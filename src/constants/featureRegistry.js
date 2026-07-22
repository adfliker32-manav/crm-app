// ─────────────────────────────────────────────────────────────────────────────
// FEATURE REGISTRY — canonical entitlements tree
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the SuperAdmin per-client Permission Manager.
// The SuperAdmin UI renders this tree (fetched from the API) and the server
// resolves/saves a client's on-off state against it. This is intentionally the
// ONLY place the module/feature hierarchy is declared.
//
// Each node:
//   key       unique dot-path id (stable — do NOT rename once shipped)
//   label     human label shown in the UI
//   icon      FontAwesome class (optional)
//   storage   how this node's on/off maps onto WorkspaceSettings (optional —
//             a node with children but no storage is a pure grouping container
//             whose state is derived from its children):
//               { type: 'module',  id }  → membership in activeModules[]
//               { type: 'feature', key } → planFeatures[key] boolean
//               { type: 'flag',    key } → featureFlags[key] boolean  (granular)
//   enforced  true  = a plan-gate already enforces this today (module/feature)
//             false = stored by the manager but runtime enforcement is pending
//   children  nested nodes
//
// Mapping rationale: `module` and `feature` nodes reuse the EXISTING plan-gate
// storage (activeModules / planFeatures), so toggling them takes effect
// immediately through the current middleware + planFeature checks. `flag` nodes
// capture finer granularity the app doesn't gate yet — they persist now so the
// control plane is complete, and enforcement can be wired incrementally.

