// Seed vocabulary for the Contextual Help video library.
//
// WHAT THIS IS — AND IS NOT
//   This is a CONVENIENCE LIST, not a constraint. It gives the Super Admin's
//   "Video Management" screen a sensible set of module / sub-module dropdown
//   options and supplies the friendly labels the Help drawer shows as its
//   breadcrumb ("WhatsApp › Broadcast").
//
//   It is NOT an allow-list. helpVideoController accepts any normalised key, the
//   admin form lets you type a new one, and the catalog endpoint unions this
//   seed with whatever keys already exist in the collection. So a new module or
//   sub-module can be added from the panel with no code change — exactly as the
//   Help component itself needs no code change to serve it, since a page simply
//   declares the key it lives under.
//
//   The keys below MUST match what the pages pass to <HelpButton>.

/**
 * Canonical form for a module / sub-module key: lower-cased, separators folded
 * to a single dash, stripped to [a-z0-9-]. Applied identically on read and on
 * write, so "WhatsApp Broadcast" typed in the admin panel and `whatsapp-broadcast`
 * sent by a page resolve to the same record.
 *
 * ⚠️ DELIBERATELY DOES NOT SPLIT camelCase. An earlier version did, to turn a
 * page's `customFields` tab id into `custom-fields` — but the transform cannot
 * tell a programmatic identifier from a brand: it also turned the "WhatsApp" a
 * super admin types into `whats-app`, which matches no page on earth and fails
 * silently as a permanent "Help video coming soon".
 *
 * Human input is the case that must not be mangled, so a page with camelCase
 * tab ids declares its topic explicitly instead (see HELP_TOPIC in Settings.jsx).
 */
const normalizeHelpKey = (value) => {
    if (value === undefined || value === null) return '';
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[\s_.]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
};

/** "lead-assignment" -> "Lead Assignment" — used for keys not in the seed list. */
const humanizeHelpKey = (key) =>
    String(key || '')
        .split('-')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

// A sub-module key of '' means "the module as a whole" — the overview video the
// drawer falls back to when a specific tab has nothing configured yet.
const MODULE_LEVEL_LABEL = 'Module overview';

