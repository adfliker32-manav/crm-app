const User = require('../models/User');
const Lead = require('../models/Lead');
const Stage = require('../models/Stage');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const mongoose = require('mongoose');
const axios = require('axios');
const Papa = require('papaparse');
const { sendAutomatedEmailOnLeadCreate, sendAutomatedEmailOnStageChange } = require('../services/emailAutomationService');
const { sendAutomatedWhatsAppOnLeadCreate, sendAutomatedWhatsAppOnStageChange } = require('../services/whatsappAutomationService');
const { sendMetaEventForLead } = require('../services/metaConversionService');
const { sendEmail } = require('../services/emailService');
const { logActivity } = require('../services/auditService');
const { findDuplicates, findAllDuplicateGroups, normalizePhone } = require('../services/duplicateService');
const { evaluateLead } = require('../services/AutomationService');
const WorkflowEngine    = require('../workflow-engine/WorkflowEngine'); // New Workflow Engine
const { logUsage } = require('../services/usageLogger');
const {
    getRequestUserId,
    hasManageTeamAccess,
    parseBoundedInteger,
    runInBackground
} = require('../utils/controllerHelpers');
const { validateCustomData, coerceCustomData } = require('../utils/customFieldValidation');
const { deleteDocumentsForLeads } = require('../services/leadDocumentService');

const DEFAULT_LEAD_PAGE = 1;
const DEFAULT_LEAD_PAGE_SIZE = 100;
const MAX_LEAD_PAGE_SIZE = 500; // Raised from 200 — frontend requests limit=500
const DEFAULT_LEAD_STATUS = 'New';
const DEFAULT_LEAD_SOURCE = 'Manual Entry';
const ALLOWED_LEAD_UPDATE_FIELDS = new Set([
    'name',
    'email',
    'phone',
    'status',
    'source',
    'customData',
    'dealValue',
    'tags'
]);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Strict 24-char hex, NOT mongoose.Types.ObjectId.isValid(): that helper accepts
// any 12-character string (12 bytes is a valid raw ObjectId) and then casts it to
// a DIFFERENT id than the caller supplied.
const isValidLeadId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

const {
    appendLeadHistory,
    queueLeadCreatedEffects,
    queueLeadStageChangeEffects,
    queueLeadAssignmentEffects,
    queueBulkLeadAssignmentEffects,
    queueLeadDeletionEffects
} = require('../utils/leadEffects');

const resolveActorName = async (user) => {
    if (user?.name) {
        return user.name;
    }

    const actorId = getRequestUserId(user);
    if (!actorId) {
        return 'Unknown';
    }

    const actor = await User.findById(actorId).select('name');
    return actor ? actor.name : 'Unknown';
};

const hasStageChanged = (previousStatus, nextStatus) =>
    Boolean(nextStatus && nextStatus !== previousStatus);

const applyNextFollowUpDateUpdate = (lead, updates) => {
    if (!hasOwn(updates, 'nextFollowUpDate')) {
        return;
    }

    if (updates.nextFollowUpDate) {
        if (lead.nextFollowUpDate && !lead.lastFollowUpDate) {
            lead.lastFollowUpDate = lead.nextFollowUpDate;
        }

        lead.nextFollowUpDate = new Date(updates.nextFollowUpDate);
    } else {
        lead.nextFollowUpDate = null;
    }

    delete updates.nextFollowUpDate;
};

const applyLeadUpdates = (lead, updates) => {
    Object.keys(updates).forEach((key) => {
        if (ALLOWED_LEAD_UPDATE_FIELDS.has(key) && updates[key] !== undefined) {
            lead[key] = updates[key];
        }
    });
};

// Custom field definitions for a workspace. Cheap, indexed, single-field read —
// the manual lead paths need it on every write to enforce dropdown option lists.
const getCustomFieldDefs = async (ownerId) => {
    const settings = await WorkspaceSettings.findOne({ userId: ownerId })
        .select('customFieldDefinitions')
        .lean();
    return settings?.customFieldDefinitions || [];
};

// Translate `?cf=budget:50k&cf=service:SEO` into Mongo conditions.
// A multiselect stores an array, and Mongo equality on an array field matches
// when the array CONTAINS the value — so one expression covers both types.
const applyCustomFieldFilters = (query, rawCf, definitions) => {
    if (!rawCf) return;
    const entries = Array.isArray(rawCf) ? rawCf : [rawCf];
    const validKeys = new Set(definitions.map(d => d.key));

    for (const entry of entries.slice(0, 10)) {
        const raw = String(entry ?? '');
        const sep = raw.indexOf(':');
        if (sep <= 0) continue;
        const key = raw.slice(0, sep).trim();
        const value = raw.slice(sep + 1).trim();
        // Only keys the admin actually defined — never let a caller probe
        // arbitrary customData paths through the filter bar.
        if (!key || !value || !validKeys.has(key)) continue;
        query[`customData.${key}`] = value.slice(0, 500);
    }
};


const sendMetaEventIfEnabled = async (lead, newStatus, oldStatus) => {
    // Outbox-backed single entry point: resolves config (incl. agent → parent
    // fallback), dedupes, and guarantees delivery-or-visible-failure via the
    // CapiEventOutbox drain cron.
    runInBackground('Meta CAPI error (non-blocking):', () =>
        sendMetaEventForLead(lead, newStatus, oldStatus)
    );
};

