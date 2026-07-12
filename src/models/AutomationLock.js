const mongoose = require('mongoose');

/**
 * AutomationLock
 * ──────────────
 * Per-(rule, lead) execution lock. Prevents the SAME lead from double-firing
 * the SAME rule concurrently (e.g. duplicate webhook deliveries), without
 * blocking OTHER leads from running that rule at the same time.
 *
 * Acquire: AutomationLock.create({ ruleId, leadId }) — the unique index below
 * makes this atomically fail (E11000) if a lock is already held.
 * Release: AutomationLock.deleteOne({ ruleId, leadId }).
 *
 * The TTL index auto-expires locks after 1 hour so a crashed/hung execution
 * can't block that (rule, lead) pair forever.
 */
const AutomationLockSchema = new mongoose.Schema({
    ruleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AutomationRule',
        required: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true
    },
    acquiredAt: {
        type: Date,
        default: Date.now
    }
});

AutomationLockSchema.index({ ruleId: 1, leadId: 1 }, { unique: true });
AutomationLockSchema.index({ acquiredAt: 1 }, { expireAfterSeconds: 60 * 60 });

module.exports = mongoose.model('AutomationLock', AutomationLockSchema);
