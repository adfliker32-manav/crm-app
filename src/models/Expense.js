const mongoose = require('mongoose');

// Manually-entered operational expenses. Subtracted from total revenue to compute Net Profit.
// SuperAdmin-global ledger — does NOT use saasPlugin.
const expenseSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: ['infrastructure', 'salary', 'marketing', 'tools', 'legal', 'taxes', 'office', 'other'],
        default: 'other',
        index: true
    },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    vendor: { type: String, default: '' },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    date: { type: Date, default: Date.now, index: true },

    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'cash', 'upi', 'card', 'cheque', 'other'],
        default: 'bank_transfer'
    },
    reference: { type: String, default: '' },
    notes: { type: String, default: '' },

    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('Expense', expenseSchema);
