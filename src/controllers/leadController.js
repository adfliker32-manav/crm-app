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
const { sendMetaEvent } = require('../services/metaConversionService');
const { sendEmail } = require('../services/emailService');
const { logActivity } = require('../services/auditService');
const { findDuplicates, findAllDuplicateGroups, normalizePhone } = require('../services/duplicateService');
const { evaluateLead } = require('../services/AutomationService');
const { logUsage } = require('../services/usageLogger');
const {
    getRequestUserId,
    hasManageTeamAccess,
    parseBoundedInteger,
    runInBackground
} = require('../utils/controllerHelpers');

const DEFAULT_LEAD_PAGE = 1;
const DEFAULT_LEAD_PAGE_SIZE = 100;
const MAX_LEAD_PAGE_SIZE = 200;
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

const isValidLeadId = (value) => mongoose.Types.ObjectId.isValid(value);

const appendLeadHistory = (leadId, historyEntry) =>
    Lead.findByIdAndUpdate(leadId, {
        $push: { history: { $each: [historyEntry], $slice: -100 } }
    }).exec();

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

const queueLeadCreatedEffects = (lead, ownerId) => {
    if (lead.email) {
        runInBackground('Email automation error (non-blocking):', async () => {
            const sent = await sendAutomatedEmailOnLeadCreate(lead, ownerId);

            if (sent) {
                await appendLeadHistory(lead._id, {
                    type: 'Email',
                    subType: 'Auto',
                    content: 'Automated Welcome Email Sent',
                    date: new Date()
                });
            }
        });
    }

    if (lead.phone) {
        runInBackground('WhatsApp automation error (non-blocking):', async () => {
            const phoneToSend = normalizePhone(lead.phone) || lead.phone;
            const leadForWhatsApp =
                typeof lead.toObject === 'function'
                    ? { ...lead.toObject(), phone: phoneToSend }
                    : { ...lead, phone: phoneToSend };

            const sent = await sendAutomatedWhatsAppOnLeadCreate(leadForWhatsApp, ownerId);

            if (sent) {
                await appendLeadHistory(lead._id, {
                    type: 'WhatsApp',
                    subType: 'Auto',
                    content: 'Automated Welcome WhatsApp Sent',
                    date: new Date()
                });
            }
        });
    }

    runInBackground('Automation Service Error (LEAD_CREATED):', () =>
        evaluateLead(lead, 'LEAD_CREATED')
    );
};

const queueLeadStageChangeEffects = (lead) => {
    runInBackground('Auto Error (STAGE_CHANGED):', () => evaluateLead(lead, 'STAGE_CHANGED'));
    runInBackground('Auto Error (TIME_IN_STAGE):', () => evaluateLead(lead, 'TIME_IN_STAGE'));
};

