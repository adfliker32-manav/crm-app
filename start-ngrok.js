const ngrok = require('ngrok');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const AUTH_TOKEN = process.env.NGROK_AUTHTOKEN;

async function startTunnel() {
    console.log('🔌 Starting ngrok...');

    // Kill any old processes first
    try {
        await ngrok.kill();
        console.log('✅ Cleaned up old sessions');
    } catch (e) { }

    // Wait a moment
    await new Promise(r => setTimeout(r, 2000));

    try {
        const url = await ngrok.connect({
            addr: PORT,
            authtoken: AUTH_TOKEN
        });

        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('✅ SUCCESS! NGROK TUNNEL IS RUNNING!');
        console.log('═══════════════════════════════════════════════════');
        console.log('');
        console.log('🌐 Your Public URL:', url);
        console.log('');
        console.log('📋 FOR META WEBHOOK:');
        console.log('   Callback URL:  ' + url + '/api/meta/webhook');
        console.log('   Verify Token:  ' + (process.env.META_VERIFY_TOKEN || 'mysecretpassword123'));
        console.log('');
        console.log('🔍 Inspector: http://127.0.0.1:4040');
        console.log('═══════════════════════════════════════════════════');
        console.log('');
        console.log('⚠️  KEEP THIS TERMINAL OPEN!');

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.log('');
        console.log('💡 Try opening http://127.0.0.1:4040 in browser to see if tunnel exists');
    }
}

startTunnel();
