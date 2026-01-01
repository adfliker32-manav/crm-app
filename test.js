const axios = require('axios');

// यहाँ अपनी Google Sheet का लिंक पेस्ट करें (नीचे वाली लाइन में) 👇
const mySheetLink = "https://docs.google.com/spreadsheets/d/1YO8k_XSx66yS0OePOFoHWM8uWo_CyyPwLhjrtcvjgUo/edit?usp=sharing"; 

async function testMyServer() {
    console.log("🟡 Button dabaya... (Sending Request)");

    try {
        // यह कोड हमारे अपने ही सर्वर को कॉल कर रहा है (जैसे वेबसाइट का बटन करता)
        const response = await axios.post('http://localhost:3000/api/sync-sheet', {
            sheetUrl: mySheetLink
        });

        console.log("🟢 Success! Server ne bola:", response.data);

    } catch (error) {
        console.log("🔴 Oops! Error:", error.response ? error.response.data : error.message);
    }
}

testMyServer();