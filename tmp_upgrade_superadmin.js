const fs = require('fs');
const file = './src/controllers/superAdminController.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Upgrade all User.find and User.countDocuments targeting 'manager'
// Example: { role: 'manager' } -> { role: { $in: ['manager', 'agency'] } }
content = content.replace(/{ role: 'manager' }/g, "{ role: { $in: ['manager', 'agency'] } }");
content = content.replace(/{ role: "manager" }/g, "{ role: { $in: ['manager', 'agency'] } }");

// 2. Modify createCompany explicitly to accept req.body.role
content = content.replace(
    "role: 'manager',",
    "role: req.body.role === 'agency' ? 'agency' : 'manager',"
);

// 3. Fix any single document queries like User.findOne({ _id: id, role: 'manager' })
content = content.replace(
    /{ _id: id, role: 'manager' }/g,
    "{ _id: id, role: { $in: ['manager', 'agency'] } }"
);

fs.writeFileSync(file, content);
console.log('superAdminController seamlessly upgraded for Agency architecture.');
