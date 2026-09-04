// Unit tests for the pure parts of teamTaskService: DTO shaping and the
// status/completedAt state machine. No MongoDB is required — nothing here
// touches the model layer. (Only tests/email/* needs a live database.)

const { test } = require('node:test');
const assert = require('node:assert');

const { toDto, applyStatus } = require('../../src/services/teamTaskService');
const { schemas } = require('../../src/middleware/validateRequest');
const PRESETS = require('../../src/constants/permissionPresets');

const TASK_PERMISSION_KEYS = ['viewTasks', 'viewAllTasks', 'createTasks', 'editTasks', 'deleteTasks', 'assignTasks'];

// ── toDto ─────────────────────────────────────────────────────────────────────

test('toDto passes through a raw (unpopulated) ObjectId for assignedTo/assignedBy', () => {
    const raw = { _id: 't1', title: 'Call back', assignedTo: 'u1', assignedBy: 'u2', priority: 'medium', status: 'pending' };
    const dto = toDto(raw);
    assert.strictEqual(dto.assignedTo, 'u1');
    assert.strictEqual(dto.assignedBy, 'u2');
});

test('toDto expands a populated assignedTo/assignedBy into { id, name, email }', () => {
    const populated = {
        _id: 't1', title: 'Call back',
        assignedTo: { _id: 'u1', name: 'Agent A', email: 'a@x.com' },
        assignedBy: { _id: 'u2', name: 'Manager M', email: 'm@x.com' },
        priority: 'high', status: 'pending'
    };
    const dto = toDto(populated);
    assert.deepStrictEqual(dto.assignedTo, { id: 'u1', name: 'Agent A', email: 'a@x.com' });
    assert.deepStrictEqual(dto.assignedBy, { id: 'u2', name: 'Manager M', email: 'm@x.com' });
});

test('toDto returns null relatedLead when absent, expands it when populated', () => {
    const noLead = { _id: 't1', title: 'x', assignedTo: 'u1', assignedBy: 'u1', priority: 'low', status: 'pending', relatedLead: null };
    assert.strictEqual(toDto(noLead).relatedLead, null);

    const withLead = { ...noLead, relatedLead: { _id: 'l1', name: 'John', phone: '999' } };
    assert.deepStrictEqual(toDto(withLead).relatedLead, { id: 'l1', name: 'John', phone: '999' });
});

test('toDto defaults description/completedAt/dueDate to null when unset', () => {
    const dto = toDto({ _id: 't1', title: 'x', assignedTo: 'u1', assignedBy: 'u1', priority: 'low', status: 'pending' });
    assert.strictEqual(dto.description, null);
    assert.strictEqual(dto.completedAt, null);
    assert.strictEqual(dto.dueDate, null);
});

// ── applyStatus ───────────────────────────────────────────────────────────────

test('applyStatus sets completedAt when moving to completed', () => {
    const task = { status: 'pending', completedAt: null };
    applyStatus(task, 'completed');
    assert.strictEqual(task.status, 'completed');
    assert.ok(task.completedAt instanceof Date);
});

test('applyStatus clears completedAt when moving away from completed', () => {
    const task = { status: 'completed', completedAt: new Date() };
    applyStatus(task, 'in_progress');
    assert.strictEqual(task.status, 'in_progress');
    assert.strictEqual(task.completedAt, null);
});

test('applyStatus leaves completedAt null when moving between non-completed statuses', () => {
    const task = { status: 'pending', completedAt: null };
    applyStatus(task, 'in_progress');
    assert.strictEqual(task.completedAt, null);
});

// ── Agent permission plumbing ─────────────────────────────────────────────────
// Regression: schemas.createAgent used to omit `permissions` entirely, so Joi's
// stripUnknown deleted the whole map before authController.createAgent read it —
// every agent created from the Team modal silently got BASIC_AGENT instead of
// the ticked permissions. Granting Tasks access on creation depends on this.

test('createAgent schema does NOT strip the permissions map', () => {
    const body = {
        name: 'Agent A',
        email: 'agent@example.com',
        password: 'Str0ng!Passw0rd',
        permissions: { viewLeads: true, editLeads: false, assignTasks: true }
    };
    const { error, value } = schemas.createAgent.validate(body, {
        abortEarly: false, stripUnknown: true, allowUnknown: false
    });
    assert.strictEqual(error, undefined, 'a permissions map must be accepted');
    assert.ok(value.permissions, 'permissions must survive validation');
    assert.strictEqual(value.permissions.assignTasks, true);
    assert.strictEqual(value.permissions.editLeads, false);
});

test('createAgent schema preserves every task permission key', () => {
    const permissions = Object.fromEntries(TASK_PERMISSION_KEYS.map(k => [k, true]));
    const { error, value } = schemas.createAgent.validate(
        { name: 'Agent B', email: 'b@example.com', password: 'Str0ng!Passw0rd', permissions },
        { abortEarly: false, stripUnknown: true, allowUnknown: false }
    );
    assert.strictEqual(error, undefined);
    for (const key of TASK_PERMISSION_KEYS) {
        assert.strictEqual(value.permissions[key], true, `${key} must survive validation`);
    }
});

test('createAgent schema still accepts the tri-state aiVoiceAccess null', () => {
    const { error, value } = schemas.createAgent.validate(
        { name: 'Agent C', email: 'c@example.com', password: 'Str0ng!Passw0rd', permissions: { aiVoiceAccess: null } },
        { abortEarly: false, stripUnknown: true, allowUnknown: false }
    );
    assert.strictEqual(error, undefined);
    assert.strictEqual(value.permissions.aiVoiceAccess, null);
});

test('every backend preset declares all task permission keys', () => {
    for (const presetName of ['VIEW_ONLY', 'BASIC_AGENT', 'SENIOR_AGENT', 'MANAGER']) {
        for (const key of TASK_PERMISSION_KEYS) {
            assert.strictEqual(
                typeof PRESETS[presetName][key], 'boolean',
                `${presetName}.${key} must be declared`
            );
        }
    }
});

test('presets follow least privilege: only MANAGER may delete, only senior+ may assign', () => {
    assert.strictEqual(PRESETS.VIEW_ONLY.createTasks, false);
    assert.strictEqual(PRESETS.BASIC_AGENT.assignTasks, false, 'a basic agent may only self-assign');
    assert.strictEqual(PRESETS.SENIOR_AGENT.assignTasks, true);
    assert.strictEqual(PRESETS.BASIC_AGENT.deleteTasks, false);
    assert.strictEqual(PRESETS.SENIOR_AGENT.deleteTasks, false);
    assert.strictEqual(PRESETS.MANAGER.deleteTasks, true);
});
