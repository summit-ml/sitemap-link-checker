'use strict';

/**
 * Zips the extension folder for upload to the Chrome Web Store.
 * The file is named after the version in extension/manifest.json and written to dist/.
 *
 * Usage: node tools/package.js   (needs the zip command)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
    throw new Error('extension/manifest.json is version ' + manifest.version + ' but package.json is ' + pkg.version);
}

const out = path.join(root, 'dist', 'sitemap-link-checker-' + manifest.version + '.zip');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '.*', '-x', '*/.*'], { cwd: path.join(root, 'extension') });
console.log('wrote ' + path.relative(root, out) + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
