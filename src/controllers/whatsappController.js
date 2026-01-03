// src/controllers/whatsappController.js
const whatsappService = require('../services/whatsappService');

const sendTestMessage = async (req, res) => {
    try {
        // Hum URL se phone number lenge (Testing ke liye aasaan rahega)
        // Example URL: http://localhost:3000/whatsapp/test?phone=919876543210
        const destinationPhone = req.query.phone; 

        if (!destinationPhone) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Please provide a phone number in URL. Example: ?phone=919876543210' 
            });
        }

        // Service ko call karo
        const result = await whatsappService.sendWhatsAppMessage(destinationPhone);

        // Success Response
        res.status(200).json({
            status: 'success',
            message: 'Message Sent Successfully! 🚀',
            data: result
        });

    } catch (error) {
        // Error Response
        res.status(500).json({
            status: 'failed',
            message: error.message
        });
    }
};

module.exports = { sendTestMessage };