const FEATURE_REGISTRY = [
    {
        key: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line',
        storage: { type: 'flag', key: 'dashboard' }, enforced: false,
    },
    {
        key: 'leads', label: 'Leads', icon: 'fa-users',
        storage: { type: 'module', id: 'leads' }, enforced: true,
        children: [
            { key: 'leads.metaSync', label: 'Meta Lead Sync', icon: 'fa-brands fa-facebook',
              storage: { type: 'feature', key: 'metaSync' }, enforced: true },
        ],
    },
    {
        key: 'whatsapp', label: 'WhatsApp', icon: 'fa-brands fa-whatsapp',
        storage: { type: 'module', id: 'whatsapp' }, enforced: true,
        children: [
            { key: 'whatsapp.inbox', label: 'Inbox', icon: 'fa-inbox',
              storage: { type: 'flag', key: 'whatsapp.inbox' }, enforced: false },
            {
                key: 'whatsapp.chatbot', label: 'Chatbot', icon: 'fa-robot',
                storage: { type: 'flag', key: 'whatsapp.chatbot' }, enforced: false,
                children: [
                    { key: 'whatsapp.chatbot.flow', label: 'Flow Builder', icon: 'fa-diagram-project',
                      storage: { type: 'flag', key: 'whatsapp.chatbot.flow' }, enforced: false },
                    { key: 'whatsapp.chatbot.ai', label: 'AI Chatbot', icon: 'fa-wand-magic-sparkles',
                      storage: { type: 'feature', key: 'aiChatbot' }, enforced: true },
                ],
            },
            { key: 'whatsapp.templates', label: 'Template Manager', icon: 'fa-file-lines',
              storage: { type: 'flag', key: 'whatsapp.templates' }, enforced: false },
            { key: 'whatsapp.broadcast', label: 'Broadcast', icon: 'fa-tower-broadcast',
              storage: { type: 'feature', key: 'campaigns' }, enforced: true },
        ],
    },
    {
        key: 'email', label: 'Email', icon: 'fa-envelope',
        storage: { type: 'module', id: 'email' }, enforced: true,
        children: [
            { key: 'email.inbox', label: 'Inbox', icon: 'fa-inbox',
              storage: { type: 'flag', key: 'email.inbox' }, enforced: false },
            { key: 'email.automation', label: 'Email Automation', icon: 'fa-envelopes-bulk',
              storage: { type: 'feature', key: 'emailAutomation' }, enforced: true },
        ],
    },
    {
        key: 'automation', label: 'Automation', icon: 'fa-robot',
        storage: { type: 'module', id: 'automations' }, enforced: true,
        children: [
            { key: 'automation.legacy', label: 'Legacy Automation', icon: 'fa-robot',
              storage: { type: 'flag', key: 'automation.legacy' }, enforced: false },
            { key: 'automation.workflow', label: 'Workflow', icon: 'fa-bolt',
              storage: { type: 'flag', key: 'automation.workflow' }, enforced: false },
            { key: 'automation.sequences', label: 'Sequences', icon: 'fa-wand-magic-sparkles',
              storage: { type: 'flag', key: 'automation.sequences' }, enforced: false },
        ],
    },
    {
        key: 'voice', label: 'AI Voice', icon: 'fa-headset',
        storage: { type: 'module', id: 'voice' }, enforced: true,
    },
    {
        key: 'reports', label: 'Analytics', icon: 'fa-chart-pie',
        storage: { type: 'module', id: 'reports' }, enforced: true,
        children: [
            { key: 'reports.advanced', label: 'Advanced Analytics', icon: 'fa-chart-line',
              storage: { type: 'feature', key: 'advancedAnalytics' }, enforced: true },
        ],
    },
    {
        key: 'team', label: 'Team', icon: 'fa-user-group',
        storage: { type: 'module', id: 'team' }, enforced: true,
    },
    {
        key: 'appointments', label: 'Appointments', icon: 'fa-calendar-check',
        storage: { type: 'flag', key: 'appointments' }, enforced: false,
    },
    {
        key: 'settings', label: 'Settings', icon: 'fa-gear',
        storage: { type: 'module', id: 'settings' }, enforced: true,
        children: [
            { key: 'settings.tags', label: 'Lead Tags', icon: 'fa-tags',
              storage: { type: 'flag', key: 'settings.tags' }, enforced: false },
            { key: 'settings.customFields', label: 'Custom Fields', icon: 'fa-list-check',
              storage: { type: 'flag', key: 'settings.customFields' }, enforced: false },
            { key: 'settings.sheetSync', label: 'Sheet Sync', icon: 'fa-table',
              storage: { type: 'flag', key: 'settings.sheetSync' }, enforced: false },
            { key: 'settings.webLead', label: 'Web-to-Lead', icon: 'fa-code',
              storage: { type: 'flag', key: 'settings.webLead' }, enforced: false },
            { key: 'settings.leadAssignment', label: 'Lead Assignment', icon: 'fa-user-tag',
              storage: { type: 'flag', key: 'settings.leadAssignment' }, enforced: false },
            { key: 'settings.claudeAI', label: 'Claude AI', icon: 'fa-brain',
              storage: { type: 'flag', key: 'settings.claudeAI' }, enforced: false },
            { key: 'settings.apiAccess', label: 'API Access', icon: 'fa-plug',
              storage: { type: 'feature', key: 'webhooks' }, enforced: true },
        ],
    },
];

// Granular flag keys are dot-paths (e.g. 'whatsapp.chatbot.flow'). MongoDB
// rejects field names containing '.', so a `$set` that writes those verbatim
// into the featureFlags Mixed map fails the whole save. We therefore encode the
// dots when a flag key is used as a storage field name. This helper is the ONLY
// place featureFlags keys are derived — read and write must both go through it.
const flagStoreKey = (key) => key.replace(/\./g, '__');

// Resolve a single storage-bearing node's on/off state from a workspace doc.
function resolveNodeValue(storage, ws) {
    if (!storage) return undefined;
    if (storage.type === 'module')  return (ws.activeModules || []).includes(storage.id);
    if (storage.type === 'feature') return !!(ws.planFeatures || {})[storage.key];
    // Flags are OPT-OUT: entitled unless the SuperAdmin has explicitly set false.
    // This keeps trial/existing tenants (empty featureFlags) fully unlocked and
    // makes enforcement backward-compatible — absence never strips access.
    if (storage.type === 'flag') {
        const flags = ws.featureFlags || {};
        // Prefer the encoded key; fall back to a raw dotted key for any legacy row.
        const stored = flags[flagStoreKey(storage.key)] !== undefined
            ? flags[flagStoreKey(storage.key)]
            : flags[storage.key];
        return stored !== false;
    }
    return undefined;
}

