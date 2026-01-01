const mongoose = require('mongoose');

const stageSchema = new mongoose.Schema({
    // 🔥 NEW: Ye stage kis user ka hai?
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: { 
        type: String, 
        required: true 
        // Note: Humne 'unique: true' hata diya hai.
        // Kyunki Rahul aur Amit dono ka "New" stage ho sakta hai.
    },
    order: { 
        type: Number, 
        default: 0 
    }
});

module.exports = mongoose.model('Stage', stageSchema);