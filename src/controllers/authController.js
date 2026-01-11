const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. REGISTER (Naya Account)
exports.register = async (req, res) => {
    try {
        const { name, email, password, companyName } = req.body;

        // SECURITY FIX: Input validation
        if (!name || !name.trim()) {
            return res.status(400).json({ message: "Name is required" });
        }
        if (!email || !email.trim()) {
            return res.status(400).json({ message: "Email is required" });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }
        
        // SECURITY FIX: Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        // Check karo user pehle se to nahi hai?
        let user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user) return res.status(400).json({ message: "User already exists" });

        // Password ko Encrypt karo 🔒
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Naya user banao (Default role: manager)
        user = await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            companyName: companyName ? companyName.trim() : undefined,
            role: 'manager' // By default naya banda Manager banega
        });

        // 🔥 Token Payload (Isme Role daalna zaroori hai)
        const payload = {
            userId: user._id,
            role: user.role
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

        res.json({ token, role: user.role, user: { id: user._id, name: user.name } });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
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
            role: user.role || 'manager' // Agar role missing ho to manager maan lo
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
            user: { id: user._id, name: user.name, email: user.email } 
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
        const { name, email, password } = req.body;

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

        // 4. Create Agent Linked to Manager
        user = await User.create({
            name,
            email,
            password: hashedPassword,
            role: 'agent',            // Role fix hai
            parentId: req.user.userId // Manager ka ID yahan save hoga
        });

        res.json({ success: true, message: "Agent Created Successfully!", agent: { id: user._id, name: user.name } });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
// 4. GET MY TEAM (Manager apne agents dekhega)
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