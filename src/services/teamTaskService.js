// ============================================================
// TEAM TASK SERVICE
// ============================================================
// Business logic behind the Tasks module (admin/agent to-dos, assignable to
// an agent). The controller only orchestrates request/response around this.
//
// SCOPING
//   Does NOT reuse the global req.dataScope — that object is hardcoded to
//   Leads' viewAllLeads/assignedTo semantics (see authMiddleware.js). Tasks
//   has its own permission key (viewAllTasks) and its own "own task" rule
//   (assignedTo OR assignedBy === self), so it builds a local scope filter
//   via taskScope(). Every single-document mutation resolves the row through
//   that scope BEFORE touching it, so an out-of-scope id 404s rather than
//   leaking a 403 (same convention as leadDocumentService).
// ============================================================

const TeamTask = require('../models/TeamTask');
const User = require('../models/User');
const { logActivity } = require('./auditService');
const { getRequestUserId, escapeRegex } = require('../utils/controllerHelpers');

class TeamTaskError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const isPrivileged = (user) => ['manager', 'superadmin'].includes(user.role);

/** Rows this requester may see: their tenant, narrowed to "own" unless they can view all. */
function taskScope(req) {
    const scope = { userId: req.tenantId };
    const canViewAll = isPrivileged(req.user) || req.user.permissions?.viewAllTasks;
    if (!canViewAll) {
        const selfId = getRequestUserId(req.user);
        scope.$or = [{ assignedTo: selfId }, { assignedBy: selfId }];
    }
    return scope;
}

const toDto = (t) => {
    const person = (p) => (p && p._id ? { id: p._id, name: p.name, email: p.email } : (p || null));
    return {
        id: t._id,
        title: t.title,
        description: t.description || null,
        assignedTo: person(t.assignedTo),
        assignedBy: person(t.assignedBy),
        relatedLead: (t.relatedLead && t.relatedLead._id)
            ? { id: t.relatedLead._id, name: t.relatedLead.name, phone: t.relatedLead.phone }
            : (t.relatedLead || null),
        dueDate: t.dueDate || null,
        priority: t.priority,
        status: t.status,
        completedAt: t.completedAt || null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
    };
};

const populateTask = (query) => query
    .populate('assignedTo', 'name email')
    .populate('assignedBy', 'name email')
    .populate('relatedLead', 'name phone');

function applyStatus(task, status) {
    task.status = status;
    if (status === 'completed') {
        task.completedAt = new Date();
    } else if (task.completedAt) {
        task.completedAt = null;
    }
}

/**
 * Resolve + authorize an assignee id.
 * Self-assignment is always allowed. Assigning to someone else requires the
 * 'assignTasks' permission (managers/superadmin bypass) and the target must
 * be a member of this tenant (the manager themselves, or one of their agents).
 */
async function resolveAssignee(req, assignedToId) {
    const requesterId = getRequestUserId(req.user);
    if (String(assignedToId) === String(requesterId)) return requesterId;

    if (!isPrivileged(req.user) && !req.user.permissions?.assignTasks) {
        throw new TeamTaskError(403, "Permission denied: You do not have 'assignTasks' permission");
    }

    // Exactly the set the assignee dropdown offers (authController.getMyTeam
    // with includeManager=true): the workspace owner, or an agent under them.
    // Kept in lockstep with that endpoint — anything it lists must be assignable,
    // and nothing else may be, whatever id the client posts.
    const tenantId = req.tenantId;
    const assignee = await User.findOne({
        _id: assignedToId,
        $or: [{ _id: tenantId }, { parentId: tenantId, role: 'agent' }]
    }).select('_id name email').lean();

    if (!assignee) {
        throw new TeamTaskError(400, 'Invalid assignee: must be a member of your team');
    }
    return assignee._id;
}

async function assertLeadInScope(req, leadId) {
    if (!leadId) return;
    const Lead = require('../models/Lead');
    const lead = await Lead.findOne({ _id: leadId, ...req.dataScope }).select('_id').lean();
    if (!lead) throw new TeamTaskError(400, 'Invalid related lead');
}

/** Real-time toast + email to the newly-assigned agent. Never throws. */
async function notifyAssignee(task, assignerName) {
    try {
        const assignee = await User.findById(task.assignedTo).select('name email').lean();
        if (!assignee) return;

        const { emitToUser } = require('./socketService');
        emitToUser(String(task.assignedTo), 'notification:agent', {
            type: 'task_assigned',
            taskId: String(task._id),
            title: task.title,
            message: `${assignerName || 'Someone'} assigned you a task: ${task.title}`,
            timestamp: new Date()
        });

        await sendTaskAssignedEmail(assignee, task, assignerName);
    } catch (err) {
        console.error('[TeamTasks] notifyAssignee failed:', err.message);
    }
}

