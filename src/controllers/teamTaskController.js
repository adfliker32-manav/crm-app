// ============================================================
// TEAM TASK CONTROLLER
// ============================================================
// HTTP layer only — every handler delegates to teamTaskService, which owns
// scoping, authorization-by-ownership, audit logging and notifications.
// ============================================================

const teamTasks = require('../services/teamTaskService');
const { TeamTaskError } = teamTasks;

const handleError = (res, err, fallback) => {
    if (err instanceof TeamTaskError) {
        return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error('[TeamTasks]', fallback, err);
    res.status(500).json({ success: false, message: fallback });
};

// ── GET /api/team-tasks ──────────────────────────────────────────────────────
exports.listTasks = async (req, res) => {
    try {
        const { status, priority, assignedTo, dueBefore, dueAfter, q } = req.query;
        const tasks = await teamTasks.listTasks(req, { status, priority, assignedTo, dueBefore, dueAfter, q });
        res.json({ success: true, tasks });
    } catch (err) {
        handleError(res, err, 'Failed to load tasks');
    }
};

// ── GET /api/team-tasks/:id ───────────────────────────────────────────────────
exports.getTask = async (req, res) => {
    try {
        const task = await teamTasks.getTask(req, req.params.id);
        if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
        res.json({ success: true, task });
    } catch (err) {
        handleError(res, err, 'Failed to load task');
    }
};

// ── POST /api/team-tasks ──────────────────────────────────────────────────────
exports.createTask = async (req, res) => {
    try {
        const task = await teamTasks.createTask(req, req.body);
        res.status(201).json({ success: true, task });
    } catch (err) {
        handleError(res, err, 'Failed to create task');
    }
};

// ── PUT /api/team-tasks/:id ───────────────────────────────────────────────────
exports.updateTask = async (req, res) => {
    try {
        const task = await teamTasks.updateTask(req, req.params.id, req.body);
        res.json({ success: true, task });
    } catch (err) {
        handleError(res, err, 'Failed to update task');
    }
};

// ── PATCH /api/team-tasks/:id/status ──────────────────────────────────────────
exports.updateTaskStatus = async (req, res) => {
    try {
        const task = await teamTasks.updateTaskStatus(req, req.params.id, req.body.status);
        res.json({ success: true, task });
    } catch (err) {
        handleError(res, err, 'Failed to update task status');
    }
};

// ── DELETE /api/team-tasks/:id ────────────────────────────────────────────────
exports.deleteTask = async (req, res) => {
    try {
        await teamTasks.deleteTask(req, req.params.id);
        res.json({ success: true, message: 'Task deleted' });
    } catch (err) {
        handleError(res, err, 'Failed to delete task');
    }
};
