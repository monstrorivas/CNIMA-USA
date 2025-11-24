#!/usr/bin/env node
/**
 * Automatically generates the hidden form in index.html from register.html
 * This ensures Netlify can detect the form at build time without manual sync
 * 
 * Run this before deploying, or configure Netlify to run it as a build command
 */

const fs = require('fs');
const path = require('path');

const registerPath = path.join(__dirname, '../components/register.html');
const indexPath = path.join(__dirname, '../index.html');

// Read register.html
const registerContent = fs.readFileSync(registerPath, 'utf8');

// Extract form element
const formMatch = registerContent.match(/<form[^>]*>([\s\S]*?)<\/form>/);
if (!formMatch) {
    console.error('❌ Could not find form in register.html');
    process.exit(1);
}

const formContent = formMatch[1];

// Extract all input/select/textarea elements with their name attributes
const fieldRegex = /<(input|select|textarea)[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>|<(input|select|textarea)[^>]*name=["']([^"']+)["'][^>]*\/?>/gi;
const fields = new Map();

let match;
while ((match = fieldRegex.exec(formContent)) !== null) {
    const tagName = match[1] || match[4];
    const fieldName = match[2] || match[5];
    const innerContent = match[3] || '';
    
    // Skip form-name and bot-field (handled separately)
    if (fieldName === 'form-name' || fieldName === 'bot-field') {
        continue;
    }
    
    if (!fields.has(fieldName)) {
        fields.set(fieldName, { type: tagName, content: innerContent });
    }
}

// Generate hidden form HTML
let hiddenFormFields = '<input type="hidden" name="form-name" value="registration" />\n        <input name="bot-field" />\n';

fields.forEach((fieldInfo, fieldName) => {
    if (fieldInfo.type === 'select') {
        // Extract options from original select
        const selectMatch = registerContent.match(new RegExp(`<select[^>]*name=["']${fieldName}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i'));
        if (selectMatch) {
            const options = selectMatch[1].match(/<option[^>]*value=["']([^"']+)["'][^>]*>/gi) || [];
            const optionValues = options.map(opt => {
                const valMatch = opt.match(/value=["']([^"']+)["']/);
                return valMatch ? valMatch[1] : '';
            }).filter(v => v);
            
            hiddenFormFields += `        <select name="${fieldName}">\n`;
            optionValues.forEach(val => {
                hiddenFormFields += `            <option value="${val}">${val}</option>\n`;
            });
            hiddenFormFields += `        </select>\n`;
        } else {
            hiddenFormFields += `        <select name="${fieldName}"><option value=""></option></select>\n`;
        }
    } else if (fieldInfo.type === 'textarea') {
        hiddenFormFields += `        <textarea name="${fieldName}"></textarea>\n`;
    } else {
        hiddenFormFields += `        <input name="${fieldName}" />\n`;
    }
});

const hiddenForm = `    <!-- 
        Hidden form for Netlify to detect at build time.
        AUTO-GENERATED from components/register.html - DO NOT EDIT MANUALLY
        Run: node scripts/generate-hidden-form.js
    -->
    <form name="registration" method="POST" data-netlify="true" netlify-honeypot="bot-field" style="display: none;">
${hiddenFormFields}    </form>`;

// Read index.html
let indexContent = fs.readFileSync(indexPath, 'utf8');

// Replace the hidden form section
const formStartMarker = '<!-- \n        Hidden form';
const formEndMarker = '</form>';
const startIndex = indexContent.indexOf(formStartMarker);
const endIndex = indexContent.indexOf(formEndMarker, startIndex) + formEndMarker.length;

if (startIndex === -1 || endIndex === -1) {
    console.error('❌ Could not find hidden form section in index.html');
    process.exit(1);
}

// Replace the form section
indexContent = indexContent.substring(0, startIndex) + hiddenForm + '\n    \n' + indexContent.substring(endIndex + 1);

// Write back to index.html
fs.writeFileSync(indexPath, indexContent, 'utf8');

console.log('✅ Hidden form generated successfully in index.html');
console.log(`   Found ${fields.size} form fields from register.html`);

