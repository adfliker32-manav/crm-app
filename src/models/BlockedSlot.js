const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const blockedSlotSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date:   { type: String, required: true },      // "YYYY-MM-DD"
    time:   { type: String, default: null },        // null = entire day blocked; "10:00 AM" = specific slot
    reason: { type: String, default: '' }
}, { timestamps: true });

blockedSlotSchema.index({ userId: 1, date: 1 });
blockedSlotSchema.plugin(saasPlugin);

module.exports = mongoose.model('BlockedSlot', blockedSlotSchema);
