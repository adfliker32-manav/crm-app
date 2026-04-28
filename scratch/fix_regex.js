const fs = require('fs');
const c = fs.readFileSync('src/controllers/reportsController.js', 'utf8');

// Find the double-escaped regex lines
const lines = c.split('\n');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('\\\\s*')) {
        console.log(`Line ${i+1}: ${lines[i].trim()}`);
    }
}

// Fix: replace \\\\s* with \\s* and \\\\u2192 with \\u2192
let fixed = c;
// Count occurrences
const count1 = (fixed.match(/\\\\s\*/g) || []).length;
console.log(`\nFound ${count1} occurrences of double-escaped \\\\s*`);

fixed = fixed.replace(/\\\\\\\\s\*/g, '\\s*');
fixed = fixed.replace(/\\\\\\\\u2192/g, '\\u2192');

const count2 = (fixed.match(/\\\\s\*/g) || []).length;
console.log(`After fix: ${count2} occurrences remain`);

fs.writeFileSync('src/controllers/reportsController.js', fixed);
console.log('DONE');
