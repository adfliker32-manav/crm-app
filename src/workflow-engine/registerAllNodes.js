// ─────────────────────────────────────────────────────────────────────────────
// registerAllNodes.js
// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap file that registers all node implementations into the NodeRegistry.
// Called once on server startup BEFORE the WorkflowEngine or Queue are started.
//
// To add a new node type: create the node file, then require it here.
// ─────────────────────────────────────────────────────────────────────────────

// ── Communication ─────────────────────────────────────────────────────────────
require('./nodes/communication/SendWhatsAppNode');
require('./nodes/communication/SendEmailNode');
require('./nodes/communication/VoiceCallNode');
require('./nodes/communication/InternalNotificationNode');

// ── CRM ───────────────────────────────────────────────────────────────────────
require('./nodes/crm/UpdateStageNode');
require('./nodes/crm/AssignUserNode');
require('./nodes/crm/AddTagNode');
require('./nodes/crm/UpdateCustomFieldNode');

// ── Logic ─────────────────────────────────────────────────────────────────────
require('./nodes/logic/ConditionNode');
require('./nodes/logic/SwitchNode');
require('./nodes/logic/WaitNode');

// ── AI ────────────────────────────────────────────────────────────────────────
require('./nodes/ai/AiClassifierNode');

// ── External ──────────────────────────────────────────────────────────────────
require('./nodes/external/HttpRequestNode');

const NodeRegistry = require('./NodeRegistry');
console.log(`✅ Workflow Engine: ${NodeRegistry.getAllMeta().length} nodes registered`);
