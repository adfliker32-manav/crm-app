const BookingPage = require('../models/BookingPage');
const Appointment = require('../models/Appointment');
const Lead = require('../models/Lead');
const Stage = require('../models/Stage');
const User = require('../models/User');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const mongoose = require('mongoose');
const { escapeHtml, generateManageToken, buildIcs } = require('../utils/appointmentUtils');
const { checkAvailability, sendBookingConfirmation } = require('../services/bookingAvailabilityService');
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } = require('../services/whatsappService');
const { sendEmail } = require('../services/emailService');
const { emitToUser } = require('../services/socketService');
const { normalizePhoneForWhatsApp, getWorkspaceCountryCode } = require('../utils/phoneUtils');
const { resolveTemplate, buildTemplateContext } = require('../utils/templateResolver');
const { queueLeadCreatedEffects, queueLeadStageChangeEffects } = require('../utils/leadEffects');

const slugify    = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
// The suffix exists only to make the slug unique — it is NOT an identifier.
// It used to be `userId.toString().slice(-8)`, which published 8 hex characters of
// the workspace owner's User._id on a page that is public by design, narrowing the
// search space for anyone trying to guess that id. A random suffix is unique just
// as well and discloses nothing.
//
// `existingSuffix` keeps the public URL STABLE: the old scheme was derived from the
// userId, so rebuilding a slug always produced the same suffix. A purely random one
// would mint a new public URL every time the page config is saved and silently break
// every link already handed to customers. So renames reuse the suffix they already had.
const SLUG_SUFFIX_RE = /-([a-f\d]{8})$/i;
const buildSlug = (prefix, existingSuffix) => {
    const suffix = (existingSuffix && /^[a-f\d]{8}$/i.test(existingSuffix))
        ? existingSuffix
        : require('crypto').randomBytes(4).toString('hex');
    const clean  = prefix ? slugify(prefix) : '';
    return clean ? `${clean}-${suffix}` : `book-${suffix}`;
};

const formatDate = (dateObj) =>
    new Date(dateObj).toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

const resolveFrontendUrl = (req) => {
    let url =
        process.env.FRONTEND_URL ||
        (req?.get?.('host') ? `${req.protocol}://${req.get('host')}` : null) ||
        'http://localhost:5173';
    if (url.endsWith('/')) url = url.slice(0, -1);
    return url;
};

const coerceObjectIdOrNull = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (!mongoose.Types.ObjectId.isValid(trimmed)) return undefined;
        return trimmed;
    }

    if (mongoose.Types.ObjectId.isValid(value)) return value;
    return undefined;
};

const buildBookingTemplateComponents = (dbComponents, bookingData) => {
    const metaComponents = [];

    const resolveBookingVar = (varNum) => {
        switch (varNum) {
            case 1: return bookingData?.name || 'Customer';
            case 2: return bookingData?.date || '';
            case 3: return bookingData?.time || '';
            case 4: return bookingData?.service || '';
            case 5: return bookingData?.businessName || '';
            default: return '';
        }
    };

    for (const comp of (dbComponents || [])) {
        // BODY variables
        if (comp.type === 'BODY' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                metaComponents.push({
                    type: 'body',
                    parameters: nums.map(n => ({ type: 'text', text: resolveBookingVar(n) }))
                });
            }
        }

        // HEADER text variables
        if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                metaComponents.push({
                    type: 'header',
                    parameters: nums.map(n => ({ type: 'text', text: resolveBookingVar(n) }))
                });
            }
        }
    }

    return metaComponents;
};

