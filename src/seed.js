// GMDI — Amorçage des comptes professionnels de développement (CDC §3)
// + quelques démarches citoyennes de démonstration.

import { load, save, get } from './store.js';
import { SEED_ACCOUNTS, ROLES } from './config.js';
import { createUser, findUserByEmail } from './auth.js';
import { createDemarche, payDemarche, validateDemarche, rejectDemarche, takeInReview, requestCompletion, closeDemarche } from './demarches.js';
import { notify } from './notifications.js';

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

  // Démarches de démonstration illustrant les six statuts (§6).
  if (withDemo && db.demarches.length === 0) {
    // 1) Extrait d'acte payé, validé puis clôturé (Terminé, avec acte + QR Code).
    const r1 = createDemarche({ citizen, moduleCode: '01', demarcheKey: 'extrait-acte', formData: { nom: 'Koffi', prenom: 'Aya', typeActe: 'Naissance' } });
    if (r1.demarche) {
      payDemarche(r1.demarche, 'Orange Money');
      validateDemarche(r1.demarche, 'Gestionnaire 01');
      closeDemarche(r1.demarche, 'Gestionnaire 01');
    }
    // 2) Signalement voirie (gratuit) — En attente de prise en charge.
    createDemarche({ citizen, moduleCode: '05', demarcheKey: 'signalement-voirie', formData: { lieu: 'Rue des Jardins', description: 'Nid de poule profond', gps: '5.345,-4.024' } });
    // 3) Permis de construire payé, refusé avec motif.
    const r3 = createDemarche({ citizen, moduleCode: '04', demarcheKey: 'permis-construire', formData: { parcelle: 'P-1024', surface: '120 m²' } });
    if (r3.demarche) {
      payDemarche(r3.demarche, 'Wave');
      rejectDemarche(r3.demarche, 'Zone non constructible selon le SIG.', 'Gestionnaire 04');
    }
    // 4) Paiement de taxe foncière validé (Validé).
    const r4 = createDemarche({ citizen, moduleCode: '02', demarcheKey: 'paiement-taxe-fonciere', formData: { bien: 'Villa Cocody' } });
    if (r4.demarche) {
      payDemarche(r4.demarche, 'MTN Mobile Money');
      validateDemarche(r4.demarche, 'Gestionnaire 02');
    }
    // 5) Copie intégrale payée, prise en charge — En cours.
    const r5 = createDemarche({ citizen, moduleCode: '01', demarcheKey: 'copie-integrale', formData: { nom: 'Koffi', typeActe: 'Mariage' } });
    if (r5.demarche) {
      payDemarche(r5.demarche, 'Carte bancaire');
      takeInReview(r5.demarche, 'Gestionnaire 01');
    }
    // 6) Occupation domaine public payée — À compléter.
    const r6 = createDemarche({ citizen, moduleCode: '08', demarcheKey: 'occupation-domaine', formData: { lieu: 'Place du marché', usage: 'Kiosque' } });
    if (r6.demarche) {
      payDemarche(r6.demarche, 'Orange Money');
      requestCompletion(r6.demarche, 'Merci de joindre un plan d\'implantation du kiosque.', 'Gestionnaire 08');
    }

    // Notifications de démonstration pour le citoyen (le seed ne passe pas par l'API).
    if (r1.demarche) notify({ userId: citizen.id, type: 'success', title: 'Dossier terminé', message: `Votre extrait d'acte (${r1.demarche.acte?.number}) est disponible.`, demarcheId: r1.demarche.id, module: '01' });
    if (r3.demarche) notify({ userId: citizen.id, type: 'error', title: 'Démarche refusée', message: 'Permis de construire : zone non constructible selon le SIG.', demarcheId: r3.demarche.id, module: '04' });
    if (r6.demarche) notify({ userId: citizen.id, type: 'warning', title: 'Dossier à compléter', message: 'Occupation du domaine : joindre un plan d\'implantation.', demarcheId: r6.demarche.id, module: '08' });
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
