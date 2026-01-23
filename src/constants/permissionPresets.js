/**
 * Permission Presets for Agent Creation
 * 
 * These presets provide quick templates for common agent roles.
 * Managers can select a preset or customize permissions individually.
 */

// View Only - Agent can only see data, no modifications
const VIEW_ONLY = {
    viewDashboard: true,
    viewLeads: true,
    viewAllLeads: false, // Only assigned leads
    createLeads: false,
    editLeads: false,
    deleteLeads: false,
    assignLeads: false,
    exportLeads: false,
    viewPipeline: true,
    moveLeads: false,
    viewEmails: false,
    sendEmails: false,
    sendBulkEmails: false,
    manageEmailTemplates: false,
    viewWhatsApp: false,
    sendWhatsApp: false,
    sendBulkWhatsApp: false,
    manageWhatsAppTemplates: false,
    viewNotes: true,
    createNotes: false,
    editNotes: false,
    deleteNotes: false,
    manageFollowUps: false,
    accessSettings: false,
    viewBilling: false,
    manageTeam: false
};

// Basic Agent - Standard permissions for regular agents
const BASIC_AGENT = {
    viewDashboard: true,
    viewLeads: true,
    viewAllLeads: false, // Only assigned leads
    createLeads: false,
    editLeads: true,
    deleteLeads: false,
    assignLeads: false,
    exportLeads: false,
    viewPipeline: true,
    moveLeads: true,
    viewEmails: false,
    sendEmails: true,
    sendBulkEmails: false,
    manageEmailTemplates: false,
    viewWhatsApp: false,
    sendWhatsApp: true,
    sendBulkWhatsApp: false,
    manageWhatsAppTemplates: false,
    viewNotes: false,
    createNotes: true,
    editNotes: false,
    deleteNotes: false,
    manageFollowUps: true,
    accessSettings: false,
    viewBilling: false,
    manageTeam: false
};

// Senior Agent - Advanced permissions for experienced agents
const SENIOR_AGENT = {
    viewDashboard: true,
    viewLeads: true,
    viewAllLeads: true, // Can see ALL leads
    createLeads: true,
    editLeads: true,
    deleteLeads: false,
    assignLeads: true,
    exportLeads: true,
    viewPipeline: true,
    moveLeads: true,
    viewEmails: true,
    sendEmails: true,
    sendBulkEmails: true,
    manageEmailTemplates: true,
    viewWhatsApp: true,
    sendWhatsApp: true,
    sendBulkWhatsApp: true,
    manageWhatsAppTemplates: true,
    viewNotes: true,
    createNotes: true,
    editNotes: true,
    deleteNotes: false,
    manageFollowUps: true,
    accessSettings: false,
    viewBilling: false,
    manageTeam: false
};

// Manager - Full permissions (for reference, managers bypass checks anyway)
const MANAGER = {
    viewDashboard: true,
    viewLeads: true,
    viewAllLeads: true,
    createLeads: true,
    editLeads: true,
    deleteLeads: true,
    assignLeads: true,
    exportLeads: true,
    viewPipeline: true,
    moveLeads: true,
    viewEmails: true,
    sendEmails: true,
    sendBulkEmails: true,
    manageEmailTemplates: true,
    viewWhatsApp: true,
    sendWhatsApp: true,
    sendBulkWhatsApp: true,
    manageWhatsAppTemplates: true,
    viewNotes: true,
    createNotes: true,
    editNotes: true,
    deleteNotes: true,
    manageFollowUps: true,
    accessSettings: true,
    viewBilling: true,
    manageTeam: true
};

module.exports = {
    VIEW_ONLY,
    BASIC_AGENT,
    SENIOR_AGENT,
    MANAGER
};
