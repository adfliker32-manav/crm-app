const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

const isDateOnlyString = (value) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDateInput = (value, { endOfDay = false } = {}) => {
    if (!value) return null;

    // HTML <input type="date"> sends YYYY-MM-DD (no timezone). Treat it as a local calendar date.
    if (isDateOnlyString(value)) {
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day, 0, 0, 0, 0);
        if (endOfDay) date.setHours(23, 59, 59, 999);
        return date;
    }

    const date = new Date(value);
    if (!isValidDate(date)) return null;
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return date;
};

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

// Returns { start, end } as Date objects.
// - `end` is "now" for preset periods.
// - For custom endDate (date-only), includes the full end day (23:59:59.999).
const getDateRange = (period = 'month', customStart, customEnd) => {
    const now = new Date();
    let start;
    let end;

    switch (period) {
        case 'today':
            start = startOfDay(now);
            end = new Date();
            break;
        case 'week': {
            start = new Date(now);
            start.setDate(start.getDate() - 7);
            start = startOfDay(start);
            end = new Date();
            break;
        }
        case 'month':
            start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
            end = new Date();
            break;
        case 'quarter': {
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            start = new Date(now.getFullYear(), quarterStart, 1, 0, 0, 0, 0);
            end = new Date();
            break;
        }
        case 'year':
            start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
            end = new Date();
            break;
        case 'custom':
            start = parseDateInput(customStart) || new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
            end = parseDateInput(customEnd, { endOfDay: true }) || new Date();
            break;
        default:
            start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
            end = new Date();
    }

    return { start, end };
};

module.exports = {
    getDateRange,
    parseDateInput,
    isValidDate
};

