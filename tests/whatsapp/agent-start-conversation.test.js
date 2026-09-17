// Agents starting a new WhatsApp chat (2026-09-17).
//
// With lead-based assignment on, a restricted agent got "You can only start
// conversations with leads assigned to you." for any unknown number or
// unassigned lead — i.e. they could never open a new chat. Now:
//   - unknown number  → a lead is created, assigned to the agent
//   - unassigned lead → the lead is assigned to the agent
//   - another agent's lead/thread → still refused
// Ownership goes THROUGH THE LEAD (the conversation owner is a derived mirror —
// the inbound webhook would undo a direct write), and the lead is only saved
// after the send succeeds.
//
// Also: templates were looked up by the AGENT's id, which owns none, so the
// send fell back to en_US with no variables and Meta rejected it.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'controllers', 'whatsappConversationController.js'), 'utf8'
);
const start = src.indexOf('exports.startConversation');
const body = src.slice(start, src.indexOf('\nexports.', start + 1));

describe('startConversation for a restricted agent', () => {
    test('the blanket refusal is gone', () => {
        assert.ok(!body.includes('You can only start conversations with leads assigned to you'));
    });

    test('another agent\'s contact is still refused', () => {
        assert.ok(body.includes('This conversation belongs to another agent.'));
        assert.ok(body.includes('This contact is assigned to another agent.'));
    });

    test('an unknown number creates a lead assigned to the agent', () => {
        assert.match(body, /new Lead\(\{[\s\S]*?assignedTo: userId/);
    });

    test('an unassigned lead is claimed by the agent', () => {
        assert.match(body, /!targetLead\.assignedTo\)\s*\{\s*targetLead\.assignedTo = userId/);
    });

    test('the lead is saved only after the message is sent, and before the conversation', () => {
        const send = body.indexOf('sendWhatsAppMessage(normalizedPhone');
        const leadSave = body.indexOf('restrictedClaimLead.lead.save()');
        const convSave = body.indexOf('await conversation.save()');
        assert.ok(send > 0 && leadSave > send, 'lead saved after the send');
        assert.ok(convSave > leadSave, 'lead saved before the conversation that references it');
    });

    test('a created lead does not also get an automated welcome message', () => {
        assert.match(body, /queueLeadCreatedEffects\([^)]*skipWelcome: true/);
        assert.ok(body.includes('queueLeadAssignmentEffects(lead, req.tenantId)'));
    });

    test('templates are resolved workspace-wide, not by the agent id', () => {
        assert.ok(body.includes('WhatsAppTemplate.findOne({ userId: { $in: companyUserIds }, name: templateName })'));
        assert.ok(!body.includes('WhatsAppTemplate.findOne({ userId, name: templateName })'));
    });
});
