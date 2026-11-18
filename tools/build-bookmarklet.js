'use strict';

/**
 * Builds bookmarklet/index.html from extension/checker.js, so the no-install version always
 * carries the same code as the extension.
 *
 * Usage: node tools/build-bookmarklet.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'extension', 'checker.js'), 'utf8').trim();
const template = fs.readFileSync(path.join(__dirname, 'bookmarklet.template.html'), 'utf8');

if (!template.includes('/*CHECKER_SOURCE*/')) {
    throw new Error('bookmarklet.template.html is missing the /*CHECKER_SOURCE*/ marker');
}
if (source.includes('</script')) {
    throw new Error('checker.js must not contain a closing script tag');
}

const out = path.join(root, 'bookmarklet', 'index.html');
fs.writeFileSync(out, template.replace('/*CHECKER_SOURCE*/', () => source));
console.log('wrote ' + path.relative(root, out));
