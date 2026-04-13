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
// ⚡ PERFORMANCE: Uses two targeted MongoDB aggregation pipelines (phone + email)
// instead of loading ALL leads into Node.js memory.
// For 5,000 leads: ~50KB aggregation result vs ~5MB full document load.
async function findAllDuplicateGroups(userId) {
    // Step 1: Find phone duplicates using aggregation (normalizes via $substr to last 10 digits)
    const [phoneDups, emailDups] = await Promise.all([
        Lead.aggregate([
            { $match: { userId: userId, phone: { $ne: null, $exists: true } } },
            { $addFields: { normPhone: { $substr: [ { $replaceAll: { input: '$phone', find: ' ', replacement: '' } }, -10, 10 ] } } },
            { $group: {
                _id: '$normPhone',
                count: { $sum: 1 },
                leads: { $push: { _id: '$_id', name: '$name', phone: '$phone', email: '$email', status: '$status', source: '$source', createdAt: '$createdAt', updatedAt: '$updatedAt' } }
            }},
            { $match: { count: { $gte: 2 } } }
        ]),
        Lead.aggregate([
            { $match: { userId: userId, email: { $ne: null, $exists: true } } },
            { $addFields: { normEmail: { $toLower: { $trim: { input: '$email' } } } } },
            { $group: {
                _id: '$normEmail',
                count: { $sum: 1 },
                leads: { $push: { _id: '$_id', name: '$name', phone: '$phone', email: '$email', status: '$status', source: '$source', createdAt: '$createdAt', updatedAt: '$updatedAt' } }
            }},
            { $match: { count: { $gte: 2 } } }
        ])
    ]);

    // Step 2: Merge phone and email duplicate groups
    // Use a union-find approach to merge groups that share any lead
    const leadToGroup = {};  // leadId -> groupId
    const groups = {};       // groupId -> Set of lead objects
    let groupCounter = 0;

    const mergeLeadsIntoGroup = (leads, reason) => {
        let targetGroupId = null;

        // Check if any lead in this batch already belongs to a group
        for (const lead of leads) {
            const lid = lead._id.toString();
            if (leadToGroup[lid]) {
                targetGroupId = leadToGroup[lid];
                break;
            }
        }

        if (!targetGroupId) {
            targetGroupId = `group_${groupCounter++}`;
            groups[targetGroupId] = { leads: new Map(), reasons: new Set() };
        }

        groups[targetGroupId].reasons.add(reason);

        for (const lead of leads) {
            const lid = lead._id.toString();
            const existingGroupId = leadToGroup[lid];

            if (existingGroupId && existingGroupId !== targetGroupId) {
                // Merge existing group into target
                const mergeFrom = groups[existingGroupId];
                if (mergeFrom) {
                    for (const [id, l] of mergeFrom.leads) {
                        groups[targetGroupId].leads.set(id, l);
                        leadToGroup[id] = targetGroupId;
                    }
                    for (const r of mergeFrom.reasons) {
                        groups[targetGroupId].reasons.add(r);
                    }
                    delete groups[existingGroupId];
                }
            }

            leadToGroup[lid] = targetGroupId;
            groups[targetGroupId].leads.set(lid, lead);
        }
    };

    // Process phone duplicate groups
    for (const dup of phoneDups) {
        mergeLeadsIntoGroup(dup.leads, 'Same Phone');
    }

    // Process email duplicate groups
    for (const dup of emailDups) {
        mergeLeadsIntoGroup(dup.leads, 'Same Email');
    }

    // Step 3: Build result — only groups with 2+ leads
    const duplicateGroups = [];
    for (const [groupId, group] of Object.entries(groups)) {
        if (group.leads.size >= 2) {
            const leads = Array.from(group.leads.values());
            // Sort by createdAt ascending (oldest first — oldest = the one to keep)
            leads.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            duplicateGroups.push({
                groupId,
                matchReason: Array.from(group.reasons).join(' & '),
                keep: leads[0],       // Oldest lead
                duplicates: leads.slice(1), // Newer leads to delete
                totalCount: leads.length
            });
        }
    }

    return duplicateGroups;
}

module.exports = {
    normalizePhone,
    findDuplicates,
    findAllDuplicateGroups
};
