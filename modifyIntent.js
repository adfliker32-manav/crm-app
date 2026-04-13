const fs = require('fs');

const path = 'c:/Users/Admin/Desktop/my-business102_22_feb/my-business102/src/services/chatbotEngineService.js';
let content = fs.readFileSync(path, 'utf8');

const search = `        // 1. Keyword Flow Match (Case-Insensitive & Boundary matched)
        targetFlow = allActiveFlows.find(f => {
            if (f.triggerType !== 'keyword' || !f.triggerKeywords || f.triggerKeywords.length === 0) return false;
            
            return f.triggerKeywords.some(k => {
                const kl = k.toLowerCase().trim();
                // Check exact match or word boundary regex (handles if keyword is part of a larger sentence)
                if (messageText === kl) return true;
                try {
                    const regex = new RegExp(\`\\\\b\${kl}\\\\b\`, 'i');
                    return regex.test(messageText);
                } catch (e) {
                    return messageText.includes(kl); // Fallback for special characters
                }
            });
        });`;

const replace = `        // Function to calculate Levenshtein distance for typo tolerance
        const getLevenshteinDistance = (a, b) => {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;
            const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
            for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
            for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
                }
            }
            return matrix[a.length][b.length];
        };

        // 1. Fuzzy Keyword Flow Match (Intent parsing with typo-tolerance)
        targetFlow = allActiveFlows.find(f => {
            if (f.triggerType !== 'keyword' || !f.triggerKeywords || f.triggerKeywords.length === 0) return false;
            
            const wordsInMessage = messageText.split(/\\s+/);
            
            return f.triggerKeywords.some(k => {
                const kl = k.toLowerCase().trim();
                
                // Exact or inclusion match
                if (messageText.includes(kl)) return true;
                
                // Fuzzy match for typo tolerance (distance of 1 for short words, 2 for longer words)
                // We compare the keyword against every word in the message
                const maxDistance = kl.length <= 4 ? 1 : 2;
                for (const word of wordsInMessage) {
                    const cleanWord = word.replace(/[^a-z0-9]/gi, ''); // remove punctuation
                    if (Math.abs(cleanWord.length - kl.length) <= maxDistance) {
                        const distance = getLevenshteinDistance(cleanWord, kl);
                        if (distance <= maxDistance) {
                            console.log(\`🎯 Fuzzy matched keyword '\${kl}' with typed word '\${cleanWord}' (distance: \${distance})\`);
                            return true;
                        }
                    }
                }
                
                return false;
            });
        });`;

content = content.replace(/\r\n/g, '\n');
content = content.replace(search, replace);

fs.writeFileSync(path, content, 'utf8');
console.log('Modified keyword matching successfully');
