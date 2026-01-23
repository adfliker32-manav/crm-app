const ChatbotFlow = require('../models/ChatbotFlow');
const mongoose = require('mongoose');

// Get all flows for user
exports.getFlows = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;

        const flows = await ChatbotFlow.find({ userId: userId })
            .sort({ updatedAt: -1 })
            .lean();

        res.json({ success: true, flows });
    } catch (error) {
        console.error('Error fetching flows:', error);
        res.status(500).json({ message: 'Error fetching flows', error: error.message });
    }
};

// Get single flow
exports.getFlow = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const flow = await ChatbotFlow.findOne({ _id: id, userId: userId }).lean();

        if (!flow) {
            return res.status(404).json({ message: 'Flow not found' });
        }

        res.json({ success: true, flow });
    } catch (error) {
        console.error('Error fetching flow:', error);
        res.status(500).json({ message: 'Error fetching flow', error: error.message });
    }
};

// Create new flow
exports.createFlow = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { name, description, triggerType, triggerKeywords, nodes, edges } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Flow name is required' });
        }

        // Create default start node if no nodes provided
        const defaultNodes = nodes && nodes.length > 0 ? nodes : [
            {
                id: 'start-1',
                type: 'start',
                position: { x: 250, y: 50 },
                data: { text: 'Flow Start', nextNodeId: null }
            }
        ];

        const flow = new ChatbotFlow({
            userId: userId,
            name: name.trim(),
            description: description || '',
            triggerType: triggerType || 'keyword',
            triggerKeywords: triggerKeywords || [],
            nodes: defaultNodes,
            edges: edges || [],
            startNodeId: defaultNodes[0].id
        });

        await flow.save();

        res.json({ success: true, flow: flow.toObject() });
    } catch (error) {
        console.error('Error creating flow:', error);
        res.status(500).json({ message: 'Error creating flow', error: error.message });
    }
};

// Update flow
exports.updateFlow = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { name, description, isActive, triggerType, triggerKeywords, triggerStage, nodes, edges, startNodeId } = req.body;

        const flow = await ChatbotFlow.findOne({ _id: id, userId: userId });

        if (!flow) {
            return res.status(404).json({ message: 'Flow not found' });
        }

        // Update fields
        if (name !== undefined) flow.name = name.trim();
        if (description !== undefined) flow.description = description;
        if (isActive !== undefined) flow.isActive = isActive;
        if (triggerType !== undefined) flow.triggerType = triggerType;
        if (triggerKeywords !== undefined) flow.triggerKeywords = triggerKeywords;
        if (triggerStage !== undefined) flow.triggerStage = triggerStage;
        if (nodes !== undefined) flow.nodes = nodes;
        if (edges !== undefined) flow.edges = edges;
        if (startNodeId !== undefined) flow.startNodeId = startNodeId;

        await flow.save();

        res.json({ success: true, flow: flow.toObject() });
    } catch (error) {
        console.error('Error updating flow:', error);
        res.status(500).json({ message: 'Error updating flow', error: error.message });
    }
};

// Delete flow
exports.deleteFlow = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const flow = await ChatbotFlow.findOneAndDelete({ _id: id, userId: userId });

        if (!flow) {
            return res.status(404).json({ message: 'Flow not found' });
        }

        res.json({ success: true, message: 'Flow deleted successfully' });
    } catch (error) {
        console.error('Error deleting flow:', error);
        res.status(500).json({ message: 'Error deleting flow', error: error.message });
    }
};

// Toggle flow active status
exports.toggleFlow = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const flow = await ChatbotFlow.findOne({ _id: id, userId: userId });

        if (!flow) {
            return res.status(404).json({ message: 'Flow not found' });
        }

        flow.isActive = !flow.isActive;
        await flow.save();

        res.json({ success: true, flow: flow.toObject() });
    } catch (error) {
        console.error('Error toggling flow:', error);
        res.status(500).json({ message: 'Error toggling flow', error: error.message });
    }
};

// Duplicate flow
exports.duplicateFlow = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const originalFlow = await ChatbotFlow.findOne({ _id: id, userId: userId }).lean();

        if (!originalFlow) {
            return res.status(404).json({ message: 'Flow not found' });
        }

        // Create duplicate
        const duplicate = new ChatbotFlow({
            ...originalFlow,
            _id: new mongoose.Types.ObjectId(),
            name: `${originalFlow.name} (Copy)`,
            isActive: false,
            analytics: {
                triggered: 0,
                completed: 0,
                abandoned: 0,
                avgCompletionTime: 0,
                dropoffs: {}
            }
        });

        await duplicate.save();

        res.json({ success: true, flow: duplicate.toObject() });
    } catch (error) {
        console.error('Error duplicating flow:', error);
        res.status(500).json({ message: 'Error duplicating flow', error: error.message });
    }
};

// Get flow analytics
exports.getFlowAnalytics = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const flow = await ChatbotFlow.findOne({ _id: id, userId: userId }).lean();

        if (!flow) {
            return res.status(404).json({ message: 'Flow not found' });
        }

        const analytics = {
            ...flow.analytics,
            completionRate: flow.analytics.triggered > 0
                ? ((flow.analytics.completed / flow.analytics.triggered) * 100).toFixed(1)
                : 0,
            abandonmentRate: flow.analytics.triggered > 0
                ? ((flow.analytics.abandoned / flow.analytics.triggered) * 100).toFixed(1)
                : 0
        };

        res.json({ success: true, analytics });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Error fetching analytics', error: error.message });
    }
};
