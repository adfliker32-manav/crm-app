const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'controllers', 'leadController.js');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Add import at the top
const importStatement = "const { logActivity } = require('../services/auditService');";
if (!content.includes(importStatement)) {
    content = content.replace(
        "const { sendEmail } = require('../services/emailService');",
        `const { sendEmail } = require('../services/emailService');\n${importStatement}`
    );
    console.log('✅ Added audit service import');
}

// 2. Add logging to createLead (after newLead.save())
const createLeadLog = `
        // Log activity
        logActivity({
            userId: ownerId,
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_CREATED',
            entityType: 'Lead',
            entityId: newLead._id,
            entityName: newLead.name,
            metadata: { source: source || 'Manual Entry', status: status || 'New' },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));
`;

if (!content.includes('LEAD_CREATED')) {
    content = content.replace(
        /await newLead\.save\(\);\s+\/\/ Send automated email/,
        `await newLead.save();
${createLeadLog}
        // Send automated email`
    );
    console.log('✅ Added logging to createLead');
}

//  3. Add logging to updateLead (after lead.save())
const updateLeadLog = `
        // Log activity
        const changesObj = {};
        if (oldStatus && req.body.status && oldStatus !== req.body.status) {
            changesObj.status = { before: oldStatus, after: req.body.status };
        }
        logActivity({
            userId: req.user.userId || req.user.id,
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_EDITED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            changes: Object.keys(changesObj).length > 0 ? changesObj : null,
            metadata: { fieldsUpdated: Object.keys(req.body) },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));
`;

// 4. Add logging to deleteLead
const deleteLeadLog = `
        // Log deletion
        logActivity({
            userId: req.user.userId || req.user.id,
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_DELETED',
            entityType: 'Lead',
            entityId: deletedLead._id,
            entityName: deletedLead.name,
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));
`;

// 5. Add logging to addNote
const addNoteLog = `
        // Log note addition
        logActivity({
            userId: req.user.userId || req.user.id,
            userName: req.user.name || 'Unknown',
            actionType: 'NOTE_ADDED',
            entityType: 'Lead',
            entityId: updatedLead._id,
            entityName: updatedLead.name,
            metadata: { noteText: text.trim().substring(0, 100) },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));
`;

// Write the file
fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ Audit logging integration complete!');
console.log('📝 Updated: leadController.js');
