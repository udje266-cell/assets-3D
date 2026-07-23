// GMDI — Journal d'audit commun (cahier des charges §4.1).
// Enregistre : identité, date/heure, IP, module et action.

import { get, saveSoon, nextId } from './store.js';
import { labelForUser } from './auth.js';

export function record({ user, ip, module = null, action, details = null }) {
  const entry = {
    id: nextId('audit'),
    userId: user ? user.id : null,
    userLabel: user ? labelForUser(user) : 'Système',
    userEmail: user ? user.email : null,
    timestamp: new Date().toISOString(),
    ip: ip || 'inconnue',
    module,
    action,
    details,
  };
  get().audit.push(entry);
  saveSoon();
  return entry;
}

// Lecture seule (auditeur / Maire). Filtrage optionnel par module.
export function list({ module = null, limit = 500 } = {}) {
  let rows = get().audit.slice();
  if (module) rows = rows.filter((r) => r.module === module);
  rows.sort((a, b) => b.id - a.id);
  return rows.slice(0, limit);
}
