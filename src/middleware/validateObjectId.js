/**
 * Middleware to validate MongoDB ObjectIds in request parameters.
 * Automatically checks req.params.id, or any custom param names passed as arguments.
 *
 * ⚠️ Deliberately does NOT use mongoose.Types.ObjectId.isValid(). That helper
 * returns true for ANY 12-character string ("abcdefghijkl" passes) because 12
 * bytes is a valid raw ObjectId buffer — it then casts to a DIFFERENT id than
 * the caller wrote, so a value that should have been rejected reaches the query
 * layer as a well-formed but unrelated id. Route params are always the 24-char
 * hex form, so match that exactly.
 */
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const validateObjectId = (...args) => {
    return (req, res, next) => {
        let checks = [];
        
        // Handle no args (default to req.params.id)
        if (args.length === 0) {
            checks = [{ source: 'params', field: 'id', required: true }];
        }
        // Handle config object: { params: ['id'], body: ['leadId'] }
        else if (typeof args[0] === 'object' && args[0] !== null) {
            const config = args[0];
            // A route param is part of the path, so an absent one means the route
            // did not match as intended — treat it as required. Body/query fields
            // stay optional: callers use those for filters that may be omitted.
            if (config.params) config.params.forEach(p => checks.push({ source: 'params', field: p, required: true }));
            if (config.body) config.body.forEach(p => checks.push({ source: 'body', field: p }));
            if (config.query) config.query.forEach(p => checks.push({ source: 'query', field: p }));
        }
        // Handle array of strings (legacy behavior: assume req.params)
        else {
            args.forEach(p => checks.push({ source: 'params', field: p, required: true }));
        }

        for (const check of checks) {
            const value = req[check.source]?.[check.field];

            if (value === undefined || value === null || value === '') {
                if (!check.required) continue;
                return res.status(400).json({
                    success: false,
                    message: `Missing required ${check.source} field '${check.field}'`
                });
            }

            // Reject non-strings outright: an object here means someone passed
            // something like ?id[$ne]= and is probing for operator injection.
            if (typeof value !== 'string' || !OBJECT_ID_RE.test(value)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid format for ${check.source} field '${check.field}'`
                });
            }
        }

        next();
    };
};

module.exports = validateObjectId;
