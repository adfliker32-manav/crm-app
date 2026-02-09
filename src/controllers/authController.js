const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. REGISTER (Naya Account)
exports.register = async (req, res) => {
    console.log("Register endpoint hit");
    try {
        const { name, email, password, companyName, industry, teamSize, phone } = req.body;
        console.log("Request body:", { name, email, password, companyName });

        // SECURITY FIX: Input validation
        if (!name || !name.trim()) {
            console.log("Validation failed: Name required");
            return res.status(400).json({ message: "Name is required" });
        }
        if (!email || !email.trim()) {
            console.log("Validation failed: Email required");
            return res.status(400).json({ message: "Email is required" });
        }
        if (!password || password.length < 6) {
            console.log("Validation failed: Password length");
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }

        // SECURITY FIX: Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.log("Validation failed: Email format");
            return res.status(400).json({ message: "Invalid email format" });
        }

        // Check karo user pehle se to nahi hai?
        console.log("Checking if user exists...");
        let user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user) {
            console.log("User already exists");
            return res.status(400).json({ message: "User already exists" });
        }

        // Password ko Encrypt karo 🔒
        console.log("Hashing password...");
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Naya user banao (Default role: manager)
        console.log("Creating user...");
        user = await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            companyName: companyName ? companyName.trim() : undefined,
            industry: industry || undefined,
            teamSize: teamSize || undefined,
            phone: phone || undefined,
            role: 'manager' // By default naya banda Manager banega
        });
        console.log("User created:", user._id);

        // 🔥 Token Payload (Isme Role daalna zaroori hai)
        const payload = {
            userId: user._id,
            role: user.role,
            name: user.name
        };

        // SECURITY FIX: Require JWT_SECRET from environment
        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) {
            console.error("JWT_SECRET missing");
            return res.status(500).json({ error: 'Server configuration error' });
        }

        console.log("Signing token...");
        const token = jwt.sign(
            payload,
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({ token, role: user.role, user: { id: user._id, name: user.name } });

    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
};

// 2. LOGIN (Purana User)
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // SECURITY FIX: Input validation
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // User dhundo
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(400).json({ message: "Invalid Email or Password" });

        // Password match karo
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid Email or Password" });

        // 🔥 Token Payload (Yahan Magic Hoga)
        // Hum Token ke andar likh rahe hain ki ye banda 'superadmin' hai ya 'manager'
        const payload = {
            userId: user._id,
            role: user.role,
            name: user.name,
            permissions: user.permissions // Include permissions for Agents
        };

        // SECURITY FIX: Require JWT_SECRET from environment
        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = jwt.sign(
            payload,
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        // Frontend ko bhi batao ki role kya hai
        res.json({
            token,
            role: user.role,
            user: { id: user._id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
// ... Upar register aur login waisa hi rahega ...

// 3. CREATE AGENT (Manager apne neeche employee banayega)
exports.createAgent = async (req, res) => {
    try {
        const { name, email, password, permissions } = req.body;
        const { BASIC_AGENT } = require('../constants/permissionPresets');

        // 1. Check permission (Sirf Manager hi Agent bana sakta hai)
        // (Waise middleware bhi check karega, par double safety sahi hai)
        if (req.user.role !== 'manager') {
            return res.status(403).json({ message: "Only Managers can create Agents" });
        }

        // 2. Check duplicate email
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ message: "User already exists" });

        // 3. Password Encrypt
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Use provided permissions or default to BASIC_AGENT preset
        const agentPermissions = permissions || BASIC_AGENT;

        // 5. Create Agent Linked to Manager
        user = await User.create({
            name,
            email,
            password: hashedPassword,
            role: 'agent',            // Role fix hai
            parentId: req.user.userId, // Manager ka ID yahan save hoga
            permissions: agentPermissions // Add permissions
        });

        res.json({
            success: true,
            message: "Agent Created Successfully!",
            agent: {
                id: user._id,
                name: user.name,
                email: user.email,
                permissions: user.permissions
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
// 4. GET MY TEAM (Manager apne agents dekhega)
// 5. DELETE AGENT (Manager apne agent ko remove kar sakta hai)
exports.deleteAgent = async (req, res) => {
    try {
        const agentId = req.params.id;

        // Verify requester is a manager (Double check, although middleware handles role)
        if (req.user.role !== 'manager') {
            return res.status(403).json({ message: "Only Managers can delete Agents" });
        }

        // Find the agent and ensure they belong to this manager
        const agent = await User.findOne({ _id: agentId, parentId: req.user.userId });

        if (!agent) {
            return res.status(404).json({ message: "Agent not found or does not belong to you" });
        }

        // Delete the agent
        await User.findByIdAndDelete(agentId);

        res.json({ success: true, message: "Agent deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 5.5 UPDATE AGENT (Manager updates agent permissions/details)
exports.updateAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, permissions, password } = req.body;

        // Only managers can update agents
        if (req.user.role !== 'manager') {
            return res.status(403).json({ message: "Only managers can update agents" });
        }

        // Find agent and ensure they belong to this manager
        const agent = await User.findOne({ _id: id, parentId: req.user.userId, role: 'agent' });

        if (!agent) {
            return res.status(404).json({ message: "Agent not found or does not belong to you" });
        }

        // Update fields
        const updateData = {};
        if (name) updateData.name = name;
        if (permissions) updateData.permissions = permissions;

        // Handle password update
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ message: "Password must be at least 6 characters" });
            }
            const salt = await bcrypt.genSalt(10);
            updateData.password = await bcrypt.hash(password, salt);
        }

        const updatedAgent = await User.findByIdAndUpdate(id, updateData, { new: true })
            .select('-password');

        res.json({
            success: true,
            message: "Agent updated successfully",
            agent: updatedAgent
        });

    } catch (err) {
        console.error("Update Agent Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// 6. GET MY TEAM
exports.getMyTeam = async (req, res) => {
    try {
        // Sirf wo users dhundo jinka 'parentId' logged-in user (Manager) hai
        const agents = await User.find({ parentId: req.user.userId }).select('-password'); // Password mat bhejna
        res.json(agents);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 6. UPDATE PROFILE (User apna naam/password change kar sakta hai)
exports.updateProfile = async (req, res) => {
    try {
        const { name, password } = req.body;
        const userId = req.user.userId;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (name && name.trim()) {
            user.name = name.trim();
        }

        if (password && password.trim()) {
            if (password.length < 6) {
                return res.status(400).json({ message: "Password must be at least 6 characters" });
            }
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();

        res.json({ success: true, message: "Profile updated successfully", user: { id: user._id, name: user.name, email: user.email } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 7. GET PUBLIC PLANS (For viewing subscription plans)
exports.getPlans = async (req, res) => {
    try {
        const SubscriptionPlan = require('../models/SubscriptionPlan');
        const plans = await SubscriptionPlan.find({ isActive: true }).sort({ price: 1 });
        res.json({ success: true, plans });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 8. GET APP NAME (Public - no auth required)
exports.getAppName = async (req, res) => {
    try {
        const GlobalSetting = require('../models/GlobalSetting');
        const appNameSetting = await GlobalSetting.findOne({ key: 'app_name' });
        res.json({
            success: true,
            appName: appNameSetting?.value || 'CRM Pro'
        });
    } catch (err) {
        console.error(err);
        res.json({ success: true, appName: 'CRM Pro' }); // Fallback on error
    }
};