const Lead = require('../models/Lead');
const Stage = require('../models/Stage');
const User = require('../models/User'); // Required for Agent Logic
const mongoose = require('mongoose');
const axios = require('axios');
const Papa = require('papaparse');
const { sendAutomatedEmailOnLeadCreate, sendAutomatedEmailOnStageChange } = require('../services/emailAutomationService');
const { sendAutomatedWhatsAppOnLeadCreate, sendAutomatedWhatsAppOnStageChange } = require('../services/whatsappAutomationService');
const { sendMetaEvent } = require('../services/metaConversionService');
const { sendEmail } = require('../services/emailService');
const { logActivity } = require('../services/auditService');

// ==========================================
// 1. GET LEADS (With Agent/Manager Logic + Permission Filtering)
// ==========================================
const getLeads = async (req, res) => {
    try {
        // Default to current user
        let ownerId = req.user.userId || req.user.id;
        let query = {};

        // 👇 AGENT LOGIC CHECK
        // Agar user 'agent' hai, to hum uske 'parentId' (Manager) ka data dikhayenge
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId; // Maalik (Manager) ka ID use karo

                // 🔒 PERMISSION CHECK: viewAllLeads
                // If agent doesn't have viewAllLeads permission, show only assigned leads
                if (!agentUser.permissions || !agentUser.permissions.viewAllLeads) {
                    query.assignedTo = agentUser._id;
                }
            }
        }

        // Set base query filter
        query.userId = ownerId;

        const leads = await Lead.find(query)
            .populate('assignedTo', 'name email')
            .sort({ date: -1 });
        res.json(leads);
    } catch (err) {
        console.error("Get Leads Error:", err);
        res.status(500).send('Server Error');
    }
};

