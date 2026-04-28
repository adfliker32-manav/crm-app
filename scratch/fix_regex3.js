const fs = require('fs');
let content = fs.readFileSync('src/controllers/reportsController.js', 'utf8');

// From the hex dump, the file has \\\\s* (4 backslashes + s + *)
// We need to find the exact byte pattern. Let's use indexOf to locate it
const searchPattern = 'Stage updated:';
const idx = content.indexOf(searchPattern);
if (idx === -1) {
    console.log('FATAL: Cannot find Stage updated');
    process.exit(1);
}

// Find the line containing this
const lineStart = content.lastIndexOf('\n', idx) + 1;
const lineEnd = content.indexOf('\n', idx);
const line = content.substring(lineStart, lineEnd);
console.log('Current line:', JSON.stringify(line));

// The broken part is within the match() call on the same line or next
const matchStart = content.indexOf('content.match(/Stage updated:', idx - 200);
const matchEnd = content.indexOf('/i);', matchStart) + 4;
const brokenMatch = content.substring(matchStart, matchEnd);
console.log('Broken match expression:', JSON.stringify(brokenMatch));

// Build the fixed version by replacing all instances of quadruple backslash + s with \s
let fixedMatch = brokenMatch;
// Replace \\\\s with \s (the file literally has 4 backslash chars before s)
while (fixedMatch.includes('\\\\\\\\s')) {
    fixedMatch = fixedMatch.replace('\\\\\\\\s', '\\s');
}
// Replace \\\\u with \u
while (fixedMatch.includes('\\\\\\\\u')) {
    fixedMatch = fixedMatch.replace('\\\\\\\\u', '\\u');
}

console.log('Fixed match expression:', JSON.stringify(fixedMatch));

content = content.replace(brokenMatch, fixedMatch);
fs.writeFileSync('src/controllers/reportsController.js', content);
console.log('DONE');
