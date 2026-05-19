const Lead = require('../models/Lead');

const SCORE_EVENTS = {
    WHATSAPP_REPLIED: 20,
    WHATSAPP_SENT: 5,
    EMAIL_SENT: 5,
    STAGE_FORWARD: 15,
    STAGE_LOST: -50,
    APPOINTMENT_BOOKED: 25,
    APPOINTMENT_COMPLETED: 30,
    INACTIVITY: -5
};

const updateLeadScore = async (leadId, event) => {
    const delta = SCORE_EVENTS[event];
    if (delta === undefined) return;
    try {
        await Lead.findByIdAndUpdate(leadId, { $inc: { score: delta } });
        // Clamp to 0 — scores never go negative
        await Lead.updateOne({ _id: leadId, score: { $lt: 0 } }, { $set: { score: 0 } });
    } catch (err) {
        // Non-critical — never block the caller
    }
};

module.exports = { updateLeadScore, SCORE_EVENTS };
