const Task = require('../models/Task');
const Lead = require('../models/Lead');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────────────────────
// Agent row-level security.
//
// Every query here was scoped to the TENANT only, so a restricted agent could
// read (and complete, and delete) follow-ups for leads they are not assigned to
// — and `getTasks` populates leadId with name/phone/email, so it handed them
// contact details for the whole workspace. Same defect class the Email module
// already fixed (see the S1/S3 note in emailConversationRoutes).
//
// `req.dataScope` cannot be spread into a Task query directly: for a restricted
// agent it carries `assignedTo`, which is a field on Lead, not on Task — that
// would match zero rows and silently empty the module. Ownership of a follow-up
// therefore derives from its parent lead, which is exactly the pattern
// leadDocumentController uses.
// ─────────────────────────────────────────────────────────────────────────────

/** True when this request is an agent limited to their own leads. */
const isLeadRestricted = (req) => !!req.dataScope?.assignedTo;

/**
 * Narrow a Task query to follow-ups whose lead the requester may see.
 *
 * Returns null when the caller sees everything (owner, manager, or an agent
 * with viewAllLeads), so the caller can skip the extra lookup entirely.
 */
async function visibleLeadFilter(req) {
    if (!isLeadRestricted(req)) return null;
    // Follow-ups are a small per-lead collection, so resolving the id set is
    // cheaper and far clearer than a $lookup here.
    const leads = await Lead.find({ userId: req.tenantId, assignedTo: req.dataScope.assignedTo })
        .select('_id')
        .lean();
    return { $in: leads.map(l => l._id) };
}

// ==========================================
// 1. GET ALL TASKS (For Logged in User)
// Supports ?status=Pending&date=today
// ==========================================
const getTasks = async (req, res) => {
    try {
        let ownerId = req.tenantId;

        const { status, dateFilter } = req.query;
        let query = { userId: ownerId };

        const leadFilter = await visibleLeadFilter(req);
        if (leadFilter) query.leadId = leadFilter;

        if (status) {
            query.status = status; // e.g., 'Pending'
        }

        if (dateFilter === 'today') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            query.dueDate = {
                $gte: today,
                $lt: tomorrow
            };
        } else if (dateFilter === 'overdue') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            query.dueDate = { $lt: today };
            query.status = 'Pending';
        } else if (dateFilter === 'upcoming') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            query.dueDate = { $gte: tomorrow };
            query.status = 'Pending';
        }

        const tasks = await Task.find(query)
            .populate('leadId', 'name phone email status')
            .sort({ dueDate: 1 })
            .lean();

        res.json(tasks);
    } catch (err) {
        console.error("Get Tasks Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 2. GET TASKS BY LEAD
// ==========================================
const getTasksByLead = async (req, res) => {
    try {
        let ownerId = req.tenantId;

        const { leadId } = req.params;

        // Resolve the parent lead through dataScope first — an agent must not be
        // able to read follow-ups for a lead they cannot see by guessing its id.
        const lead = await Lead.findOne({ _id: leadId, ...req.dataScope }).select('_id').lean();
        if (!lead) return res.status(404).json({ message: 'Lead not found' });

        const tasks = await Task.find({ userId: ownerId, leadId }).sort({ dueDate: 1 }).lean();
        res.json(tasks);
    } catch (err) {
        console.error("Get Lead Tasks Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 3. CREATE TASK
// ==========================================
const createTask = async (req, res) => {
    try {
        const { leadId, title, description, dueDate } = req.body;
        let ownerId = req.tenantId;

        if (!leadId || !title || !dueDate) {
            return res.status(400).json({ message: "Lead ID, Title, and Due Date are required" });
        }

        // Verify the lead belongs to the requester — dataScope, not just the
        // tenant, so an agent cannot attach a follow-up to someone else's lead.
        const lead = await Lead.findOne({ _id: leadId, ...req.dataScope });
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        const newTask = new Task({
            userId: ownerId,
            leadId,
            title,
            description,
            dueDate: new Date(dueDate),
            createdBy: req.user.userId || req.user.id
        });

        await newTask.save();

        // Also add a Note to the Lead history that a task was set
        await Lead.findByIdAndUpdate(leadId, {
            $push: {
                history: {
                    $each: [{
                        type: 'Task',
                        subType: 'Created',
                        content: `Task Created: ${title} (Due: ${new Date(dueDate).toLocaleDateString()})`,
                        date: new Date()
                    }],
                    $slice: -100
                }
            }
        });

        res.json(newTask);
    } catch (err) {
        console.error("Create Task Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 4. UPDATE TASK STATUS (Mark Complete)
// ==========================================
const updateTaskStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        let ownerId = req.tenantId;

        // findOneAndUpdate does NOT run schema validators unless asked, so any
        // string at all used to be written straight into `status`. A task set to
        // something outside the enum then matched neither the Pending filters nor
        // the Completed ones — it simply vanished from every view while still
        // existing. There is no Joi schema on this route to catch it either.
        const ALLOWED_STATUS = ['Pending', 'Completed'];
        if (!ALLOWED_STATUS.includes(status)) {
            return res.status(400).json({ message: `status must be one of: ${ALLOWED_STATUS.join(', ')}` });
        }

        // Scoped by lead visibility for the same reason as the read paths — an
        // agent must not be able to complete or reopen another agent's follow-up.
        const scope = { _id: id, userId: ownerId };
        const leadFilter = await visibleLeadFilter(req);
        if (leadFilter) scope.leadId = leadFilter;

        const task = await Task.findOneAndUpdate(
            scope,
            { status },
            { returnDocument: 'after', runValidators: true }
        ).populate('leadId', 'name');

        if (!task) return res.status(404).json({ message: "Task not found" });

        // Log to Lead History if completed and lead exists
        if (status === 'Completed' && task.leadId) {
            await Lead.findByIdAndUpdate(task.leadId._id || task.leadId, {
                $push: {
                    history: {
                        $each: [{
                            type: 'Task',
                            subType: 'Completed',
                            content: `Task Completed: ${task.title}`,
                            date: new Date()
                        }],
                        $slice: -100
                    }
                }
            });
        }

        res.json(task);
    } catch (err) {
        console.error("Update Task Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 5. DELETE TASK
// ==========================================
const deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        let ownerId = req.tenantId;

        const scope = { _id: id, userId: ownerId };
        const leadFilter = await visibleLeadFilter(req);
        if (leadFilter) scope.leadId = leadFilter;

        const task = await Task.findOneAndDelete(scope);
        if (!task) return res.status(404).json({ message: "Task not found" });

        res.json({ success: true, message: "Task deleted" });
    } catch (err) {
        console.error("Delete Task Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getTasks,
    getTasksByLead,
    createTask,
    updateTaskStatus,
    deleteTask
};
