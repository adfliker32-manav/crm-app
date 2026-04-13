const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const taskSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The person who created the task
    date: { type: Date, default: Date.now },
});

// Compound indexes for common query patterns
taskSchema.index({ userId: 1, status: 1, dueDate: 1 }); // Dashboard: pending tasks today
taskSchema.index({ userId: 1, leadId: 1 }); // Task-by-lead lookups
taskSchema.index({ createdBy: 1, status: 1 }); // Analytics: agent task completion

taskSchema.plugin(saasPlugin);

module.exports = mongoose.model('Task', taskSchema);