const getPublicBookingPage = async (req, res) => {
    try {
        const slug = String(req.params.slug || '').toLowerCase().trim();
        const page = await BookingPage.findOne({ slug, isActive: true }).lean();
        if (!page) return res.status(404).json({ message: 'Booking page not found or inactive.' });

        res.json({
            title:           page.title,
            subtitle:        page.subtitle,
            services:        page.services,
            availableDays:   page.availableDays,
            timeSlots:       page.timeSlots,
            primaryColor:    page.primaryColor,
            logoUrl:         page.logoUrl,
            businessName:    page.businessName,
            maxAdvanceDays:  page.maxAdvanceDays,
            bufferMinutes:   page.bufferMinutes || 0,
            minNoticeMinutes: page.minNoticeMinutes || 0,
            slug:            page.slug,
            customQuestions: page.customQuestions || [],
            thankYouMessage: page.thankYouMessage || '',
            description:     page.description     || '',
            slugPrefix:      page.slugPrefix      || '',
            // Controls the booking flow UI and per-service conflict detection
            conflictScope:   page.conflictScope   || 'page'
        });
    } catch (err) {
        console.error('getPublicBookingPage error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

const submitBooking = async (req, res) => {
    try {
        const slug = String(req.params.slug || '').toLowerCase().trim();
        const {
            customerName, customerPhone, customerEmail,
            serviceType, appointmentDate, appointmentTime, notes,
            customAnswers
        } = req.body;

        if (!customerName || !customerPhone || !serviceType || !appointmentDate || !appointmentTime) {
            return res.status(400).json({ message: 'Name, phone, service, date and time are required.' });
        }

        const page = await BookingPage.findOne({ slug, isActive: true }).lean();
        if (!page) return res.status(404).json({ message: 'Booking page not found.' });

        // ─── Server-side availability validation (never trust the client) ───────
        // The public form enforces these rules, but a direct POST bypasses it, so
        // every constraint is re-checked here (shared with the reschedule flow).
        const availability = await checkAvailability(page, { appointmentDate, appointmentTime, serviceType });
        if (!availability.ok)
            return res.status(availability.code).json({ message: availability.message });
        const { appointmentAt, tzOffset } = availability;

        const countryCode = await getWorkspaceCountryCode(page.userId);
        const normalizedPhone = normalizePhoneForWhatsApp(customerPhone, countryCode) || customerPhone.replace(/[^0-9]/g, '');

        let stageNameToSet = null;
        if (page.leadStageId) {
            const stage = await Stage.findOne({ _id: page.leadStageId, userId: page.userId }).select('name').lean();
            stageNameToSet = stage?.name || null;
        }

        const sanitizedAnswers = Array.isArray(customAnswers)
            ? customAnswers.filter(a => a.questionId && a.answer?.trim())
            : [];

        const appt = new Appointment({
            userId:          page.userId,
            bookingPageId:   page._id,
            customerName,
            customerPhone:   normalizedPhone,
            customerEmail:   customerEmail || '',
            serviceType,
            appointmentDate: new Date(appointmentDate),
            appointmentTime,
            notes:           notes || '',
            source:          'direct_link',
            status:          'Pending',
            customAnswers:   sanitizedAnswers,
            manageToken:     generateManageToken()
        });
        // Let the model's pre-save hook derive appointmentAt in the page's timezone.
        appt.$locals.tzOffsetMinutes = tzOffset;
        await appt.save();

        // Concurrency guard: two submits can both pass the availability check above
        // and race to save. If an earlier active booking exists for the same exact
        // slot, this one loses and is rolled back. (ObjectIds are creation-ordered.)
        // In service-scope mode, scope by bookingPageId+serviceType so Turf A racing
        // with another Turf A booking is correctly detected, but a concurrent Turf B
        // booking at the same time does NOT trigger a false rollback.
        const concurrencyQuery = {
            userId: page.userId,
            appointmentDate: appt.appointmentDate,
            appointmentTime,
            status: { $in: ['Pending', 'Confirmed'] },
            _id: { $lt: appt._id }
        };
        if ((page.conflictScope || 'page') === 'service') {
            concurrencyQuery.bookingPageId = page._id;
            concurrencyQuery.serviceType   = serviceType;
        }
        const earlier = await Appointment.findOne(concurrencyQuery).select('_id').lean();
        if (earlier) {
            await Appointment.deleteOne({ _id: appt._id });
            return res.status(409).json({ message: 'Sorry, that time slot was just booked. Please choose another.' });
        }

        const formattedDate = formatDate(appt.appointmentDate);

        // Link to existing lead by phone suffix match (handles +91 vs 91 variants),
        // or create a new lead automatically if none exists.
        try {
            const digits = String(normalizedPhone || '').replace(/[^0-9]/g, '');
            const suffix = digits.length >= 10 ? digits.slice(-10) : digits;

            let lead = null;
            if (suffix) {
                const phoneRegex = new RegExp(suffix + '$');
                lead = await Lead.findOne({ userId: page.userId, phone: { $regex: phoneRegex } })
                    .select('_id status name email phone')
                    .lean();
            }

            let leadWasCreated = false;
            if (!lead) {
                // 🔒 BUG-5 FIX: Check lead limit before creating from booking page.
                const { checkLeadLimit } = require('../utils/leadLimitGuard');
                const limitCheck = await checkLeadLimit(page.userId);
                if (limitCheck.allowed) {
                const newLead = new Lead({
                    userId: page.userId,
                    name: customerName,
                    phone: normalizedPhone,
                    email: (customerEmail || '').trim(),
                    status: stageNameToSet || 'New',
                    source: 'Booking Page',
                    history: [{
                        type: 'System',
                        subType: 'Created',
                        content: 'Lead created from booking page appointment',
                        date: new Date()
                    }]
                });
                await newLead.save();
                lead = newLead.toObject();
                leadWasCreated = true;

                queueLeadCreatedEffects(newLead, page.userId.toString(), { source: 'Booking Page' });
                } // end limitCheck.allowed
            }

            const leadId = lead?._id || null;
            if (leadId) {
                await Appointment.findByIdAndUpdate(appt._id, { leadId });

                const historyItems = [{
                    type: 'System',
                    subType: 'Auto',
                    content: `Appointment booked: ${serviceType} on ${formattedDate} at ${appointmentTime}`,
                    date: new Date()
                }];

                if (sanitizedAnswers.length > 0) {
                    const answersText = sanitizedAnswers
                        .map(a => `• ${a.question}: ${a.answer}`)
                        .join('\n');
                    historyItems.push({
                        type: 'System',
                        subType: 'Auto',
                        content: `Booking form answers:\n${answersText}`,
                        date: new Date()
                    });
                }

                const setOps = {};

                // If a stage is configured for bookings, set/overwrite the lead's pipeline stage.
                if (stageNameToSet && !leadWasCreated && lead.status !== stageNameToSet) {
                    setOps.status = stageNameToSet;
                    historyItems.push({
                        type: 'System',
                        subType: 'Stage Change',
                        content: `Stage updated: ${lead.status || 'New'} ➔ ${stageNameToSet} (via booking page)`,
                        date: new Date()
                    });
                }

                // Keep email fresh if user provided it on booking.
                if (customerEmail?.trim() && !lead.email) {
                    setOps.email = customerEmail.trim();
                }

                const updateOps = {
                    $push: { history: { $each: historyItems, $slice: -100 } }
                };
                if (Object.keys(setOps).length > 0) updateOps.$set = setOps;

                await Lead.findByIdAndUpdate(leadId, updateOps);

                // Fetch the updated lead doc to pass to the workflow engine
                const leadDoc = await Lead.findById(leadId);
                if (leadDoc) {
                    const WorkflowEngine = require('../workflow-engine/WorkflowEngine');

                    // 1. LEAD_CREATED & STAGE_CHANGED (initial) were already handled by queueLeadCreatedEffects earlier.
                    // 2. If stage changed on an EXISTING lead, fire stage change effects
                    if (!leadWasCreated && stageNameToSet && lead.status !== stageNameToSet) {
                        queueLeadStageChangeEffects(leadDoc, lead.status);
                    }

                    // 3. Fire APPOINTMENT_BOOKED
                    WorkflowEngine.fireTrigger('APPOINTMENT_BOOKED', { lead: leadDoc, appointment: appt }).catch(err =>
                        console.error('[Booking Page] WorkflowEngine APPOINTMENT_BOOKED error:', err.message)
                    );
                }
            }
        } catch (err) {
            console.error('[Booking Page] confirmBooking lead sync error:', err.message);
        }

        // Send WhatsApp (template or plain-text) + email + ICS via the shared
        // helper — the same path used by the AI chatbot's book_appointment action,
        // so confirmations are always identical regardless of booking source.
        sendBookingConfirmation(
            page,
            appt,
            {
                name:          customerName,
                phone:         normalizedPhone,
                email:         customerEmail,
                serviceType,
                formattedDate,
                notes,
                appointmentAt,
                appointmentTime
            },
            resolveFrontendUrl(req)
        ).catch(e => console.error('[Booking] sendBookingConfirmation error:', e.message));

        // Real-time notification to admin's Appointments page
        try {
            emitToUser(page.userId.toString(), 'appointment:new', {
                _id:             appt._id,
                customerName,
                customerPhone:   normalizedPhone,
                serviceType,
                appointmentDate: appt.appointmentDate,
                appointmentTime,
                status:          'Pending',
                source:          'direct_link',
                createdAt:       appt.createdAt
            });
        } catch (_) { /* socket may not be connected */ }

        res.status(201).json({ success: true, message: 'Appointment booked successfully!', appointmentId: appt._id });
    } catch (err) {
        console.error('submitBooking error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

const getMyBookingPage = async (req, res) => {
    try {
        const userId = req.tenantId;
        let page = await BookingPage.findOne({ userId }).lean();

        if (!page) {
            const user = await User.findById(userId).select('name').lean();
            const slug = buildSlug(user?.name || '');
            const newPage = new BookingPage({
                userId,
                slug,
                businessName: user?.name || 'My Business',
                title:    'Book an Appointment',
                subtitle: 'Choose a service and pick a time.',
                services: ['Site Visit', 'Online Meeting', 'Consultation']
            });
            await newPage.save();
            page = newPage.toObject();
        }

        const frontendUrl = resolveFrontendUrl(req);
        res.json({ ...page, publicUrl: `${frontendUrl}/book/${page.slug}` });
    } catch (err) {
        console.error('getMyBookingPage error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

const updateMyBookingPage = async (req, res) => {
    try {
        const userId = req.tenantId;
        const allowed = [
            'title', 'subtitle', 'services', 'availableDays', 'timeSlots',
            'primaryColor', 'logoUrl', 'businessName', 'confirmationMessage',
            'confirmationTemplateId', 'leadStageId',
            'sendConfirmation', 'isActive', 'maxAdvanceDays', 'bufferMinutes',
            'timezoneOffsetMinutes', 'minNoticeMinutes', 'slotDurationMinutes',
            'customQuestions', 'thankYouMessage', 'description', 'slugPrefix',
            'conflictScope'
        ];
        const updates = {};
        allowed.forEach(key => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

        if ('leadStageId' in updates) {
            const coerced = coerceObjectIdOrNull(updates.leadStageId);
            if (coerced === undefined) return res.status(400).json({ message: 'Invalid leadStageId' });
            updates.leadStageId = coerced;
        }

        if ('confirmationTemplateId' in updates) {
            const coerced = coerceObjectIdOrNull(updates.confirmationTemplateId);
            if (coerced === undefined) return res.status(400).json({ message: 'Invalid confirmationTemplateId' });
            updates.confirmationTemplateId = coerced;
        }

        // Regenerate the slug only when the prefix ACTUALLY changes. The client
        // posts the whole config on every save, so rebuilding unconditionally would
        // re-mint the public URL each time and break links already in customers'
        // hands. The existing random suffix is carried over so a rename keeps the
        // same suffix rather than inventing a new one.
        if ('slugPrefix' in updates) {
            const current = await BookingPage.findOne({ userId }).select('slug slugPrefix').lean();
            if (!current || current.slugPrefix !== updates.slugPrefix) {
                const existingSuffix = current?.slug ? (current.slug.match(SLUG_SUFFIX_RE)?.[1] || null) : null;
                updates.slug = buildSlug(updates.slugPrefix, existingSuffix);
            }
        }

        let page = await BookingPage.findOneAndUpdate(
            { userId },
            { $set: updates },
            { returnDocument: 'after', upsert: false }
        );

        if (!page) {
            const slug = buildSlug();
            page = new BookingPage({ userId, slug, ...updates });
            await page.save();
        }

        const frontendUrl = resolveFrontendUrl(req);
        res.json({ ...page.toObject(), publicUrl: `${frontendUrl}/book/${page.slug}` });
    } catch (err) {
        console.error('updateMyBookingPage error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getPublicBookingPage, submitBooking, getMyBookingPage, updateMyBookingPage };