const sendMetaEventIfEnabled = async (lead, newStatus, oldStatus) => {
    try {
        const config = await IntegrationConfig.findOne({ userId: lead.userId })
            .select('+meta.metaCapiAccessToken +meta.metaCapiEnabled +meta.metaPixelId +meta.metaStageMapping +meta.metaTestEventCode');

        if (config && config.meta?.metaCapiEnabled) {
            runInBackground('Meta CAPI error (non-blocking):', () =>
                sendMetaEvent(config, lead, newStatus, oldStatus)
            );
        }
    } catch (err) {
        console.error('Error fetching config for Meta CAPI (non-blocking):', err);
    }
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
        const leadLimit = req.workspace?.planFeatures?.leadLimit;

        if (leadLimit != null) {
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

        const newLead = new Lead({
            userId: ownerId,
            name,
            email,
            phone,
            status: status || DEFAULT_LEAD_STATUS,
            source: source || DEFAULT_LEAD_SOURCE,
            customData: customData || {}
        });

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

        // Send Email
        await sendEmail({
            to,
            subject,
            text: message,
            userId
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
        applyNextFollowUpDateUpdate(lead, updates);

        const oldStatus = lead.status;
        applyLeadUpdates(lead, updates);

        await lead.save();

        const initiatorName = await resolveActorName(req.user);
        const nextStatus = updates.status;
        const stageChanged = hasStageChanged(oldStatus, nextStatus);

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
            metadata: { fieldsUpdated: Object.keys(updates) },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        // Send automated email if stage changed
        if (stageChanged && lead.email) {
            const ownerId = lead.userId;
            sendAutomatedEmailOnStageChange(lead, oldStatus, nextStatus, ownerId)
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
                        }).exec();
                    }
                })
                .catch(err => {
                    console.error('Email automation error (non-blocking):', err);
                });
        }

        // Send automated WhatsApp if stage changed
        if (stageChanged && lead.phone) {
            const ownerId = lead.userId;
            sendAutomatedWhatsAppOnStageChange(lead, oldStatus, nextStatus, ownerId)
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
                        }).exec();
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
            queueLeadStageChangeEffects(lead);
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
            { new: true }
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
            await Stage.insertMany(defaults);
            return res.json(defaults);
        }
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

        // 🚦 LEAD LIMIT CHECK
        const leadLimit = workspace?.planFeatures?.leadLimit;
        if (leadLimit != null) {
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
            Lead.distinct('email', { userId: userId, email: { $ne: null } }),
            Lead.distinct('phone', { userId: userId, phone: { $ne: null } })
        ]);
        
        const existingEmails = new Set(existingEmailList.map(e => e?.trim().toLowerCase()).filter(Boolean));
        const existingPhones = new Set(existingPhoneList.map(p => {
            const norm = normalizePhone(p);
            return norm ? norm.slice(-10) : null;
        }).filter(Boolean));

        const leadsToInsert = [];
        const emailsInThisBatch = new Set();
        const phonesInThisBatch = new Set();

        for (const row of parsed.data) {
            const keys = Object.keys(row);
            const nameKey = keys.find(k => k.toLowerCase().includes('name'));
            const emailKey = keys.find(k => k.toLowerCase().includes('email'));
            const phoneKey = keys.find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile'));

            const finalName = nameKey ? row[nameKey] : 'Unknown';
            const finalEmail = emailKey ? row[emailKey]?.trim() : null;
            const finalPhone = phoneKey ? row[phoneKey]?.toString() : 'No Phone';

            // Build customData by iterating over CRM's custom fields only
            const customData = {};
            customFieldDefs.forEach(field => {
                const matchingHeader = keys.find(k => k.toLowerCase() === field.label.toLowerCase());
                if (matchingHeader && row[matchingHeader]) {
                    customData[field.key] = row[matchingHeader];
                }
            });

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

            // Trigger automations safely without blocking main thread
            setTimeout(() => {
                insertedLeads.forEach(newLead => {
                    queueLeadCreatedEffects(newLead, userId);
                    
                    // Meta CAPI "Lead" event
                    sendMetaEventIfEnabled(newLead, 'New', null).catch(err => console.error('Meta CAPI error (Sheet Sync):', err));
                });
            }, 0);
        }

        res.json({ success: true, message: `${count} New Leads Imported!` });
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
                                    { $and: [
                                        { $gte: [{ $ifNull: ["$date", "$createdAt"] }, today] },
                                        { $lt: [{ $ifNull: ["$date", "$createdAt"] }, tomorrow] }
                                    ]}, 1, 0
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
        const { leadId, note, nextFollowUpDate, markedAsDeadLead } = req.body;

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
        if (markedAsDeadLead) {
            // Mark as Dead Lead stage - ensure the stage exists
            lead.status = 'Dead Lead';
            lead.nextFollowUpDate = null; // Clear next follow-up date

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
        }

        await lead.save();

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
const assignLead = async (req, res) => {
    try {
        const { id } = req.params;
        const { agentId } = req.body;

        let ownerId = req.tenantId;

        const lead = await Lead.findOne({ _id: id, ...req.dataScope });
        if (!lead) {
            return res.status(404).json({ message: "Lead not found" });
        }

        if (agentId) {
            const agent = await User.findOne({ _id: agentId, parentId: ownerId, role: 'agent' });
            if (!agent) {
                return res.status(400).json({ message: "Invalid agent ID" });
            }
        }

        lead.assignedTo = agentId || null;
        await lead.save();

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
        const { leadIds, agentId } = req.body;

        if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ message: "Lead IDs array required" });
        }

        let ownerId = req.tenantId;

        if (agentId) {
            const agent = await User.findOne({ _id: agentId, parentId: ownerId, role: 'agent' });
            if (!agent) {
                return res.status(400).json({ message: "Invalid agent ID" });
            }
        }

        // Use req.dataScope to ensure we only affect allowed leads
        const result = await Lead.updateMany(
            { _id: { $in: leadIds }, ...req.dataScope },
            { $set: { assignedTo: agentId || null } }
        );

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

        const { leads } = req.body; // Expects an array: [{name, email, phone, source, status, customData}]

        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ message: "No leads provided for import." });
        }

        // ⚡ PERFORMANCE FIX: Use Lead.distinct() instead of loading ALL leads into memory.
        // Previously: Lead.find({userId}).select('phone email').lean() loaded every document.
        // Now: distinct() returns only unique values — orders of magnitude less memory.
        const [existingPhoneList, existingEmailList] = await Promise.all([
            Lead.distinct('phone', { userId: ownerId, phone: { $ne: null } }),
            Lead.distinct('email', { userId: ownerId, email: { $ne: null } })
        ]);
        const existingPhones = new Set(existingPhoneList.map(p => normalizePhone(p)).filter(Boolean));
        const existingEmails = new Set(existingEmailList.map(e => e?.trim().toLowerCase()).filter(Boolean));

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
                newLeadsToInsert.push({
                    userId: ownerId,
                    name: lead.name || 'Unknown',
                    email: lead.email || null,
                    phone: lead.phone || 'No Phone',
                    source: lead.source || 'CSV Import',
                    status: lead.status || 'New',
                    tags: Array.isArray(lead.tags) ? lead.tags : [],
                    customData: lead.customData || {},
                    assignedTo: req.user.role === 'agent' ? getRequestUserId(req.user) : undefined
                });

                // Add to Sets so we don't insert duplicates within the same batch!
                if (normPhone) existingPhones.add(normPhone);
                if (normEmail) existingEmails.add(normEmail);
            }
        }

        if (newLeadsToInsert.length > 0) {
            await Lead.insertMany(newLeadsToInsert);

            // Log activity
            logActivity({
                userId: getRequestUserId(req.user),
                userName: req.user.name || 'Unknown',
                actionType: 'LEAD_CREATED',
                entityType: 'Lead',
                entityName: 'Bulk Import',
                metadata: { importedCount: newLeadsToInsert.length, skippedDuplicates: duplicateCount },
                companyId: ownerId
            }).catch(err => console.error('Audit log error:', err));
        }

        res.json({ 
            success: true, 
            message: "Import complete", 
            importedCount: newLeadsToInsert.length, 
            duplicateCount 
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
// NEW: BULK DELETE LEADS (single DB query replaces N individual deletes)
// ==========================================
const bulkDeleteLeads = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "No leads selected for deletion" });
        }

        // Tenant-scoped delete — can only delete leads you own
        const result = await Lead.deleteMany({
            _id: { $in: ids },
            ...req.dataScope
        });

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

        const result = await Lead.updateMany(
            { _id: { $in: ids }, ...req.dataScope },
            { $set: { status } }
        );

        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_EDITED',
            entityType: 'Lead',
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
    bulkDeleteLeads,
    bulkUpdateStatus
};
