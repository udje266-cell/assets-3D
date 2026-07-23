// GMDI — Persistance simple sur fichier JSON (zéro dépendance native).
// Adéquat pour un prototype/démo ; en production, remplacer par une vraie base
// (PostgreSQL) sans changer l'API de ce module.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DATA_FILE } from './config.js';

const EMPTY = {
  users: [],
  demarches: [],
  audit: [],
  counters: { user: 0, demarche: 0, audit: 0, tracking: 0 },
};

let db = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function load() {
  ensureDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // Garantit la présence des collections attendues.
      db = { ...structuredClone(EMPTY), ...db };
      db.counters = { ...EMPTY.counters, ...(db.counters || {}) };
    } catch (err) {
      console.error('DB corrompue, réinitialisation:', err.message);
      db = structuredClone(EMPTY);
    }
  } else {
    db = structuredClone(EMPTY);
  }
  return db;
}

export function get() {
  if (!db) load();
  return db;
}

let saveTimer = null;
export function save() {
  ensureDir();
  // Écriture atomique : fichier temporaire puis rename.
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Sauvegarde différée pour regrouper les écritures rapprochées.
export function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, 50);
}

export function nextId(kind) {
  const d = get();
  d.counters[kind] = (d.counters[kind] || 0) + 1;
  return d.counters[kind];
}

// Numéro de suivi unique lisible : GMDI-<module>-<année>-<séquence>.
export function nextTracking(moduleCode) {
  const seq = nextId('tracking');
  const year = new Date().getFullYear();
  return `GMDI-${moduleCode}-${year}-${String(seq).padStart(5, '0')}`;
}

export function resetForTests() {
  db = structuredClone(EMPTY);
}
