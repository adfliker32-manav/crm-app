const axios = require('axios');

async function runTest() {
    try {
        console.log("Logging in as Super Admin...");
        const loginRes = await axios.post('http://localhost:5000/api/auth/login', {
            email: 'superadmin@crm.com',
            password: 'SuperSecure123!'
        });
        
        const token = loginRes.data.token;
        console.log("Token obtained:", token.substring(0, 20) + "...");
        
        const headers = { Authorization: `Bearer ${token}` };

        console.log("Fetching /api/leads/analytics-data...");
        const stats = await axios.get('http://localhost:5000/api/leads/analytics-data', { headers });
        console.log("Stats Success:");
        
        console.log("Fetching /api/leads/follow-up-today...");
        const followUps = await axios.get('http://localhost:5000/api/leads/follow-up-today', { headers });
        console.log("FollowUps Success");
        
        console.log("Fetching /api/tasks?status=Pending&dateFilter=today...");
        const tasks = await axios.get('http://localhost:5000/api/tasks?status=Pending&dateFilter=today', { headers });
        console.log("Tasks Success:", tasks.data);
        
    } catch(err) {
        if(err.response) {
            console.error("API ERROR:", err.response.status, err.response.data);
        } else {
            console.error("NETWORK ERROR:", err.message);
        }
    }
}

runTest();
