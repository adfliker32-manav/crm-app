const Joi = require('joi');

/**
 * validate(schema) — Joi validation middleware factory.
 * Usage: router.post('/register', validate(schemas.register), controller)
 *
 * Returns 400 with structured error details on validation failure.
 */
const validate = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
        abortEarly: false,      // Return ALL errors, not just first
        stripUnknown: true,     // Remove unexpected fields (security)
        allowUnknown: false
    });

    if (error) {
        const errors = error.details.map(d => ({
            field: d.path.join('.'),
            message: d.message.replace(/"/g, '')
        }));
        return res.status(400).json({
            success: false,
            error: 'validation_failed',
            errors
        });
    }

    req.body = value; // Replace body with sanitized/coerced value
    next();
};

// ============================================================
// SCHEMAS
// ============================================================

const schemas = {

    // Auth
    register: Joi.object({
        email:    Joi.string().email().lowercase().trim().required(),
        password: Joi.string().min(8).max(128).required()
            .pattern(/[A-Z]/, 'uppercase letter')
            .pattern(/[0-9]/, 'number')
            .pattern(/[^A-Za-z0-9]/, 'special character')
    }),

    login: Joi.object({
        email:    Joi.string().email().lowercase().trim().required(),
        password: Joi.string().min(1).required()
    }),

    // Onboarding wizard
    onboardStep1: Joi.object({
        accountType: Joi.string()
            .valid('agency', 'freelancer', 'clinic', 'real_estate', 'other')
            .required()
    }),

    onboardStep2: Joi.object({
        name:        Joi.string().trim().min(2).max(100).required(),
        companyName: Joi.string().trim().min(2).max(150).required(),
        teamSize:    Joi.string().valid('Just me','2–10','11–50','51–200','200+').optional(),
        phone:       Joi.string().trim().max(20).optional().allow('')
    }),

    onboardStep3: Joi.object({
        activationSource: Joi.string()
            .valid('meta_ads', 'whatsapp', 'manual', 'other')
            .required()
    }),

    // Leads
    createLead: Joi.object({
        name:       Joi.string().trim().min(1).max(200).required(),
        phone:      Joi.string().trim().min(5).max(20).required(),
        email:      Joi.string().email().lowercase().trim().optional().allow(''),
        status:     Joi.string().trim().max(50).optional(),
        source:     Joi.string().trim().max(100).optional(),
        customData: Joi.object().optional(),
        force:      Joi.boolean().optional()
    }),

    updateLead: Joi.object({
        name:       Joi.string().trim().min(1).max(200).optional(),
        phone:      Joi.string().trim().min(5).max(20).optional(),
        email:      Joi.string().email().lowercase().trim().optional().allow('', null),
        status:     Joi.string().trim().max(50).optional(),
        source:     Joi.string().trim().max(100).optional(),
        dealValue:  Joi.number().min(0).optional(),
        tags:       Joi.array().items(Joi.string()).optional(),
        customData: Joi.object().optional(),
        assignedTo: Joi.string().hex().length(24).optional().allow(null),
        nextFollowUpDate: Joi.date().optional().allow(null)
    }),

    // Agent creation
    createAgent: Joi.object({
        name:     Joi.string().trim().min(2).max(100).required(),
        email:    Joi.string().email().lowercase().trim().required(),
        password: Joi.string().min(8).max(128).required()
    })
};

module.exports = { validate, schemas };
