const Task = require('../models/Task');
const Lead = require('../models/Lead');
const User = require('../models/User');

// ==========================================
// 1. GET ALL TASKS (For Logged in User)
// Supports ?status=Pending&date=today
// ==========================================
const getTasks = async (req, res) => {
    try {
        let ownerId = req.tenantId;

        const { status, dateFilter } = req.query;
        let query = { userId: ownerId };

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

        // Verify Lead belongs to user
        const lead = await Lead.findOne({ _id: leadId, userId: ownerId });
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

        const task = await Task.findOneAndUpdate(
            { _id: id, userId: ownerId },
            { status },
            { new: true }
        ).populate('leadId', 'name');

        if (!task) return res.status(404).json({ message: "Task not found" });

        // Log to Lead History if completed
        if (status === 'Completed') {
            await Lead.findByIdAndUpdate(task.leadId._id, {
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

        const task = await Task.findOneAndDelete({ _id: id, userId: ownerId });
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
