const fs = require('fs');
let c = fs.readFileSync('src/controllers/leadController.js', 'utf8');
const target = "    runInBackground('Auto Error (TIME_IN_STAGE):', () => evaluateLead(lead, 'TIME_IN_STAGE'));";
const replacement = '    // NOTE: TIME_IN_STAGE removed - it is time-based, not event-based. Needs a cron/Agenda job.';
if (c.includes(target)) {
    c = c.replace(target, replacement);
    fs.writeFileSync('src/controllers/leadController.js', c);
    console.log('DONE: TIME_IN_STAGE line replaced');
} else {
    console.log('ERROR: Target line not found');
}