const HELP_CATALOG = [
    {
        key: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line',
        submodules: [
            { key: 'getting-started', label: 'Full CRM Demo / Getting Started' },
            { key: 'overview',        label: 'Dashboard Overview' }
        ]
    },
    {
        key: 'leads', label: 'Leads', icon: 'fa-users',
        submodules: [
            { key: 'lead-management', label: 'Lead Management' },
            { key: 'lead-assignment', label: 'Lead Assignment' },
            { key: 'lead-status',     label: 'Lead Status' },
            { key: 'lead-followup',   label: 'Lead Follow-up' },
            { key: 'pipeline',        label: 'Pipeline View' },
            { key: 'import-export',   label: 'Import & Export' }
        ]
    },
    {
        key: 'whatsapp', label: 'WhatsApp', icon: 'fa-whatsapp',
        submodules: [
            { key: 'overview',   label: 'WhatsApp Overview' },
            { key: 'inbox',      label: 'WhatsApp Inbox' },
            { key: 'chatbot',    label: 'WhatsApp Chatbot' },
            { key: 'templates',  label: 'WhatsApp Templates' },
            { key: 'media',      label: 'WhatsApp Media Library' },
            { key: 'broadcasts', label: 'WhatsApp Broadcast' },
            { key: 'analytics',  label: 'WhatsApp Analytics' },
            { key: 'settings',   label: 'WhatsApp Configuration' }
        ]
    },
    {
        key: 'email', label: 'Email', icon: 'fa-envelope',
        submodules: [
            { key: 'overview',  label: 'Email Overview' },
            { key: 'inbox',     label: 'Email Inbox' },
            { key: 'templates', label: 'Email Templates' },
            { key: 'campaigns', label: 'Email Campaigns' },
            { key: 'logs',      label: 'Email Delivery Log' },
            { key: 'analytics', label: 'Email Analytics' },
            { key: 'settings',  label: 'Email Configuration' }
        ]
    },
    {
        key: 'automation', label: 'Automation', icon: 'fa-robot',
        submodules: [
            { key: 'overview',  label: 'Automation Overview' },
            { key: 'legacy',    label: 'Automation Rules' },
            { key: 'workflow',  label: 'Workflow Builder' },
            { key: 'sequences', label: 'Drip Sequences' }
        ]
    },
    {
        key: 'appointments', label: 'Appointments', icon: 'fa-calendar-check',
        submodules: [
            { key: 'bookings',  label: 'Managing Bookings' },
            { key: 'calendar',  label: 'Calendar View' },
            { key: 'customize', label: 'Booking Page Setup' }
        ]
    },
    {
        key: 'tasks', label: 'Tasks', icon: 'fa-list-check',
        submodules: [
            { key: 'overview', label: 'Task Management' }
        ]
    },
    {
        key: 'team', label: 'Team', icon: 'fa-user-group',
        submodules: [
            { key: 'overview',    label: 'Team Management' },
            { key: 'permissions', label: 'Roles & Permissions' }
        ]
    },
    {
        key: 'reports', label: 'Reports', icon: 'fa-chart-pie',
        submodules: [
            { key: 'overview',     label: 'Reports Overview' },
            { key: 'conversion',   label: 'Conversion Report' },
            { key: 'agents',       label: 'Agent Performance' },
            { key: 'agent-detail', label: 'Agent Detail' },
            { key: 'revenue',      label: 'Revenue Report' },
            { key: 'funnel',       label: 'Funnel & Close Time' },
            { key: 'activity',     label: 'Activity Metrics' },
            { key: 'goals',        label: 'Goal Tracking' },
            { key: 'export',       label: 'Exporting Reports' }
        ]
    },
    {
        key: 'voice', label: 'AI Voice', icon: 'fa-headset',
        submodules: [
            { key: 'analytics',   label: 'Voice Analytics' },
            { key: 'templates',   label: 'Voice Templates' },
            { key: 'integration', label: 'Voice Integration' }
        ]
    },
    {
        key: 'settings', label: 'Settings', icon: 'fa-gear',
        submodules: [
            { key: 'profile',         label: 'Profile & Password' },
            { key: 'tags',            label: 'Lead Tags' },
            { key: 'custom-fields',   label: 'Custom Fields' },
            { key: 'sheet-sync',      label: 'Google Sheet Sync' },
            { key: 'meta',            label: 'Meta Lead Sync' },
            { key: 'web-lead',        label: 'Web-to-Lead Form' },
            { key: 'claude-ai',       label: 'Claude AI / MCP' },
            { key: 'lead-assignment', label: 'Lead Assignment Rules' },
            { key: 'external-api',    label: 'API Access' },
            { key: 'audit-log',       label: 'Audit Log' }
        ]
    },
    {
        key: 'billing', label: 'Billing', icon: 'fa-credit-card',
        submodules: [
            { key: 'overview', label: 'Billing & Invoices' },
            { key: 'plans',    label: 'Plans & Upgrades' }
        ]
    }
];

const HELP_MODULE_MAP = new Map(HELP_CATALOG.map(m => [m.key, m]));

/** Friendly module label, falling back to a humanised form of an unknown key. */
const moduleLabelFor = (key) =>
    HELP_MODULE_MAP.get(key)?.label || humanizeHelpKey(key) || '';

/** Friendly sub-module label; '' resolves to the module-overview label. */
const submoduleLabelFor = (moduleKey, submoduleKey) => {
    if (!submoduleKey) return MODULE_LEVEL_LABEL;
    const found = HELP_MODULE_MAP.get(moduleKey)?.submodules
        ?.find(s => s.key === submoduleKey);
    return found?.label || humanizeHelpKey(submoduleKey);
};

module.exports = {
    HELP_CATALOG,
    MODULE_LEVEL_LABEL,
    normalizeHelpKey,
    humanizeHelpKey,
    moduleLabelFor,
    submoduleLabelFor
};
