const Lead = require('../models/Lead');
const Stage = require('../models/Stage');
const axios = require('axios');
const Papa = require('papaparse');

// 1. GET LEADS (Only Current User's Leads)
// src/controllers/leadController.js

exports.getLeads = async (req, res) => {
    try {
        // 🕵️‍♂️ JASOOS (Debug Logs)
        console.log("-----------------------------------------");
        console.log("📡 API HIT: Get Leads");
        
        // Check 1: Kya User ID server tak pahunchi?
        console.log("🆔 User ID in Request:", req.user ? req.user.id : "❌ MISSING (Undefined)");

        // Agar User ID nahi hai, to wahi rok do
        if (!req.user || !req.user.id) {
            console.log("⛔ Error: User not identified.");
            return res.status(401).json({ error: "User identity missing" });
        }

        // Check 2: Database se kya maang rahe hain?
        const query = { userId: req.user.id };
        console.log("🔍 Searching DB with Query:", JSON.stringify(query));

        const leads = await Lead.find(query).sort({ date: -1 });
        
        console.log(`📦 Found: ${leads.length} leads for this user.`);
        console.log("-----------------------------------------");

        res.json(leads);
    } catch (err) {
        console.error("❌ ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
};
// 2. GET STAGES (User Specific)
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// 4. UPDATE LEAD
exports.updateLead = async (req, res) => {
    try {
        await Lead.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id }, 
            req.body
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// 5. DELETE LEAD (Iske na hone se Error aa raha tha shayad)
exports.deleteLead = async (req, res) => {
    try {
        await Lead.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ success: true, message: "Lead Deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
            const nameKey = keys.find(k => k.toLowerCase().includes('name')) || keys.find(k => k.toLowerCase().includes('customer'));
            const emailKey = keys.find(k => k.toLowerCase().includes('email'));
            const phoneKey = keys.find(k => k.toLowerCase().includes('phone'));

            const finalName = nameKey ? row[nameKey] : 'Unknown';
            const finalEmail = emailKey ? row[emailKey] : null;
            const finalPhone = phoneKey ? row[phoneKey] : 'No Phone';

            if (finalEmail || finalPhone !== 'No Phone') {
                let exists = null;
                if(finalEmail) {
                     exists = await Lead.findOne({ email: finalEmail, userId: req.user.id });
                }

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

    } catch (error) {
        console.error("❌ Sync Error:", error.message);
        res.status(500).json({ message: "Error syncing sheet." });
    }
};

// 7. ANALYTICS
exports.getAnalytics = async (req, res) => {
    try {
        const leads = await Lead.find({ userId: req.user.id });
        const stats = {};
        leads.forEach(lead => {
            const status = lead.status || 'New';
            if (stats[status]) stats[status]++;
            else stats[status] = 1;
        });
        res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
// 🔥 ADD NOTE
exports.addNote = async (req, res) => {
    try {
        const { text } = req.body;
        
        // Debug: Terminal me dekho request aayi ya nahi
        console.log(`📝 Adding Note... Lead ID: ${req.params.id} | User: ${req.user.id}`);

        const updatedLead = await Lead.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $push: { notes: { text: text, date: new Date() } } }, // Note push karo
            { new: true } // Updated data wapas do
        );

        if (!updatedLead) return res.status(404).json({ message: "Lead not found" });
        
        res.json(updatedLead);
    } catch (err) {
        console.error("❌ Note Error:", err.message); // Asli error yahan dikhega
        res.status(500).json({ error: err.message });
    }
};
// 🔥 9. CREATE LEAD (Manual Entry)
exports.createLead = async (req, res) => {
    try {
        const { name, email, phone } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ message: "Name and Phone are required" });
        }

        const newLead = await Lead.create({
            userId: req.user.id, // Security: Ye lead kiski hai?
            name,
            email,
            phone,
            status: 'New',
            source: 'Manual Entry' // Pata chale ki ye hath se dali gayi hai
        });

        res.json(newLead);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};