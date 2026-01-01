const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // 👇 यहाँ हमने लिंक सीधा लिख दिया है ताकि कोई कन्फ्यूजन न हो
        const conn = await mongoose.connect('mongodb://127.0.0.1:27017/my-business-crm');
        
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1); // अगर कनेक्ट नहीं हुआ तो सर्वर बंद
    }
};

module.exports = connectDB;