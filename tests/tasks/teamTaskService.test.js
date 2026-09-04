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

// ═════════════════════════════════════════════════════════════════════════════
// Audit fixes (2026-09-05). Each test below fails against the pre-fix source.
// ═════════════════════════════════════════════════════════════════════════════

const fs = require('node:fs');
const path = require('node:path');
// Full-line comments are stripped so an assertion matches code, not the prose
// explaining what the code replaced.
const readSrc = (...p) =>
    fs.readFileSync(path.join(__dirname, '..', '..', 'src', ...p), 'utf8')
        .replace(/^\s*\/\/.*$/gm, '');

// ── 1. Tenant deletion must not orphan team tasks ────────────────────────────

test('TeamTask is cleaned up when an account is deleted', () => {
    const src = readSrc('services', 'accountCleanupService.js');
    assert.match(src, /require\('\.\.\/models\/TeamTask'\)/,
        'accountCleanupService must know about TeamTask');
    const list = src.slice(src.indexOf('USER_OWNED_MODELS'), src.indexOf('DESTRUCTIVE-QUERY GUARD'));
    assert.match(list, /\bTeamTask\b/,
        'the Tasks module shipped after this list was written — a deleted tenant left every team task behind');
});

// ── 2. Legacy per-lead follow-ups respect agent row-level security ────────────

test('legacy taskController narrows follow-ups to leads the agent can see', () => {
    const src = readSrc('controllers', 'taskController.js');

    assert.match(src, /visibleLeadFilter/,
        'every query was tenant-scoped only, so a restricted agent read follow-ups for every lead');
    assert.match(src, /req\.dataScope\?\.assignedTo/,
        'restriction is detected from dataScope, which carries assignedTo for a limited agent');
    // Task has no assignedTo field, so spreading dataScope into a Task query
    // would match zero rows and silently empty the module for every agent.
    assert.doesNotMatch(src, /Task\.find\(\{[^}]*\.\.\.req\.dataScope/,
        'dataScope must never be spread into a Task query — assignedTo is a Lead field');
});

test('every legacy task path is scoped, not just the list', () => {
    const src = readSrc('controllers', 'taskController.js');

    for (const fn of ['getTasksByLead', 'createTask']) {
        const start = src.indexOf(`const ${fn} = async`);
        assert.notStrictEqual(start, -1, `${fn} not found — was it renamed?`);
        const body = src.slice(start, src.indexOf('\n};', start));
        assert.match(body, /Lead\.findOne\(\{[\s\S]{0,80}\.\.\.req\.dataScope/,
            `${fn} must resolve the parent lead through dataScope before touching follow-ups`);
    }

    for (const fn of ['updateTaskStatus', 'deleteTask']) {
        const start = src.indexOf(`const ${fn} = async`);
        const body = src.slice(start, src.indexOf('\n};', start));
        assert.match(body, /visibleLeadFilter\(req\)/,
            `${fn} must not let an agent act on another agent's follow-up`);
    }
});

// ── 3. The legacy status enum is actually enforced ───────────────────────────

test('legacy updateTaskStatus rejects a status outside the enum', () => {
    const src = readSrc('controllers', 'taskController.js');
    const start = src.indexOf('const updateTaskStatus = async');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.match(body, /ALLOWED_STATUS/,
        'findOneAndUpdate does not run validators by default, so any string was written straight in');
    assert.match(body, /runValidators:\s*true/,
        'and the schema validator must run as a second line of defence');
    assert.match(body, /status:\s*Joi|400/,
        'an invalid status must be a 400, not a silently corrupted row');
});

// ── 4. Team task list filters reject junk instead of 500ing ──────────────────

const teamTasks = require('../../src/services/teamTaskService');

// A request shaped like the ones authMiddleware builds, for a privileged user
// so taskScope() adds no $or and the filter under test is the only variable.
const managerReq = () => ({
    tenantId: '507f1f77bcf86cd799439011',
    user: { role: 'manager', userId: '507f1f77bcf86cd799439011', name: 'M', permissions: {} },
    dataScope: { userId: '507f1f77bcf86cd799439011' }
});

const expectStatus = async (fn, status, label) => {
    try {
        await fn();
    } catch (err) {
        assert.strictEqual(err.status, status, `${label}: expected ${status}, got ${err.status} (${err.message})`);
        return err;
    }
    throw new Error(`${label}: expected a ${status}, but nothing was thrown`);
};

test('an unparseable assignedTo filter is a 400, not a CastError 500', async () => {
    await expectStatus(
        () => teamTasks.listTasks(managerReq(), { assignedTo: 'not-an-id' }),
        400, 'assignedTo'
    );
});

test('an unparseable date filter is a 400, not a CastError 500', async () => {
    await expectStatus(
        () => teamTasks.listTasks(managerReq(), { dueBefore: 'whenever' }),
        400, 'dueBefore'
    );
    await expectStatus(
        () => teamTasks.listTasks(managerReq(), { dueAfter: 'whenever' }),
        400, 'dueAfter'
    );
});

// ── 5. Module + permission gating stays wired ────────────────────────────────

test('the team-tasks API is behind the tasks module gate', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
    assert.match(index, /app\.use\('\/api\/team-tasks',[^\n]*requireModule\('tasks'\)/,
        'a workspace without the Tasks module must not be able to call the API directly');
});

test('each team-task route carries its own permission check', () => {
    const routes = readSrc('routes', 'teamTaskRoutes.js');
    for (const [verb, perm] of [
        ["get\\('/'", 'viewTasks'],
        ["post\\('/'", 'createTasks'],
        ["put\\('/:id'", 'editTasks'],
        ["delete\\('/:id'", 'deleteTasks']
    ]) {
        const line = new RegExp(`router\\.${verb}[^\\n]*checkPermission\\('${perm}'\\)`);
        assert.match(routes, line, `the ${perm} route lost its permission check`);
    }
});
