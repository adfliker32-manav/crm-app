const assert = require('assert');
const { getDateRange } = require('../src/utils/dateRange');

const assertLocalTime = (date, h, m, s, ms) => {
    assert.strictEqual(date.getHours(), h, `Expected hours=${h}, got ${date.getHours()}`);
    assert.strictEqual(date.getMinutes(), m, `Expected minutes=${m}, got ${date.getMinutes()}`);
    assert.strictEqual(date.getSeconds(), s, `Expected seconds=${s}, got ${date.getSeconds()}`);
    assert.strictEqual(date.getMilliseconds(), ms, `Expected ms=${ms}, got ${date.getMilliseconds()}`);
};

// Custom date-only inputs should include the full end day (end-of-day inclusive)
{
    const { start, end } = getDateRange('custom', '2026-04-01', '2026-04-01');
    assertLocalTime(start, 0, 0, 0, 0);
    assertLocalTime(end, 23, 59, 59, 999);
    assert.ok(end >= start, 'Expected end >= start');
}

// Quarter start should align to the current quarter boundary
{
    const now = new Date();
    const expectedQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const { start } = getDateRange('quarter');
    assert.strictEqual(start.getFullYear(), now.getFullYear());
    assert.strictEqual(start.getMonth(), expectedQuarterStartMonth);
    assert.strictEqual(start.getDate(), 1);
    assertLocalTime(start, 0, 0, 0, 0);
}

console.log('reporting-sanity ok');

