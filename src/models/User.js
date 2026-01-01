const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true, // Ek email se ek hi account banega
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    // SaaS ke liye jaruri fields
    companyName: { type: String },
    role: { 
        type: String, 
        default: 'Admin' // Admin, Manager, Agent etc.
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', userSchema);