// Flatten the tree → { [key]: resolvedBool } for every storage-bearing node.
function resolveValues(ws) {
    const values = {};
    const walk = (nodes) => nodes.forEach((n) => {
        if (n.storage) values[n.key] = resolveNodeValue(n.storage, ws);
        if (n.children) walk(n.children);
    });
    walk(FEATURE_REGISTRY);
    return values;
}

// Inverse of resolveValues: given a { nodeKey: boolean } map (as produced by the
// permission tree UI), fold it back onto the three storage buckets. Starts from
// `base` (existing state to preserve — e.g. planFeatures.leadLimit) and returns
// plain values ready to persist on a WorkspaceSettings OR a Plan (both share the
// same activeModules / planFeatures / featureFlags shape). Single source of truth
// for values→storage, used by the per-client manager AND the plan builder.
function applyValues(values = {}, base = {}) {
    const activeModules = new Set(base.activeModules || []);
    const planFeatures = { ...(base.planFeatures || {}) };
    const featureFlags = { ...(base.featureFlags || {}) };
    const walk = (nodes) => nodes.forEach((n) => {
        if (n.storage && values[n.key] !== undefined) {
            const on = !!values[n.key];
            if (n.storage.type === 'module') {
                if (on) activeModules.add(n.storage.id); else activeModules.delete(n.storage.id);
            } else if (n.storage.type === 'feature') {
                planFeatures[n.storage.key] = on;
            } else if (n.storage.type === 'flag') {
                featureFlags[flagStoreKey(n.storage.key)] = on;
            }
        }
        if (n.children) walk(n.children);
    });
    walk(FEATURE_REGISTRY);
    return { activeModules: [...activeModules], planFeatures, featureFlags };
}

// ─── Per-client override layering ────────────────────────────────────────────
// A tenant's effective entitlements = PLAN baseline + per-client overrides on top.
// Overrides are stored sparsely as { nodeKey: boolean } (only the keys a SuperAdmin
// deliberately changed away from the plan). Keeping them separate from the plan's
// materialized values is what lets them SURVIVE plan renewals / catalog edits — every
// plan-apply path re-layers them via resolveEffective().

// Node keys contain dots (e.g. 'whatsapp.chatbot.flow'); MongoDB rejects dotted
// field names, so the STORED override map is dot-encoded (same scheme as flags).
// Encoding lives here so call sites always work in plain node-key space.
const encodeOverrides = (raw = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) out[flagStoreKey(k)] = v;
    return out;
};
const decodeOverrides = (stored = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(stored)) out[k.replace(/__/g, '.')] = v;
    return out;
};

// Reduce a full { nodeKey: bool } selection (as produced by the permission tree) to
// only the keys that DEVIATE from the plan baseline — that sparse set is persisted.
// Returns plain node-key space; encode with encodeOverrides() before storing.
function diffOverrides(values = {}, baselineValues = {}) {
    const out = {};
    for (const [k, v] of Object.entries(values)) {
        if (baselineValues[k] !== v) out[k] = v;
    }
    return out;
}

// Given a plan-like baseline source ({ activeModules, planFeatures, featureFlags })
// and the STORED (encoded) override map, return the effective storage buckets to
// persist and enforce. Overrides win over the plan. `base` seeds non-tree fields to
// preserve (numeric limits like leadLimit/agentLimit live outside the registry tree).
function resolveEffective(baseline = {}, storedOverrides = {}, base = baseline) {
    const merged = { ...resolveValues(baseline), ...decodeOverrides(storedOverrides) };
    return applyValues(merged, base);
}

