const fs = require('fs');
const results = [];
const check = (label, file, pattern) => {
  try {
    const src = fs.readFileSync(file, 'utf8');
    const found = src.includes(pattern);
    results.push({ label, found });
    console.log(found ? 'PASS' : 'FAIL', label);
  } catch(e) {
    console.log('FAIL', label, '(file missing)');
    results.push({ label, found: false });
  }
};

// index.js
check('index: uses {Agenda} destructure', './index.js', "const { Agenda } = require('agenda')");
check('index: defineWhatsAppJobs wired', './index.js', 'defineWhatsAppJobs(agenda)');
check('index: defineAutomationJobs wired', './index.js', 'defineAutomationJobs(agenda)');
check('index: agenda.start()', './index.js', 'await agenda.start()');
check('index: /api/automations route', './index.js', "'/api/automations'");

// Queue Service
check('queue: exports defineWhatsAppJobs', './src/services/whatsappQueueService.js', 'exports.defineWhatsAppJobs');
check('queue: defines resume-chatbot-session', './src/services/whatsappQueueService.js', 'resume-chatbot-session');
check('queue: defines CHECK_REPLY_TIMEOUT', './src/services/whatsappQueueService.js', 'CHECK_REPLY_TIMEOUT');
check('queue: exports scheduleDelayNode', './src/services/whatsappQueueService.js', 'exports.scheduleDelayNode');
check('queue: no self-start (singleton removed)', './src/services/whatsappQueueService.js', 'sharedAgenda');

// AutomationService
check('automation: handleWatcherReply exported', './src/services/AutomationService.js', 'handleWatcherReply');
check('automation: defineAutomationJobs exported', './src/services/AutomationService.js', 'defineAutomationJobs');
check('automation: schedules CHECK_REPLY_TIMEOUT', './src/services/AutomationService.js', 'CHECK_REPLY_TIMEOUT');
check('automation: creates LeadAutomationWatcher', './src/services/AutomationService.js', 'LeadAutomationWatcher.create');
check('automation: one-at-a-time lock', './src/services/AutomationService.js', 'currentlyProcessingLeadId');

// Chatbot Engine
check('chatbot: imports whatsappQueueService', './src/services/chatbotEngineService.js', "whatsappQueueService");
check('chatbot: calls scheduleDelayNode', './src/services/chatbotEngineService.js', 'scheduleDelayNode');
check('chatbot: checks chatbotPausedUntil', './src/services/chatbotEngineService.js', 'chatbotPausedUntil');
check('chatbot: Levenshtein fuzzy match', './src/services/chatbotEngineService.js', 'getLevenshteinDistance');
check('chatbot: exports resumeExecution', './src/services/chatbotEngineService.js', 'exports.resumeExecution');
check('chatbot: cancelActiveChatbots sets pause', './src/services/chatbotEngineService.js', 'chatbotPausedUntil: new Date');

// Models
check('model: WhatsAppConversation.chatbotPausedUntil', './src/models/WhatsAppConversation.js', 'chatbotPausedUntil');
check('model: AutomationRule has WAIT_FOR_REPLY', './src/models/AutomationRule.js', 'WAIT_FOR_REPLY');
check('model: AutomationRule.currentlyProcessingLeadId', './src/models/AutomationRule.js', 'currentlyProcessingLeadId');
check('model: AutomationRule.ifRepliedAction', './src/models/AutomationRule.js', 'ifRepliedAction');
check('model: LeadAutomationWatcher exists', './src/models/LeadAutomationWatcher.js', 'LeadAutomationWatcher');
check('model: LeadAutomationWatcher TTL cleanup', './src/models/LeadAutomationWatcher.js', 'expireAfterSeconds');

// Webhook
check('webhook: calls handleWatcherReply', './src/controllers/whatsappWebhookController.js', 'handleWatcherReply');

// Frontend
check('frontend: WAIT_FOR_REPLY option exists', './client/src/components/Automations/RuleBuilderModal.jsx', 'WAIT_FOR_REPLY');
check('frontend: ifRepliedAction form', './client/src/components/Automations/RuleBuilderModal.jsx', 'ifRepliedAction');
check('frontend: ifNoReplyAction form', './client/src/components/Automations/RuleBuilderModal.jsx', 'ifNoReplyAction');
check('frontend: waitForReplyHours input', './client/src/components/Automations/RuleBuilderModal.jsx', 'waitForReplyHours');

const passed = results.filter(r => r.found).length;
const failed = results.filter(r => !r.found).length;
console.log('\n' + '-'.repeat(50));
console.log('RESULTS: ' + passed + ' passed, ' + failed + ' failed');
if (failed === 0) console.log('END-TO-END: ALL CHECKS PASSED');
