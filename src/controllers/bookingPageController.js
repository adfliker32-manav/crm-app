const BookingPage = require('../models/BookingPage');
const Appointment = require('../models/Appointment');
const Lead = require('../models/Lead');
const Stage = require('../models/Stage');
const User = require('../models/User');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const mongoose = require('mongoose');
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } = require('../services/whatsappService');
const { sendEmail } = require('../services/emailService');
const { emitToUser } = require('../services/socketService');
const { normalizePhoneForWhatsApp, getWorkspaceCountryCode } = require('../utils/phoneUtils');
const { replaceVariables } = require('../utils/emailTemplateUtils');

const slugify    = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const buildSlug  = (userId, prefix) => {
    const suffix = userId.toString().slice(-8);
    const clean  = prefix ? slugify(prefix) : '';
    return clean ? `${clean}-${suffix}` : `book-${suffix}`;
};

const formatDate = (dateObj) =>
    new Date(dateObj).toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

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
            slug:            page.slug,
            customQuestions: page.customQuestions || [],
            thankYouMessage: page.thankYouMessage || '',
            description:     page.description     || '',
            slugPrefix:      page.slugPrefix      || ''
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
            customerName,
            customerPhone:   normalizedPhone,
            customerEmail:   customerEmail || '',
            serviceType,
            appointmentDate: new Date(appointmentDate),
            appointmentTime,
            notes:           notes || '',
            source:          'direct_link',
            status:          'Pending',
            customAnswers:   sanitizedAnswers
        });
        await appt.save();

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
            }
        } catch (_) { /* non-critical */ }

        // Send WhatsApp + email confirmations in parallel (independent operations)
        if (page.sendConfirmation) {
            const bookingData = {
                name: customerName,
                date: formattedDate,
                time: appointmentTime,
                service: serviceType,
                businessName: page.businessName || ''
            };

            const emailHtml = customerEmail?.trim() ? `
                <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
                    <h2 style="color:#1e293b;margin-bottom:4px;">✅ Appointment Confirmed</h2>
                    <p style="color:#64748b;margin-top:0;">Hi <strong>${customerName}</strong>, your appointment has been booked!</p>
                    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
                        <tr><td style="padding:10px 0;color:#64748b;font-size:14px;">Service</td><td style="padding:10px 0;font-weight:600;color:#1e293b;">${serviceType}</td></tr>
                        <tr style="border-top:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:14px;">Date</td><td style="padding:10px 0;font-weight:600;color:#1e293b;">${formattedDate}</td></tr>
                        <tr style="border-top:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:14px;">Time</td><td style="padding:10px 0;font-weight:600;color:#1e293b;">${appointmentTime}</td></tr>
                        ${notes ? `<tr style="border-top:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:14px;">Notes</td><td style="padding:10px 0;color:#1e293b;">${notes}</td></tr>` : ''}
                    </table>
                    <p style="color:#94a3b8;font-size:12px;margin-top:24px;">${page.businessName || ''}</p>
                </div>
            ` : null;

            const sends = [];

            if (page.confirmationTemplateId) {
                const tpl = await WhatsAppTemplate.findOne({ _id: page.confirmationTemplateId })
                    .select('name language components status')
                    .lean();

                if (tpl?.name && tpl.status === 'APPROVED') {
                    const components = buildBookingTemplateComponents(tpl.components || [], bookingData);
                    sends.push(
                        sendWhatsAppTemplateMessage(
                            normalizedPhone,
                            tpl.name,
                            tpl.language || 'en',
                            components,
                            page.userId,
                            { isAutomated: true, triggerType: 'booking_confirmation' }
                        )
                            .then(() => Appointment.findByIdAndUpdate(appt._id, { confirmationSent: true }))
                            .catch(e => console.warn('[Booking] WhatsApp template confirmation failed:', e.message))
                    );
                }
            }

            // Backward-compatible fallback (older configs) — use plain text only if no template selected.
            if (sends.length === 0) {
                const waMsg = replaceVariables(page.confirmationMessage, {
                    name:    bookingData.name,
                    date:    bookingData.date,
                    time:    bookingData.time,
                    service: bookingData.service
                });

                sends.push(
                    sendWhatsAppTextMessage(normalizedPhone, waMsg, page.userId)
                        .then(() => Appointment.findByIdAndUpdate(appt._id, { confirmationSent: true }))
                        .catch(e => console.warn('[Booking] WhatsApp confirmation failed:', e.message))
                );
            }

            if (emailHtml) {
                sends.push(
                    sendEmail({
                        to:      customerEmail.trim(),
                        subject: `✅ Appointment Confirmed — ${serviceType} on ${formattedDate}`,
                        html:    emailHtml,
                        userId:  page.userId
                    }).catch(e => console.warn('[Booking] Email confirmation failed:', e.message))
                );
            }

            await Promise.all(sends);
        }

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
            const slug = buildSlug(userId, user?.name || '');
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

        let frontendUrl =
            process.env.FRONTEND_URL ||
            (req.get('host') ? `${req.protocol}://${req.get('host')}` : null) ||
            'http://localhost:5173';
        if (frontendUrl.endsWith('/')) frontendUrl = frontendUrl.slice(0, -1);
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
            'customQuestions', 'thankYouMessage', 'description', 'slugPrefix'
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

        // Regenerate slug when user changes the slug prefix
        if ('slugPrefix' in updates) {
            updates.slug = buildSlug(userId, updates.slugPrefix);
        }

        let page = await BookingPage.findOneAndUpdate(
            { userId },
            { $set: updates },
            { new: true, upsert: false }
        );

        if (!page) {
            const slug = buildSlug(userId);
            page = new BookingPage({ userId, slug, ...updates });
            await page.save();
        }

        let frontendUrl =
            process.env.FRONTEND_URL ||
            (req.get('host') ? `${req.protocol}://${req.get('host')}` : null) ||
            'http://localhost:5173';
        if (frontendUrl.endsWith('/')) frontendUrl = frontendUrl.slice(0, -1);
        res.json({ ...page.toObject(), publicUrl: `${frontendUrl}/book/${page.slug}` });
    } catch (err) {
        console.error('updateMyBookingPage error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getPublicBookingPage, submitBooking, getMyBookingPage, updateMyBookingPage };
