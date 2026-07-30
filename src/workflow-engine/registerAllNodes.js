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
// Row 26: lets a SCHEDULED_TRIGGER select leads and run a workflow per lead.
require('./nodes/crm/FindLeadsNode');

// ── Logic ─────────────────────────────────────────────────────────────────────
require('./nodes/logic/ConditionNode');
require('./nodes/logic/SwitchNode');
require('./nodes/logic/WaitNode');
// Row 27: iteration + join. ForEach fans out one token per item into its own
// iteration namespace; Merge waits for every branch (or iteration) to arrive.
require('./nodes/logic/ForEachNode');
require('./nodes/logic/MergeNode');

// ── AI ────────────────────────────────────────────────────────────────────────
require('./nodes/ai/AiClassifierNode');

// ── External ──────────────────────────────────────────────────────────────────
require('./nodes/external/HttpRequestNode');

const NodeRegistry = require('./NodeRegistry');
console.log(`✅ Workflow Engine: ${NodeRegistry.getAllMeta().length} nodes registered`);
