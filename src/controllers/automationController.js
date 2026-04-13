const AutomationRule = require('../models/AutomationRule');

// Get all rules for the tenant
const getRules = async (req, res) => {
    try {
        const rules = await AutomationRule.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).lean();
        res.json(rules);
    } catch (err) {
        console.error('Error fetching automations:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Create a new rule
const createRule = async (req, res) => {
    try {
        const { name, trigger, delayMinutes, conditions, actions, isActive } = req.body;

        if (!name || !trigger || !actions || actions.length === 0) {
            return res.status(400).json({ message: 'Name, trigger, and at least one action are required' });
        }

        const newRule = await AutomationRule.create({
            tenantId: req.tenantId,
            name,
            trigger,
            delayMinutes: delayMinutes || 0,
            conditions: conditions || [],
            actions: actions,
            isActive: isActive !== undefined ? isActive : true,
            createdBy: req.user.userId || req.user.id
        });

        res.status(201).json(newRule);
    } catch (err) {
        console.error('Error creating automation:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update an existing rule
const updateRule = async (req, res) => {
    try {
        const { id } = req.params;
        // ⚠️ SECURITY: Whitelist allowed fields to prevent mass assignment.
        // Previously req.body was passed directly to $set, allowing users to
        // overwrite tenantId, executionCount, currentlyProcessingLeadId, etc.
        const { name, trigger, delayMinutes, conditions, actions, isActive } = req.body;
        const safeUpdates = {};
        if (name !== undefined) safeUpdates.name = name;
        if (trigger !== undefined) safeUpdates.trigger = trigger;
        if (delayMinutes !== undefined) safeUpdates.delayMinutes = delayMinutes;
        if (conditions !== undefined) safeUpdates.conditions = conditions;
        if (actions !== undefined) safeUpdates.actions = actions;
        if (isActive !== undefined) safeUpdates.isActive = isActive;

        const rule = await AutomationRule.findOneAndUpdate(
            { _id: id, tenantId: req.tenantId },
            { $set: safeUpdates },
            { new: true }
        );

        if (!rule) return res.status(404).json({ message: 'Automation rule not found' });

        res.json(rule);
    } catch (err) {
        console.error('Error updating automation:', err);
        res.status(500).json({ message: 'Failed to update automation' });
    }
};

// Delete a rule
const deleteRule = async (req, res) => {
    try {
        const { id } = req.params;
        const rule = await AutomationRule.findOneAndDelete({ _id: id, tenantId: req.tenantId });

        if (!rule) return res.status(404).json({ message: 'Automation rule not found' });

        res.json({ success: true, message: 'Automation rule deleted' });
    } catch (err) {
        console.error('Error deleting automation:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Toggle a rule's active state
const toggleRule = async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        const rule = await AutomationRule.findOneAndUpdate(
            { _id: id, tenantId: req.tenantId },
            { $set: { isActive } },
            { new: true }
        );

        if (!rule) return res.status(404).json({ message: 'Automation rule not found' });

        res.json(rule);
    } catch (err) {
        console.error('Error toggling automation:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getRules,
    createRule,
    updateRule,
    deleteRule,
    toggleRule
};
