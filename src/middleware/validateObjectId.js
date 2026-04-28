const mongoose = require('mongoose');

/**
 * Middleware to validate MongoDB ObjectIds in request parameters.
 * Automatically checks req.params.id, or any custom param names passed as arguments.
 */
const validateObjectId = (...args) => {
    return (req, res, next) => {
        let checks = [];
        
        // Handle no args (default to req.params.id)
        if (args.length === 0) {
            checks = [{ source: 'params', field: 'id' }];
        } 
        // Handle config object: { params: ['id'], body: ['leadId'] }
        else if (typeof args[0] === 'object' && args[0] !== null) {
            const config = args[0];
            if (config.params) config.params.forEach(p => checks.push({ source: 'params', field: p }));
            if (config.body) config.body.forEach(p => checks.push({ source: 'body', field: p }));
            if (config.query) config.query.forEach(p => checks.push({ source: 'query', field: p }));
        } 
        // Handle array of strings (legacy behavior: assume req.params)
        else {
            args.forEach(p => checks.push({ source: 'params', field: p }));
        }

        for (const check of checks) {
            const value = req[check.source]?.[check.field];
            if (value && !mongoose.Types.ObjectId.isValid(value)) {
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