/** Mirrors authController.sendWelcomeEmail's pattern for a platform → team-member email. */
async function sendTaskAssignedEmail(assignee, task, assignerName) {
    if (!assignee.email) return;
    try {
        const { sendEmail } = require('./emailService');
        const IntegrationConfig = require('../models/IntegrationConfig');

        const superAdmins = await User.find({ role: 'superadmin' }).select('_id').lean();
        const superAdminIds = superAdmins.map(sa => sa._id);
        const configuredSaConfig = await IntegrationConfig.findOne({
            userId: { $in: superAdminIds },
            'email.emailUser': { $ne: null, $exists: true }
        }).select('userId').lean();
        const superAdminId = configuredSaConfig ? configuredSaConfig.userId.toString() : superAdminIds[0]?.toString();

        const appName = process.env.APP_NAME || 'Adfliker';
        const rawFrontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173';
        const frontendUrl = rawFrontendUrl.replace(/\/+$/, '');
        const dueText = task.dueDate
            ? new Date(task.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'No due date';

        const htmlBody = `
            <div style="background-color:#f9fafb;padding:40px 20px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
                    <div style="background-color:#0f172a;padding:30px;text-align:center;border-bottom:4px solid #3b82f6;">
                        <h1 style="color:white;margin:0;font-size:24px;font-weight:bold;">📋 New Task Assigned</h1>
                    </div>
                    <div style="padding:32px;">
                        <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;">Hi ${assignee.name || 'there'},</h2>
                        <p style="color:#4b5563;margin:0 0 20px;font-size:15px;line-height:1.6;">
                            <strong>${assignerName || 'A teammate'}</strong> assigned you a new task in ${appName}.
                        </p>
                        <div style="background-color:#f0f7ff;border-left:4px solid #3b82f6;padding:16px;margin-bottom:24px;border-radius:0 8px 8px 0;">
                            <p style="margin:0 0 6px;color:#111827;font-size:16px;font-weight:600;">${task.title}</p>
                            ${task.description ? `<p style="margin:0 0 6px;color:#4b5563;font-size:14px;">${task.description}</p>` : ''}
                            <p style="margin:0;color:#6b7280;font-size:13px;">Due: ${dueText} &middot; Priority: ${task.priority}</p>
                        </div>
                        <a href="${frontendUrl}/tasks" style="display:block;width:100%;text-align:center;padding:14px 0;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">View Task</a>
                    </div>
                </div>
            </div>
        `;

        await sendEmail({
            to: assignee.email,
            subject: `New task assigned: ${task.title}`,
            html: htmlBody,
            text: `${assignerName || 'A teammate'} assigned you a new task: ${task.title}\nDue: ${dueText}\nPriority: ${task.priority}\n\nView it: ${frontendUrl}/tasks`,
            userId: superAdminId || null,
            transactional: true
        });
    } catch (err) {
        console.error('[TeamTasks] Failed to send assignment email:', err.message);
    }
}

/** Tasks visible to this requester, newest-due first. */
async function listTasks(req, filters = {}) {
    const query = { ...taskScope(req) };
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.assignedTo) query.assignedTo = filters.assignedTo;
    if (filters.dueBefore || filters.dueAfter) {
        query.dueDate = {};
        if (filters.dueAfter) query.dueDate.$gte = new Date(filters.dueAfter);
        if (filters.dueBefore) query.dueDate.$lte = new Date(filters.dueBefore);
    }
    if (filters.q) {
        query.title = { $regex: escapeRegex(String(filters.q)), $options: 'i' };
    }

    const tasks = await populateTask(
        TeamTask.find(query).sort({ dueDate: 1, createdAt: -1 })
    ).lean();
    return tasks.map(toDto);
}

async function getTask(req, id) {
    const task = await populateTask(TeamTask.findOne({ _id: id, ...taskScope(req) })).lean();
    return task ? toDto(task) : null;
}

