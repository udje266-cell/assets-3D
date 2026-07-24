// GMDI — Configuration partagée (modules, rôles, démarches)
// Architecture commune à toute la plateforme (voir cahier des charges §2 et §5).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DATA_FILE = path.join(DATA_DIR, 'db.json');

export const PORT = process.env.PORT || 3000;
export const SESSION_COOKIE = 'gmdi_sid';
// Déconnexion automatique après inactivité (cahier des charges §2.4).
export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
// Blocage temporaire après plusieurs échecs (cahier des charges §2.4).
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 min

export const ROLES = {
  CITIZEN: 'citizen',
  MAYOR: 'mayor',
  MANAGER: 'manager',
  AGENT: 'agent', // agent municipal (RH) — accès à son dossier personnel
  AUDITOR: 'auditor',
  ADMIN: 'admin', // Administration Système (cahier des charges technique §2.5)
};

// Les sept modules métiers de la plateforme (le module 07 n'existe pas dans le CDC).
export const MODULES = [
  {
    code: '01',
    key: 'etat-civil',
    name: 'État Civil Numérique',
    short: 'État Civil',
    icon: '📋',
    citizen: true,
    // Démarches citoyennes proposées par le module.
    demarches: [
      { key: 'declaration-naissance', label: 'Déclarer une naissance', fee: 0 },
      { key: 'declaration-deces', label: 'Déclarer un décès', fee: 0 },
      { key: 'extrait-acte', label: "Demander un extrait d'acte", fee: 1000 },
      { key: 'copie-integrale', label: "Demander une copie intégrale", fee: 2000 },
    ],
  },
  {
    code: '02',
    key: 'finances',
    name: 'Finances Locales & Mobile Money',
    short: 'Finances',
    icon: '💰',
    citizen: true,
    demarches: [
      { key: 'paiement-taxe-fonciere', label: 'Payer la taxe foncière', fee: 25000 },
      { key: 'paiement-patente', label: 'Payer la patente', fee: 15000 },
      { key: 'paiement-taxe-marche', label: 'Payer la taxe de marché', fee: 3000 },
    ],
  },
  {
    code: '03',
    key: 'rh',
    name: 'Ressources Humaines (RH)',
    short: 'RH',
    icon: '👥',
    citizen: false, // aucun accès citoyen (cahier des charges §2.1)
    demarches: [],
  },
  {
    code: '04',
    key: 'urbanisme',
    name: 'Urbanisme, Cadastre & SIG',
    short: 'Urbanisme',
    icon: '🏗️',
    citizen: true,
    demarches: [
      { key: 'permis-construire', label: 'Déposer une demande de permis de construire', fee: 50000 },
      { key: 'certificat-urbanisme', label: "Demander un certificat d'urbanisme", fee: 5000 },
      { key: 'signalement-foncier', label: 'Signaler une construction illégale', fee: 0 },
    ],
  },
  {
    code: '05',
    key: 'services-techniques',
    name: 'Services Techniques & Maintenance',
    short: 'Services Techniques',
    icon: '🔧',
    citizen: true,
    demarches: [
      { key: 'signalement-voirie', label: 'Signaler un problème de voirie (nid de poule…)', fee: 0 },
      { key: 'signalement-eclairage', label: "Signaler un problème d'éclairage public", fee: 0 },
      { key: 'signalement-ordures', label: 'Signaler un dépôt sauvage / ordures', fee: 0 },
      { key: 'signalement-eau', label: "Signaler une fuite d'eau", fee: 0 },
    ],
  },
  {
    code: '06',
    key: 'communication',
    name: 'Communication Institutionnelle & Délibérations',
    short: 'Communication',
    icon: '📢',
    citizen: true,
    demarches: [
      { key: 'consultation-publique', label: 'Participer à une consultation publique', fee: 0 },
    ],
  },
  {
    code: '08',
    key: 'patrimoine',
    name: 'Patrimoine',
    short: 'Patrimoine',
    icon: '🏛️',
    citizen: true,
    demarches: [
      { key: 'occupation-domaine', label: "Demander l'occupation d'un espace public", fee: 10000 },
      { key: 'signalement-equipement', label: 'Signaler une dégradation sur un équipement public', fee: 0 },
    ],
  },
];

export const MODULE_BY_CODE = Object.fromEntries(MODULES.map((m) => [m.code, m]));
export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]));

