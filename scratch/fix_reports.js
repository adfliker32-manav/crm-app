const fs = require('fs');
let c = fs.readFileSync('src/controllers/reportsController.js', 'utf8');

// 1. Remove dead ownerId variables (5 occurrences)
// They're all "const ownerId = castObjectId(req.tenantId);\n" followed by dataScope
let count = 0;
c = c.replace(/        const ownerId = castObjectId\(req\.tenantId\);\r?\n        const dataScope = getDataScope\(req\);/g, (match) => {
    count++;
    return '        const dataScope = getDataScope(req);';
});
console.log(`Removed ${count} dead ownerId declarations`);

// 2. Fix double-escaped regex on line 904
const brokenRegex1 = String.raw`content.match(/Stage updated:\\\\s*(.*?)\\\\s*(?:→|➔|->|=>|»|›|>|\\\\u2192)\\\\s*(.*?)\\\\s*(?:by|$)/i)`;
const fixedRegex1 = String.raw`content.match(/Stage updated:\s*(.*?)\s*(?:→|➔|->|=>|»|›|>|\u2192)\s*(.*?)\s*(?:by|$)/i)`;

if (c.includes(brokenRegex1)) {
    c = c.replace(brokenRegex1, fixedRegex1);
    console.log('Fixed regex 1 (Stage updated)');
} else {
    console.log('WARN: Regex 1 not found');
}

// 3. Fix double-escaped regex on line 908
const brokenRegex2 = String.raw`content.match(/Stage changed to\\\\s*(.*?)\\\\s*(?:by|$)/i)`;
const fixedRegex2 = String.raw`content.match(/Stage changed to\s*(.*?)\s*(?:by|$)/i)`;

if (c.includes(brokenRegex2)) {
    c = c.replace(brokenRegex2, fixedRegex2);
    console.log('Fixed regex 2 (Stage changed to)');
} else {
    console.log('WARN: Regex 2 not found');
}

fs.writeFileSync('src/controllers/reportsController.js', c);
console.log('DONE');
