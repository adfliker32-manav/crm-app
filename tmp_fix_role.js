const fs = require('fs');
const file = './src/models/User.js';
let content = fs.readFileSync(file, 'utf8');

// Replace the Enum array explicitly
content = content.replace(
    "['superadmin', 'manager', 'agent']", 
    "['superadmin', 'agency', 'manager', 'agent']"
);

// Replace the comment explicitly
content = content.replace(
    '// 👇 3-LAYER ROLE SYSTEM', 
    '// 👇 4-LAYER SAAS ROLE SYSTEM'
);

fs.writeFileSync(file, content);
console.log('User schema updated successfully with the Agency role.');