export function findDemarche(moduleCode, demarcheKey) {
  const mod = MODULE_BY_CODE[moduleCode];
  if (!mod) return null;
  return mod.demarches.find((d) => d.key === demarcheKey) || null;
}

// Statuts officiels du flux unifié (cahier des charges technique §6).
export const STATUS = {
  PENDING: 'pending', // En attente (déposée / en attente de paiement ou de prise en charge)
  IN_PROGRESS: 'in_progress', // En cours (le gestionnaire traite le dossier)
  TO_COMPLETE: 'to_complete', // À compléter (le gestionnaire demande des pièces/infos)
  VALIDATED: 'validated', // Validé (décision favorable, document généré)
  REJECTED: 'rejected', // Refusé (motif obligatoire)
  COMPLETED: 'completed', // Terminé (dossier clôturé / acte délivré)
};

export const STATUS_LABELS = {
  pending: 'En attente',
  in_progress: 'En cours',
  to_complete: 'À compléter',
  validated: 'Validé',
  rejected: 'Refusé',
  completed: 'Terminé',
};

export const PRIORITIES = ['normale', 'prioritaire', 'urgente'];

// Comptes professionnels de développement (cahier des charges §3).
export const SEED_ACCOUNTS = [
  { email: 'maire@mairie-gmdi.ci', password: 'Maire@2026', role: ROLES.MAYOR, name: 'Maire de la commune', module: null },
  { email: 'etatcivil@mairie-gmdi.ci', password: 'EtatCivil@2026', role: ROLES.MANAGER, name: 'Gestionnaire — État Civil', module: '01' },
  { email: 'finances@mairie-gmdi.ci', password: 'Finances@2026', role: ROLES.MANAGER, name: 'Gestionnaire — Finances', module: '02' },
  { email: 'rh@mairie-gmdi.ci', password: 'RH@2026', role: ROLES.MANAGER, name: 'Gestionnaire — Ressources Humaines', module: '03' },
  { email: 'urbanisme@mairie-gmdi.ci', password: 'Urbanisme@2026', role: ROLES.MANAGER, name: 'Gestionnaire — Urbanisme & SIG', module: '04' },
  { email: 'technique@mairie-gmdi.ci', password: 'Technique@2026', role: ROLES.MANAGER, name: 'Gestionnaire — Services Techniques', module: '05' },
  { email: 'communication@mairie-gmdi.ci', password: 'Communication@2026', role: ROLES.MANAGER, name: 'Gestionnaire — Communication', module: '06' },
  { email: 'patrimoine@mairie-gmdi.ci', password: 'Patrimoine@2026', role: ROLES.MANAGER, name: 'Gestionnaire — Patrimoine', module: '08' },
  { email: 'auditeur@mairie-gmdi.ci', password: 'Auditeur@2026', role: ROLES.AUDITOR, name: 'Auditeur', module: null },
  { email: 'admin@mairie-gmdi.ci', password: 'Admin@2026', role: ROLES.ADMIN, name: 'Administrateur Système', module: null },
];

// Contenu du Site public (vitrine officielle — cahier des charges technique §2.1).
export const PUBLIC_SITE = {
  mairie: {
    nom: 'Mairie de la commune',
    slogan: 'Une administration numérique, proche et transparente',
    presentation:
      "La mairie met à disposition des citoyens la plateforme GMDI, un guichet numérique unique regroupant l'ensemble des services municipaux. Effectuez vos démarches en ligne, suivez vos dossiers et recevez vos documents officiels sans vous déplacer.",
  },
  actualites: [
    { date: '2026-07-20', titre: 'Ouverture du guichet numérique GMDI', resume: "Tous les services de la mairie sont désormais accessibles en ligne via un compte citoyen unique." },
    { date: '2026-07-15', titre: 'Paiement des taxes par Mobile Money', resume: 'Réglez vos taxes et redevances via Orange Money, MTN, Wave ou carte bancaire, 24h/24.' },
    { date: '2026-07-05', titre: 'Consultation publique : aménagement du marché central', resume: 'Donnez votre avis sur le projet via le module Communication jusqu\'au 31 août.' },
  ],
  contacts: {
    adresse: 'Hôtel de ville, Place de l\'Indépendance',
    telephone: '+225 27 20 00 00 00',
    email: 'contact@mairie-gmdi.ci',
    horaires: 'Lun. – Ven. : 08h00 – 16h30',
  },
};
