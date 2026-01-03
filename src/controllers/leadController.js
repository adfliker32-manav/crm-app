const Lead = require('../models/Lead');
const Stage = require('../models/Stage');
const axios = require('axios');
const Papa = require('papaparse');
const { sendWhatsAppMessage } = require('../services/whatsappService');

// 1. GET LEADS
exports.getLeads = async (req, res) => {
    try {
        console.log("-----------------------------------------");
        console.log("📡 API HIT: Get Leads");
        console.log("🆔 User ID in Request:", req.user ? req.user.id : "❌ MISSING");

        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: "User identity missing" });
        }

        const leads = await Lead.find({ userId: req.user.id }).sort({ date: -1 });
        res.json(leads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. GET STAGES
exports.getStages = async (req, res) => {
    try {
        let stages = await Stage.find({ userId: req.user.id }).sort('order');

        if (stages.length === 0) {
            const defaults = [
                { name: 'New', order: 1, userId: req.user.id },
                { name: 'Contacted', order: 2, userId: req.user.id },
                { name: 'Won', order: 3, userId: req.user.id }
            ];
            await Stage.insertMany(defaults);
            return res.json(defaults);
        }
        res.json(stages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. CREATE STAGE
exports.createStage = async (req, res) => {
    try {
        const newStage = await Stage.create({
            name: req.body.name,
            order: Date.now(),
            userId: req.user.id
        });
        res.json(newStage);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};



// 4. UPDATE LEAD
exports.updateLead = async (req, res) => {
    try {
        await Lead.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            req.body
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 5. DELETE LEAD
exports.deleteLead = async (req, res) => {
    try {
        await Lead.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 6. SYNC GOOGLE SHEET
exports.syncLeads = async (req, res) => {
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ message: "Link required" });

    try {
        const sheetId = sheetUrl.split('/d/')[1].split('/')[0];
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

        const response = await axios.get(csvUrl);
        const parsed = Papa.parse(response.data, { header: true, skipEmptyLines: true });

        let count = 0;
        for (const row of parsed.data) {
            const keys = Object.keys(row);
            const nameKey = keys.find(k => k.toLowerCase().includes('name'));
            const emailKey = keys.find(k => k.toLowerCase().includes('email'));
            const phoneKey = keys.find(k => k.toLowerCase().includes('phone'));

            const finalName = nameKey ? row[nameKey] : 'Unknown';
            const finalEmail = emailKey ? row[emailKey] : null;
            const finalPhone = phoneKey ? row[phoneKey] : 'No Phone';

            if (finalEmail || finalPhone !== 'No Phone') {
                const exists = finalEmail
                    ? await Lead.findOne({ email: finalEmail, userId: req.user.id })
                    : null;

                if (!exists) {
                    await Lead.create({
                        userId: req.user.id,
                        name: finalName,
                        email: finalEmail,
                        phone: finalPhone,
                        source: 'Google Sheet',
                        status: 'New'
                    });
                    count++;
                }
            }
        }

        res.json({ success: true, message: `${count} New Leads Imported!` });
    } catch (err) {
        res.status(500).json({ message: "Error syncing sheet." });
    }
};

// 7. ANALYTICS
exports.getAnalytics = async (req, res) => {
    try {
        const leads = await Lead.find({ userId: req.user.id });
        const stats = {};
        leads.forEach(l => {
            stats[l.status || 'New'] = (stats[l.status || 'New'] || 0) + 1;
        });
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 8. ADD NOTE
exports.addNote = async (req, res) => {
    try {
        const { text } = req.body;

        const updatedLead = await Lead.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $push: { notes: { text, date: new Date() } } },
            { new: true }
        );

        if (!updatedLead) {
            return res.status(404).json({ message: "Lead not found" });
        }

        res.json(updatedLead);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 9. CREATE LEAD (MERGED EXACTLY AS ASKED)
exports.createLead = async (req, res) => {
    try {
        const { name, email, phone } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ message: "Name and Phone are required" });
        }

        const newLead = await Lead.create({
            userId: req.user.id,
            name,
            email,
            phone,
            status: 'New',
            source: 'Manual Entry'
        });

        // ... (Upar save wala code) ...
        await newLead.save();

        // WhatsApp: send welcome message (non-blocking)
        try {
            sendWhatsAppMessage(phone, name).catch(err => console.warn('WhatsApp send failed:', err.message));
        } catch (err) {
            console.warn('WhatsApp error:', err.message);
        }

        res.json(newLead);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


