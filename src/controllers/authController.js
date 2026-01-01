const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Secret Key (Isse hum baad me .env me daalenge)
const JWT_SECRET = 'meri-secret-key-123'; 

// 1. REGISTER (Naya Account)
exports.register = async (req, res) => {
    try {
        const { name, email, password, companyName } = req.body;

        // Check karo user pehle se to nahi hai?
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ message: "User already exists" });

        // Password ko Encrypt karo (Security) 🔒
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Naya user banao
        user = await User.create({
            name,
            email,
            password: hashedPassword, // Asli password save nahi karte!
            companyName
        });

        // Token banao (Digital Pass)
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });

        res.json({ token, user: { id: user._id, name: user.name, email: user.email } });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. LOGIN (Purana User)
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // User dhundo
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "Invalid Email or Password" });

        // Password match karo
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid Email or Password" });

        // Token do
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });

        res.json({ token, user: { id: user._id, name: user.name, email: user.email } });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};