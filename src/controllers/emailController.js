const nodemailer = require('nodemailer');

// ⚠️ Yahan apna Gmail aur App Password dalna mat bhulna
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'YOUR_EMAIL@gmail.com', // Apna Asli Gmail
        pass: 'xxxx xxxx xxxx xxxx'    // 16-digit App Password
    }
});

exports.sendWelcomeEmail = async (req, res) => {
    const { email, name } = req.body;
    if(!email) return res.status(400).json({ success: false, message: "Email missing" });

    const mailOptions = {
        from: '"CRM Pro" <YOUR_EMAIL@gmail.com>',
        to: email,
        subject: `Welcome ${name}! 🚀`,
        text: `Hello ${name},\n\nWelcome to our CRM. We are happy to have you!\n\nBest,\nTeam`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: "Email Sent!" });
    } catch (error) {
        console.error("Email Error:", error);
        res.status(500).json({ success: false, message: "Email Failed" });
    }
};