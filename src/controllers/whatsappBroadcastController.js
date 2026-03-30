const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const Lead = require('../models/Lead');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const User = require('../models/User');
const { sendWhatsAppMessage } = require('../services/whatsappService');

// Helper to resolve specific mapped variables
const resolveVariable = (mappingObj, varNum, data) => {
    // Handle Mongoose Map vs plain object
    const mapType = (mappingObj && typeof mappingObj.get === 'function') 
        ? mappingObj.get(varNum.toString()) 
        : (mappingObj?.[varNum.toString()] || '');
        
    switch (mapType) {
        case 'lead.name': return data.leadName || '';
        case 'lead.phone': return data.leadPhone || '';
        case 'lead.email': return data.leadEmail || '';
        case 'lead.status': return data.stageName || '';
        case 'company.name': return data.companyName || '';
        case 'user.name': return data.userName || '';
        case 'custom': 
            const customVal = (mappingObj && typeof mappingObj.get === 'function') 
                ? mappingObj.get(`${varNum}_custom`) 
                : (mappingObj?.[`${varNum}_custom`] || '');
            return customVal || '';
        default: 
            // Fallback to older static convention if unmapped
            if (varNum === 1) return data.leadName || 'Customer';
            if (varNum === 2) return data.stageName || 'New';
            if (varNum === 3) return data.companyName || 'Our Company';
            if (varNum === 4) return data.userName || 'Representative';
            return '';
    }
};

// Helper to build Meta API components from the database components
const buildMetaComponents = (dbComponents, variableMapping, data) => {
    const metaComponents = [];

    for (const comp of dbComponents) {
        if (comp.type === 'BODY' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                
                for (const n of nums) {
                    parameters.push({ type: 'text', text: resolveVariable(variableMapping, n, data) });
                }
                metaComponents.push({ type: 'body', parameters: parameters });
            }
        }
        if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                for (const n of nums) {
                    parameters.push({ type: 'text', text: resolveVariable(variableMapping, n, data) });
                }
                metaComponents.push({ type: 'header', parameters: parameters });
            }
        }
    }
    return metaComponents;
};

