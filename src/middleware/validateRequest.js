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

    // Auth — public self-registration (creates a manager + 14-day trial workspace)
    register: Joi.object({
        name:        Joi.string().trim().min(2).max(100).required(),
        companyName: Joi.string().trim().min(2).max(150).required(),
        email:       Joi.string().email().lowercase().trim().required(),
        password:    Joi.string().min(8).max(128).required()
            .pattern(/[A-Z]/, 'uppercase letter')
            .pattern(/[0-9]/, 'number')
            .pattern(/[^A-Za-z0-9]/, 'special character'),
        phone:       Joi.string().trim().min(5).max(20).required(),
        // Plain string (no .uri()) so users can type "example.com" without a scheme.
        website:         Joi.string().trim().max(200).optional().allow(''),
        onboardingNotes: Joi.string().trim().max(2000).optional().allow('')
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
        dealValue:  Joi.number().min(0).optional().allow('', null),
        tags:       Joi.array().items(Joi.string()).optional(),
        customData: Joi.object().optional(),
        assignedTo: Joi.string().hex().length(24).optional().allow('', null),
        nextFollowUpDate: Joi.date().optional().allow('', null)
    }),

    // Agent creation
    createAgent: Joi.object({
        name:     Joi.string().trim().min(2).max(100).required(),
        email:    Joi.string().email().lowercase().trim().required(),
        password: Joi.string().min(8).max(128).required()
    }),

    // ── Appointments ────────────────────────────────────────────────────────
    // Field names + formats verified against src/models/Appointment.js and
    // appointmentController.createAppointment.
    // NOTE: appointmentTime is a display string like "10:00 AM" — NOT 24h "HH:MM".
    // Constraining it to /^\d{2}:\d{2}$/ would reject every real booking.
    createAppointment: Joi.object({
        customerName:    Joi.string().trim().min(1).max(200).required(),
        customerPhone:   Joi.string().trim().min(5).max(20).required(),
        customerEmail:   Joi.string().email().lowercase().trim().optional().allow('', null),
        serviceType:     Joi.string().trim().min(1).max(200).required(),
        appointmentDate: Joi.date().required(),
        appointmentTime: Joi.string().trim().max(20).required(),
        notes:           Joi.string().trim().max(2000).optional().allow('', null),
        leadId:          Joi.string().hex().length(24).optional().allow('', null)
    }),

    // Partial update. Restricted to EXACTLY the five fields
    // appointmentController.updateAppointment actually reads — accepting more
    // would advertise an API contract the handler silently ignores.
    // `status` mirrors the model enum. `.min(1)` makes an empty PUT a 400
    // rather than a silent no-op.
    updateAppointment: Joi.object({
        status:          Joi.string().valid('Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show').optional(),
        notes:           Joi.string().trim().max(2000).optional().allow('', null),
        cancelledReason: Joi.string().trim().max(500).optional().allow('', null),
        appointmentDate: Joi.date().optional(),
        appointmentTime: Joi.string().trim().max(20).optional()
    }).min(1),

    // ── Voice templates ─────────────────────────────────────────────────────
    // `isGlobal` is intentionally absent: allowing it here would let any tenant
    // publish a template (and its call-driving basePrompt) into every workspace.
    // Only superAdminController.createGlobalVoiceTemplate may set it.
    createVoiceTemplate: Joi.object({
        name:             Joi.string().trim().min(1).max(150).required(),
        category:         Joi.string().trim().max(80).optional(),
        basePrompt:       Joi.string().trim().min(1).max(20000).required(),
        executionMode:    Joi.string().valid('static', 'injected', 'smart').optional(),
        voiceProfile:     Joi.string().trim().max(80).optional(),
        language:         Joi.string().trim().max(20).optional(),
        suggestedTrigger: Joi.string().trim().max(80).optional()
    }),

    // ── Agency clients (superadmin finance console) ─────────────────────────
    // Field names verified against src/models/AgencyClient.js — the money field
    // is `monthlyFee`, not `monthlyAmount`. `lastBilledDate` is excluded on
    // purpose: it is billing-engine state, not user input.
    updateAgencyClient: Joi.object({
        name:             Joi.string().trim().min(1).max(150).optional(),
        email:            Joi.string().email().lowercase().trim().optional().allow(''),
        phone:            Joi.string().trim().max(20).optional().allow(''),
        company:          Joi.string().trim().max(150).optional().allow(''),
        serviceType:      Joi.string().valid('seo', 'ads', 'social-media', 'web-dev', 'content', 'branding', 'other').optional(),
        monthlyFee:       Joi.number().min(0).max(100000000).optional(),
        requirements:     Joi.string().trim().max(5000).optional().allow(''),
        startDate:        Joi.date().optional().allow('', null),
        status:           Joi.string().valid('active', 'inactive', 'on-hold').optional(),
        notes:            Joi.string().trim().max(5000).optional().allow(''),
        billingAddress:   Joi.string().trim().max(500).optional().allow(''),
        gstNumber:        Joi.string().trim().max(20).optional().allow(''),
        billingDay:       Joi.number().integer().min(1).max(28).optional(),
        billingStartDate: Joi.date().optional().allow('', null)
    }).min(1),

    // ── Workflow engine (M-V9 import, M-V3 restore) ───────────────────────────
    // An import envelope is attacker-supplied JSON that becomes a workflow graph, so
    // it is bounded here as well as re-validated against the NodeRegistry in the
    // controller. `nodes`/`connections` stay loosely typed on purpose — their shape is
    // owned by the node schemas, and duplicating it here would drift.
    importWorkflow: Joi.object({
        schemaVersion: Joi.number().integer().min(1).max(1).required(),
        exportedAt:    Joi.string().isoDate().optional(),
        workflow: Joi.object({
            name:        Joi.string().trim().min(1).max(200).required(),
            description: Joi.string().trim().max(2000).optional().allow(''),
            trigger:     Joi.string().trim().max(50).required(),
            triggerConfig: Joi.object().unknown(true).optional(),
            nodes:       Joi.array().items(Joi.object({
                id:   Joi.string().trim().min(1).max(100).required(),
                type: Joi.string().trim().min(1).max(60).required(),
                name: Joi.string().trim().max(200).optional().allow(''),
                data: Joi.object().unknown(true).optional()
            }).unknown(true)).max(500).required(),
            connections: Joi.array().items(Joi.object({
                id:           Joi.string().trim().min(1).max(100).required(),
                sourceNodeId: Joi.string().trim().min(1).max(100).required(),
                sourcePort:   Joi.string().trim().max(100).optional().allow(''),
                targetNodeId: Joi.string().trim().min(1).max(100).required(),
                targetPort:   Joi.string().trim().max(100).optional().allow(''),
                label:        Joi.string().trim().max(200).optional().allow('')
            }).unknown(true)).max(2000).required(),
            variables: Joi.object().unknown(true).optional(),
            settings:  Joi.object({
                maxExecutionsPerLead: Joi.number().integer().min(0).max(1000).optional(),
                continueOnError:      Joi.boolean().optional(),
                timeoutHours:         Joi.number().integer().min(1).max(8760).optional()
            }).unknown(true).optional()
        }).required(),
        layout: Joi.object({
            nodePositions: Joi.object().unknown(true).optional(),
            viewport:      Joi.object().unknown(true).optional()
        }).allow(null).optional()
    }),

    // Restore takes its version from the URL path, so the body must be empty.
    restoreWorkflowVersion: Joi.object({}),

    // Rows 23 + 55: the plaintext credential arrives here once and is never returned.
    upsertWorkflowSecret: Joi.object({
        name:        Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{2,64}$/).required()
            .messages({ 'string.pattern.base': 'name must be 2-64 characters of A-Z, 0-9 or underscore' }),
        value:       Joi.string().min(1).max(8192).required(),
        description: Joi.string().trim().max(200).optional().allow('')
    })
};

module.exports = { validate, schemas };
