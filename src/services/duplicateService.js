const Lead = require('../models/Lead');

// Normalize phone number for consistent matching
// Strips spaces, dashes, dots, parentheses, and common country code prefixes (+91, 0)
function normalizePhone(phone) {
    if (!phone) return null;
    let normalized = phone.toString().replace(/[\s\-\.\(\)]/g, '');
    // Remove leading +91 or 91 (India) or leading 0
    normalized = normalized.replace(/^(\+91|91|0)/, '');
    // Must have at least 7 digits to be valid
    if (normalized.length < 7) return null;
    return normalized;
}

// Find duplicate leads for a given user by phone OR email
async function findDuplicates(userId, phone, email, excludeId = null) {
    const conditions = [];

    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone) {
        // Build regex to match phone with or without country code/spaces
        const phoneRegex = new RegExp(normalizedPhone.replace(/\D/g, '').slice(-10) + '$');
        conditions.push({ phone: { $regex: phoneRegex } });
    }

    if (email && email.trim()) {
        conditions.push({ email: { $regex: new RegExp('^' + email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
    }

    if (conditions.length === 0) return [];

    const query = {
        userId: userId,
        $or: conditions
    };

    if (excludeId) {
        query._id = { $ne: excludeId };
    }

    const duplicates = await Lead.find(query)
        .select('name phone email status source createdAt')
        .sort({ createdAt: 1 })
        .lean();

    return duplicates;
}

// Find ALL duplicate groups for a user
// Groups leads that share the same normalized phone or email
async function findAllDuplicateGroups(userId) {
    const allLeads = await Lead.find({ userId })
        .select('name phone email status source createdAt updatedAt')
        .sort({ createdAt: 1 })
        .lean();

    // Build lookup maps
    const phoneMap = {};  // normalizedPhone -> [leads]
    const emailMap = {};  // lowerEmail -> [leads]
    const leadGroups = {}; // groupId -> Set of lead IDs
    const leadToGroup = {}; // leadId -> groupId

    let groupCounter = 0;

    allLeads.forEach(lead => {
        const leadId = lead._id.toString();
        const normPhone = normalizePhone(lead.phone);
        const normEmail = lead.email ? lead.email.trim().toLowerCase() : null;

        let assignedGroup = null;

        // Check phone match
        if (normPhone) {
            const last10 = normPhone.slice(-10);
            if (phoneMap[last10]) {
                // Found phone match — use existing group
                const existingLeadId = phoneMap[last10][0]._id.toString();
                assignedGroup = leadToGroup[existingLeadId];
                phoneMap[last10].push(lead);
            } else {
                phoneMap[last10] = [lead];
            }
        }

        // Check email match
        if (normEmail) {
            if (emailMap[normEmail]) {
                const existingLeadId = emailMap[normEmail][0]._id.toString();
                const emailGroup = leadToGroup[existingLeadId];

                if (assignedGroup && assignedGroup !== emailGroup) {
                    // Merge two groups
                    const mergeFrom = emailGroup;
                    const mergeTo = assignedGroup;
                    if (leadGroups[mergeFrom]) {
                        leadGroups[mergeFrom].forEach(id => {
                            leadToGroup[id] = mergeTo;
                            leadGroups[mergeTo].add(id);
                        });
                        delete leadGroups[mergeFrom];
                    }
                } else if (!assignedGroup) {
                    assignedGroup = emailGroup;
                }

                emailMap[normEmail].push(lead);
            } else {
                emailMap[normEmail] = [lead];
            }
        }

        // Assign to group
        if (assignedGroup) {
            leadToGroup[leadId] = assignedGroup;
            if (!leadGroups[assignedGroup]) leadGroups[assignedGroup] = new Set();
            leadGroups[assignedGroup].add(leadId);
        } else {
            // New group
            const newGroupId = `group_${groupCounter++}`;
            leadToGroup[leadId] = newGroupId;
            leadGroups[newGroupId] = new Set([leadId]);
        }
    });

    // Build result — only groups with 2+ leads are duplicates
    const leadMap = {};
    allLeads.forEach(lead => {
        leadMap[lead._id.toString()] = lead;
    });

    const duplicateGroups = [];
    Object.entries(leadGroups).forEach(([groupId, leadIds]) => {
        if (leadIds.size >= 2) {
            const leads = Array.from(leadIds).map(id => leadMap[id]).filter(Boolean);
            // Sort by createdAt ascending (oldest first — oldest = the one to keep)
            leads.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            duplicateGroups.push({
                groupId,
                matchReason: getMatchReason(leads),
                keep: leads[0],       // Oldest lead
                duplicates: leads.slice(1), // Newer leads to delete
                totalCount: leads.length
            });
        }
    });

    return duplicateGroups;
}

// Determine why leads matched
function getMatchReason(leads) {
    const reasons = [];
    const phones = leads.map(l => normalizePhone(l.phone)).filter(Boolean);
    const emails = leads.map(l => l.email?.trim().toLowerCase()).filter(Boolean);

    const uniquePhones = new Set(phones.map(p => p.slice(-10)));
    const uniqueEmails = new Set(emails);

    if (uniquePhones.size < phones.length) reasons.push('Same Phone');
    if (uniqueEmails.size < emails.length) reasons.push('Same Email');

    return reasons.length > 0 ? reasons.join(' & ') : 'Phone/Email Match';
}

module.exports = {
    normalizePhone,
    findDuplicates,
    findAllDuplicateGroups
};
