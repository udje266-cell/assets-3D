// GMDI — Amorçage des comptes professionnels de développement (CDC §3)
// + quelques démarches citoyennes de démonstration.

import { load, save, get } from './store.js';
import { SEED_ACCOUNTS, ROLES } from './config.js';
import { createUser, findUserByEmail } from './auth.js';
import { createDemarche, payDemarche, validateDemarche, rejectDemarche } from './demarches.js';

export function seed({ force = false, withDemo = true } = {}) {
  load();
  const db = get();

  if (force) {
    db.users = [];
    db.demarches = [];
    db.audit = [];
    db.counters = { user: 0, demarche: 0, audit: 0, tracking: 0 };
  }

  // Comptes Back Office (Maire, gestionnaires, auditeur).
  let created = 0;
  for (const acc of SEED_ACCOUNTS) {
    if (!findUserByEmail(acc.email)) {
      createUser({
        email: acc.email,
        password: acc.password,
        role: acc.role,
        name: acc.name,
        module: acc.module,
        // En production, mot de passe temporaire à changer à la 1re connexion.
        mustChangePassword: false,
      });
      created++;
    }
  }

  // Citoyen de démonstration + agent municipal (RH).
  let citizen = findUserByEmail('koffi.aya@example.ci');
  if (!citizen) {
    citizen = createUser({
      email: 'koffi.aya@example.ci',
      password: 'Citoyen@2026',
      role: ROLES.CITIZEN,
      name: 'Aya Koffi',
    });
  }
  if (!findUserByEmail('agent.diallo@mairie-gmdi.ci')) {
    createUser({
      email: 'agent.diallo@mairie-gmdi.ci',
      password: 'Agent@2026',
      role: ROLES.AGENT,
      name: 'Mamadou Diallo',
      module: '03',
    });
  }

  // Démarches de démonstration illustrant plusieurs statuts.
  if (withDemo && db.demarches.length === 0) {
    // 1) Extrait d'acte payé puis validé (avec acte + QR Code).
    const r1 = createDemarche({ citizen, moduleCode: '01', demarcheKey: 'extrait-acte', formData: { nom: 'Koffi', prenom: 'Aya', typeActe: 'Naissance' } });
    if (r1.demarche) {
      payDemarche(r1.demarche, 'Orange Money');
      validateDemarche(r1.demarche, 'Gestionnaire 01');
    }
    // 2) Signalement voirie (gratuit, en attente de traitement).
    createDemarche({ citizen, moduleCode: '05', demarcheKey: 'signalement-voirie', formData: { lieu: 'Rue des Jardins', description: 'Nid de poule profond', gps: '5.345,-4.024' } });
    // 3) Permis de construire payé, refusé avec motif.
    const r3 = createDemarche({ citizen, moduleCode: '04', demarcheKey: 'permis-construire', formData: { parcelle: 'P-1024', surface: '120 m²' } });
    if (r3.demarche) {
      payDemarche(r3.demarche, 'Wave');
      rejectDemarche(r3.demarche, 'Zone non constructible selon le SIG.', 'Gestionnaire 04');
    }
    // 4) Paiement de taxe foncière validé.
    const r4 = createDemarche({ citizen, moduleCode: '02', demarcheKey: 'paiement-taxe-fonciere', formData: { bien: 'Villa Cocody' } });
    if (r4.demarche) {
      payDemarche(r4.demarche, 'MTN Mobile Money');
      validateDemarche(r4.demarche, 'Gestionnaire 02');
    }
  }

  save();
  return { created, totalUsers: db.users.length, totalDemarches: db.demarches.length };
}

// Exécution directe : `node src/seed.js [--force]`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  const res = seed({ force });
  console.log(`Seed terminé. Comptes créés: ${res.created}. Utilisateurs: ${res.totalUsers}. Démarches: ${res.totalDemarches}.`);
}
