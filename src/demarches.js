// GMDI — Flux unifié des démarches (cahier des charges §6).
// Toute démarche, quel que soit le module, suit la même logique :
// dépôt → paiement → numéro de suivi → vérification gestionnaire →
// validation (génération éventuelle d'un acte + QR Code) ou refus motivé →
// notification citoyen → mise à jour des statistiques.

import crypto from 'node:crypto';
import { get, saveSoon, nextId, nextTracking } from './store.js';
import { STATUS, findDemarche, MODULE_BY_CODE, PRIORITIES } from './config.js';

function addHistory(demarche, action, byLabel) {
  demarche.history.push({
    at: new Date().toISOString(),
    action,
    by: byLabel,
  });
}

// Génère un identifiant d'acte + un jeton QR Code sécurisé (simulé).
function generateActe(demarche) {
  const acteNumber = `ACTE-${demarche.moduleCode}-${String(demarche.id).padStart(6, '0')}`;
  const qrToken = crypto.randomBytes(12).toString('hex').toUpperCase();
  return {
    number: acteNumber,
    qrToken,
    // URL de vérification publique de l'authenticité de l'acte.
    verifyUrl: `/verify/${qrToken}`,
    generatedAt: new Date().toISOString(),
  };
}

export function createDemarche({ citizen, moduleCode, demarcheKey, formData = {} }) {
  const mod = MODULE_BY_CODE[moduleCode];
  if (!mod) return { error: 'Module inconnu.' };
  if (!mod.citizen) return { error: "Ce module ne propose pas de démarche citoyenne." };
  const def = findDemarche(moduleCode, demarcheKey);
  if (!def) return { error: 'Démarche inconnue pour ce module.' };

  const id = nextId('demarche');
  const fee = def.fee || 0;
  const demarche = {
    id,
    tracking: nextTracking(moduleCode),
    moduleCode,
    moduleKey: mod.key,
    demarcheKey,
    demarcheLabel: def.label,
    citizenId: citizen.id,
    citizenName: citizen.name,
    status: fee > 0 ? STATUS.SUBMITTED : STATUS.PAID, // gratuit => directement en file de traitement
    priority: 'normale',
    fee,
    payment: fee > 0 ? null : { method: 'gratuit', paidAt: new Date().toISOString(), amount: 0 },
    formData,
    acte: null,
    rejectReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };
  addHistory(demarche, 'Démarche déposée', `Citoyen — ${citizen.name}`);
  if (fee === 0) addHistory(demarche, 'Démarche gratuite — transmise au gestionnaire', 'Système');
  get().demarches.push(demarche);
  saveSoon();
  return { demarche };
}

export function payDemarche(demarche, method) {
  if (demarche.status !== STATUS.SUBMITTED) {
    return { error: 'Cette démarche n\'est pas en attente de paiement.' };
  }
  const allowed = ['Orange Money', 'MTN Mobile Money', 'Wave', 'Carte bancaire'];
  if (!allowed.includes(method)) return { error: 'Moyen de paiement non supporté.' };
  demarche.payment = {
    method,
    amount: demarche.fee,
    reference: 'PAY-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
    paidAt: new Date().toISOString(),
  };
  demarche.status = STATUS.PAID;
  demarche.updatedAt = new Date().toISOString();
  addHistory(demarche, `Paiement reçu (${method}) — ${demarche.fee} FCFA`, `Citoyen — ${demarche.citizenName}`);
  saveSoon();
  return { demarche };
}

export function setPriority(demarche, priority) {
  if (!PRIORITIES.includes(priority)) return { error: 'Priorité invalide.' };
  demarche.priority = priority;
  demarche.updatedAt = new Date().toISOString();
  saveSoon();
  return { demarche };
}

// Le gestionnaire prend le dossier en cours de vérification.
export function takeInReview(demarche, byLabel) {
  if (![STATUS.PAID, STATUS.SUBMITTED].includes(demarche.status)) {
    return { error: 'Dossier non traitable dans son état actuel.' };
  }
  demarche.status = STATUS.IN_REVIEW;
  demarche.updatedAt = new Date().toISOString();
  addHistory(demarche, 'Vérification en cours', byLabel);
  saveSoon();
  return { demarche };
}

export function validateDemarche(demarche, byLabel) {
  if (![STATUS.PAID, STATUS.IN_REVIEW].includes(demarche.status)) {
    return { error: 'Ce dossier ne peut pas être validé dans son état actuel.' };
  }
  demarche.status = STATUS.VALIDATED;
  demarche.acte = generateActe(demarche);
  demarche.rejectReason = null;
  demarche.updatedAt = new Date().toISOString();
  addHistory(demarche, `Validée — acte ${demarche.acte.number} généré (QR ${demarche.acte.qrToken})`, byLabel);
  saveSoon();
  return { demarche };
}

export function rejectDemarche(demarche, reason, byLabel) {
  if (![STATUS.PAID, STATUS.IN_REVIEW, STATUS.SUBMITTED].includes(demarche.status)) {
    return { error: 'Ce dossier ne peut pas être refusé dans son état actuel.' };
  }
  if (!reason || !reason.trim()) return { error: 'Le motif de refus est obligatoire.' };
  demarche.status = STATUS.REJECTED;
  demarche.rejectReason = reason.trim();
  demarche.updatedAt = new Date().toISOString();
  addHistory(demarche, `Refusée — motif : ${reason.trim()}`, byLabel);
  saveSoon();
  return { demarche };
}

export function findById(id) {
  return get().demarches.find((d) => d.id === Number(id)) || null;
}

export function findByTracking(tracking) {
  return get().demarches.find((d) => d.tracking === tracking) || null;
}

export function findByQrToken(token) {
  return get().demarches.find((d) => d.acte && d.acte.qrToken === token) || null;
}

export function forCitizen(citizenId) {
  return get()
    .demarches.filter((d) => d.citizenId === citizenId)
    .sort((a, b) => b.id - a.id);
}

export function forModule(moduleCode) {
  return get()
    .demarches.filter((d) => d.moduleCode === moduleCode)
    .sort((a, b) => b.id - a.id);
}

// Statistiques d'un module (tableau de bord gestionnaire / Maire).
export function statsForModule(moduleCode) {
  const rows = forModule(moduleCode);
  const byStatus = { submitted: 0, paid: 0, in_review: 0, validated: 0, rejected: 0 };
  let revenue = 0;
  for (const d of rows) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    if (d.payment && d.payment.amount) revenue += d.payment.amount;
  }
  const pending = byStatus.submitted + byStatus.paid + byStatus.in_review;
  return {
    moduleCode,
    total: rows.length,
    pending,
    validated: byStatus.validated,
    rejected: byStatus.rejected,
    byStatus,
    revenue,
  };
}
