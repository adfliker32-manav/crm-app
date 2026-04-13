const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// We just want to extract Mongoose schema info without strictly connecting
const modelsDir = path.join(__dirname, '../src/models');
const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));

let markdown = '# Database Architecture Audit\n\n';
markdown += 'This document outlines the current database architecture, models, schemas, and indexing strategies.\n\n';

for (const file of files) {
    try {
        const modelNameOrig = file.replace('.js', '');
        // Require the file. Some of them might error if they rely on undefined globals, let's catch.
        const model = require(path.join(modelsDir, file));
        
        if (model && model.schema) {
            markdown += `## Model: **${model.modelName}**\n\n`;
            markdown += `### Schema Paths\n`;
            markdown += `| Path | Type | Options |\n`;
            markdown += `|---|---|---|\n`;
            
            const paths = model.schema.paths;
            for (const [pathName, pathDesc] of Object.entries(paths)) {
                let typeStr = pathDesc.instance || 'Mixed';
                if (pathDesc.options && pathDesc.options.type) {
                  if (typeof pathDesc.options.type === 'function') {
                    typeStr = pathDesc.options.type.name || typeStr;
                  } else if (Array.isArray(pathDesc.options.type)) {
                    typeStr = `Array<${pathDesc.options.type[0]?.type?.name || 'Mixed'}>`;
                  }
                }
                if (pathDesc.schema) {
                  typeStr = 'Subdocument Array';
                }
                
                let optionsArr = [];
                if (pathDesc.options.required) optionsArr.push('Required');
                if (pathDesc.options.unique) optionsArr.push('Unique');
                if (pathDesc.options.index) optionsArr.push('Indexed');
                if (pathDesc.options.ref) optionsArr.push(`Ref: ${pathDesc.options.ref}`);
                if (pathDesc.options.default !== undefined) optionsArr.push(`Default`);
                if (pathDesc.options.enum) optionsArr.push(`Enum: [${pathDesc.options.enum.join(', ')}]`);
                
                const optionsStr = optionsArr.join(', ') || '-';
                
                markdown += `| \`${pathName}\` | ${typeStr} | ${optionsStr} |\n`;
            }
            
            markdown += `\n### Indexes\n`;
            const indexes = model.schema.indexes();
            if (indexes.length === 0) {
                 markdown += `No explicit indexes defined.\n\n`;
            } else {
                markdown += `| Keys | Options |\n`;
                markdown += `|---|---|\n`;
                for (const idx of indexes) {
                    const keys = JSON.stringify(idx[0]);
                    const opts = Object.keys(idx[1]).length ? JSON.stringify(idx[1]) : '-';
                    markdown += `| \`${keys}\` | ${opts} |\n`;
                }
                markdown += `\n`;
            }
            markdown += `---\n\n`;
        }
    } catch (e) {
        console.error(`Error loading model ${file}:`, e.message);
    }
}

fs.writeFileSync(path.join(__dirname, '../database_audit.md'), markdown);
console.log('Audit generated at database_audit.md');
