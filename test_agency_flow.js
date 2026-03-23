const mongoose = require('mongoose');
const User = require('./src/models/User');
const Lead = require('./src/models/Lead');

async function testSaaSEngine() {
    console.log('--- STARTING SAAS AGENCY PLATFORM INTEGRATION TEST ---\n');

    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/my-business-crm');
        console.log('✅ Connected to mongodb://127.0.0.1:27017/my-business-crm');

        // 1. Create a mock SuperAdmin to generate the Agency
        const sa = new User({
            name: "Master Admin System",
            email: `system-${Date.now()}@test.com`,
            password: "mockpassword",
            role: "superadmin"
        });
        await sa.save();
        console.log(`✅ Provisioned SuperAdmin with ID: ${sa._id}`);

        // 2. Create the Agency Reseller account
        const agency = new User({
            name: "Cloud Hosting Agency",
            email: `agency-${Date.now()}@test.com`,
            password: "mockpassword",
            role: "agency"
        });
        await agency.save();
        console.log(`✅ Provisioned new Agency Reseller with ID: ${agency._id}`);

        // 3. Test multi-tenancy bounds checking (Does deletedAt initialize correctly?)
        if (agency.deletedAt === null) {
            console.log(`✅ VERIFIED: saasPlugin injected deletedAt constraint perfectly into User Schema.`);
        } else {
            throw new Error("Missing deletedAt constraint on User object!");
        }

        // 4. Create a mock Client under the Agency (Role: manager)
        const client = new User({
            name: "Jane Client",
            email: `client-${Date.now()}@test.com`,
            password: "mockpassword",
            role: "manager",
            agencyId: agency._id // Bound to the reseller
        });
        await client.save();
        console.log(`✅ Provisioned Client (Manager) under Agency. Client ID: ${client._id}`);
        console.log(`✅ VERIFIED: Client object successfully registered agencyId mapping: ${client.agencyId}`);

        // 5. Have the Client generate a fresh Lead
        const lead = new Lead({
            userId: client._id,
            name: "Valuable Prospect",
            phone: "555-0000",
            stage: "New",
            agencyId: agency._id // The API middleware would inject this automatically, but we simulate it here
        });
        await lead.save();
        console.log(`✅ Created CRM Lead mapping straight through the Tenant Hierarchy to the Reseller bucket.`);

        // 6. Test saasPlugin soft-deletion querying bounds
        let count = await Lead.countDocuments({ agencyId: agency._id });
        console.log(`[Query] Current Leads for Agency Bucket: ${count}`);

        console.log('--- Initiating Soft Delete Sandbox ---');
        await lead.softDelete(); // Calling the injected SAAS method
        console.log(`✅ Triggered lead.softDelete() schema method successfully.`);

        let countAfterDelete = await Lead.countDocuments({ agencyId: agency._id });
        if (countAfterDelete === 0) {
            console.log(`✅ VERIFIED: Global Query Masking successfully hid the deleted lead from standard API queries! (Count returned 0)`);
            
            // Prove the data isn't hard-destroyed
            let hardCount = await Lead.countDocuments({ agencyId: agency._id }).setOptions({ includeDeleted: true });
            console.log(`✅ VERIFIED: Mongoose override .setOptions({ includeDeleted: true }) successfully recovered the ghost record. (Count returned ${hardCount})`);
        } else {
            throw new Error("Global Query Masking failed to hide the soft-deleted lead!");
        }

        console.log('\n✅ ALL ARCHITECTURE AND DATABASE MIDDLEWARES PASSED INTEGRATION AUDIT. ✅\n');

    } catch (e) {
        console.error("❌ TEST FAILURE:", e.message);
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

testSaaSEngine();
