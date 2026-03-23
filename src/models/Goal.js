const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const goalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // tenant (manager)
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // target agent
    month: { type: String, required: true }, // e.g. "2026-03"
    targetLeads: { type: Number, default: 0 },
    targetWon: { type: Number, default: 0 },
    targetRevenue: { type: Number, default: 0 },
    targetTasks: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

goalSchema.index({ userId: 1, agentId: 1, month: 1 }, { unique: true });

goalSchema.plugin(saasPlugin);

module.exports = mongoose.model('Goal', goalSchema);
