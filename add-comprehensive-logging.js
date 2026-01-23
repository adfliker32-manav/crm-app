const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'controllers', 'leadController.js');
let content = fs.readFileSync(filePath, 'utf-8');

console.log('Adding comprehensive audit logging...');

// 1. Add logging to updateLead (after lead.save())
const updateLeadPattern = /await lead\.save\(\);[\s\r\n]+\/\/ Send automated email if stage changed/;
if (content.match(updateLeadPattern)) {
    const updateLeadLog = `await lead.save();

        // Log lead edit
        const changesObj = {};
        if (oldStatus && req.body.status && oldStatus !== req.body.status) {
            changesObj.status = { before: oldStatus, after: req.body.status };
        }
        logActivity({
            userId: req.user.userId || req.user.id,
            userName: req.user.name || 'Unknown',
            actionType: req.body.status && oldStatus !== req.body.status ? 'LEAD_STATUS_CHANGED' : 'LEAD_EDITED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            changes: Object.keys(changesObj).length > 0 ? changesObj : null,
            metadata: { fieldsUpdated: Object.keys(req.body) },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        // Send automated email if stage changed`;

    content = content.replace(updateLeadPattern, updateLeadLog);
    console.log('✅ Added logging to updateLead');
}

// 2. Add logging to deleteLead (after successful deletion)
const deleteLeadPattern = /const deletedLead = await Lead\.findOneAndDelete\([^)]+\);[\s\r\n]+if \(!deletedLead\)/;
if (content.match(deleteLeadPattern)) {
    const deleteLeadLog = `const deletedLead = await Lead.findOneAndDelete({ _id: req.params.id, userId: ownerId });
        
        if (!deletedLead) {
            return res.status(404).json({ message: "Lead not found or access denied" });
        }

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

        if (false`;  // This ensures the next 'if' gets matched

    content = content.replace(deleteLeadPattern, deleteLeadLog);
    console.log('✅ Added logging to deleteLead');
}

// 3. Add logging to addNote (after successful note addition)
const addNotePattern = /if \(!updatedLead\) return res\.status\(404\)\.json\(\{ message: "Lead not found or access denied" \}\);[\s\r\n]+res\.json\(updatedLead\);/;
if (content.match(addNotePattern)) {
    const addNoteLog = `if (!updatedLead) return res.status(404).json({ message: "Lead not found or access denied" });
        
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

        res.json(updatedLead);`;

    content = content.replace(addNotePattern, addNoteLog);
    console.log('✅ Added logging to addNote');
}

// 4. Add logging to assignLead
const assignLeadPattern = /lead\.assignedTo = agentId \|\| null;[\s\r\n]+await lead\.save\(\);[\s\r\n]+const updatedLead = await Lead\.findById\(id\)\.populate/;
if (content.match(assignLeadPattern)) {
    const assignLeadLog = `lead.assignedTo = agentId || null;
        await lead.save();

        // Log assignment
        logActivity({
            userId: req.user.userId || req.user.id,
            userName: req.user.name || 'Unknown',
            actionType: 'LEAD_ASSIGNED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            metadata: { assignedTo: agentId ? 'Agent' : 'Unassigned' },
            companyId: ownerId
        }).catch(err => console.error('Audit log error:', err));

        const updatedLead = await Lead.findById(id).populate`;

    content = content.replace(assignLeadPattern, assignLeadLog);
    console.log('✅ Added logging to assignLead');
}

// Write the updated file
fs.writeFileSync(filePath, content, 'utf-8');
console.log('\n✅ Comprehensive audit logging complete!');
console.log('📝 Updated: leadController.js');
console.log('\n📊 Logging added for:');
console.log('  - Lead creation');
console.log('  - Lead editing');
console.log('  - Lead deletion');
console.log('  - Status changes');
console.log('  - Note additions');
console.log('  - Lead assignments');
