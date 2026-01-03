const mongoose = require('mongoose');

// 👇 Chota Schema sirf Messages ke liye
const messageSchema = new mongoose.Schema({
    text: { type: String, required: true },
    from: { 
        type: String, 
        enum: ['lead', 'admin'], // 'lead' matlab customer, 'admin' matlab aap
        required: true 
    },
    timestamp: { type: Date, default: Date.now }
});

const LeadSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    email: {
        type: String
    },
    status: {
        type: String,
        default: 'New'
    },
    source: {
        type: String,
        default: 'Web'
    },
    notes: [{
        text: String,
        date: { type: Date, default: Date.now }
    }],
    
    // 👇 NEW: Yahan saari chatting save hogi
    messages: [messageSchema] 

}, { timestamps: true });

module.exports = mongoose.model('Lead', LeadSchema);