const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
    // 1. User Link
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // 2. Lead Details
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, required: true },

    // 3. Status
    status: { type: String, default: 'New' },
    
    // 4. Tracking
    source: { type: String, default: 'Manual' },
    
    // 🔥 5. IMPORTANT: 'date' field wapas lagaya hai (Sorting ke liye jaruri)
    date: { type: Date, default: Date.now },

    // 🔥 6. NOTES SECTION (History) 📝
    notes: [{
        text: String,
        date: { type: Date, default: Date.now }
    }]

}, { timestamps: true }); 

module.exports = mongoose.model('Lead', leadSchema);