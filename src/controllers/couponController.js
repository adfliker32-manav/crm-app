const Coupon = require('../models/Coupon');
const WorkspaceSettings = require('../models/WorkspaceSettings');

// ─── Shared validation helper ──────────────────────────────────────────────
// Returns the coupon doc or throws a tagged error. Used internally by
// both the dry-run validate endpoint and the apply/subscribe paths.
const validateCode = async (code, planCode = null) => {
    const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });
    if (!coupon) {
        const e = new Error('Invalid coupon code'); e.status = 400; throw e;
    }
    if (!coupon.isActive) {
        const e = new Error('This coupon is no longer active'); e.status = 400; throw e;
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        const e = new Error('This coupon has expired'); e.status = 400; throw e;
    }
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
        const e = new Error('This coupon has reached its usage limit'); e.status = 400; throw e;
    }
    if (planCode && coupon.applicablePlanCodes.length > 0) {
        if (!coupon.applicablePlanCodes.includes(planCode.toLowerCase())) {
            const e = new Error('This coupon is not valid for the selected plan'); e.status = 400; throw e;
        }
    }
    return coupon;
};

// ─── SuperAdmin: list all coupons ──────────────────────────────────────────
const listCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find({}).sort({ createdAt: -1 }).lean();
        res.json({ success: true, coupons });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ─── SuperAdmin: create coupon ──────────────────────────────────────────────
const createCoupon = async (req, res) => {
    try {
        const {
            code, description, type,
            discountType, discountValue,
            extensionDays,
            applicablePlanCodes, maxUses, expiresAt, isActive
        } = req.body;

        if (!code || !type) return res.status(400).json({ message: 'code and type are required' });
        if (type === 'discount' && (!discountType || !discountValue)) {
            return res.status(400).json({ message: 'discountType and discountValue are required for discount coupons' });
        }
        // A percentage discount above 100% would compute a negative charge — reject it.
        if (type === 'discount' && discountType === 'percentage' && Number(discountValue) > 100) {
            return res.status(400).json({ message: 'Percentage discount cannot exceed 100%' });
        }
        if (type === 'trial_extension' && !extensionDays) {
            return res.status(400).json({ message: 'extensionDays is required for trial extension coupons' });
        }

        const coupon = await Coupon.create({
            code: code.toUpperCase().trim(),
            description: description || '',
            type,
            discountType:   type === 'discount' ? discountType : null,
            discountValue:  type === 'discount' ? Number(discountValue) : 0,
            extensionDays:  type === 'trial_extension' ? Number(extensionDays) : 0,
            applicablePlanCodes: (applicablePlanCodes || []).map(c => c.toLowerCase()),
            maxUses:    Number(maxUses || 0),
            expiresAt:  expiresAt ? new Date(expiresAt) : null,
            isActive:   isActive !== false
        });

        res.status(201).json({ success: true, coupon });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ message: 'Coupon code already exists' });
        res.status(500).json({ message: err.message });
    }
};

// ─── SuperAdmin: update coupon ──────────────────────────────────────────────
const updateCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findById(req.params.id);
        if (!coupon) return res.status(404).json({ message: 'Coupon not found' });

        const allowed = [
            'description', 'discountType', 'discountValue', 'extensionDays',
            'applicablePlanCodes', 'maxUses', 'expiresAt', 'isActive'
        ];
        for (const k of allowed) {
            if (req.body[k] !== undefined) coupon[k] = req.body[k];
        }
        // Same guard as create: a percentage discount can't exceed 100%.
        if (coupon.discountType === 'percentage' && Number(coupon.discountValue) > 100) {
            return res.status(400).json({ message: 'Percentage discount cannot exceed 100%' });
        }
        await coupon.save();
        res.json({ success: true, coupon });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ─── SuperAdmin: delete coupon ──────────────────────────────────────────────
const deleteCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndDelete(req.params.id);
        if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ─── Client: validate coupon (dry-run, no DB writes) ──────────────────────
// Returns discount/extension preview so the UI can show the effect before
// the user commits to subscribing.
const validateCoupon = async (req, res) => {
    try {
        if (req.user?.role !== 'manager') {
            return res.status(403).json({ message: 'Billing access is manager-only' });
        }
        const { code, planCode } = req.body;
        if (!code) return res.status(400).json({ message: 'code is required' });

        const coupon = await validateCode(code, planCode);
        const resp = {
            success: true,
            type: coupon.type,
            description: coupon.description,
            // Expose plan restriction so the pricing page can scope the discount badge
            // to applicable plans only (empty = applies to all).
            applicablePlanCodes: coupon.applicablePlanCodes || []
        };
        if (coupon.type === 'discount') {
            resp.discountType  = coupon.discountType;
            resp.discountValue = coupon.discountValue;
        } else {
            resp.extensionDays = coupon.extensionDays;
        }
        res.json(resp);
    } catch (err) {
        res.status(err.status || 400).json({ message: err.message });
    }
};

// ─── Client: apply trial_extension coupon from Billing page ───────────────
// Discount coupons are applied at subscribe time (Plans page → billingController).
// This endpoint handles only trial_extension — it writes directly to planExpiryDate.
const applyCoupon = async (req, res) => {
    try {
        if (req.user?.role !== 'manager') {
            return res.status(403).json({ message: 'Billing access is manager-only' });
        }
        const { code, planCode } = req.body;
        if (!code) return res.status(400).json({ message: 'code is required' });

        // Pass planCode so plan-restricted coupons are checked against the tenant's current plan
        const coupon = await validateCode(code, planCode || null);

        if (coupon.type !== 'trial_extension') {
            return res.status(400).json({
                message: 'This is a discount coupon — apply it on the Plans page when subscribing.'
            });
        }

        const ws = await WorkspaceSettings.findOne({ userId: req.tenantId });
        if (!ws) return res.status(404).json({ message: 'Workspace not found' });

        // Atomic conditional increment: claim the slot before writing the workspace
        // update, so concurrent requests for a maxUses=1 coupon can't both succeed.
        const claimed = await Coupon.findOneAndUpdate(
            {
                _id: coupon._id,
                isActive: true,
                $or: [{ maxUses: 0 }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }]
            },
            { $inc: { usedCount: 1 } }
        );
        if (!claimed) {
            return res.status(400).json({ message: 'This coupon has reached its usage limit' });
        }

        const now  = new Date();
        const base = ws.planExpiryDate && new Date(ws.planExpiryDate) > now
            ? new Date(ws.planExpiryDate)
            : now;
        const newExpiry = new Date(base.getTime() + coupon.extensionDays * 24 * 60 * 60 * 1000);

        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { planExpiryDate: newExpiry, subscriptionStatus: 'active' } }
        );

        res.json({ success: true, extensionDays: coupon.extensionDays, newExpiryDate: newExpiry });
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message });
    }
};

module.exports = {
    listCoupons,
    createCoupon,
    updateCoupon,
    deleteCoupon,
    validateCoupon,
    applyCoupon,
    validateCode
};
