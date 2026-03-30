require('dotenv').config();
const mongoose = require('mongoose');

async function test() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const User = require('./src/models/User');
        const pendingUsers = await User.find({ status: 'pending' }).lean();
        console.log("Pending Uses:", pendingUsers.length);
        console.log(JSON.stringify(pendingUsers.map(u => ({
            _id: u._id,
            email: u.email,
            role: u.role,
            status: u.status,
            parentId: u.parentId
        })), null, 2));

        const allManagers = await User.find({ role: 'manager' }).sort({createdAt: -1}).limit(3).lean();
        console.log("\nRecent Managers:", allManagers.length);
        console.log(JSON.stringify(allManagers.map(u => ({
            _id: u._id,
            email: u.email,
            role: u.role,
            status: u.status,
            accountStatus: u.accountStatus,
            parentId: u.parentId
        })), null, 2));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
