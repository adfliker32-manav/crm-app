const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'controllers', 'leadController.js');

// Functions to add before module.exports
const assignFunctions = `

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

        res.json({ success: true, message: \`\${result.modifiedCount} leads updated\`, modifiedCount: result.modifiedCount });
    } catch (err) {
        console.error("Bulk Assign Error:", err);
        res.status(500).json({ error: err.message });
    }
};
`;

// Read file
let content = fs.readFileSync(filePath, 'utf-8');

// Find module.exports
const exportsIndex = content.lastIndexOf('module.exports');
if (exportsIndex === -1) {
    console.error('module.exports not found');
    process.exit(1);
}

// Insert functions before module.exports
content = content.substring(0, exportsIndex) + assignFunctions + '\n' + content.substring(exportsIndex);

// Update module.exports to include new functions
content = content.replace(
    /module\.exports = \{([^}]+)\};/,
    (match, exports) => {
        return `module.exports = {${exports},\n    assignLead,\n    bulkAssignLeads\n};`;
    }
);

// Write back
fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ Lead assignment functions added successfully!');