// Job processor definition (this could live in a separate worker file, but placing here for simplicity)
let agendaInstance = null;
const defineBroadcastJob = (agenda) => {
    agendaInstance = agenda;
    agenda.define('process whatsapp broadcast', async (job) => {
        const { broadcastId, userId } = job.attrs.data;
        
        try {
            const broadcast = await WhatsAppBroadcast.findById(broadcastId)
                .populate('templateId');
                
            if (!broadcast || broadcast.status !== 'PROCESSING') {
                console.log(`[Broadcast ${broadcastId}] Not ready or not found. Target status: PROCESSING, Current: ${broadcast?.status}`);
                return;
            }

            if (!broadcast.templateId || broadcast.templateId.status !== 'APPROVED') {
                broadcast.status = 'FAILED';
                broadcast.errorMessage = 'Template is missing or not APPROVED by Meta.';
                await broadcast.save();
                return;
            }

            // Find target leads based on audience selection
            let leadQuery = { userId };
            
            // Basic filtering logic (assuming Lead schema has these fields based on CRM structure)
            if (broadcast.targetAudience.selectionType === 'STAGES' && broadcast.targetAudience.stages.length > 0) {
                leadQuery.status = { $in: broadcast.targetAudience.stages };
            } else if (broadcast.targetAudience.selectionType === 'TAGS' && broadcast.targetAudience.tags.length > 0) {
                // Assuming Lead schema has a tags array (might need adjustment based on exact schema)
                leadQuery.tags = { $in: broadcast.targetAudience.tags };
            } else if (broadcast.targetAudience.selectionType === 'SPECIFIC' && broadcast.targetAudience.specificLeadIds.length > 0) {
                leadQuery._id = { $in: broadcast.targetAudience.specificLeadIds };
            }

            // Only grab leads with valid phone numbers
            const leads = await Lead.find({
                ...leadQuery,
                phone: { $exists: true, $ne: null, $ne: '' }
            }).select('_id name phone customData');

            console.log(`[Broadcast ${broadcastId}] Found ${leads.length} valid lead targets.`);

            // Update stats
            broadcast.stats.totalTargets = leads.length;
            await broadcast.save();

            if (leads.length === 0) {
                broadcast.status = 'COMPLETED';
                broadcast.completedAt = new Date();
                broadcast.errorMessage = 'No valid leads found for criteria.';
                await broadcast.save();
                return;
            }

            // Fetch user info for template variables
            const user = await User.findById(userId);

            // Process leads sequentially (or batch them for speed, but sequentially is safer for Meta API limits initially)
            let successCount = 0;
            let failCount = 0;

            for (const lead of leads) {
                try {
                    const templateData = {
                        leadName: lead.name || '',
                        leadEmail: lead.email || '',
                        leadPhone: lead.phone || '',
                        companyName: user?.companyName || '',
                        userName: user?.name || '',
                        stageName: lead.status || 'New'
                    };

                    const metaComponents = buildMetaComponents(broadcast.templateId.components || [], broadcast.templateId.variableMapping, templateData);
                    const result = await sendWhatsAppMessage(lead.phone, broadcast.templateId.name, userId, metaComponents);
                    
                    if (result && result.success !== false) {
                        successCount++;
                        broadcast.stats.sent = successCount;
                        
                        // ============================================
                        // Sync to New Conversation Data Model
                        // ============================================
                        const waMessageId = result.messages?.[0]?.id;
                        if (waMessageId) {
                            try {
                                let conversation = await WhatsAppConversation.findOne({
                                    phone: lead.phone,
                                    userId: userId
                                });

                                if (!conversation) {
                                    conversation = new WhatsAppConversation({
                                        userId: userId,
                                        leadId: lead._id,
                                        phone: lead.phone,
                                        displayName: lead.name,
                                        status: 'active',
                                        unreadCount: 0,
                                        metadata: { totalMessages: 0, totalInbound: 0, totalOutbound: 0 }
                                    });
                                }

                                const messageRecord = new WhatsAppMessage({
                                    conversationId: conversation._id,
                                    userId: userId,
                                    waMessageId: waMessageId,
                                    direction: 'outbound',
                                    type: 'template',
                                    content: { text: `[Broadcast] Template: ${broadcast.templateId.name}` },
                                    status: 'sent',
                                    timestamp: new Date(),
                                    isAutomated: true
                                });

                                await messageRecord.save();

                                conversation.lastMessage = `[Broadcast] ${broadcast.templateId.name}`;
                                conversation.lastMessageAt = new Date();
                                conversation.lastMessageDirection = 'outbound';
                                conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
                                conversation.metadata.totalOutbound = (conversation.metadata.totalOutbound || 0) + 1;
                                
                                await conversation.save();
                            } catch (syncErr) {
                                console.error(`[Broadcast ${broadcastId}] DB Sync failed for lead ${lead.phone}:`, syncErr.message);
                            }
                        }

                    } else {
                        failCount++;
                        broadcast.stats.failed = failCount;
                    }

                    // Optional: Save small progress interval (e.g. every 10 messages)
                    if ((successCount + failCount) % 10 === 0) {
                        await broadcast.save();
                    }

                    // Sleep 1000ms (1 second) to enforce a STRICT limit of ~60 messages per minute
                    // This prevents Meta rate limits and API Lockups for clients.
                    await new Promise(r => setTimeout(r, 1000));
                    
                } catch (err) {
                    console.error(`[Broadcast ${broadcastId}] Failed for lead ${lead._id}:`, err.message);
                    failCount++;
                    broadcast.stats.failed = failCount;
                }
            }

            broadcast.status = 'COMPLETED';
            broadcast.completedAt = new Date();
            await broadcast.save();
            console.log(`[Broadcast ${broadcastId}] Finished. Sent: ${successCount}, Failed: ${failCount}`);

        } catch (error) {
            console.error(`[Broadcast ${broadcastId}] Critical Failure:`, error);
            await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                status: 'FAILED',
                errorMessage: error.message
            });
        }
    });
};

// --- API Methods ---

exports.getBroadcasts = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcasts = await WhatsAppBroadcast.find({ userId })
            .populate('templateId', 'name status category')
            .sort({ createdAt: -1 });

        res.json({ broadcasts });
    } catch (error) {
        console.error('Error fetching broadcasts:', error);
        res.status(500).json({ message: 'Error fetching broadcasts', error: error.message });
    }
};

