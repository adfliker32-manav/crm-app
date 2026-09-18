// Regression tests for "a standalone task is created but nobody can see it".
//
// e43c07c relaxed the Task schema so leadId and dueDate became optional, which
// unblocked the MCP create_task tool — it advertises both as optional and passes
// null for each, so Mongoose had been rejecting every standalone reminder.
//
// What that commit missed: MongoDB comparison operators are TYPE-BRACKETED. A
// null dueDate never matches { $gte: <Date> } or { $lt: <Date> }, and every UI
// caller of GET /tasks passes a dateFilter:
//
//   TaskModal.jsx      — all four tabs (today / overdue / upcoming / completed)
//   Sidebar.jsx        — dateFilter=today for the badge count
//   dashboardController— dueDate ranges for every widget
//
// There is no unfiltered /tasks fetch anywhere in the frontend, so the row was
// written, create_task reported success to the AI, and no human could ever see
// it. "Unscheduled" is not overdue and not due today, so upcoming is its home.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const Task = require(path.join(ROOT, 'src', 'models', 'Task'));
const { getTasks } = require(path.join(ROOT, 'src', 'controllers', 'taskController'));

/**
 * Run getTasks with Task.find stubbed, so the query it builds can be inspected
 * and a fixed result set can be pushed through the response ordering. No DB.
 */
async function runGetTasks(query, rows = []) {
    const originalFind = Task.find;
    let capturedQuery = null;

    Task.find = (q) => {
        capturedQuery = q;
        return { populate: () => ({ sort: () => ({ lean: async () => rows }) }) };
    };

    let payload;
    // dataScope without assignedTo = an owner/manager, so visibleLeadFilter
    // short-circuits and never touches the Lead collection.
    const req = { tenantId: 'tenant-1', query, dataScope: {} };
    const res = {
        json: (d) => { payload = d; },
        status: () => ({ json: (d) => { payload = d; } })
    };

    try {
        await getTasks(req, res);
    } finally {
        Task.find = originalFind;
    }

    return { query: capturedQuery, payload };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the schema must keep allowing a standalone task
// ─────────────────────────────────────────────────────────────────────────────

test('Task schema leaves leadId and dueDate optional', () => {
    const { leadId, dueDate } = Task.schema.obj;
    assert.notEqual(leadId.required, true, 'leadId required again — create_task would break');
    assert.notEqual(dueDate.required, true, 'dueDate required again — create_task would break');
});

test('a task with neither a lead nor a due date passes validation', async () => {
    const doc = new Task({
        userId: '507f1f77bcf86cd799439011',
        title: 'Standalone reminder',
        createdBy: '507f1f77bcf86cd799439011'
    });
    await assert.doesNotReject(() => doc.validate());
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the upcoming filter is what actually surfaces them
// ─────────────────────────────────────────────────────────────────────────────

test('dateFilter=upcoming matches undated tasks as well as future ones', async () => {
    const { query } = await runGetTasks({ dateFilter: 'upcoming' });

    assert.ok(Array.isArray(query.$or), 'upcoming must widen to an $or');
    assert.ok(
        query.$or.some(c => c.dueDate === null),
        'upcoming must include { dueDate: null } or standalone tasks stay invisible'
    );
    assert.ok(
        query.$or.some(c => c.dueDate && c.dueDate.$gte instanceof Date),
        'upcoming must still match genuinely future tasks'
    );
    assert.equal(query.status, 'Pending');
});

test('today and overdue do NOT absorb undated tasks', async () => {
    for (const dateFilter of ['today', 'overdue']) {
        const { query } = await runGetTasks({ dateFilter });
        assert.ok(!query.$or, `${dateFilter} must not widen to $or — undated is not ${dateFilter}`);
        assert.ok(query.dueDate, `${dateFilter} must still bracket on a real date range`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — ordering: null sorts before every date in BSON, which is backwards here
// ─────────────────────────────────────────────────────────────────────────────

test('undated tasks are returned last, not first', async () => {
    const rows = [
        { _id: 'a', title: 'undated',   dueDate: null },
        { _id: 'b', title: 'next week', dueDate: new Date('2030-01-08T09:00:00Z') },
        { _id: 'c', title: 'tomorrow',  dueDate: new Date('2030-01-02T09:00:00Z') }
    ];

    const { payload } = await runGetTasks({ dateFilter: 'upcoming' }, rows);

    assert.deepEqual(
        payload.map(t => t.title),
        ['next week', 'tomorrow', 'undated'],
        'a reminder with no date must not outrank dated work'
    );
});

test('ordering of dated tasks is left exactly as Mongo sorted it', async () => {
    const rows = [
        { _id: 'c', title: 'tomorrow',  dueDate: new Date('2030-01-02T09:00:00Z') },
        { _id: 'b', title: 'next week', dueDate: new Date('2030-01-08T09:00:00Z') }
    ];

    const { payload } = await runGetTasks({ dateFilter: 'upcoming' }, rows);

    assert.deepEqual(payload.map(t => t.title), ['tomorrow', 'next week']);
});
