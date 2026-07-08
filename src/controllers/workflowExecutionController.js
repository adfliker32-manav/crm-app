const WorkflowExecution = require('../models/WorkflowExecution');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/:id/executions
// List executions for a specific workflow (paginated).
// ─────────────────────────────────────────────────────────────────────────────
exports.listExecutions = async (req, res) => {
    try {
        const tenantId   = req.tenantId;
        const workflowId = req.params.id;
        const { status, page = 1, limit = 25 } = req.query;

        const filter = { tenantId, workflowId };
        if (status) filter.status = status;

        const [executions, total] = await Promise.all([
            WorkflowExecution.find(filter)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                .select('-history') // Omit heavy history for list view
                .populate('contactId', 'name phone email status')
                .lean(),
            WorkflowExecution.countDocuments(filter)
        ]);

        res.json({ executions, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        console.error('[workflowExecutionController] listExecutions:', err);
        res.status(500).json({ message: 'Failed to load executions' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/executions/:execId
// Get a single execution with full node history (for the execution debugger).
// ─────────────────────────────────────────────────────────────────────────────
exports.getExecution = async (req, res) => {
    try {
        const tenantId  = req.tenantId;
        const { execId } = req.params;

        const execution = await WorkflowExecution.findOne({ _id: execId, tenantId })
            .populate('contactId', 'name phone email status')
            .lean();

        if (!execution) return res.status(404).json({ message: 'Execution not found' });

        res.json({ execution });
    } catch (err) {
        console.error('[workflowExecutionController] getExecution:', err);
        res.status(500).json({ message: 'Failed to load execution' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/workflows/executions/:execId
// Cancel a running or waiting execution.
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelExecution = async (req, res) => {
    try {
        const tenantId  = req.tenantId;
        const { execId } = req.params;

        const execution = await WorkflowExecution.findOne({ _id: execId, tenantId });
        if (!execution) return res.status(404).json({ message: 'Execution not found' });

        if (!['running', 'waiting'].includes(execution.status)) {
            return res.status(400).json({ message: `Cannot cancel an execution with status: ${execution.status}` });
        }

        execution.status      = 'cancelled';
        execution.completedAt = new Date();
        await execution.save();

        res.json({ message: 'Execution cancelled' });
    } catch (err) {
        console.error('[workflowExecutionController] cancelExecution:', err);
        res.status(500).json({ message: 'Failed to cancel execution' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/executions
// List ALL recent executions across all workflows for this tenant.
// Used by the global execution monitor.
// ─────────────────────────────────────────────────────────────────────────────
exports.listAllExecutions = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { status, page = 1, limit = 25 } = req.query;

        const filter = { tenantId };
        if (status) filter.status = status;

        const [executions, total] = await Promise.all([
            WorkflowExecution.find(filter)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                .select('-history')
                .populate('contactId',  'name phone email')
                .populate('workflowId', 'name trigger')
                .lean(),
            WorkflowExecution.countDocuments(filter)
        ]);

        res.json({ executions, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        console.error('[workflowExecutionController] listAllExecutions:', err);
        res.status(500).json({ message: 'Failed to load executions' });
    }
};