// ─── Upsell metadata ─────────────────────────────────────────────────────────
// Presentation copy for the UpgradeWall, keyed by registry node key. Kept beside
// the tree so there are NO hardcoded feature strings in the UI — the wall renders
// entirely from here. Any key without an entry falls back to its label.
const FEATURE_META = {
    leads:                  { tagline: 'Capture, organise and work every lead in one pipeline.', planHint: 'Included on all paid plans', benefits: ['Kanban pipeline', 'Lead tags & custom fields', 'Assignment rules'] },
    'leads.metaSync':       { tagline: 'Auto-import Facebook & Instagram Lead Ads in real time.', planHint: 'Available on Pro', benefits: ['Instant lead sync', 'No CSV uploads', 'Per-form routing'] },
    whatsapp:               { tagline: 'Run your whole WhatsApp presence from one inbox.', planHint: 'Available on Pro', benefits: ['Shared team inbox', 'Chatbot flows', 'Broadcasts & templates'] },
    'whatsapp.chatbot.ai':  { tagline: 'Let AI reply, qualify leads and book appointments 24/7.', planHint: 'Available on Enterprise', benefits: ['Automate replies instantly', 'Qualify leads automatically', 'Book appointments hands-free'] },
    'whatsapp.broadcast':   { tagline: 'Reach thousands of contacts with one approved template.', planHint: 'Available on Pro', benefits: ['Bulk campaigns', 'Audience targeting', 'Delivery analytics'] },
    'whatsapp.templates':   { tagline: 'Create and manage approved WhatsApp templates.', planHint: 'Included with WhatsApp', benefits: ['Template builder', 'Meta submission', 'Variable mapping'] },
    email:                  { tagline: 'Send, receive and automate email beside your leads.', planHint: 'Available on Pro', benefits: ['Unified email inbox', 'Templates', 'Follow-up automation'] },
    'email.automation':     { tagline: 'Trigger personalised emails from any pipeline event.', planHint: 'Available on Pro', benefits: ['Event-based sends', 'Personalisation', 'Zero manual effort'] },
    automation:             { tagline: 'Put your follow-up on autopilot with rules & workflows.', planHint: 'Available on Pro', benefits: ['Visual workflow builder', 'Drip sequences', 'Stage routing'] },
    voice:                  { tagline: 'AI voice agents that call and qualify leads for you.', planHint: 'Available as an add-on', benefits: ['Outbound AI calls', 'Call transcripts', 'Auto lead updates'] },
    reports:                { tagline: 'See what’s working with pipeline & performance reports.', planHint: 'Included on all paid plans', benefits: ['Pipeline reports', 'Team metrics', 'Source insights'] },
    'reports.advanced':     { tagline: 'Deeper analytics, trends and custom breakdowns.', planHint: 'Available on Enterprise', benefits: ['Trend analysis', 'Custom breakdowns', 'Export-ready charts'] },
    team:                   { tagline: 'Invite agents and control exactly what they can do.', planHint: 'Available on Pro', benefits: ['Unlimited seats', 'Granular permissions', 'Activity tracking'] },
    appointments:           { tagline: 'Let leads self-book into your calendar.', planHint: 'Included on all paid plans', benefits: ['Booking pages', 'Availability rules', 'Auto reminders'] },
    settings:               { tagline: 'Configure tags, fields, integrations and more.', planHint: 'Included on all paid plans', benefits: ['Custom fields', 'Integrations', 'API access'] },
    'settings.apiAccess':   { tagline: 'Connect your CRM to any third-party system.', planHint: 'Available on Enterprise', benefits: ['REST API keys', 'Webhooks', 'Custom integrations'] },
};

// Flatten the tree → { [key]: node } with parent label attached, for O(1) lookup.
function flattenRegistry() {
    const flat = {};
    const walk = (nodes, parent) => nodes.forEach((n) => {
        flat[n.key] = { ...n, parentKey: parent?.key || null, parentLabel: parent?.label || null };
        if (n.children) walk(n.children, n);
    });
    walk(FEATURE_REGISTRY, null);
    return flat;
}

// Resolve display metadata for a feature key (label + upsell copy), with fallbacks.
function getFeatureMeta(key) {
    const node = flattenRegistry()[key];
    const meta = FEATURE_META[key] || {};
    return {
        key,
        name: node?.label || key,
        icon: node?.icon || 'fa-lock',
        category: node?.parentLabel || node?.label || null,
        tagline: meta.tagline || null,
        planHint: meta.planHint || 'Available on a higher plan',
        benefits: meta.benefits || [],
    };
}

module.exports = { FEATURE_REGISTRY, FEATURE_META, flagStoreKey, resolveNodeValue, resolveValues, applyValues, diffOverrides, resolveEffective, encodeOverrides, decodeOverrides, flattenRegistry, getFeatureMeta };