exports.getBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId })
            .populate('templateId');

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });
        res.json({ broadcast });
    } catch (error) {
        console.error('Error fetching broadcast:', error);
        res.status(500).json({ message: 'Error fetching broadcast', error: error.message });
    }
};

exports.createBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { name, templateId, targetAudience, scheduledFor } = req.body;

        if (!name || !templateId) {
            return res.status(400).json({ message: 'Name and Template are required' });
        }

        // Verify template exists and is APPROVED
        const template = await WhatsAppTemplate.findOne({ _id: templateId, userId });
        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }
        if (template.status !== 'APPROVED') {
            return res.status(400).json({ message: 'Can only broadcast APPROVED templates' });
        }

        const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();

        const broadcast = new WhatsAppBroadcast({
            userId,
            name,
            templateId,
            targetAudience: targetAudience || { selectionType: 'ALL' },
            scheduledFor: isScheduled ? new Date(scheduledFor) : null,
            status: isScheduled ? 'SCHEDULED' : 'DRAFT'
        });

        await broadcast.save();
        res.status(201).json({ broadcast });
    } catch (error) {
        console.error('Error creating broadcast:', error);
        res.status(500).json({ message: 'Error creating broadcast', error: error.message });
    }
};

// Start or Schedule the job in Agenda
exports.startBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });

        if (['PROCESSING', 'COMPLETED'].includes(broadcast.status)) {
            return res.status(400).json({ message: 'Broadcast is already running or completed' });
        }

        // We require Agenda to be initialized and passed in during app startup
        if (!agendaInstance) {
            return res.status(500).json({ message: 'Job queue (Agenda) is not initialized' });
        }

        // If it's scheduled for future
        if (broadcast.scheduledFor && new Date(broadcast.scheduledFor) > new Date()) {
            broadcast.status = 'SCHEDULED';
            await broadcast.save();
            
            const job = await agendaInstance.schedule(broadcast.scheduledFor, 'process whatsapp broadcast', {
                broadcastId: broadcast._id,
                userId
            });
            
            broadcast.jobId = job.attrs._id;
            await broadcast.save();
            
            return res.json({ message: 'Broadcast scheduled', broadcast });
        }

        // Run immediately
        broadcast.status = 'PROCESSING';
        broadcast.startedAt = new Date();
        await broadcast.save();

        const job = await agendaInstance.now('process whatsapp broadcast', {
            broadcastId: broadcast._id,
            userId
        });

        broadcast.jobId = job.attrs._id;
        await broadcast.save();

        res.json({ message: 'Broadcast started', broadcast });
    } catch (error) {
        console.error('Error starting broadcast:', error);
        res.status(500).json({ message: 'Error starting broadcast', error: error.message });
    }
};

exports.cancelBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(broadcast.status)) {
            return res.status(400).json({ message: `Cannot cancel a broadcast that is ${broadcast.status}` });
        }

        broadcast.status = 'CANCELLED';
        
        // Remove from agenda if it exists
        if (agendaInstance && broadcast.jobId) {
            try {
                // To cancel an agenda job, we can remove it by ID. Usually requires DB query if not standard method
                await agendaInstance.cancel({ _id: broadcast.jobId });
            } catch (err) {
                console.error('Failed to cancel agenda job:', err);
            }
        }

        await broadcast.save();
        res.json({ message: 'Broadcast cancelled', broadcast });
    } catch (error) {
        console.error('Error cancelling broadcast:', error);
        res.status(500).json({ message: 'Error cancelling broadcast', error: error.message });
    }
};

exports.deleteBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });
        if (broadcast.status === 'PROCESSING') {
            return res.status(400).json({ message: 'Cannot delete a running broadcast. Cancel it first.' });
        }

        await WhatsAppBroadcast.findByIdAndDelete(req.params.id);
        res.json({ message: 'Broadcast deleted' });
    } catch (error) {
        console.error('Error deleting broadcast:', error);
        res.status(500).json({ message: 'Error deleting broadcast', error: error.message });
    }
};

module.exports = {
    defineBroadcastJob,
    getBroadcasts: exports.getBroadcasts,
    getBroadcast: exports.getBroadcast,
    createBroadcast: exports.createBroadcast,
    startBroadcast: exports.startBroadcast,
    cancelBroadcast: exports.cancelBroadcast,
    deleteBroadcast: exports.deleteBroadcast
};
