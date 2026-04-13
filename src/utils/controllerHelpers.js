const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const STRONG_PASSWORD_MESSAGE = 'Password must be at least 8 characters, and include uppercase, lowercase, number, and special character';

const normalizeEmail = (email) => {
    if (typeof email !== 'string') {
        return email;
    }

    return email.toLowerCase().trim();
};

const getRequestUserId = (user = {}) => user?.userId || user?.id || null;

const hasManageTeamAccess = (user = {}) =>
    ['superadmin', 'manager'].includes(user.role) || user.permissions?.manageTeam === true;

const hasStrongPassword = (password) =>
    typeof password === 'string' && STRONG_PASSWORD_REGEX.test(password);

const parseBoundedInteger = (value, fallback, options = {}) => {
    const { min = 1, max = Number.MAX_SAFE_INTEGER } = options;
    const parsedValue = Number.parseInt(value, 10);

    if (Number.isNaN(parsedValue)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsedValue));
};

const handleDetachedPromise = (promise, label) =>
    Promise.resolve(promise).catch((error) => {
        console.error(label, error);
    });

const runInBackground = (label, task) => {
    setTimeout(() => {
        Promise.resolve()
            .then(task)
            .catch((error) => {
                console.error(label, error);
            });
    }, 0);
};

// ⚠️ SECURITY: Sanitize user input before using in MongoDB $regex queries.
// Without this, attackers can inject regex like '.*.*.*.*a' causing catastrophic backtracking (ReDoS).
const escapeRegex = (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = {
    STRONG_PASSWORD_MESSAGE,
    normalizeEmail,
    getRequestUserId,
    hasManageTeamAccess,
    hasStrongPassword,
    parseBoundedInteger,
    handleDetachedPromise,
    runInBackground,
    escapeRegex
};