// ==========================================
// 1. GET LEADS (Paginated — replaces dangerous limit(2000))
// Query params: ?page=1&limit=50&status=New&search=john
// ==========================================
const getLeads = async (req, res) => {
    try {
        const query = { ...req.dataScope };

        const page = parseBoundedInteger(req.query.page, DEFAULT_LEAD_PAGE, { min: 1 });
        const limit = parseBoundedInteger(req.query.limit, DEFAULT_LEAD_PAGE_SIZE, {
            min: 1,
            max: MAX_LEAD_PAGE_SIZE
        });
        const skip = (page - 1) * limit;

        // Optional filters
        if (req.query.status) query.status = req.query.status;
        if (req.query.assignedTo) query.assignedTo = req.query.assignedTo;
        if (req.query.search) {
            if (req.query.search.length > 50) {
                return res.status(400).json({ success: false, message: 'Search query exceeds maximum length of 50 characters' });
            }
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(escapeRegExp(req.query.search), 'i');
            query.$or = [{ name: rx }, { phone: rx }, { email: rx }];
        }

        // Tag filter — accepts comma-separated names, optional &tagMatch=any|all (default: all)
        if (req.query.tags) {
            const tagNames = String(req.query.tags)
                .split(',')
                .map(t => t.trim())
                .filter(Boolean);
            if (tagNames.length > 0) {
                const op = req.query.tagMatch === 'any' ? '$in' : '$all';
                query.tags = { [op]: tagNames };
            }
        }

        // Custom field filter — ?cf=<key>:<value>, repeatable (AND across keys).
        if (req.query.cf) {
            const defs = await getCustomFieldDefs(req.tenantId);
            applyCustomFieldFilters(query, req.query.cf, defs);
        }

        const [leads, total] = await Promise.all([
            Lead.find(query)
                .select('-history -messages -followUpHistory -customData')
                .populate('assignedTo', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Lead.countDocuments(query)
        ]);

        res.json({
            leads,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasMore: page * limit < total
            }
        });
    } catch (err) {
        console.error('Get Leads Error:', err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// ==========================================
// 1.5 GET SINGLE LEAD (Full Document with History)
// ==========================================
const getLeadById = async (req, res) => {
    try {
        const { id } = req.params;
        const query = { _id: id, ...req.dataScope };

        const lead = await Lead.findOne(query).select('-messages').populate('assignedTo', 'name email').lean();
        if (!lead) return res.status(404).json({ message: 'Lead not found or unauthorized' });

        res.json(lead);
    } catch (err) {
        console.error("Get Lead By Id Error:", err);
        res.status(500).send('Server Error');
    }
};

// ==========================================
// 2. CREATE LEAD
// ==========================================
const createLead = async (req, res) => {
    try {
        const { name, email, phone, status, source, customData, force } = req.body;
        const ownerId = req.tenantId;

        // 🚦 LEAD LIMIT CHECK — uses req.workspace from auth middleware cache (no extra DB query)
        // A limit of 0 (or null) means UNLIMITED — higher tiers (e.g. Enterprise)
        // set leadLimit:0 for unlimited, so we must NOT treat 0 as a hard cap.
        const leadLimit = req.workspace?.planFeatures?.leadLimit;

        if (leadLimit != null && leadLimit > 0) {
            const leadCount = await Lead.countDocuments({ userId: ownerId });
            if (leadCount >= leadLimit) {
                return res.status(403).json({
                    success: false,
                    error: 'lead_limit_reached',
                    message: `You have reached your maximum account capacity of ${leadLimit} leads. Please contact your administrator to increase your limit.`,
                    currentCount: leadCount,
                    limit: leadLimit
                });
            }
        }

        // 🔍 DUPLICATE CHECK — unless force=true
        // FIX 5.2: Trim and null-coerce phone/email before the duplicate check.
        //           An empty string phone ("") would match ALL leads with empty phone,
        //           returning false positives and blocking valid lead creation.
        const normalizedPhoneForDupCheck = phone?.trim() || null;
        const normalizedEmailForDupCheck = email?.trim() || null;

        if (!force) {
            const duplicates = await findDuplicates(ownerId, normalizedPhoneForDupCheck, normalizedEmailForDupCheck);
            if (duplicates.length > 0) {
                return res.status(409).json({
                    duplicate: true,
                    message: 'Duplicate lead detected! A lead with the same phone or email already exists.',
                    existingLead: duplicates[0]
                });
            }
        }

        // Custom field values must match the option list the admin defined.
        // The Add Lead form already restricts this; enforcing it here closes the
        // same hole for anything hitting the API directly.
        const customFieldDefs = await getCustomFieldDefs(ownerId);
        const customCheck = validateCustomData(customData, customFieldDefs);
        if (!customCheck.valid) {
            return res.status(400).json({
                success: false,
                error: 'invalid_custom_fields',
                message: customCheck.errors[0],
                errors: customCheck.errors
            });
        }

        const newLead = new Lead({
            userId: ownerId,
            name,
            email,
            phone,
            status: status || DEFAULT_LEAD_STATUS,
            source: source || DEFAULT_LEAD_SOURCE,
            customData: customCheck.cleaned
        });

        // If the lead is created directly as closed, capture close timestamp
        if (typeof newLead.status === 'string') {
            if (/won/i.test(newLead.status)) {
                newLead.wonAt = new Date();
            } else if (/lost/i.test(newLead.status) || /dead/i.test(newLead.status)) {
                newLead.lostAt = new Date();
            }
        }

        // Enterprise ABAC: Auto-assign lead to agent if they created it
        if (req.user.role === 'agent') {
            newLead.assignedTo = getRequestUserId(req.user);
        }

        await newLead.save();

        // 📊 Usage Logging (non-blocking)
        logUsage(ownerId, 'leadsCreated');

        // Log activity
        logActivity({
            userId: ownerId,
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_CREATED',
            entityType: 'Lead',
            entityId: newLead._id,
            entityName: newLead.name,
            metadata: { source: source || DEFAULT_LEAD_SOURCE, status: status || DEFAULT_LEAD_STATUS },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        queueLeadCreatedEffects(newLead, ownerId);

        res.json(newLead);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 2.5 SEND MANUAL EMAIL (New)
// ==========================================
const sendManualEmail = async (req, res) => {
    try {
        const { to, subject, message } = req.body;
        const leadId = req.params.id;
        const userId = getRequestUserId(req.user);

        if (!to || !subject || !message) {
            return res.status(400).json({ message: "To, Subject, and Message are required" });
        }

        const leadToUpdate = await Lead.findOne({ _id: leadId, ...req.dataScope });
        if (!leadToUpdate) {
            return res.status(404).json({ message: "Lead not found or access denied" });
        }

        // Send Email. Logging + Inbox threading happen inside sendEmail(); this
        // path previously did neither, so emails sent from the lead detail view
        // never showed up in the Email Center at all.
        await sendEmail({
            to,
            subject,
            text: message,
            userId,
            conversational: true, // human-typed 1:1 message
            leadId: leadToUpdate._id
        });

        // Log to History
        await Lead.findByIdAndUpdate(leadId, {
            $push: {
                history: {
                    $each: [{
                        type: 'Email',
                        subType: 'Manual',
                        content: `Sent: ${subject}`,
                        metadata: { subject, body: message },
                        date: new Date()
                    }],
                    $slice: -100
                }
            }
        });

        res.json({ success: true, message: "Email sent successfully" });
    } catch (err) {
        console.error("Manual Email Error:", err);
        res.status(500).json({ message: "Failed to send email" });
    }
};

// ==========================================
// 3. UPDATE LEAD
// ==========================================
const updateLead = async (req, res) => {
    try {
        // SECURITY FIX: Validate ObjectId format
        if (!isValidLeadId(req.params.id)) {
            return res.status(400).json({ message: "Invalid lead ID format" });
        }

        // SECURITY FIX: Data scope check preventing IDOR
        const ownerId = req.tenantId;

        const lead = await Lead.findOne({ _id: req.params.id, ...req.dataScope });

        if (!lead) {
            return res.status(404).json({ message: "Lead not found or access denied" });
        }

        const updates = { ...req.body };

        // ── Reassignment through the lead-edit endpoint ──────────────────────
        // `assignedTo` is declared on the updateLead schema but is deliberately
        // NOT in ALLOWED_LEAD_UPDATE_FIELDS, so applyLeadUpdates used to drop it
        // silently: the API answered 200 OK, the owner never changed, and the
        // WhatsApp conversation never followed. Handled explicitly here instead.
        //
        // Gated on `assignLeads`, not `editLeads` (this route's own gate):
        // PUT /leads/:id must not become a way around the permission that
        // PUT /leads/:id/assign enforces.
        let assignmentChanged = false;
        let assigneeName = null;
        if (hasOwn(updates, 'assignedTo')) {
            const rawAssignee = updates.assignedTo;
            delete updates.assignedTo; // never let applyLeadUpdates see it

            const nextAssignee = rawAssignee ? String(rawAssignee) : null;
            const currentAssignee = lead.assignedTo ? String(lead.assignedTo) : null;

            if (nextAssignee !== currentAssignee) {
                const canAssign = ['manager', 'superadmin'].includes(req.user.role)
                    || req.user.permissions?.assignLeads === true;
                if (!canAssign) {
                    return res.status(403).json({
                        success: false,
                        message: "Permission denied: You do not have 'assignLeads' permission"
                    });
                }

                if (nextAssignee) {
                    // Same in-workspace resolution assignLead performs — an id
                    // alone must never reach a user in someone else's account,
                    // and the workspace owner counts as a valid assignee.
                    const resolvedAssignee = await resolveAssignee(nextAssignee, ownerId);
                    if (!resolvedAssignee.ok) {
                        return res.status(resolvedAssignee.status).json({ message: resolvedAssignee.message });
                    }
                    lead.assignedTo = resolvedAssignee.agent._id;
                    assigneeName = resolvedAssignee.agent.name;
                } else {
                    lead.assignedTo = null;
                }
                assignmentChanged = true;

                lead.history.push({
                    type: 'System',
                    subType: 'Assignment',
                    content: assigneeName ? `Assigned to ${assigneeName}` : 'Unassigned',
                    date: new Date()
                });
            }
        }

        // Same option-list enforcement as create. `partial` because an edit may
        // touch only some fields, and `existingData` so a value stored before an
        // admin retired its option still round-trips instead of blocking the save.
        if (hasOwn(updates, 'customData')) {
            const customFieldDefs = await getCustomFieldDefs(ownerId);
            const customCheck = validateCustomData(updates.customData, customFieldDefs, {
                existingData: lead.customData, // Mongoose Map — normalised inside
                partial: true
            });
            if (!customCheck.valid) {
                return res.status(400).json({
                    success: false,
                    error: 'invalid_custom_fields',
                    message: customCheck.errors[0],
                    errors: customCheck.errors
                });
            }
            updates.customData = customCheck.cleaned;
        }

        applyNextFollowUpDateUpdate(lead, updates);

        // Handle follow-up template fields alongside nextFollowUpDate
        if (hasOwn(req.body, 'followUpTemplateName') || hasOwn(req.body, 'followUpTemplateType')) {
            if (lead.nextFollowUpDate) {
                lead.followUpTemplateType = req.body.followUpTemplateType || null;
                lead.followUpTemplateName = req.body.followUpTemplateName || null;
                lead.followUpTemplateSent = false;
            }
        }
        delete updates.followUpTemplateType;
        delete updates.followUpTemplateName;
        delete updates.followUpTemplateSent;

        const oldStatus = lead.status;
        const nextStatus = updates.status;
        const stageChanged = hasStageChanged(oldStatus, nextStatus);
        // L3 FIX: capture tags before the update so we can detect newly-added ones
        // and fire TAG_ADDED for tags added via a plain lead edit (not just bulk /
        // automation). Guarded below so re-saving existing tags never re-fires.
        const oldTags = Array.isArray(lead.tags) ? [...lead.tags] : [];
        applyLeadUpdates(lead, updates);

        if (stageChanged) {
            const now = new Date();
            lead.stageEnteredAt = now;
            if (typeof nextStatus === 'string' && /won/i.test(nextStatus)) {
                lead.wonAt = now;
                lead.lostAt = null;
            } else if (typeof nextStatus === 'string' && (/lost/i.test(nextStatus) || /dead/i.test(nextStatus))) {
                lead.lostAt = now;
            }
        }

        await lead.save();

        // The Lead is the single source of truth for who owns its WhatsApp
        // conversation, so every path that writes assignedTo must call this —
        // fired only after the write lands.
        if (assignmentChanged) {
            queueLeadAssignmentEffects(lead, ownerId);
        }

        const initiatorName = await resolveActorName(req.user);

        const changesObj = {};
        if (stageChanged) {
            changesObj.status = { before: oldStatus, after: nextStatus };
        }
        logActivity({
            userId: getRequestUserId(req.user),
            userName: initiatorName,
            actionType: stageChanged ? 'LEAD_STATUS_CHANGED' : 'LEAD_EDITED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            changes: Object.keys(changesObj).length > 0 ? changesObj : null,
            // `assignedTo` is consumed above and deleted from `updates`, so it
            // has to be re-added here or a reassignment would be invisible in
            // the audit trail.
            metadata: {
                fieldsUpdated: assignmentChanged
                    ? [...Object.keys(updates), 'assignedTo']
                    : Object.keys(updates)
            },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        // Send automated email if stage changed
        if (stageChanged && lead.email) {
            sendAutomatedEmailOnStageChange(lead, oldStatus, nextStatus, lead.userId)
                .then(sent => {
                    if (sent) {
                        Lead.findByIdAndUpdate(lead._id, {
                            $push: {
                                history: {
                                    $each: [{
                                        type: 'Email',
                                        subType: 'Auto',
                                        content: `Automated Email: Stage changed to ${nextStatus}`,
                                        date: new Date()
                                    }],
                                    $slice: -100
                                }
                            }
                        }).exec().catch(err => console.error('Email auto history error:', err.message));
                    }
                })
                .catch(err => {
                    console.error('Email automation error (non-blocking):', err);
                });
        }

        // Send automated WhatsApp if stage changed
        if (stageChanged && lead.phone) {
            sendAutomatedWhatsAppOnStageChange(lead, oldStatus, nextStatus, lead.userId)
                .then(sent => {
                    if (sent) {
                        Lead.findByIdAndUpdate(lead._id, {
                            $push: {
                                history: {
                                    $each: [{
                                        type: 'WhatsApp',
                                        subType: 'Auto',
                                        content: `Automated WhatsApp: Stage changed to ${nextStatus}`,
                                        date: new Date()
                                    }],
                                    $slice: -100
                                }
                            }
                        }).exec().catch(err => console.error('WA auto history error:', err.message));
                    }
                })
                .catch(err => {
                    console.error('WhatsApp automation error (non-blocking):', err);
                });
        }

        // 🟢 Explicit History Log for Stage Change (Requested by User)
        if (stageChanged) {
            await Lead.findByIdAndUpdate(lead._id, {
                $push: {
                    history: {
                        $each: [{
                            type: 'System',
                            subType: 'Stage Change',
                            content: `Stage updated: ${oldStatus} ➔ ${nextStatus} by ${initiatorName}`,
                            date: new Date()
                        }],
                        $slice: -100
                    }
                }
            });
        }

        if (stageChanged) {
            await sendMetaEventIfEnabled(lead, nextStatus, oldStatus);
            queueLeadStageChangeEffects(lead, oldStatus);
        }

        // L3 FIX: fire LEAD_UPDATED (previously a dead trigger — defined but never
        // fired). changedFields lets triggerConfig field filters match.
        runInBackground('Workflow Engine Error (LEAD_UPDATED):', () =>
            WorkflowEngine.fireTrigger('LEAD_UPDATED', {
                lead,
                changedFields: Object.keys(updates || {})
            })
        );

        // L3 FIX: fire TAG_ADDED for tags added via a plain lead edit. Compute the
        // set difference so re-saving existing tags never re-fires the trigger.
        const newTags = (Array.isArray(lead.tags) ? lead.tags : [])
            .filter(t => !oldTags.includes(t));
        if (newTags.length > 0) {
            runInBackground('Workflow Engine Error (TAG_ADDED):', () =>
                WorkflowEngine.fireTrigger('TAG_ADDED', { lead, addedTags: newTags })
            );
        }

        res.json({ success: true, lead });
    } catch (err) {
        console.error("Update Lead Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 4. DELETE LEAD
// ==========================================
const deleteLead = async (req, res) => {
    try {
        // SECURITY FIX: Validate ObjectId format
        if (!isValidLeadId(req.params.id)) {
            return res.status(400).json({ message: "Invalid lead ID format" });
        }

        // SECURITY FIX: Data scope check preventing IDOR
        const ownerId = req.tenantId;
        const deletedLead = await Lead.findOneAndDelete({ _id: req.params.id, ...req.dataScope });

        if (!deletedLead) {
            return res.status(404).json({ message: "Lead not found or access denied" });
        }

        // Leads are hard-deleted, so their attachments must be reclaimed from
        // object storage here — nothing else references those bytes afterwards
        // and they would be billed forever. Never throws.
        await deleteDocumentsForLeads(ownerId, [deletedLead._id]);

        // The conversation survives (its message history is still wanted) but
        // loses the lead link and the derived owner — the assignment's
        // justification is gone, so it falls back to manager-only visibility.
        queueLeadDeletionEffects([deletedLead._id], ownerId);

        // Log deletion
        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_DELETED',
            entityType: 'Lead',
            entityId: deletedLead._id,
            entityName: deletedLead.name,
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        res.json({ success: true, message: "Lead deleted successfully" });
    } catch (err) {
        console.error("Delete Lead Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 5. ADD NOTE
// ==========================================
const addNote = async (req, res) => {
    try {
        // SECURITY FIX: Validate ObjectId format
        if (!isValidLeadId(req.params.id)) {
            return res.status(400).json({ message: "Invalid lead ID format" });
        }

        // SECURITY FIX: Validate and sanitize input
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ message: "Note text is required" });
        }

        // SECURITY FIX: Data scope check preventing IDOR
        const ownerId = req.tenantId;

        const updatedLead = await Lead.findOneAndUpdate(
            { _id: req.params.id, ...req.dataScope },
            {
                $push: {
                    notes: {
                        $each: [{ text: text.trim(), date: new Date() }],
                        $slice: -50
                    },
                    history: {
                        $each: [{
                            type: 'Note',
                            subType: 'Manual',
                            content: text.trim(),
                            date: new Date()
                        }],
                        $slice: -100
                    }
                }
            },
            { returnDocument: 'after' }
        );

        if (!updatedLead) return res.status(404).json({ message: "Lead not found or access denied" });

        // Log note addition
        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'NOTE_ADDED',
            entityType: 'Lead',
            entityId: updatedLead._id,
            entityName: updatedLead.name,
            metadata: { noteText: text.trim().substring(0, 100) },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        res.json(updatedLead);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 6. STAGE MANAGEMENT (Get, Create, Delete)
// ==========================================
const getStages = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        let stages = await Stage.find({ userId: ownerId }).sort('order').lean();

        if (stages.length === 0) {
            const defaults = [
                { name: 'New', order: 1, userId: ownerId },
                { name: 'Contacted', order: 2, userId: ownerId },
                { name: 'Won', order: 3, userId: ownerId }
            ];
            const inserted = await Stage.insertMany(defaults);
            stages = inserted.map(s => s.toObject ? s.toObject() : s);
        }

        // Attach lead counts from DB so callers don't have to paginate all leads client-side
        const counts = await Lead.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(ownerId), deletedAt: null } },
            {
                $group: {
                    _id: '$status',
                    total: { $sum: 1 },
                    withPhone: {
                        $sum: {
                            $cond: [{ $and: [{ $ifNull: ['$phone', false] }, { $ne: ['$phone', ''] }] }, 1, 0]
                        }
                    }
                }
            }
        ]);
        const countMap = counts.reduce((m, c) => { m[c._id] = c; return m; }, {});
        stages = stages.map(s => ({
            ...s,
            leadCount: countMap[s.name]?.total || 0,
            leadCountWithPhone: countMap[s.name]?.withPhone || 0
        }));

        res.json(stages);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

const createStage = async (req, res) => {
    try {
        const canManageTeam = hasManageTeamAccess(req.user);
        if (!canManageTeam) return res.status(403).json({ message: "Unauthorized to modify pipeline stages" });

        const ownerId = req.tenantId;
        const newStage = await Stage.create({
            name: req.body.name,
            order: Date.now(),
            userId: ownerId
        });
        res.json(newStage);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

const deleteStage = async (req, res) => {
    try {
        const canManageTeam = hasManageTeamAccess(req.user);
        if (!canManageTeam) return res.status(403).json({ message: "Unauthorized to modify pipeline stages" });

        const ownerId = req.tenantId;
        const stage = await Stage.findOne({ _id: req.params.id, userId: ownerId });

        if (!stage) return res.status(404).json({ message: 'Stage not found' });
        if (stage.name === 'New') return res.status(400).json({ message: "Cannot delete 'New' stage" });

        // 🔴 DATA SAFETY: Move leads FIRST, then delete stage.
        // If server crashes after move but before delete, stage still exists (retryable).
        // Old order (delete first, then move) could leave leads stuck in a deleted stage.
        await Lead.updateMany(
            { userId: ownerId, status: stage.name },
            { $set: { status: 'New' } }
        );

        await Stage.deleteOne({ _id: stage._id });

        return res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

const updateStage = async (req, res) => {
    try {
        const canManageTeam = hasManageTeamAccess(req.user);
        if (!canManageTeam) return res.status(403).json({ message: "Unauthorized to modify pipeline stages" });

        const ownerId = req.tenantId;
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Stage name is required' });
        }

        const stage = await Stage.findOne({ _id: req.params.id, userId: ownerId });
        if (!stage) return res.status(404).json({ message: 'Stage not found' });
        if (stage.name === 'New') return res.status(400).json({ message: "Cannot rename the 'New' stage" });

        const oldName = stage.name;
        stage.name = name.trim();
        await stage.save();

        // Bulk-update all leads that had the old stage name
        await Lead.updateMany(
            { userId: ownerId, status: oldName },
            { $set: { status: name.trim() } }
        );

        return res.json({ success: true, stage });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 7. SYNC GOOGLE SHEET
// ==========================================
const syncLeads = async (req, res) => {
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ message: "Link required" });

    let count = 0; // FIX: was an implicit global reference — now properly declared
    try {
        const userId = req.tenantId; // Enterprise ABAC Fix: Sync goes to correct tenant DB

        // Extract sheet ID from Google Sheets URL
        const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!sheetIdMatch || !sheetIdMatch[1]) {
            return res.status(400).json({ message: "Invalid Google Sheets URL format" });
        }

        // ⚡ PERFORMANCE: Use cached workspace from auth middleware for planFeatures.
        // CustomFieldDefinitions need fresh fetch since the auth cache may not include them.
        const cachedWorkspace = req.workspace || {};
        const workspace = await WorkspaceSettings.findOne({ userId: userId }).select('customFieldDefinitions planFeatures').lean();
        const customFieldDefs = workspace?.customFieldDefinitions || [];

        const sheetId = sheetIdMatch[1];
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

        const response = await axios.get(csvUrl);
        const parsed = Papa.parse(response.data, { header: true, skipEmptyLines: true });

        // Protection: Limit import to 100 leads at a time
        if (parsed.data.length > 100) {
            return res.status(400).json({
                success: false,
                message: `Import limit exceeded: You are trying to import ${parsed.data.length} leads. The system currently strictly allows a maximum of 100 leads per import to ensure stability. Please split your Google Sheet.`
            });
        }

        // 🚦 LEAD LIMIT CHECK — 0 (or null) means UNLIMITED (see create-lead note above)
        const leadLimit = workspace?.planFeatures?.leadLimit;
        if (leadLimit != null && leadLimit > 0) {
            const currentLeadCount = await Lead.countDocuments({ userId: userId });
            if (currentLeadCount + parsed.data.length > leadLimit) {
                return res.status(403).json({
                    success: false,
                    error: 'lead_limit_reached',
                    message: `Import blocked: This import of ${parsed.data.length} leads would exceed your maximum capacity of ${leadLimit} leads. You currently have ${currentLeadCount} leads.`,
                    currentCount: currentLeadCount,
                    limit: leadLimit
                });
            }
        }

        // 🚦 BULK OPTIMIZATION: Get unique email/phone values directly from DB
        //    instead of loading all lead documents into memory
        const { normalizePhone } = require('../services/duplicateService');

        const [existingEmailList, existingPhoneList] = await Promise.all([
            Lead.distinct('email', { userId: userId, email: { $ne: null }, deletedAt: null }),
            Lead.distinct('phone', { userId: userId, phone: { $ne: null }, deletedAt: null })
        ]);

        const existingEmails = new Set(existingEmailList.map(e => e?.trim().toLowerCase()).filter(Boolean));
        const existingPhones = new Set(existingPhoneList.map(p => {
            const norm = normalizePhone(p);
            return norm ? norm.slice(-10) : null;
        }).filter(Boolean));

        const leadsToInsert = [];
        const emailsInThisBatch = new Set();
        const phonesInThisBatch = new Set();
        // Dropdown/multi-select cells matching no defined option — imported as-is.
        let syncUnmappedCount = 0;
        const syncUnmappedSamples = new Set();

        for (const row of parsed.data) {
            const keys = Object.keys(row);
            const nameKey = keys.find(k => k.toLowerCase().includes('name'));
            const emailKey = keys.find(k => k.toLowerCase().includes('email'));
            const phoneKey = keys.find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile'));

            const finalName = nameKey ? row[nameKey] : 'Unknown';
            const finalEmail = emailKey ? row[emailKey]?.trim() : null;
            const finalPhone = phoneKey ? row[phoneKey]?.toString() : 'No Phone';

            // Build customData by iterating over CRM's custom fields only
            const rawCustomData = {};
            customFieldDefs.forEach(field => {
                const matchingHeader = keys.find(k => k.toLowerCase() === field.label.toLowerCase());
                if (matchingHeader && row[matchingHeader]) {
                    rawCustomData[field.key] = row[matchingHeader];
                }
            });

            // Sheet cells are machine-supplied: snap dropdown/multi-select values
            // onto the defined option list so they group correctly. A cell matching
            // no option is imported verbatim and counted, never a reason to skip.
            const { cleaned: customData, unmapped } = coerceCustomData(rawCustomData, customFieldDefs);
            if (unmapped.length > 0) {
                syncUnmappedCount += unmapped.length;
                for (const u of unmapped) syncUnmappedSamples.add(`"${u.value}" (${u.label})`);
            }

            if (finalEmail || finalPhone !== 'No Phone') {
                const normEmail = finalEmail ? finalEmail.toLowerCase() : null;
                const normPhone = normalizePhone(finalPhone);
                const phoneLast10 = normPhone ? normPhone.slice(-10) : null;

                let isDuplicate = false;

                // Check memory sets for duplication (Database + Current Batch)
                if (normEmail && (existingEmails.has(normEmail) || emailsInThisBatch.has(normEmail))) {
                    isDuplicate = true;
                }
                if (phoneLast10 && (existingPhones.has(phoneLast10) || phonesInThisBatch.has(phoneLast10))) {
                    isDuplicate = true;
                }

                if (!isDuplicate) {
                    leadsToInsert.push({
                        userId: userId,
                        name: finalName,
                        email: finalEmail,
                        phone: finalPhone,
                        source: 'Google Sheet',
                        status: 'New',
                        customData: customData,
                        assignedTo: req.user.role === 'agent' ? getRequestUserId(req.user) : undefined
                    });

                    // Add to current batch sets to prevent local duplicates
                    if (normEmail) emailsInThisBatch.add(normEmail);
                    if (phoneLast10) phonesInThisBatch.add(phoneLast10);
                }
            }
        }

        // 🟢 BATCH INSERTION
        if (leadsToInsert.length > 0) {
            const insertedLeads = await Lead.insertMany(leadsToInsert);
            count = insertedLeads.length;

            // Trigger automations safely without blocking main thread.
            // AUDIT H1: no CAPI here — CSV rows are historical records, not fresh
            // conversions. The old batch block fired one unbounded parallel "Lead"
            // event per row with event_time = now, flooding Meta with stale,
            // wrongly-timestamped conversions on every import.
            setTimeout(() => {
                insertedLeads.forEach(newLead => queueLeadCreatedEffects(newLead, userId, { skipCapi: true }));
            }, 0);
        }

        if (syncUnmappedCount > 0) {
            console.warn(
                `⚠️ [Sheet Sync] User ${userId}: ${syncUnmappedCount} cell(s) outside the defined option list ` +
                `— imported as-is: ${[...syncUnmappedSamples].slice(0, 5).join(', ')}`
            );
        }

        res.json({
            success: true,
            message: `${count} New Leads Imported!`,
            ...(syncUnmappedCount > 0 ? {
                unmappedCustomValues: syncUnmappedCount,
                unmappedSamples: [...syncUnmappedSamples].slice(0, 10)
            } : {})
        });
    } catch (err) {
        console.error("Sync Sheet Error:", err);
        res.status(500).json({ message: "Error syncing sheet" });
    }
};

// ==========================================
// 8. ANALYTICS (DEPRECATED — use getAnalyticsData or getDashboardSummary instead)
// Kept as a lightweight backward-compatible endpoint; internally delegates to $facet.
// ==========================================
// NOTE: This endpoint is confirmed dead code (no frontend references).
// Removed to eliminate 4 redundant DB queries per call.
// If you need analytics, use GET /api/leads/analytics-data or GET /api/dashboard.

// ==========================================
// 8.5. GET ANALYTICS DATA (For Dashboard)
// ==========================================
const getAnalyticsData = async (req, res) => {
    try {
        const query = { ...req.dataScope };

        // Mongoose Aggregate $match requires strict ObjectIds for string fields that are ObjectIds in DB
        if (query.userId && typeof query.userId === 'string' && mongoose.Types.ObjectId.isValid(query.userId)) {
            query.userId = new mongoose.Types.ObjectId(query.userId);
        }
        if (query.assignedTo && typeof query.assignedTo === 'string' && mongoose.Types.ObjectId.isValid(query.assignedTo)) {
            query.assignedTo = new mongoose.Types.ObjectId(query.assignedTo);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        // Setup dates array for trend chart (last 7 days)
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            dates.push(d);
        }

        const facets = {
            basicStats: [
                {
                    $group: {
                        _id: null,
                        totalLeads: { $sum: 1 },
                        wonLeads: {
                            $sum: {
                                $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0]
                            }
                        },
                        leadsToday: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $gte: [{ $ifNull: ["$date", "$createdAt"] }, today] },
                                            { $lt: [{ $ifNull: ["$date", "$createdAt"] }, tomorrow] }
                                        ]
                                    }, 1, 0
                                ]
                            }
                        }
                    }
                }
            ],
            followUpStats: [
                { $match: { nextFollowUpDate: { $ne: null } } },
                {
                    $group: {
                        _id: null,
                        followUpTotal: { $sum: 1 },
                        followUpToday: {
                            $sum: { $cond: [{ $and: [{ $gte: ["$nextFollowUpDate", today] }, { $lt: ["$nextFollowUpDate", tomorrow] }] }, 1, 0] }
                        },
                        followUpOverdue: {
                            $sum: { $cond: [{ $lt: ["$nextFollowUpDate", today] }, 1, 0] }
                        },
                        followUpUpcoming: {
                            $sum: { $cond: [{ $and: [{ $gte: ["$nextFollowUpDate", tomorrow] }, { $lt: ["$nextFollowUpDate", nextWeek] }] }, 1, 0] }
                        }
                    }
                }
            ],
            sourceDistribution: [
                { $group: { _id: { $ifNull: ["$source", "Unknown"] }, count: { $sum: 1 } } }
            ],
            stageDistribution: [
                { $group: { _id: { $ifNull: ["$status", "New"] }, count: { $sum: 1 } } }
            ]
        };

        // Dynamically add facet branches for the last 7 days chart
        dates.forEach((date, i) => {
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            facets[`date_${i}`] = [
                {
                    $match: {
                        $or: [
                            { date: { $gte: date, $lt: nextDate } },
                            { createdAt: { $gte: date, $lt: nextDate } },
                            // Missing date/createdAt leads are not counted for this day
                        ]
                    }
                },
                { $count: "count" }
            ];
        });

        const [results] = await Lead.aggregate([
            { $match: query },
            { $facet: facets }
        ]);

        const basic = results.basicStats[0] || { totalLeads: 0, wonLeads: 0, leadsToday: 0 };
        const followUp = results.followUpStats[0] || { followUpTotal: 0, followUpToday: 0, followUpOverdue: 0, followUpUpcoming: 0 };

        const leadSource = {};
        results.sourceDistribution.forEach(item => { leadSource[item._id] = item.count; });

        const stageDistribution = {};
        results.stageDistribution.forEach(item => { stageDistribution[item._id] = item.count; });

        const leadsOverTime = dates.map((date, i) => {
            const countArray = results[`date_${i}`];
            const count = (countArray && countArray.length > 0) ? countArray[0].count : 0;
            return {
                date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                count
            };
        });

        const conversionRate = basic.totalLeads > 0
            ? ((basic.wonLeads / basic.totalLeads) * 100).toFixed(1)
            : 0;

        res.json({
            totalLeads: basic.totalLeads,
            leadsToday: basic.leadsToday,
            conversionRate: parseFloat(conversionRate),
            followUpToday: followUp.followUpToday,
            followUpOverdue: followUp.followUpOverdue,
            followUpUpcoming: followUp.followUpUpcoming,
            followUpTotal: followUp.followUpTotal,
            leadSource,
            leadsOverTime,
            stageDistribution
        });
    } catch (err) {
        console.error("Get Analytics Data Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 9. GET FOLLOW-UP LEADS (Due Today) — Now Paginated
// ==========================================
const getFollowUpLeads = async (req, res) => {
    try {
        const page = parseBoundedInteger(req.query.page, 1, { min: 1 });
        const limit = parseBoundedInteger(req.query.limit, 50, { min: 1, max: 100 });
        const skip = (page - 1) * limit;

        // Get today's date (start and end of day)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const query = {
            ...req.dataScope,
            nextFollowUpDate: {
                $gte: today,
                $lt: tomorrow
            }
        };

        const [leads, total] = await Promise.all([
            Lead.find(query)
                .select('-history -messages -followUpHistory -customData')
                .sort({ nextFollowUpDate: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Lead.countDocuments(query)
        ]);

        res.json({
            leads,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error("Get Follow-up Leads Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 10. UPDATE FOLLOW-UP DATE
// ==========================================
const updateFollowUpDate = async (req, res) => {
    try {
        const { leadId, nextFollowUpDate } = req.body;

        if (!leadId || !nextFollowUpDate) {
            return res.status(400).json({ message: "Lead ID and follow-up date are required" });
        }

        const ownerId = req.tenantId;
        const lead = await Lead.findOne({ _id: leadId, ...req.dataScope });

        if (!lead) {
            return res.status(404).json({ message: "Lead not found" });
        }

        // If lead already has a nextFollowUpDate, move it to lastFollowUpDate
        if (lead.nextFollowUpDate) {
            lead.lastFollowUpDate = lead.nextFollowUpDate;
        }

        lead.nextFollowUpDate = new Date(nextFollowUpDate);
        await lead.save();

        res.json({ success: true, lead });
    } catch (err) {
        console.error("Update Follow-up Date Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 11. COMPLETE FOLLOW-UP (Mark as Done)
// ==========================================
const completeFollowUp = async (req, res) => {
    try {
        const { leadId, note, nextFollowUpDate, markedAsDeadLead, followUpTemplateType, followUpTemplateName } = req.body;

        // Validation: Note is required
        if (!note || !note.trim()) {
            return res.status(400).json({ message: "Follow-up note is required" });
        }

        // Validation: Either nextFollowUpDate OR markedAsDeadLead must be provided
        if (!nextFollowUpDate && !markedAsDeadLead) {
            return res.status(400).json({ message: "Either next follow-up date or 'Mark as Dead Lead' must be selected" });
        }

        const ownerId = req.tenantId;
        const lead = await Lead.findOne({ _id: leadId, ...req.dataScope });

        if (!lead) {
            return res.status(404).json({ message: "Lead not found" });
        }

        // Add note to lead's notes array
        lead.notes.push({
            text: note,
            date: new Date()
        });

        // Add to follow-up history
        const followUpEntry = {
            note: note,
            completedDate: new Date(),
            nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
            markedAsDeadLead: markedAsDeadLead || false
        };

        if (!lead.followUpHistory) {
            lead.followUpHistory = [];
        }
        lead.followUpHistory.push(followUpEntry);

        // Add to unified history
        if (!lead.history) {
            lead.history = [];
        }
        lead.history.push({
            type: 'Follow-up',
            subType: 'Manual',
            content: note,
            date: new Date()
        });

        // Update last follow-up date
        lead.lastFollowUpDate = lead.nextFollowUpDate || new Date();

        // Update next follow-up date or status based on action
        const statusBeforeFollowUp = lead.status;
        if (markedAsDeadLead) {
            // Mark as Dead Lead stage - ensure the stage exists
            lead.status = 'Dead Lead';
            lead.nextFollowUpDate = null;
            lead.followUpTemplateType = null;
            lead.followUpTemplateName = null;
            lead.followUpTemplateSent = false;

            // Optionally create "Dead Lead" stage if it doesn't exist
            const deadLeadStage = await Stage.findOne({ name: 'Dead Lead', userId: ownerId });
            if (!deadLeadStage) {
                await Stage.create({
                    name: 'Dead Lead',
                    order: Date.now(),
                    userId: ownerId
                });
            }
        } else if (nextFollowUpDate) {
            // Set next follow-up date
            lead.nextFollowUpDate = new Date(nextFollowUpDate);
            lead.followUpTemplateType = followUpTemplateType || null;
            lead.followUpTemplateName = followUpTemplateName || null;
            lead.followUpTemplateSent = false;
        }

        await lead.save();

        // CAPI: marking dead from follow-up is a real stage transition (was missing)
        if (markedAsDeadLead && statusBeforeFollowUp !== 'Dead Lead') {
            sendMetaEventIfEnabled(lead, 'Dead Lead', statusBeforeFollowUp)
                .catch(err => console.error('Meta CAPI error (Follow-up Dead Lead):', err));
        }

        res.json({ success: true, lead });
    } catch (err) {
        console.error("Complete Follow-up Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 12. GET FOLLOW-UP DONE LEADS — Now Paginated
// ==========================================
const getFollowUpDoneLeads = async (req, res) => {
    try {
        const page = parseBoundedInteger(req.query.page, 1, { min: 1 });
        const limit = parseBoundedInteger(req.query.limit, 50, { min: 1, max: 100 });
        const skip = (page - 1) * limit;

        const query = {
            ...req.dataScope,
            'followUpHistory.0': { $exists: true }
        };

        const [leads, total] = await Promise.all([
            Lead.find(query)
                .select('-messages -customData')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Lead.countDocuments(query)
        ]);

        res.json({
            leads,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error("Get Follow-up Done Leads Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 👇 EXPORT ALL FUNCTIONS (Fixes TypeError)
// ==========================================


// ==========================================
// 15. ASSIGN LEAD TO AGENT (Single)
// ==========================================

/**
 * Resolve an assignee id to a real user inside THIS workspace.
 *
 * Accepts the workspace owner as well as their agents. The assign dropdown
 * fetches `/auth/my-team?includeManager=true` and lists the manager first, but
 * this check used to require `parentId: ownerId, role: 'agent'` — which the
 * owner never satisfies, so picking the name at the top of the list always
 * failed with "Invalid agent ID". The external API already allowed both
 * (`$or: [{_id: tenantId}, {parentId: tenantId}]`); this brings the CRM in line.
 *
 * Returns `{ ok: false, status, message }` on any rejection so callers answer
 * 400 for a malformed or foreign id rather than throwing a CastError into a 500.
 */
const resolveAssignee = async (agentId, ownerId) => {
    if (!agentId) return { ok: true, agent: null };

    if (!mongoose.isValidObjectId(agentId)) {
        return { ok: false, status: 400, message: 'Invalid agent ID' };
    }

    const agent = await User.findOne({
        _id: agentId,
        $or: [{ _id: ownerId }, { parentId: ownerId }]
    }).select('_id name').lean();

    if (!agent) return { ok: false, status: 400, message: 'Invalid agent ID' };
    return { ok: true, agent };
};

const assignLead = async (req, res) => {
    try {
        const { id } = req.params;
        const { agentId } = req.body;

        let ownerId = req.tenantId;

        const lead = await Lead.findOne({ _id: id, ...req.dataScope });
        if (!lead) {
            return res.status(404).json({ message: "Lead not found" });
        }

        const resolved = await resolveAssignee(agentId, ownerId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ message: resolved.message });
        }

        // Only write history when the owner actually changes — re-selecting the
        // same agent should not litter the timeline.
        const previousAssignee = lead.assignedTo ? String(lead.assignedTo) : null;
        const nextAssignee = resolved.agent ? String(resolved.agent._id) : null;
        const assignmentChanged = previousAssignee !== nextAssignee;

        lead.assignedTo = resolved.agent ? resolved.agent._id : null;

        // The lead timeline is the audit trail agents actually read, and it was
        // the one place a reassignment left no trace — PUT /leads/:id and the
        // external API both record it, this route did not.
        if (assignmentChanged) {
            lead.history.push({
                type: 'System',
                subType: 'Assignment',
                content: resolved.agent ? `Assigned to ${resolved.agent.name}` : 'Unassigned',
                date: new Date()
            });
        }

        await lead.save();

        // The Lead owns the WhatsApp conversation: push the new owner onto it.
        queueLeadAssignmentEffects(lead, ownerId);

        // Log assignment
        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_ASSIGNED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            metadata: { assignedTo: agentId ? 'Agent' : 'Unassigned' },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        // ⚡ PERFORMANCE: Populate from the already-fetched lead instead of re-querying
        const updatedLead = await Lead.findById(id).select('-history -messages -followUpHistory').populate('assignedTo', 'name email').lean();
        res.json({ success: true, message: agentId ? "Lead assigned" : "Lead unassigned", lead: updatedLead });
    } catch (err) {
        console.error("Assign Lead Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 16. BULK ASSIGN LEADS
// ==========================================
const bulkAssignLeads = async (req, res) => {
    try {
        // The Leads page posts `ids`; the other bulk endpoints on this
        // controller post `leadIds`. Only `leadIds` was read, so bulk assign
        // from the UI always 400'd. Accept both rather than breaking whichever
        // caller we do not currently see.
        const { leadIds, ids, agentId } = req.body;
        const targetIds = Array.isArray(leadIds) ? leadIds : ids;

        if (!targetIds || !Array.isArray(targetIds) || targetIds.length === 0) {
            return res.status(400).json({ message: "Lead IDs array required" });
        }

        let ownerId = req.tenantId;

        // Same resolution as the single-assign route, so the manager is a valid
        // assignee here too and a malformed id answers 400 instead of throwing a
        // CastError into a 500.
        const resolved = await resolveAssignee(agentId, ownerId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ message: resolved.message });
        }
        const nextAssignee = resolved.agent ? resolved.agent._id : null;

        // A single malformed id used to blow the whole request up with a
        // CastError → 500. Filter to well-formed ids and let the scope query
        // decide the rest.
        const validIds = targetIds.filter(i => mongoose.isValidObjectId(i));
        if (validIds.length === 0) {
            return res.status(400).json({ message: "No valid lead IDs provided" });
        }

        // Resolve which ids are actually in scope BEFORE writing, so the
        // conversation sync below only ever follows leads we really touched.
        const scopedLeads = await Lead.find({ _id: { $in: validIds }, ...req.dataScope })
            .select('_id')
            .lean();
        const scopedIds = scopedLeads.map(l => l._id);

        // Bulk reassignment left NO audit trail of any kind — no lead history and
        // no activity log — so moving a whole book of business between agents was
        // invisible after the fact. The history entry rides along with the same
        // updateMany (capped like every other history write in this codebase).
        const historyEntry = {
            type: 'System',
            subType: 'Assignment',
            content: resolved.agent ? `Assigned to ${resolved.agent.name} (bulk)` : 'Unassigned (bulk)',
            date: new Date()
        };

        const result = await Lead.updateMany(
            { _id: { $in: scopedIds }, ...req.dataScope },
            {
                $set: { assignedTo: nextAssignee },
                $push: { history: { $each: [historyEntry], $slice: -100 } }
            }
        );

        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_ASSIGNED',
            entityType: 'Lead',
            // ActivityLog.entityId is required, and a bulk action has no single
            // target — the company stands in, the same convention the export log
            // already uses ("the lead database as a whole"). Passing null (or
            // omitting it, as bulkUpdateStatus does) fails schema validation and
            // the write is swallowed by the .catch, so the action is never logged.
            entityId: ownerId,
            entityName: `${scopedIds.length} leads (bulk)`,
            metadata: {
                assignedTo: resolved.agent ? resolved.agent.name : 'Unassigned',
                count: scopedIds.length
            },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        // updateMany fires no document middleware — the propagation has to be
        // an explicit call. One batched updateMany, not one per lead.
        queueBulkLeadAssignmentEffects(scopedIds, nextAssignee, ownerId);

        res.json({ success: true, message: `${result.modifiedCount} leads updated`, modifiedCount: result.modifiedCount });
    } catch (err) {
        console.error("Bulk Assign Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 17. CHECK DUPLICATES (Real-time)
// ==========================================
const checkDuplicates = async (req, res) => {
    try {
        const { phone, email } = req.body;

        let ownerId = req.tenantId;

        const duplicates = await findDuplicates(ownerId, phone, email);
        res.json({ hasDuplicates: duplicates.length > 0, duplicates });
    } catch (err) {
        console.error('Check Duplicates Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 18. GET ALL DUPLICATE GROUPS
// ==========================================
const getDuplicateGroups = async (req, res) => {
    try {
        let ownerId = req.tenantId;

        const groups = await findAllDuplicateGroups(ownerId);
        const totalDuplicates = groups.reduce((sum, g) => sum + g.duplicates.length, 0);

        res.json({
            totalGroups: groups.length,
            totalDuplicates,
            groups
        });
    } catch (err) {
        console.error('Get Duplicate Groups Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 19. AUTO-DELETE DUPLICATES (Keep Oldest)
// ==========================================
const autoDeleteDuplicates = async (req, res) => {
    try {
        let ownerId = req.tenantId;

        const groups = await findAllDuplicateGroups(ownerId);

        // ⚡ PERFORMANCE: Collect all duplicate IDs and delete in ONE batch operation
        // Previously did N individual findByIdAndDelete calls (1 DB roundtrip per duplicate)
        const allDupIds = groups.flatMap(g => g.duplicates.map(d => d._id));
        let deletedCount = 0;

        if (allDupIds.length > 0) {
            const result = await Lead.deleteMany({ _id: { $in: allDupIds } });
            deletedCount = result.deletedCount;

            // Reclaim the deleted leads' attachments from object storage. Runs
            // detached: a large duplicate sweep should not hold the response
            // open on R2 round-trips, and the helper never throws.
            runInBackground('[LeadDocuments] duplicate-sweep cleanup',
                () => deleteDocumentsForLeads(ownerId, allDupIds));
        }

        // Log activity
        if (deletedCount > 0) {
            logActivity({
                userId: getRequestUserId(req.user),
                userName: req.user.name || 'Unknown',
                actionType: 'DUPLICATES_DELETED',
                entityType: 'Lead',
                entityName: `${deletedCount} duplicate leads`,
                metadata: { deletedCount, groupCount: groups.length },
                companyId: ownerId
            }).catch(err => console.error('Audit log error:', err));
        }

        res.json({
            success: true,
            message: `${deletedCount} duplicate leads deleted successfully`,
            deletedCount,
            groupsProcessed: groups.length
        });
    } catch (err) {
        console.error('Auto Delete Duplicates Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 20. BULK IMPORT LEADS (CSV)
// ==========================================
const bulkImportLeads = async (req, res) => {
    try {
        let ownerId = req.tenantId;

        const { leads, quiet } = req.body; // Expects an array: [{name, email, phone, source, status, customData}]

        // Quiet import (migrating existing contacts): suppress the welcome
        // email/WhatsApp only. Sequences, automation rules, workflows and alerts
        // still run — see queueLeadCreatedEffects. Coerced strictly so a stray
        // truthy string can never silence a normal import by accident.
        const quietImport = quiet === true;

        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ message: "No leads provided for import." });
        }

        // ⚡ PERFORMANCE FIX: Use Lead.distinct() instead of loading ALL leads into memory.
        // Previously: Lead.find({userId}).select('phone email').lean() loaded every document.
        // Now: distinct() returns only unique values — orders of magnitude less memory.
        const [existingPhoneList, existingEmailList] = await Promise.all([
            Lead.distinct('phone', { userId: ownerId, phone: { $ne: null }, deletedAt: null }),
            Lead.distinct('email', { userId: ownerId, email: { $ne: null }, deletedAt: null })
        ]);
        const existingPhones = new Set(existingPhoneList.map(p => normalizePhone(p)).filter(Boolean));
        const existingEmails = new Set(existingEmailList.map(e => e?.trim().toLowerCase()).filter(Boolean));

        // CSV values are machine-supplied, so we COERCE rather than reject: a cell
        // reading "premium plan" snaps onto the option "Premium Plan" so filters
        // and reports group it correctly. Anything unmatched imports verbatim and
        // is reported back, so a typo in the sheet never costs the user the row.
        const customFieldDefs = await getCustomFieldDefs(ownerId);
        const unmappedValues = new Map(); // "label: value" → count

        const newLeadsToInsert = [];
        let duplicateCount = 0;

        for (const lead of leads) {
            const normPhone = lead.phone ? normalizePhone(lead.phone) : null;
            const normEmail = lead.email ? lead.email.toLowerCase() : null;

            // Simple duplicate check against Sets
            const isPhoneDup = normPhone && existingPhones.has(normPhone);
            const isEmailDup = normEmail && existingEmails.has(normEmail);

            if (isPhoneDup || isEmailDup) {
                duplicateCount++;
            } else {
                const { cleaned, unmapped } = coerceCustomData(lead.customData, customFieldDefs);
                for (const u of unmapped) {
                    const label = `${u.label}: ${u.value}`;
                    unmappedValues.set(label, (unmappedValues.get(label) || 0) + 1);
                }

                newLeadsToInsert.push({
                    userId: ownerId,
                    name: lead.name || 'Unknown',
                    email: lead.email || null,
                    phone: lead.phone || 'No Phone',
                    source: lead.source || 'CSV Import',
                    status: lead.status || 'New',
                    tags: Array.isArray(lead.tags) ? lead.tags : [],
                    customData: cleaned,
                    assignedTo: req.user.role === 'agent' ? getRequestUserId(req.user) : undefined
                });

                // Add to Sets so we don't insert duplicates within the same batch!
                if (normPhone) existingPhones.add(normPhone);
                if (normEmail) existingEmails.add(normEmail);
            }
        }

        if (newLeadsToInsert.length > 0) {
            const insertedLeads = await Lead.insertMany(newLeadsToInsert);

            // Imported rows are real leads and must enter sequences, automation
            // rules and workflows like every other source. This was missing
            // entirely: CSV leads landed in the pipeline and nothing ever ran,
            // while the sibling syncLeads (Sheet import) fired effects correctly.
            // skipCapi mirrors that path — imported rows are historical records,
            // not fresh conversions, so sending Meta events with event_time = now
            // would flood Meta with wrongly-timestamped data.
            setTimeout(() => {
                insertedLeads.forEach(newLead =>
                    queueLeadCreatedEffects(newLead, ownerId, {
                        skipCapi: true,
                        skipWelcome: quietImport,
                        source: quietImport ? 'CSV Import (quiet)' : 'CSV Import'
                    })
                );
            }, 0);

            // Log activity
            logActivity({
                userId: getRequestUserId(req.user),
                userName: req.user.name || 'Unknown',
                actionType: 'LEAD_CREATED',
                entityType: 'Lead',
                entityName: 'Bulk Import',
                // `quiet` is recorded so "why did these leads never get a welcome
                // message?" is answerable months later from the audit trail alone.
                metadata: { importedCount: newLeadsToInsert.length, skippedDuplicates: duplicateCount, quiet: quietImport },
                companyId: ownerId
            }).catch(err => console.error('Audit log error:', err));
        }

        res.json({
            success: true,
            message: "Import complete",
            importedCount: newLeadsToInsert.length,
            duplicateCount,
            quiet: quietImport,
            // Values that did not match any option on a dropdown/multi-select
            // field. They WERE imported as-is — this is a heads-up, not an error.
            unmappedCustomValues: [...unmappedValues.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([value, count]) => ({ value, count }))
        });

    } catch (err) {
        console.error("Bulk Import Error:", err);
        res.status(500).json({ message: "Error importing leads" });
    }
};

// ==========================================
// NEW: BULK ADD TAGS
// ==========================================
const bulkAddTags = async (req, res) => {
    try {
        const { leadIds, tags } = req.body;

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ message: "No leads selected" });
        }

        if (!Array.isArray(tags) || tags.length === 0) {
            return res.status(400).json({ message: "No tags provided" });
        }

        const query = { _id: { $in: leadIds }, ...req.dataScope };

        // $addToSet prevents duplicate tags on the same lead
        const result = await Lead.updateMany(
            query,
            { $addToSet: { tags: { $each: tags } } }
        );

        // L3 FIX: fire TAG_ADDED (previously a dead trigger). Re-read the affected
        // leads so each execution has a real lead in context, and pass addedTags so
        // triggerConfig tag filters can match. Non-blocking — never delays the response.
        runInBackground('Workflow Engine Error (TAG_ADDED):', async () => {
            const taggedLeads = await Lead.find(query).lean();
            for (const taggedLead of taggedLeads) {
                WorkflowEngine.fireTrigger('TAG_ADDED', { lead: taggedLead, addedTags: tags })
                    .catch(err => console.error('TAG_ADDED fireTrigger error:', err.message));
            }
        });

        // Audit log
        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_EDITED',
            entityType: 'Lead',
            entityName: 'Bulk Tag Update',
            metadata: { count: leadIds.length, tags },
            companyId: req.tenantId
        }).catch(err => console.error('Audit log error:', err));

        res.json({ success: true, message: `${result.modifiedCount} leads tagged successfully` });
    } catch (err) {
        console.error("Bulk Add Tags Error:", err);
        res.status(500).json({ message: "Error updating tags" });
    }
};

// ==========================================
// NEW: BULK REMOVE TAGS
// ==========================================
const bulkRemoveTags = async (req, res) => {
    try {
        const { leadIds, tags } = req.body;

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ message: "No leads selected" });
        }

        if (!Array.isArray(tags) || tags.length === 0) {
            return res.status(400).json({ message: "No tags provided" });
        }

        const query = { _id: { $in: leadIds }, ...req.dataScope };

        // $pull removes matching tag values from the tags array
        const result = await Lead.updateMany(
            query,
            { $pull: { tags: { $in: tags } } }
        );

        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_EDITED',
            entityType: 'Lead',
            entityName: 'Bulk Remove Tags',
            metadata: { count: leadIds.length, tags },
            companyId: req.tenantId
        }).catch(err => console.error('Audit log error:', err));

        res.json({ success: true, message: `Tags removed from ${result.modifiedCount} leads` });
    } catch (err) {
        console.error("Bulk Remove Tags Error:", err);
        res.status(500).json({ message: "Error removing tags" });
    }
};

// ==========================================
// NEW: BULK DELETE LEADS (single DB query replaces N individual deletes)
// ==========================================
const bulkDeleteLeads = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "No leads selected for deletion" });
        }

        // Validate every id before it reaches $in. One malformed entry made Mongoose
        // throw a CastError for the WHOLE batch, so a single bad id turned a bulk
        // delete into a 500 with nothing deleted and no indication of which id.
        const invalid = ids.filter(id => !isValidLeadId(id));
        if (invalid.length > 0) {
            return res.status(400).json({
                message: `Invalid lead ID format (${invalid.length} of ${ids.length})`,
                invalidIds: invalid.slice(0, 10)
            });
        }

        // Cap the batch so one request cannot delete an unbounded slice of the tenant.
        if (ids.length > 500) {
            return res.status(400).json({ message: 'Too many leads in one request. Delete at most 500 at a time.' });
        }

        // Resolve which of the requested ids are actually in scope BEFORE
        // deleting. An agent's dataScope narrows to leads assigned to them, so
        // the requested list is not the deleted list — cascading attachment
        // cleanup over the raw ids would wipe documents off leads that survive.
        const scopedLeads = await Lead.find({ _id: { $in: ids }, ...req.dataScope })
            .select('_id').lean();
        const scopedIds = scopedLeads.map(l => l._id);

        // Tenant-scoped delete — can only delete leads you own
        const result = await Lead.deleteMany({
            _id: { $in: scopedIds },
            ...req.dataScope
        });

        // Reclaim attachments for exactly those leads (detached; never throws).
        if (scopedIds.length > 0) {
            runInBackground('[LeadDocuments] bulk-delete cleanup',
                () => deleteDocumentsForLeads(req.tenantId, scopedIds));

            // Conversations survive but lose the link and the derived owner.
            queueLeadDeletionEffects(scopedIds, req.tenantId);
        }

        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_DELETED',
            entityType: 'Lead',
            entityName: 'Bulk Delete',
            metadata: { deletedCount: result.deletedCount, requestedCount: ids.length },
            companyId: req.tenantId
        }).catch(err => console.error('Audit log error:', err));

        res.json({
            success: true,
            message: `${result.deletedCount} leads deleted successfully`,
            deletedCount: result.deletedCount
        });
    } catch (err) {
        console.error("Bulk Delete Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// NEW: BULK UPDATE STATUS (single DB query replaces N individual updates)
// ==========================================
const bulkUpdateStatus = async (req, res) => {
    try {
        const { ids, status } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "No leads selected" });
        }
        if (!status) {
            return res.status(400).json({ message: "Status is required" });
        }

        // Same reasoning as bulkDeleteLeads: one bad id must not 500 the batch.
        const invalid = ids.filter(id => !isValidLeadId(id));
        if (invalid.length > 0) {
            return res.status(400).json({
                message: `Invalid lead ID format (${invalid.length} of ${ids.length})`,
                invalidIds: invalid.slice(0, 10)
            });
        }
        if (ids.length > 500) {
            return res.status(400).json({ message: 'Too many leads in one request. Update at most 500 at a time.' });
        }

        // Snapshot the in-scope leads BEFORE the write. Stage-change effects need
        // each lead's previous stage, and dataScope means "ids requested" is not
        // the same set as "leads this user may actually touch".
        const targets = await Lead.find({ _id: { $in: ids }, ...req.dataScope })
            .select('_id name email phone userId status assignedTo')
            .lean();

        // Mirror the single-lead path (updateLead): moving a stage stamps
        // stageEnteredAt, and won/lost timestamps drive the revenue reports.
        // Without these, bulk-moving leads to "Won" left wonAt empty and the
        // reports under-counted.
        const now = new Date();
        const stageFields = { status, stageEnteredAt: now };
        if (/won/i.test(status)) {
            stageFields.wonAt = now;
            stageFields.lostAt = null;
        } else if (/lost|dead/i.test(status)) {
            stageFields.lostAt = now;
        }

        const result = await Lead.updateMany(
            { _id: { $in: ids }, ...req.dataScope },
            { $set: stageFields }
        );

        // Bulk stage changes now get the SAME automation surface as dragging one
        // lead across the board — sequences, automation rules, workflows, score.
        // Previously this endpoint only wrote the status, so "select 50 leads →
        // Cold Lead" silently ran nothing while moving them one-by-one ran
        // everything. Only leads whose stage actually changed are fired.
        // Deliberately no Meta CAPI here: queueLeadStageChangeEffects carries
        // none, and a 500-lead reclassification is not 500 conversions.
        const movedLeads = targets.filter(l => l.status !== status);
        if (movedLeads.length > 0) {
            setTimeout(() => {
                movedLeads.forEach(prev =>
                    queueLeadStageChangeEffects({ ...prev, status }, prev.status)
                );
            }, 0);
        }

        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_EDITED',
            entityType: 'Lead',
            // Required by the schema — without it this log silently failed
            // validation and every bulk status change went unrecorded.
            entityId: req.tenantId,
            entityName: 'Bulk Status Update',
            metadata: { updatedCount: result.modifiedCount, newStatus: status },
            companyId: req.tenantId
        }).catch(err => console.error('Audit log error:', err));

        res.json({
            success: true,
            message: `${result.modifiedCount} leads updated to "${status}"`,
            modifiedCount: result.modifiedCount
        });
    } catch (err) {
        console.error("Bulk Status Update Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

/**
 * Bulk export of the company's leads as data ready for CSV download.
 *
 * SECURITY: This is the #1 lead-exfiltration vector, so the control lives on the
 * server, not the browser:
 *   1. Owner-only — agents (and agency resellers) are rejected. Only the account
 *      owner (manager) or a platform superadmin can bulk-export.
 *   2. Every export is written to the tamper-evident ActivityLog (who, how many
 *      rows, applied filters, when, IP) BEFORE the data is returned. Because the
 *      log is written server-side it cannot be skipped by the caller — so the
 *      manager can always prove exactly what left the system.
 */
const exportLeads = async (req, res) => {
    try {
        // 1. Owner-only guard. Agents/agencies can never bulk-export.
        if (!['manager', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only the account owner can export leads.'
            });
        }

        const companyId = req.tenantId;

        // 2. Optional filters (mirror the Export dialog). 'All'/empty = no filter.
        const { stage, source, tag, ids } = req.body || {};
        const query = { userId: companyId }; // always tenant-scoped — no cross-company leakage
        if (stage && stage !== 'All') query.status = stage;
        if (source && source !== 'All') query.source = source;
        if (tag && tag !== 'All') query.tags = tag;

        // Optional: export only an explicitly selected subset of leads (still scoped
        // to this company, so the caller can never widen the set to other tenants).
        let selectedSubset = false;
        if (Array.isArray(ids) && ids.length > 0) {
            const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
            if (validIds.length > 0) {
                query._id = { $in: validIds };
                selectedSubset = true;
            }
        }

        // saasPlugin automatically excludes soft-deleted leads.
        const leads = await Lead.find(query)
            .select('name phone email source status tags createdAt date notes customData')
            .sort({ createdAt: -1 })
            .lean();

        // 3. Unskippable server-side audit entry. logActivity swallows its own
        //    errors and returns true/false (it never throws), so we MUST inspect the
        //    result: if the export could not be recorded, we do NOT release the data.
        //    No log ⇒ no export — that is the whole point of this endpoint.
        const logged = await logActivity({
            userId: getRequestUserId(req.user),
            userName: await resolveActorName(req.user),
            actionType: 'LEADS_EXPORTED',
            entityType: 'Lead',
            entityId: companyId, // stand-in target: the lead database as a whole
            entityName: `Bulk export (${leads.length} leads)`,
            metadata: {
                count: leads.length,
                format: 'csv',
                scope: selectedSubset ? 'selected' : 'filtered',
                filters: {
                    stage: stage || 'All',
                    source: source || 'All',
                    tag: tag || 'All'
                }
            },
            companyId,
            ipAddress: req.ip
        });

        if (!logged) {
            return res.status(500).json({
                success: false,
                message: 'Export blocked: the audit entry could not be recorded. Please try again.'
            });
        }

        return res.json({ success: true, count: leads.length, leads });
    } catch (err) {
        console.error('exportLeads error:', err);
        return res.status(500).json({ success: false, message: 'Failed to export leads' });
    }
};

module.exports = {
    getLeads,
    getLeadById,
    createLead,
    updateLead,
    deleteLead,
    addNote,
    getStages,
    createStage,
    deleteStage,
    updateStage,
    syncLeads,
    // getAnalytics removed — dead code, replaced by getAnalyticsData and getDashboardSummary
    getAnalyticsData,
    getFollowUpLeads,
    updateFollowUpDate,
    completeFollowUp,
    getFollowUpDoneLeads,
    sendManualEmail,
    assignLead,
    bulkAssignLeads,
    checkDuplicates,
    getDuplicateGroups,
    autoDeleteDuplicates,
    bulkImportLeads,
    bulkAddTags,
    bulkRemoveTags,
    bulkDeleteLeads,
    bulkUpdateStatus,
    exportLeads
};
