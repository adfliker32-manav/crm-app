const User = require('../models/User');
const jwt = require('jsonwebtoken');

// @desc    Impersonate Client
// @route   GET /api/agency/impersonate/:clientId
// @access  Private (Agency Only)
const impersonateClient = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const { clientId } = req.params;

        // 1. Verify that the requested Client actually belongs to this Agency
        const client = await User.findOne({ _id: clientId, agencyId, role: 'manager' });

        if (!client) {
            return res.status(404).json({ message: "Client not found or unassigned to your Agency." });
        }

        // 2. Generate a specialized JWT.
        // We set the role to 'manager' so the Frontend and Backend treat this session exactly like the client.
        const payload = {
            userId: client._id,
            role: client.role, // 'manager'
            tenantId: client._id,
            permissions: client.permissions || {}
        };

        const impersonationToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });

        res.status(200).json({
            success: true,
            message: `Securely hijacking session for ${client.companyName || client.name}...`,
            token: impersonationToken,
            user: {
                _id: client._id,
                name: client.name,
                email: client.email,
                role: client.role,
                companyName: client.companyName,
                permissions: client.permissions,
                isImpersonated: true // Optional flag if the frontend wants a visual indicator
            }
        });

    } catch (error) {
        console.error("Impersonation Error:", error);
        res.status(500).json({ message: "Server error during session impersonation." });
    }
};

module.exports = {
    impersonateClient
};