// ==========================================
// 2. CREATE LEAD
// ==========================================
const createLead = async (req, res) => {
    try {
        const { name, email, phone, status, source, customData } = req.body;

        let ownerId = req.user.userId || req.user.id;
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const newLead = new Lead({
            userId: ownerId,
            name,
            email,
            phone,
            status: status || 'New',
            source: source || 'Manual Entry',
            customData: customData || {}
        });

        await newLead.save();

        // Log activity
        logActivity({
            userId: ownerId,
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_CREATED',
            entityType: 'Lead',
            entityId: newLead._id,
            entityName: newLead.name,
            metadata: { source: source || 'Manual Entry', status: status || 'New' },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        // Send automated email if configured
        if (newLead.email) {
            setTimeout(() => {
                sendAutomatedEmailOnLeadCreate(newLead, ownerId)
                    .then(sent => {
                        if (sent) {
                            Lead.findByIdAndUpdate(newLead._id, {
                                $push: {
                                    history: {
                                        type: 'Email',
                                        subType: 'Auto',
                                        content: 'Automated Welcome Email Sent',
                                        date: new Date()
                                    }
                                }
                            }).exec();
                        }
                    })
                    .catch(err => {
                        console.error('Email automation error (non-blocking):', err);
                    });
            }, 0);
        }

        // Send automated WhatsApp if configured
        if (newLead.phone) {
            setTimeout(() => {
                sendAutomatedWhatsAppOnLeadCreate(newLead, ownerId)
                    .then(sent => {
                        if (sent) {
                            Lead.findByIdAndUpdate(newLead._id, {
                                $push: {
                                    history: {
                                        type: 'WhatsApp',
                                        subType: 'Auto',
                                        content: 'Automated Welcome WhatsApp Sent',
                                        date: new Date()
                                    }
                                }
                            }).exec();
                        }
                    })
                    .catch(err => {
                        console.error('WhatsApp automation error (non-blocking):', err);
                    });
            }, 0);
        }

        res.json(newLead);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 2.5 SEND MANUAL EMAIL (New)
// ==========================================
const sendManualEmail = async (req, res) => {
    try {
        const { to, subject, message } = req.body;
        const leadId = req.params.id;
        const userId = req.user.userId || req.user.id;

        if (!to || !subject || !message) {
            return res.status(400).json({ message: "To, Subject, and Message are required" });
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
                    type: 'Email',
                    subType: 'Manual',
                    content: `Sent: ${subject}`,
                    metadata: { subject, body: message },
                    date: new Date()
                }
            }
        });

        res.json({ success: true, message: "Email sent successfully" });
    } catch (err) {
        console.error("Manual Email Error:", err);
        res.status(500).json({ message: "Failed to send email", error: err.message });
    }
};

// ==========================================
// 3. UPDATE LEAD
// ==========================================
const updateLead = async (req, res) => {
    try {
        console.log('🔄 [DEBUG updateLead] Request received for lead:', req.params.id);
        console.log('🔄 [DEBUG updateLead] Request body:', JSON.stringify(req.body));
        console.log('🔄 [DEBUG updateLead] User:', req.user?.userId || req.user?.id, 'Role:', req.user?.role);

        // SECURITY FIX: Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            console.log('❌ [DEBUG updateLead] Invalid ObjectId format');
            return res.status(400).json({ message: "Invalid lead ID format" });
        }

        // SECURITY FIX: Check authorization - user can only update their own leads
        let ownerId = req.user.userId || req.user.id;
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId).select('parentId').lean();
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
                console.log('🔄 [DEBUG updateLead] Agent detected, using parent ownerId:', ownerId);
            }
        }

        console.log('🔄 [DEBUG updateLead] Looking for lead with _id:', req.params.id, 'userId:', ownerId);
        const lead = await Lead.findOne({ _id: req.params.id, userId: ownerId });

        if (!lead) {
            console.log('❌ [DEBUG updateLead] Lead not found or access denied');
            console.log('❌ [DEBUG updateLead] Attempted query: { _id:', req.params.id, ', userId:', ownerId, '}');
            return res.status(404).json({ message: "Lead not found or access denied" });
        }

        console.log('✅ [DEBUG updateLead] Lead found:', lead._id, 'Current status:', lead.status);

        // Handle nextFollowUpDate update
        if (req.body.hasOwnProperty('nextFollowUpDate')) {
            if (req.body.nextFollowUpDate) {
                // Setting a new follow-up date
                if (lead.nextFollowUpDate && !lead.lastFollowUpDate) {
                    // If previous nextFollowUpDate exists and we're setting a new one, mark the old one as lastFollowUpDate
                    lead.lastFollowUpDate = lead.nextFollowUpDate;
                }
                lead.nextFollowUpDate = new Date(req.body.nextFollowUpDate);
            } else {
                // Clearing the follow-up date (setting to null)
                lead.nextFollowUpDate = null;
            }
            // Remove from req.body so we can use $set for other fields
            delete req.body.nextFollowUpDate;
        }

        // Track old status for stage change automation
        const oldStatus = lead.status;
        console.log('🔄 [DEBUG updateLead] Old status:', oldStatus, '-> New status:', req.body.status);

        // Update other fields
        Object.keys(req.body).forEach(key => {
            if (req.body[key] !== undefined) {
                lead[key] = req.body[key];
            }
        });

        await lead.save();
        console.log('✅ [DEBUG updateLead] Lead saved successfully. New status:', lead.status);

        // Fetch user name if missing from token (for backward compatibility)
        let initiatorName = req.user.name;
        if (!initiatorName) {
            const u = await User.findById(req.user.userId || req.user.id).select('name');
            initiatorName = u ? u.name : 'Unknown';
        }

        // Log lead edit
        const changesObj = {};
        if (oldStatus && req.body.status && oldStatus !== req.body.status) {
            changesObj.status = { before: oldStatus, after: req.body.status };
        }
        logActivity({
            userId: req.user.userId || req.user.id,
            userName: initiatorName,
            actionType: req.body.status && oldStatus !== req.body.status ? 'LEAD_STATUS_CHANGED' : 'LEAD_EDITED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            changes: Object.keys(changesObj).length > 0 ? changesObj : null,
            metadata: { fieldsUpdated: Object.keys(req.body) },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        // Send automated email if stage changed
        if (req.body.status && req.body.status !== oldStatus && lead.email) {
            const ownerId = lead.userId;
            sendAutomatedEmailOnStageChange(lead, oldStatus, req.body.status, ownerId)
                .then(sent => {
                    if (sent) {
                        Lead.findByIdAndUpdate(lead._id, {
                            $push: {
                                history: {
                                    type: 'Email',
                                    subType: 'Auto',
                                    content: `Automated Email: Stage changed to ${req.body.status}`,
                                    date: new Date()
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
        if (req.body.status && req.body.status !== oldStatus && lead.phone) {
            const ownerId = lead.userId;
            sendAutomatedWhatsAppOnStageChange(lead, oldStatus, req.body.status, ownerId)
                .then(sent => {
                    if (sent) {
                        Lead.findByIdAndUpdate(lead._id, {
                            $push: {
                                history: {
                                    type: 'WhatsApp',
                                    subType: 'Auto',
                                    content: `Automated WhatsApp: Stage changed to ${req.body.status}`,
                                    date: new Date()
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
        if (req.body.status && req.body.status !== oldStatus) {
            await Lead.findByIdAndUpdate(lead._id, {
                $push: {
                    history: {
                        type: 'System',
                        subType: 'Stage Change',
                        content: `${initiatorName} changed stage from "${oldStatus}" to "${req.body.status}"`,
                        date: new Date()
                    }
                }
            });
        }

        // Send Meta Conversion API event if status changed
        if (req.body.status && req.body.status !== oldStatus) {
            try {
                const ownerUser = await User.findById(lead.userId).select('metaCapiEnabled metaPixelId metaCapiAccessToken metaTestEventCode metaStageMapping');
                if (ownerUser && ownerUser.metaCapiEnabled) {
                    sendMetaEvent(ownerUser, lead, req.body.status, oldStatus).catch(err => {
                        console.error('Meta CAPI error (non-blocking):', err);
                    });
                }
            } catch (err) {
                console.error('Error fetching user for Meta CAPI (non-blocking):', err);
            }
        }

        res.json({ success: true, lead });
    } catch (err) {
        console.error("Update Lead Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4. DELETE LEAD
// ==========================================
const deleteLead = async (req, res) => {
    try {
        // SECURITY FIX: Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: "Invalid lead ID format" });
        }

        // SECURITY FIX: Check authorization - user can only delete their own leads
        let ownerId = req.user.userId || req.user.id;
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId).select('parentId').lean();
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const deletedLead = await Lead.findOneAndDelete({ _id: req.params.id, userId: ownerId });

        if (!deletedLead) {
            return res.status(404).json({ message: "Lead not found or access denied" });
        }

        // Log deletion
        logActivity({
            userId: req.user.userId || req.user.id,
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
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 5. ADD NOTE
// ==========================================
const addNote = async (req, res) => {
    try {
        // SECURITY FIX: Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: "Invalid lead ID format" });
        }

        // SECURITY FIX: Validate and sanitize input
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ message: "Note text is required" });
        }

        // SECURITY FIX: Check authorization
        let ownerId = req.user.userId || req.user.id;
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId).select('parentId').lean();
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const updatedLead = await Lead.findOneAndUpdate(
            { _id: req.params.id, userId: ownerId },
            {
                $push: {
                    notes: { text: text.trim(), date: new Date() },
                    history: {
                        type: 'Note',
                        subType: 'Manual',
                        content: text.trim(),
                        date: new Date()
                    }
                }
            },
            { new: true }
        );

        if (!updatedLead) return res.status(404).json({ message: "Lead not found or access denied" });

        // Log note addition
        logActivity({
            userId: req.user.userId || req.user.id,
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
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 6. STAGE MANAGEMENT (Get, Create, Delete)
// ==========================================
const getStages = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        let stages = await Stage.find({ userId: userId }).sort('order');

        if (stages.length === 0) {
            const defaults = [
                { name: 'New', order: 1, userId: userId },
                { name: 'Contacted', order: 2, userId: userId },
                { name: 'Won', order: 3, userId: userId }
            ];
            await Stage.insertMany(defaults);
            return res.json(defaults);
        }
        res.json(stages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const createStage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const newStage = await Stage.create({
            name: req.body.name,
            order: Date.now(),
            userId: userId
        });
        res.json(newStage);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const deleteStage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const stage = await Stage.findOne({ _id: req.params.id, userId: userId });

        if (!stage) return res.status(404).json({ message: 'Stage not found' });
        if (stage.name === 'New') return res.status(400).json({ message: "Cannot delete 'New' stage" });

        await Stage.deleteOne({ _id: stage._id });

        // Move leads to 'New'
        await Lead.updateMany(
            { userId: userId, status: stage.name },
            { $set: { status: 'New' } }
        );

        return res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 7. SYNC GOOGLE SHEET
// ==========================================
const syncLeads = async (req, res) => {
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ message: "Link required" });

    try {
        const userId = req.user.userId || req.user.id;

        // Extract sheet ID from Google Sheets URL
        const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!sheetIdMatch || !sheetIdMatch[1]) {
            return res.status(400).json({ message: "Invalid Google Sheets URL format" });
        }

        // Fetch user's custom field definitions
        const user = await User.findById(userId).select('customFieldDefinitions').lean();
        const customFieldDefs = user?.customFieldDefinitions || [];

        // Create a map of lowercase label -> key for matching
        const customFieldMap = {};
        customFieldDefs.forEach(field => {
            customFieldMap[field.label.toLowerCase()] = field.key;
        });

        const sheetId = sheetIdMatch[1];
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

        const response = await axios.get(csvUrl);
        const parsed = Papa.parse(response.data, { header: true, skipEmptyLines: true });

        // Standard field keywords to exclude from custom mapping
        const standardKeywords = ['name', 'email', 'phone', 'mobile', 'status', 'source'];

        let count = 0;
        for (const row of parsed.data) {
            const keys = Object.keys(row);
            const nameKey = keys.find(k => k.toLowerCase().includes('name'));
            const emailKey = keys.find(k => k.toLowerCase().includes('email'));
            const phoneKey = keys.find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile'));

            const finalName = nameKey ? row[nameKey] : 'Unknown';
            const finalEmail = emailKey ? row[emailKey] : null;
            const finalPhone = phoneKey ? row[phoneKey] : 'No Phone';

            // Build customData from remaining columns
            const customData = {};
            keys.forEach(header => {
                const headerLower = header.toLowerCase();
                // Skip standard fields
                if (standardKeywords.some(sw => headerLower.includes(sw))) {
                    return;
                }
                // Check if header matches a custom field label
                const matchedKey = customFieldMap[headerLower];
                if (matchedKey && row[header]) {
                    customData[matchedKey] = row[header];
                }
            });

            if (finalEmail || finalPhone !== 'No Phone') {
                const exists = finalEmail
                    ? await Lead.findOne({ email: finalEmail, userId: userId })
                    : null;

                if (!exists) {
                    const newLead = await Lead.create({
                        userId: userId,
                        name: finalName,
                        email: finalEmail,
                        phone: finalPhone,
                        source: 'Google Sheet',
                        status: 'New',
                        customData: customData
                    });

                    // Send automated email if configured
                    if (newLead.email) {
                        sendAutomatedEmailOnLeadCreate(newLead, userId).catch(err => {
                            console.error('Email automation error (non-blocking):', err);
                        });
                    }

                    // Send automated WhatsApp if configured
                    if (newLead.phone) {
                        sendAutomatedWhatsAppOnLeadCreate(newLead, userId).catch(err => {
                            console.error('WhatsApp automation error (non-blocking):', err);
                        });
                    }

                    count++;
                }
            }
        }
        res.json({ success: true, message: `${count} New Leads Imported!` });
    } catch (err) {
        console.error("Sync Sheet Error:", err);
        res.status(500).json({ message: "Error syncing sheet: " + (err.message || "Unknown error") });
    }
};

// ==========================================
// 8. ANALYTICS
// ==========================================
const getAnalytics = async (req, res) => {
    try {
        // Note: For Agents, this should technically fetch Manager's analytics
        // But for now, we keep it simple based on ID
        let ownerId = req.user.userId || req.user.id;

        // Agent Logic Check
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId).select('parentId').lean();
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        // Optimized: Use aggregation pipeline instead of fetching all leads into memory
        // This is much more efficient for large datasets
        const ownerIdObjectId = mongoose.Types.ObjectId.isValid(ownerId)
            ? new mongoose.Types.ObjectId(ownerId)
            : ownerId;

        const statsArray = await Lead.aggregate([
            { $match: { userId: ownerIdObjectId } },
            {
                $group: {
                    _id: { $ifNull: ['$status', 'New'] },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Convert array to object format
        const stats = {};
        statsArray.forEach(item => {
            stats[item._id] = item.count;
        });

        // Calculate follow-up analytics
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        // Follow-ups due today
        const followUpToday = await Lead.countDocuments({
            userId: ownerIdObjectId,
            nextFollowUpDate: {
                $gte: today,
                $lt: tomorrow
            }
        });

        // Overdue follow-ups (before today)
        const followUpOverdue = await Lead.countDocuments({
            userId: ownerIdObjectId,
            nextFollowUpDate: {
                $lt: today
            }
        });

        // Upcoming follow-ups (next 7 days, excluding today)
        const followUpUpcoming = await Lead.countDocuments({
            userId: ownerIdObjectId,
            nextFollowUpDate: {
                $gte: tomorrow,
                $lt: nextWeek
            }
        });

        // Add follow-up analytics to response
        stats.followUpAnalytics = {
            dueToday: followUpToday,
            overdue: followUpOverdue,
            upcoming: followUpUpcoming,
            total: followUpToday + followUpOverdue + followUpUpcoming
        };

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 8.5. GET ANALYTICS DATA (For Dashboard)
// ==========================================
const getAnalyticsData = async (req, res) => {
    try {
        let ownerId = req.user.userId || req.user.id;

        // Agent Logic Check
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId).select('parentId').lean();
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const ownerIdObjectId = mongoose.Types.ObjectId.isValid(ownerId)
            ? new mongoose.Types.ObjectId(ownerId)
            : ownerId;

        // Get all leads for this user
        const allLeads = await Lead.find({ userId: ownerIdObjectId }).lean();
        const totalLeads = allLeads.length;

        // Calculate today's leads
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const leadsToday = allLeads.filter(lead => {
            const leadDate = new Date(lead.date || lead.createdAt);
            return leadDate >= today && leadDate < tomorrow;
        }).length;

        // Calculate conversion rate (Won leads / Total leads)
        const wonLeads = allLeads.filter(lead =>
            lead.status && lead.status.toLowerCase().includes('won')
        ).length;
        const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : 0;

        // Follow-up analytics
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        const followUpToday = allLeads.filter(lead => {
            if (!lead.nextFollowUpDate) return false;
            const followUpDate = new Date(lead.nextFollowUpDate);
            return followUpDate >= today && followUpDate < tomorrow;
        }).length;

        const followUpOverdue = allLeads.filter(lead => {
            if (!lead.nextFollowUpDate) return false;
            const followUpDate = new Date(lead.nextFollowUpDate);
            return followUpDate < today;
        }).length;

        const followUpUpcoming = allLeads.filter(lead => {
            if (!lead.nextFollowUpDate) return false;
            const followUpDate = new Date(lead.nextFollowUpDate);
            return followUpDate >= tomorrow && followUpDate < nextWeek;
        }).length;

        const followUpTotal = allLeads.filter(lead => lead.nextFollowUpDate).length;

        // Lead source distribution
        const leadSource = {};
        allLeads.forEach(lead => {
            const source = lead.source || 'Unknown';
            leadSource[source] = (leadSource[source] || 0) + 1;
        });

        // Leads over time (last 7 days)
        const leadsOverTime = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);

            const count = allLeads.filter(lead => {
                const leadDate = new Date(lead.date || lead.createdAt);
                return leadDate >= date && leadDate < nextDate;
            }).length;

            leadsOverTime.push({
                date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                count
            });
        }

        // Stage distribution
        const stageDistribution = {};
        allLeads.forEach(lead => {
            const stage = lead.status || 'New';
            stageDistribution[stage] = (stageDistribution[stage] || 0) + 1;
        });

        res.json({
            totalLeads,
            leadsToday,
            conversionRate: parseFloat(conversionRate),
            followUpToday,
            followUpOverdue,
            followUpUpcoming,
            followUpTotal,
            leadSource,
            leadsOverTime,
            stageDistribution
        });
    } catch (err) {
        console.error("Get Analytics Data Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 9. GET FOLLOW-UP LEADS (Due Today)
// ==========================================
const getFollowUpLeads = async (req, res) => {
    try {
        let ownerId = req.user.userId || req.user.id;

        // Agent Logic Check
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        // Get today's date (start and end of day)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Find leads with nextFollowUpDate between today 00:00 and tomorrow 00:00
        const followUpLeads = await Lead.find({
            userId: ownerId,
            nextFollowUpDate: {
                $gte: today,
                $lt: tomorrow
            }
        }).sort({ nextFollowUpDate: 1 });

        res.json(followUpLeads);
    } catch (err) {
        console.error("Get Follow-up Leads Error:", err);
        res.status(500).json({ error: err.message });
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

        let ownerId = req.user.userId || req.user.id;

        // Agent Logic Check
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const lead = await Lead.findOne({ _id: leadId, userId: ownerId });

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
        res.status(500).json({ error: err.message });
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

        let ownerId = req.user.userId || req.user.id;

        // Agent Logic Check
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const lead = await Lead.findOne({ _id: leadId, userId: ownerId });

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
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 12. GET FOLLOW-UP DONE LEADS
// ==========================================
const getFollowUpDoneLeads = async (req, res) => {
    try {
        let ownerId = req.user.userId || req.user.id;

        // Agent Logic Check
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        // Get all leads for the user first
        const allLeads = await Lead.find({ userId: ownerId });

        // Filter to only include leads with at least one follow-up history entry
        const filteredDoneLeads = allLeads.filter(lead =>
            lead.followUpHistory &&
            Array.isArray(lead.followUpHistory) &&
            lead.followUpHistory.length > 0
        );

        // Sort by most recent follow-up completion date
        filteredDoneLeads.sort((a, b) => {
            const aDate = a.followUpHistory && a.followUpHistory.length > 0
                ? new Date(a.followUpHistory[a.followUpHistory.length - 1].completedDate || 0)
                : new Date(0);
            const bDate = b.followUpHistory && b.followUpHistory.length > 0
                ? new Date(b.followUpHistory[b.followUpHistory.length - 1].completedDate || 0)
                : new Date(0);
            return bDate - aDate; // Most recent first
        });

        res.json(filteredDoneLeads);
    } catch (err) {
        console.error("Get Follow-up Done Leads Error:", err);
        res.status(500).json({ error: err.message });
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

        let ownerId = req.user.userId || req.user.id;

        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const lead = await Lead.findOne({ _id: id, userId: ownerId });
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
            userId: req.user.userId || req.user.id,
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_ASSIGNED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            metadata: { assignedTo: agentId ? 'Agent' : 'Unassigned' },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        const updatedLead = await Lead.findById(id).populate('assignedTo', 'name email');
        res.json({ success: true, message: agentId ? "Lead assigned" : "Lead unassigned", lead: updatedLead });
    } catch (err) {
        console.error("Assign Lead Error:", err);
        res.status(500).json({ error: err.message });
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

        let ownerId = req.user.userId || req.user.id;

        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        if (agentId) {
            const agent = await User.findOne({ _id: agentId, parentId: ownerId, role: 'agent' });
            if (!agent) {
                return res.status(400).json({ message: "Invalid agent ID" });
            }
        }

        const result = await Lead.updateMany(
            { _id: { $in: leadIds }, userId: ownerId },
            { $set: { assignedTo: agentId || null } }
        );

        res.json({ success: true, message: `${result.modifiedCount} leads updated`, modifiedCount: result.modifiedCount });
    } catch (err) {
        console.error("Bulk Assign Error:", err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getLeads,
    createLead,
    updateLead,
    deleteLead,
    addNote,
    getStages,
    createStage,
    deleteStage,
    syncLeads,
    getAnalytics,
    getAnalyticsData,
    getFollowUpLeads,
    updateFollowUpDate,
    completeFollowUp,
    getFollowUpDoneLeads,
    sendManualEmail
    ,
    assignLead,
    bulkAssignLeads
};