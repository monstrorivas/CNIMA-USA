#!/usr/bin/env node
/**
 * Helper script to extract form field names from register.html
 * Run this to see what fields need to be in the hidden form in index.html
 * 
 * Usage: node scripts/check-form-fields.js
 */

const fs = require('fs');
const path = require('path');

const registerPath = path.join(__dirname, '../components/register.html');
const content = fs.readFileSync(registerPath, 'utf8');

// Extract all input/select/textarea name attributes
const fieldRegex = /name=["']([^"']+)["']/g;
const fields = new Set();
let match;

while ((match = fieldRegex.exec(content)) !== null) {
    // Skip hidden fields that are already handled
    if (match[1] !== 'form-name' && match[1] !== 'bot-field') {
        fields.add(match[1]);
    }
}

console.log('\n📋 Form fields found in register.html:');
console.log('=====================================\n');
Array.from(fields).sort().forEach(field => {
    console.log(`  - ${field}`);
});

console.log(`\n✅ Total: ${fields.size} fields`);
console.log('\n💡 Make sure all these fields are in the hidden form in index.html\n');

