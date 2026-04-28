const fs = require('fs');
let content = fs.readFileSync('src/controllers/reportsController.js', 'utf8');

// Line 899 contains double-escaped \s patterns in a regex literal
// Find the line by its unique content prefix
const lines = content.split('\n');
let fixed = false;

for (let i = 0; i < lines.length; i++) {
    // Find the Stage updated regex line  
    if (lines[i].includes('Stage updated:') && lines[i].includes('.match(')) {
        console.log('BEFORE L' + (i+1) + ':', lines[i]);
        // Replace the entire line with the correct regex
        lines[i] = '            let match = content.match(/Stage updated:\\s*(.*?)\\s*(?:\u2192|\u2794|->|=>|\u00bb|\u203a|>|\\u2192)\\s*(.*?)\\s*(?:by|$)/i);';
        console.log('AFTER  L' + (i+1) + ':', lines[i]);
        fixed = true;
        break;
    }
}

if (!fixed) {
    console.log('ERROR: Could not find Stage updated regex line');
} else {
    content = lines.join('\n');
    fs.writeFileSync('src/controllers/reportsController.js', content);
    console.log('DONE - regex fixed');
}
