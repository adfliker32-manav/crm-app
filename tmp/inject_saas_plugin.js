const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'models');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

files.forEach(file => {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    if (content.includes('saasPlugin')) {
        console.log(`Skipping ${file} - already injected`);
        return;
    }

    if (content.includes('module.exports = mongoose.model')) {
        // Regex to hunt the schema variable name from the module.exports declaration
        // Supports: module.exports = mongoose.model('User', userSchema);
        const match = content.match(/module\.exports\s*=\s*mongoose\.model\(['"\w]+,\s*(\w+)\)/);
        
        if (match && match[1]) {
            const schemaName = match[1];
            
            // Inject require right below the mongoose require (to keep things clean)
            if (content.includes("const mongoose = require('mongoose');")) {
                 content = content.replace("const mongoose = require('mongoose');", "const mongoose = require('mongoose');\nconst saasPlugin = require('./plugins/saasPlugin');");
            } else {
                 content = "const saasPlugin = require('./plugins/saasPlugin');\n" + content;
            }
            
            // Inject plugin application immediately above export
            content = content.replace(
                `module.exports = mongoose.model`,
                `${schemaName}.plugin(saasPlugin);\n\nmodule.exports = mongoose.model`
            );
            
            fs.writeFileSync(filePath, content);
            console.log(`✅ successfully injected saasPlugin into ${file}`);
        } else {
            console.log(`⚠️ Could not regex match schema name for ${file}`);
        }
    }
});
