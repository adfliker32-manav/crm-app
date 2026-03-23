const path = require('path');
// Mock environment
process.env.WA_PHONE_NUMBER_ID = 'test_id_123';
process.env.Phone_Number_ID = 'test_id_123';

// Mock User Model
const User = {
    findOne: async (query) => {
        console.log('User.findOne called with:', query);
        if (query.role === 'superadmin') {
            return { _id: 'superadmin_id', name: 'Super Admin', role: 'superadmin' };
        }
        return null; // Simulate no user found by waPhoneNumberId
    }
};

// Simple mock for the controller logic
async function testProcessEntry(phoneNumberId) {
    console.log('Testing processEntry with ID:', phoneNumberId);
    
    // Equivalent logic from controller
    let user = await User.findOne({ waPhoneNumberId: phoneNumberId });
    
    if (!user) {
        const globalPhoneId = process.env.WA_PHONE_NUMBER_ID || process.env.Phone_Number_ID;
        if (phoneNumberId && globalPhoneId && phoneNumberId === globalPhoneId) {
            console.log(`ℹ️ No user found by ID, but matches environment ID. Falling back to Super Admin.`);
            user = await User.findOne({ role: 'superadmin' });
        }
    }

    if (!user) {
        console.log(`⚠️ No user found for phone number ID: ${phoneNumberId}`);
        return null;
    }

    console.log('✅ Result:', user.name);
    return user;
}

async function runTests() {
    console.log('--- Test 1: Matching ID ---');
    await testProcessEntry('test_id_123');
    
    console.log('\n--- Test 2: Non-matching ID ---');
    await testProcessEntry('wrong_id');
}

runTests();
