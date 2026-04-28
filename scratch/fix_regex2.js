const fs = require('fs');
let buf = fs.readFileSync('src/controllers/reportsController.js');
let content = buf.toString('utf8');

// In the actual file, \\s* is stored as the literal chars: backslash backslash s *
// We need to replace \\ (two chars) with \ (one char) only inside regex patterns

// Line 899: /Stage updated:\\s* ... \\u2192) ... /
// The file literally has \\s* meaning it matches "backslash then s" instead of whitespace

// Let's find and replace the specific broken regex lines
const line899Before = 'content.match(/Stage updated:\\\\s*(.*?)\\\\s*(?:\u2192|\u2794|->|=>|\u00bb|\u203a|>|\\\\u2192)\\\\s*(.*?)\\\\s*(?:by|$)/i)';
const line899After  = 'content.match(/Stage updated:\\s*(.*?)\\s*(?:\u2192|\u2794|->|=>|\u00bb|\u203a|>|\\u2192)\\s*(.*?)\\s*(?:by|$)/i)';

const line903Before = 'content.match(/Stage changed to\\\\s*(.*?)\\\\s*(?:by|$)/i)';
const line903After  = 'content.match(/Stage changed to\\s*(.*?)\\s*(?:by|$)/i)';

if (content.includes(line899Before)) {
    content = content.replace(line899Before, line899After);
    console.log('Fixed regex 1 (Stage updated)');
} else {
    console.log('ERROR: Regex 1 not found. Attempting hex dump of nearby content...');
    const idx = content.indexOf('Stage updated:');
    if (idx !== -1) {
        const snippet = content.substring(idx, idx + 120);
        console.log('Found at:', JSON.stringify(snippet));
    }
}

if (content.includes(line903Before)) {
    content = content.replace(line903Before, line903After);
    console.log('Fixed regex 2 (Stage changed to)');
} else {
    console.log('ERROR: Regex 2 not found');
    const idx = content.indexOf('Stage changed to');
    if (idx !== -1) {
        const snippet = content.substring(idx, idx + 80);
        console.log('Found at:', JSON.stringify(snippet));
    }
}

fs.writeFileSync('src/controllers/reportsController.js', content);
