require('dotenv').config();
require('mongoose').connect(process.env.MONGO_URI).then(async () => {
    const msg = await require('./src/models/WhatsAppMessage').findOne({ waMessageId: 'wamid.HBgMOTE5NDI3MTc3NjExFQIAERgSREZBOTgwNUU1MDU4N0I0RURBAA==' });
    console.log('LATEST_BROADCAST_MSG:', JSON.stringify(msg, null, 2));
    process.exit(0);
});
