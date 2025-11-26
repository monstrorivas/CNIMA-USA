#!/usr/bin/env node
/**
 * Automatically generates the hidden form in index.html from register.html
 * This ensures Netlify can detect the form at build time without manual sync
 * 
 * Run this before deploying, or configure Netlify to run it as a build command
 * 
 * Debug mode: Set DEBUG=true environment variable to see detailed output
 *   DEBUG=true node scripts/generate-hidden-form.js
 */

const fs = require('fs');
const path = require('path');

// Check for debug mode
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

function debugLog(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}

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

debugLog('Fields found:', fields.size);
debugLog('Field names:', Array.from(fields.keys()).join(', '));

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
        // Check if it's a hidden input with a value attribute
        const inputMatch = registerContent.match(new RegExp(`<input[^>]*name=["']${fieldName}["'][^>]*>`, 'i'));
        let inputTag = `<input name="${fieldName}" />`;
        if (inputMatch) {
            // Extract value attribute if present
            const valueMatch = inputMatch[0].match(/value=["']([^"']+)["']/i);
            if (valueMatch) {
                inputTag = `<input name="${fieldName}" value="${valueMatch[1]}" />`;
            }
            // Preserve type attribute - important for email fields (Reply-To) and hidden fields
            const typeMatch = inputMatch[0].match(/type=["']([^"']+)["']/i);
            if (typeMatch) {
                const inputType = typeMatch[1];
                if (inputType === 'hidden') {
                    inputTag = inputTag.replace('<input', '<input type="hidden"');
                } else if (inputType === 'email') {
                    // Preserve type="email" so Netlify can set Reply-To header
                    inputTag = inputTag.replace('<input', '<input type="email"');
                }
            }
        }
        hiddenFormFields += `        ${inputTag}\n`;
    }
});

debugLog('Hidden form fields generated:');
debugLog('  Total lines:', hiddenFormFields.split('\n').length);
debugLog('  Blank lines:', hiddenFormFields.split('\n').filter(l => !l.trim()).length);
debugLog('  First 200 chars:', hiddenFormFields.substring(0, 200));

// Remove trailing newline from hiddenFormFields to avoid extra blank lines
const cleanedFormFields = hiddenFormFields.replace(/\n+$/, '');

// Extract redirect/action attributes from the visible form
const redirectMatch = registerContent.match(/data-netlify-redirect=["']([^"']+)["']/i);
const actionMatch = registerContent.match(/<form[^>]*action=["']([^"']+)["']/i);
const redirectAttr = redirectMatch ? ` data-netlify-redirect="${redirectMatch[1]}"` : '';
const actionAttr = actionMatch ? ` action="${actionMatch[1]}"` : '';

const hiddenForm = `    <!-- 
        Hidden form for Netlify to detect at build time.
        AUTO-GENERATED from components/register.html - DO NOT EDIT MANUALLY
        Run: node scripts/generate-hidden-form.js
    -->
    <form name="registration" method="POST" netlify netlify-honeypot="bot-field" style="display: none;"${actionAttr}${redirectAttr}>
${cleanedFormFields}
    </form>`;

debugLog('Complete hiddenForm template:');
debugLog('  Total lines:', hiddenForm.split('\n').length);
debugLog('  Blank lines:', hiddenForm.split('\n').filter(l => !l.trim()).length);

// Read index.html
let indexContent = fs.readFileSync(indexPath, 'utf8');

// Replace the hidden form section - use regex to find the form regardless of whitespace
const formRegex = /(\s*)<!--\s*\n\s*Hidden form[\s\S]*?<\/form>/;
const indexFormMatch = indexContent.match(formRegex);

if (!indexFormMatch) {
    console.error('❌ Could not find hidden form section in index.html');
    console.error('   Looking for form with "Hidden form" comment');
    process.exit(1);
}

// Get the indentation from the match (preserve existing indentation)
const baseIndent = indexFormMatch[1] || '    ';
debugLog('Base indentation:', JSON.stringify(baseIndent), `(${baseIndent.length} spaces)`);

// Format the new form with proper indentation matching the existing structure
const newFormLines = hiddenForm.split('\n');
debugLog('Before formatting:');
debugLog('  Total lines:', newFormLines.length);
debugLog('  Blank lines:', newFormLines.filter(l => !l.trim()).length);

const formattedForm = newFormLines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return ''; // Skip empty lines
    
    // Calculate relative indentation from the template (which uses 4 spaces base)
    const originalIndent = line.match(/^(\s*)/)[1].length;
    const relativeIndent = Math.max(0, originalIndent - 4); // Subtract base 4 spaces
    
    return baseIndent + ' '.repeat(relativeIndent) + trimmed;
}).filter(line => line !== '').join(' ');

debugLog('After formatting:');
debugLog('  Total lines:', formattedForm.split('\n').length);
debugLog('  Blank lines:', formattedForm.split('\n').filter(l => !l.trim()).length);
debugLog('  First 300 chars of formatted form:');
debugLog(formattedForm.substring(0, 300));
debugLog('  Last 200 chars of formatted form:');
debugLog(formattedForm.substring(Math.max(0, formattedForm.length - 200)));

// Replace the form section
const beforeReplace = indexContent.match(formRegex);
if (beforeReplace) {
    debugLog('Before replacement:');
    debugLog('  Match length:', beforeReplace[0].length);
    debugLog('  Match lines:', beforeReplace[0].split('\n').length);
    debugLog('  Match blank lines:', beforeReplace[0].split('\n').filter(l => !l.trim()).length);
}

indexContent = indexContent.replace(formRegex, formattedForm);

const afterReplace = indexContent.match(formRegex);
if (afterReplace) {
    debugLog('⚠️  WARNING: Form section still found after replacement!');
    debugLog('  This means the replacement may not have worked correctly.');
} else {
    debugLog('✅ Replacement successful - form section not found in content after replace');
}

// Verify the replacement worked by checking for our form
const verifyMatch = indexContent.match(/<form name="registration"[^>]*>/);
if (verifyMatch) {
    debugLog('✅ Form tag found in final content');
} else {
    debugLog('⚠️  WARNING: Form tag not found in final content!');
}

// Write back to index.html
fs.writeFileSync(indexPath, indexContent, 'utf8');

// Read back and verify
const verifyContent = fs.readFileSync(indexPath, 'utf8');
const verifyFormMatch = verifyContent.match(/<form name="registration"[^>]*>[\s\S]*?<\/form>/);
if (verifyFormMatch) {
    const formSection = verifyFormMatch[0];
    const formLines = formSection.split('\n');
    debugLog('Final file verification:');
    debugLog('  Form section lines:', formLines.length);
    debugLog('  Form section blank lines:', formLines.filter(l => !l.trim()).length);
    debugLog('  First 10 lines of form in file:');
    formLines.slice(0, 10).forEach((l, i) => {
        debugLog(`    ${i + 1}:`, JSON.stringify(l));
    });
}

console.log('✅ Hidden form generated successfully in index.html');
console.log(`   Found ${fields.size} form fields from register.html`);
if (DEBUG) {
    console.log('   (Debug mode enabled - see details above)');
}

