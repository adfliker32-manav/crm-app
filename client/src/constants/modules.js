// Single source of truth for the workspace modules a MANAGER (tenant) can have.
//
// These are the real, customer-facing modules that actually gate navigation and
// API routes. Things like "API Access" and "White-Label" are NOT manager-level
// offerings (white-label is an agency/reseller capability), so they are
// intentionally excluded — they must never appear in a manager's plan, the
// superadmin module pickers, or the customer Billing page.
//
// Drip "Sequences" are part of the Automations module (not a separate module).
// The WhatsApp "Chatbot" / visual flow builder is FREE and rides on the WhatsApp
// module (anyone with WhatsApp gets it), so it is not a standalone toggle here.
// Only the premium *AI* (LLM) layer is gated separately, via planFeatures.aiChatbot.
export const WORKSPACE_MODULES = [
    { id: 'leads',       name: 'Leads',       icon: 'fa-address-book' },
    { id: 'whatsapp',    name: 'WhatsApp',    icon: 'fa-whatsapp', isBrand: true },
    { id: 'email',       name: 'Email',       icon: 'fa-envelope' },
    { id: 'automations', name: 'Automations', icon: 'fa-bolt' },
    { id: 'team',        name: 'Team',        icon: 'fa-users' },
    { id: 'reports',     name: 'Reports',     icon: 'fa-chart-pie' },
    { id: 'settings',    name: 'Settings',    icon: 'fa-gear' }
];

export const WORKSPACE_MODULE_IDS = WORKSPACE_MODULES.map(m => m.id);

// Friendly label for a module id; falls back to the raw id for any legacy/unknown value.
export const moduleLabel = (id) => WORKSPACE_MODULES.find(m => m.id === id)?.name || id;
