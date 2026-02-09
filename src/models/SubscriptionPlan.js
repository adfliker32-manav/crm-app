const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    price: {
        type: Number,
        required: true,
        default: 0
    },
    duration: {
        type: String, // 'Monthly', 'Yearly'
        default: 'Monthly'
    },
    features: [{
        type: String
    }],
    limits: {
        agents: {
            type: Number,
            default: 5
        },
        leads: {
            type: Number,
            default: 1000 // Monthly lead limit maybe?
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
