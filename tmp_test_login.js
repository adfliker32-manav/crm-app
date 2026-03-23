const http = require('http');

const data = JSON.stringify({ email: 'karannabhani4840@gmail.com', password: 'Password123!' });
const options = {
    hostname: 'localhost', port: 5000, path: '/api/auth/login',
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
};

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        const json = JSON.parse(body);
        if (json.token) {
            console.log('Token: YES (len:', json.token.length + ')');
            // Decode JWT payload
            const payload = JSON.parse(Buffer.from(json.token.split('.')[1], 'base64').toString());
            console.log('JWT userId:', payload.userId);
            console.log('JWT role:', payload.role);
            console.log('JWT name:', payload.name);
        }
        if (json.user) {
            console.log('User ID:', json.user.id);
            console.log('User name:', json.user.name);
            console.log('User role:', json.user.role);
        }
        if (json.message) console.log('Message:', json.message);
    });
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