async function createTask(req, data) {
    const tenantId = req.tenantId;
    const requesterId = getRequestUserId(req.user);

    if (!data.title || !String(data.title).trim()) {
        throw new TeamTaskError(400, 'Title is required');
    }

    const assignedTo = await resolveAssignee(req, data.assignedTo || requesterId);
    await assertLeadInScope(req, data.relatedLead);

    const task = await TeamTask.create({
        userId: tenantId,
        title: String(data.title).trim().slice(0, 200),
        description: data.description ? String(data.description).trim().slice(0, 2000) : null,
        assignedTo,
        assignedBy: requesterId,
        relatedLead: data.relatedLead || null,
        dueDate: data.dueDate || null,
        priority: data.priority || 'medium'
    });

    logActivity({
        userId: requesterId,
        userName: req.user.name || 'Unknown',
        actionType: 'TASK_CREATED',
        entityType: 'Task',
        entityId: task._id,
        entityName: task.title,
        metadata: { assignedTo: String(assignedTo) },
        companyId: tenantId
    }).catch(err => console.error('Audit log error:', err));

    const selfAssigned = String(assignedTo) === String(requesterId);
    if (!selfAssigned) {
        logActivity({
            userId: requesterId,
            userName: req.user.name || 'Unknown',
            actionType: 'TASK_ASSIGNED',
            entityType: 'Task',
            entityId: task._id,
            entityName: task.title,
            metadata: { assignedTo: String(assignedTo) },
            companyId: tenantId
        }).catch(err => console.error('Audit log error:', err));

        notifyAssignee(task, req.user.name).catch(err => console.error('[TeamTasks] notify error:', err.message));
    }

    const populated = await populateTask(TeamTask.findById(task._id));
    return toDto(populated);
}

async function updateTask(req, id, data) {
    const requesterId = getRequestUserId(req.user);
    const task = await TeamTask.findOne({ _id: id, ...taskScope(req) });
    if (!task) throw new TeamTaskError(404, 'Task not found or access denied');

    let reassignedTo = null;
    if (data.assignedTo && String(data.assignedTo) !== String(task.assignedTo)) {
        reassignedTo = await resolveAssignee(req, data.assignedTo);
        task.assignedTo = reassignedTo;
    }
    if (data.title !== undefined) task.title = String(data.title).trim().slice(0, 200);
    if (data.description !== undefined) task.description = data.description ? String(data.description).trim().slice(0, 2000) : null;
    if (data.relatedLead !== undefined) {
        await assertLeadInScope(req, data.relatedLead);
        task.relatedLead = data.relatedLead || null;
    }
    if (data.dueDate !== undefined) task.dueDate = data.dueDate || null;
    if (data.priority !== undefined) task.priority = data.priority;
    if (data.status !== undefined) applyStatus(task, data.status);

    await task.save();

    logActivity({
        userId: requesterId,
        userName: req.user.name || 'Unknown',
        actionType: 'TASK_EDITED',
        entityType: 'Task',
        entityId: task._id,
        entityName: task.title,
        companyId: req.tenantId
    }).catch(err => console.error('Audit log error:', err));

    if (reassignedTo && String(reassignedTo) !== String(requesterId)) {
        logActivity({
            userId: requesterId,
            userName: req.user.name || 'Unknown',
            actionType: 'TASK_ASSIGNED',
            entityType: 'Task',
            entityId: task._id,
            entityName: task.title,
            metadata: { assignedTo: String(reassignedTo) },
            companyId: req.tenantId
        }).catch(err => console.error('Audit log error:', err));

        notifyAssignee(task, req.user.name).catch(err => console.error('[TeamTasks] notify error:', err.message));
    }

    const populated = await populateTask(TeamTask.findById(task._id));
    return toDto(populated);
}

/** Status-only change. No extra permission beyond being in scope (own task, or full visibility). */
async function updateTaskStatus(req, id, status) {
    const requesterId = getRequestUserId(req.user);
    const task = await TeamTask.findOne({ _id: id, ...taskScope(req) });
    if (!task) throw new TeamTaskError(404, 'Task not found or access denied');

    applyStatus(task, status);
    await task.save();

    logActivity({
        userId: requesterId,
        userName: req.user.name || 'Unknown',
        actionType: status === 'completed' ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
        entityType: 'Task',
        entityId: task._id,
        entityName: task.title,
        metadata: { status },
        companyId: req.tenantId
    }).catch(err => console.error('Audit log error:', err));

    const populated = await populateTask(TeamTask.findById(task._id));
    return toDto(populated);
}

async function deleteTask(req, id) {
    const requesterId = getRequestUserId(req.user);
    const task = await TeamTask.findOne({ _id: id, ...taskScope(req) });
    if (!task) throw new TeamTaskError(404, 'Task not found or access denied');

    await TeamTask.deleteOne({ _id: task._id });

    logActivity({
        userId: requesterId,
        userName: req.user.name || 'Unknown',
        actionType: 'TASK_DELETED',
        entityType: 'Task',
        entityId: task._id,
        entityName: task.title,
        companyId: req.tenantId
    }).catch(err => console.error('Audit log error:', err));

    return true;
}

module.exports = {
    TeamTaskError,
    // pure helpers (unit-tested)
    toDto,
    applyStatus,
    // data access
    listTasks,
    getTask,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask
};
