// GMDI — Prépare le dossier web statique `www/` pour l'empaquetage Capacitor (APK).
// Copie public/ puis injecte le backend embarqué (offline-api.js) afin que
// l'application fonctionne entièrement hors-ligne sur l'appareil.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const out = path.join(root, 'www');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, f), path.join(out, f));
}

// Injecte le backend embarqué avant le module app.js dans index.html.
const indexPath = path.join(out, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('offline-api.js')) {
  html = html.replace(
    '<script src="/app.js" type="module"></script>',
    '<script src="/offline-api.js"></script>\n  <script src="/app.js" type="module"></script>'
  );
  fs.writeFileSync(indexPath, html);
}

console.log('www/ prêt (mode hors-ligne).');
