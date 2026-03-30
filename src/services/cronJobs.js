// ============================================================
// CRON JOBS — DISABLED
// The trial expiry and subscription renewal jobs have been
// permanently removed as the platform now uses an
// approval-based access control system.
//
// Super Admin manually approves/rejects accounts.
// No automated billing or expiry logic exists.
// ============================================================

const startCronJobs = () => {
    console.log('[CronJobs] Billing/trial cron jobs are disabled. System uses approval-based control.');
};

module.exports = { startCronJobs };
