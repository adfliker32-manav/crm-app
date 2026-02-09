const { spawn, exec } = require('child_process');
const path = require('path');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const AUTH_TOKEN = process.env.NGROK_AUTHTOKEN;
const BIN_PATH = path.join(__dirname, 'node_modules', 'ngrok', 'bin', 'ngrok.exe');

async function startTunnel() {
    console.log('🔌 Starting ngrok manually...');

    // Kill any old processes first
    await new Promise(resolve => {
        exec('taskkill /F /IM ngrok.exe', () => resolve());
    });
    console.log('✅ Cleaned up old sessions');

    // Wait a moment
    await new Promise(r => setTimeout(r, 1000));

    const args = ['http', PORT, '--log=stdout'];
    if (AUTH_TOKEN) {
        args.push('--authtoken', AUTH_TOKEN);
    }

    const child = spawn(BIN_PATH, args);

    child.stdout.on('data', (data) => {
        const line = data.toString();
        // Check for URL
        const match = line.match(/url=(https:\/\/[^ ]+)/);
        if (match) {
            const url = match[1];
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
        }
    });

    child.stderr.on('data', (data) => {
        // console.error(`stderr: ${data}`);
    });

    child.on('close', (code) => {
        console.log(`ngrok process exited with code ${code}`);
    });

    child.on('error', (err) => {
        console.error('Failed to start ngrok:', err);
    });
}

startTunnel();
