const axios = require('axios');

const registerUser = async () => {
    try {
        console.log("Attempting registration with valid data...");
        const response = await axios.post('http://localhost:5000/api/auth/register', {
            name: "Test User",
            email: "testuser" + Date.now() + "@example.com",
            password: "password123"
        });
        console.log("Registration Success:", response.data);
    } catch (error) {
        console.error("Registration Failed:", error.response ? error.response.data : error.message);
    }

    try {
        console.log("\nAttempting registration with missing name...");
        await axios.post('http://localhost:5000/api/auth/register', {
            email: "fail" + Date.now() + "@example.com",
            password: "password123"
        });
    } catch (error) {
        console.error("Expected Failure (Missing Name):", error.response ? error.response.data : error.message);
    }
};

registerUser();
