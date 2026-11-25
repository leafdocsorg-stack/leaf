// Builds the standalone Leaf Viewer into dist/: node tools/build-viewer.mjs
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'dist'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
const core = fs.readFileSync(path.join(root, 'core/leaf-core.js'), 'utf8');
const sample = fs.readFileSync(path.join(root, 'samples/lease-sample.leaf')).toString('base64');
let html = fs.readFileSync(path.join(root, 'viewer/viewer.template.html'), 'utf8');
html = html.replace('/*CORE*/', () => core).replace("'/*SAMPLE*/'", () => `'${sample}'`);
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of ['pdf-tools.js', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(root, 'viewer', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'viewer/vendor'))) fs.copyFileSync(path.join(root, 'viewer/vendor', f), path.join(out, f));
console.log('Built dist/ (' + fs.readdirSync(out).length + ' files). Serve it with any static host, e.g. npx serve dist');
