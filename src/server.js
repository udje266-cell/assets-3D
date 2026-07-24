// GMDI — Serveur unique de la plateforme.
// Sert l'API REST + les trois espaces (Portail Citoyen, Back Office Maire,
// Back Office Gestionnaires) derrière une seule application.

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORT, SESSION_COOKIE, ROLES, MODULES, MODULE_BY_CODE, STATUS_LABELS, PUBLIC_SITE } from './config.js';
import { load, get } from './store.js';
import {
  attemptLogin, createSession, destroySession, userFromSession,
  publicUser, findUserByEmail, findUserById, createUser, changePassword,
  resetPasswordByAdmin, setActive, setRole, labelForUser,
} from './auth.js';
import * as audit from './audit.js';
import * as notif from './notifications.js';
import * as D from './demarches.js';
import { seed } from './seed.js';

// Résout le(s) gestionnaire(s) d'un module — destinataires des notifications métier.
function managersOfModule(moduleCode) {
  return get().users.filter((u) => u.role === ROLES.MANAGER && u.module === moduleCode && u.active !== false);
}
function notifyManagers(moduleCode, payload) {
  for (const m of managersOfModule(moduleCode)) notif.notify({ userId: m.id, module: moduleCode, ...payload });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(cookieParser());

// IP réelle du client (pour le journal d'audit).
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'inconnue';
}

// Attache l'utilisateur courant à la requête via le cookie de session.
app.use((req, res, next) => {
  const sid = req.cookies[SESSION_COOKIE];
  req.sid = sid;
  req.user = userFromSession(sid);
  next();
});

// --- Middlewares d'autorisation ---------------------------------------------
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès non autorisé pour votre rôle.' });
    next();
  };
}

// ============================================================================
// AUTHENTIFICATION
// ============================================================================

// Auto-inscription citoyen depuis le Portail Citoyen (CDC §3).
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères).' });
  if (findUserByEmail(email)) return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
  const user = createUser({ email, password, role: ROLES.CITIZEN, name });
  const sid = createSession(user.id);
  res.cookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax' });
  audit.record({ user, ip: clientIp(req), action: 'Création de compte citoyen' });
  res.json({ user: publicUser(user) });
});

// Connexion unique : Maire, gestionnaire, agent, auditeur, citoyen.
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });
  const result = attemptLogin(email, password);
  if (!result.ok) {
    return res.status(result.locked ? 423 : 401).json({ error: result.error });
  }
  const sid = createSession(result.user.id);
  res.cookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax' });
  audit.record({
    user: result.user, ip: clientIp(req),
    module: result.user.module || null,
    action: 'Connexion réussie',
  });
  res.json({ user: publicUser(result.user) });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.user) audit.record({ user: req.user, ip: clientIp(req), module: req.user.module || null, action: 'Déconnexion' });
  destroySession(req.sid);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'Nouveau mot de passe trop court (min. 6 caractères).' });
  // On revérifie le mot de passe courant sauf si un changement est imposé.
  if (!req.user.mustChangePassword) {
    const check = attemptLogin(req.user.email, currentPassword);
    if (!check.ok) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }
  changePassword(req.user, newPassword);
  audit.record({ user: req.user, ip: clientIp(req), module: req.user.module || null, action: 'Modification du mot de passe' });
  res.json({ ok: true });
});

// ============================================================================
// MÉTA — modules disponibles
// ============================================================================
app.get('/api/modules', (req, res) => {
  res.json({
    modules: MODULES.map((m) => ({
      code: m.code, key: m.key, name: m.name, short: m.short, icon: m.icon,
      citizen: m.citizen, demarches: m.demarches,
    })),
    statusLabels: STATUS_LABELS,
  });
});

// Vérification publique de l'authenticité d'un acte via son jeton QR.
app.get('/api/verify/:token', (req, res) => {
  const d = D.findByQrToken(req.params.token);
  if (!d) return res.status(404).json({ valid: false, error: 'Aucun acte ne correspond à ce code.' });
  res.json({
    valid: true,
    acte: d.acte.number,
    module: MODULE_BY_CODE[d.moduleCode]?.name,
    demarche: d.demarcheLabel,
    delivrePar: 'Mairie GMDI',
    date: d.acte.generatedAt,
    beneficiaire: d.citizenName,
  });
});

// ============================================================================
// ESPACE CITOYEN — ne voit que ses propres dossiers (CDC §2.1)
// ============================================================================
function serializeDemarche(d, { includeInternal = false } = {}) {
  const base = {
    id: d.id, tracking: d.tracking, moduleCode: d.moduleCode,
    moduleName: MODULE_BY_CODE[d.moduleCode]?.name, moduleIcon: MODULE_BY_CODE[d.moduleCode]?.icon,
    demarcheKey: d.demarcheKey, demarcheLabel: d.demarcheLabel,
    status: d.status, statusLabel: STATUS_LABELS[d.status], priority: d.priority,
    fee: d.fee, payment: d.payment, needsPayment: D.needsPayment(d),
    acte: d.acte, rejectReason: d.rejectReason, completionRequest: d.completionRequest || null,
    createdAt: d.createdAt, updatedAt: d.updatedAt, history: d.history,
    formData: d.formData,
  };
  if (includeInternal) {
    base.citizenId = d.citizenId;
    base.citizenName = d.citizenName;
  }
  return base;
}

// Notifie le citoyen d'une évolution de son dossier.
function notifyCitizen(d, { type, title, message }) {
  notif.notify({ userId: d.citizenId, type, title, message, demarcheId: d.id, module: d.moduleCode });
}

app.get('/api/citizen/demarches', requireRole(ROLES.CITIZEN), (req, res) => {
  const rows = D.forCitizen(req.user.id).map((d) => serializeDemarche(d));
  res.json({ demarches: rows });
});

app.post('/api/citizen/demarches', requireRole(ROLES.CITIZEN), (req, res) => {
  const { moduleCode, demarcheKey, formData } = req.body || {};
  const result = D.createDemarche({ citizen: req.user, moduleCode, demarcheKey, formData });
  if (result.error) return res.status(400).json({ error: result.error });
  const d = result.demarche;
  audit.record({ user: req.user, ip: clientIp(req), module: moduleCode, action: `Dépôt démarche ${d.tracking}` });
  // Notification citoyen (accusé de dépôt). Le gestionnaire est notifié une fois
  // le paiement effectué (ou immédiatement si la démarche est gratuite).
  notifyCitizen(d, { type: 'info', title: 'Démarche enregistrée', message: `Votre démarche « ${d.demarcheLabel} » a été déposée (${d.tracking}).` });
  if (!D.needsPayment(d)) {
    notifyManagers(moduleCode, { type: 'info', title: 'Nouvelle demande', message: `${d.tracking} — ${d.demarcheLabel} (${d.citizenName})`, demarcheId: d.id });
  }
  res.json({ demarche: serializeDemarche(d) });
});

app.get('/api/citizen/demarches/:id', requireRole(ROLES.CITIZEN), (req, res) => {
  const d = D.findById(req.params.id);
  if (!d || d.citizenId !== req.user.id) return res.status(404).json({ error: 'Démarche introuvable.' });
  res.json({ demarche: serializeDemarche(d) });
});

app.post('/api/citizen/demarches/:id/pay', requireRole(ROLES.CITIZEN), (req, res) => {
  const d = D.findById(req.params.id);
  if (!d || d.citizenId !== req.user.id) return res.status(404).json({ error: 'Démarche introuvable.' });
  const { method } = req.body || {};
  const result = D.payDemarche(d, method);
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Paiement démarche ${d.tracking} (${method})` });
  notifyCitizen(d, { type: 'success', title: 'Paiement confirmé', message: `Reçu ${d.payment.receipt} — ${d.demarcheLabel}. Votre dossier est transmis au service.` });
  notifyManagers(d.moduleCode, { type: 'info', title: 'Nouvelle demande (payée)', message: `${d.tracking} — ${d.demarcheLabel} (${d.citizenName})`, demarcheId: d.id });
  res.json({ demarche: serializeDemarche(d) });
});

// Le citoyen fournit le complément demandé par le gestionnaire (statut À compléter).
app.post('/api/citizen/demarches/:id/complete', requireRole(ROLES.CITIZEN), (req, res) => {
  const d = D.findById(req.params.id);
  if (!d || d.citizenId !== req.user.id) return res.status(404).json({ error: 'Démarche introuvable.' });
  const result = D.citizenComplete(d, (req.body || {}).info);
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Complément fourni ${d.tracking}` });
  notifyManagers(d.moduleCode, { type: 'info', title: 'Complément reçu', message: `${d.tracking} — le citoyen a complété son dossier.`, demarcheId: d.id });
  res.json({ demarche: serializeDemarche(d) });
});

// ============================================================================
// ESPACE GESTIONNAIRE — un module uniquement (CDC §2.3)
// ============================================================================
// Un gestionnaire ne peut agir que sur son module de rattachement.
function guardModule(req, d) {
  return d && d.moduleCode === req.user.module;
}

app.get('/api/manager/demarches', requireRole(ROLES.MANAGER), (req, res) => {
  const rows = D.forModule(req.user.module).map((d) => serializeDemarche(d, { includeInternal: true }));
  res.json({ module: req.user.module, demarches: rows });
});

app.get('/api/manager/stats', requireRole(ROLES.MANAGER), (req, res) => {
  res.json({ stats: D.statsForModule(req.user.module) });
});

app.post('/api/manager/demarches/:id/review', requireRole(ROLES.MANAGER), (req, res) => {
  const d = D.findById(req.params.id);
  if (!guardModule(req, d)) return res.status(404).json({ error: 'Démarche introuvable dans votre module.' });
  const result = D.takeInReview(d, labelForUser(req.user));
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Prise en charge ${d.tracking}` });
  res.json({ demarche: serializeDemarche(d, { includeInternal: true }) });
});

app.post('/api/manager/demarches/:id/priority', requireRole(ROLES.MANAGER), (req, res) => {
  const d = D.findById(req.params.id);
  if (!guardModule(req, d)) return res.status(404).json({ error: 'Démarche introuvable dans votre module.' });
  const result = D.setPriority(d, (req.body || {}).priority);
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Priorité ${d.priority} — ${d.tracking}` });
  res.json({ demarche: serializeDemarche(d, { includeInternal: true }) });
});

// Le gestionnaire demande un complément au citoyen (→ À compléter).
app.post('/api/manager/demarches/:id/request-completion', requireRole(ROLES.MANAGER), (req, res) => {
  const d = D.findById(req.params.id);
  if (!guardModule(req, d)) return res.status(404).json({ error: 'Démarche introuvable dans votre module.' });
  const result = D.requestCompletion(d, (req.body || {}).message, labelForUser(req.user));
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Complément demandé ${d.tracking}` });
  notifyCitizen(d, { type: 'warning', title: 'Dossier à compléter', message: `${d.demarcheLabel} : ${d.completionRequest}` });
  res.json({ demarche: serializeDemarche(d, { includeInternal: true }) });
});

app.post('/api/manager/demarches/:id/validate', requireRole(ROLES.MANAGER), (req, res) => {
  const d = D.findById(req.params.id);
  if (!guardModule(req, d)) return res.status(404).json({ error: 'Démarche introuvable dans votre module.' });
  const result = D.validateDemarche(d, labelForUser(req.user));
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Validation ${d.tracking} — acte ${d.acte.number}` });
  notifyCitizen(d, { type: 'success', title: 'Démarche validée', message: `${d.demarcheLabel} : votre document (${d.acte.number}) est disponible.` });
  res.json({ demarche: serializeDemarche(d, { includeInternal: true }) });
});

// Clôture du dossier après délivrance (→ Terminé).
app.post('/api/manager/demarches/:id/close', requireRole(ROLES.MANAGER), (req, res) => {
  const d = D.findById(req.params.id);
  if (!guardModule(req, d)) return res.status(404).json({ error: 'Démarche introuvable dans votre module.' });
  const result = D.closeDemarche(d, labelForUser(req.user));
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Clôture ${d.tracking}` });
  notifyCitizen(d, { type: 'success', title: 'Dossier terminé', message: `${d.demarcheLabel} : dossier clôturé.` });
  res.json({ demarche: serializeDemarche(d, { includeInternal: true }) });
});

app.post('/api/manager/demarches/:id/reject', requireRole(ROLES.MANAGER), (req, res) => {
  const d = D.findById(req.params.id);
  if (!guardModule(req, d)) return res.status(404).json({ error: 'Démarche introuvable dans votre module.' });
  const result = D.rejectDemarche(d, (req.body || {}).reason, labelForUser(req.user));
  if (result.error) return res.status(400).json({ error: result.error });
  audit.record({ user: req.user, ip: clientIp(req), module: d.moduleCode, action: `Refus ${d.tracking}` });
  notifyCitizen(d, { type: 'error', title: 'Démarche refusée', message: `${d.demarcheLabel} : ${d.rejectReason}` });
  res.json({ demarche: serializeDemarche(d, { includeInternal: true }) });
});

// ============================================================================
// ESPACE MAIRE — supervision transversale, jamais opérationnel (CDC §2.2)
// ============================================================================
app.get('/api/mayor/dashboard', requireRole(ROLES.MAYOR), (req, res) => {
  const perModule = MODULES.map((m) => {
    const s = D.statsForModule(m.code);
    return {
      code: m.code, name: m.name, short: m.short, icon: m.icon, citizen: m.citizen,
      ...s,
    };
  });
  const totals = perModule.reduce(
    (acc, m) => {
      acc.total += m.total; acc.pending += m.pending; acc.validated += m.validated;
      acc.completed += m.completed; acc.rejected += m.rejected; acc.revenue += m.revenue;
      return acc;
    },
    { total: 0, pending: 0, validated: 0, completed: 0, rejected: 0, revenue: 0 }
  );
  res.json({ perModule, totals, citizens: countCitizens() });
});

// Détail d'un module côté Maire : consultation seule (pas d'action opérationnelle).
app.get('/api/mayor/modules/:code', requireRole(ROLES.MAYOR), (req, res) => {
  const mod = MODULE_BY_CODE[req.params.code];
  if (!mod) return res.status(404).json({ error: 'Module inconnu.' });
  const rows = D.forModule(mod.code).map((d) => serializeDemarche(d, { includeInternal: true }));
  res.json({ module: { code: mod.code, name: mod.name }, stats: D.statsForModule(mod.code), demarches: rows });
});

function countCitizens() {
  return load().users.filter((u) => u.role === ROLES.CITIZEN).length;
}

// ============================================================================
// ESPACE AUDITEUR — lecture seule des journaux, tous modules (CDC §4.3)
// ============================================================================
app.get('/api/audit', requireRole(ROLES.AUDITOR, ROLES.MAYOR, ROLES.ADMIN), (req, res) => {
  const module = req.query.module || null;
  res.json({ entries: audit.list({ module }) });
});

// ============================================================================
// NOTIFICATIONS (CDC technique §7) — chaque utilisateur voit les siennes
// ============================================================================
app.get('/api/notifications', requireAuth, (req, res) => {
  res.json({ notifications: notif.listForUser(req.user.id), unread: notif.unreadCount(req.user.id) });
});
app.post('/api/notifications/read', requireAuth, (req, res) => {
  const { id } = req.body || {};
  if (id) notif.markRead(req.user.id, id);
  else notif.markAllRead(req.user.id);
  res.json({ unread: notif.unreadCount(req.user.id) });
});

// ============================================================================
// SITE PUBLIC (CDC technique §2.1) — vitrine, aucun compte nécessaire
// ============================================================================
app.get('/api/public/site', (req, res) => {
  res.json({
    ...PUBLIC_SITE,
    services: MODULES.filter((m) => m.citizen).map((m) => ({
      code: m.code, name: m.name, short: m.short, icon: m.icon,
      demarches: m.demarches.map((d) => d.label),
    })),
  });
});

// ============================================================================
// ADMINISTRATION SYSTÈME (CDC technique §2.5) — jamais de traitement métier
// ============================================================================
const ADMIN_ASSIGNABLE_ROLES = [ROLES.MANAGER, ROLES.MAYOR, ROLES.AUDITOR, ROLES.ADMIN, ROLES.AGENT];

function adminUserView(u) {
  return { ...publicUser(u), label: labelForUser(u) };
}

app.get('/api/admin/users', requireRole(ROLES.ADMIN), (req, res) => {
  const users = get().users.slice().sort((a, b) => a.id - b.id).map(adminUserView);
  res.json({ users, modules: MODULES.map((m) => ({ code: m.code, name: m.name })) });
});

// Création d'un compte professionnel.
app.post('/api/admin/users', requireRole(ROLES.ADMIN), (req, res) => {
  const { email, name, role, module, password } = req.body || {};
  if (!email || !name || !role) return res.status(400).json({ error: 'Email, nom et rôle requis.' });
  if (!ADMIN_ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle non autorisé.' });
  if (role === ROLES.MANAGER && !module) return res.status(400).json({ error: 'Un gestionnaire doit être rattaché à un module.' });
  if (findUserByEmail(email)) return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
  const temp = password && password.length >= 6 ? password : 'Gmdi@' + Math.floor(1000 + Math.random() * 9000);
  const user = createUser({ email, password: temp, role, name, module: role === ROLES.MANAGER ? module : null, mustChangePassword: true });
  audit.record({ user: req.user, ip: clientIp(req), action: `Création compte ${email} (${role})` });
  res.json({ user: adminUserView(user), tempPassword: temp });
});

// Réinitialisation du mot de passe (génère un mot de passe temporaire).
app.post('/api/admin/users/:id/reset-password', requireRole(ROLES.ADMIN), (req, res) => {
  const u = findUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const temp = 'Gmdi@' + Math.floor(1000 + Math.random() * 9000);
  resetPasswordByAdmin(u, temp);
  audit.record({ user: req.user, ip: clientIp(req), action: `Réinitialisation mot de passe ${u.email}` });
  res.json({ tempPassword: temp });
});

// Activation / désactivation d'un compte.
app.post('/api/admin/users/:id/active', requireRole(ROLES.ADMIN), (req, res) => {
  const u = findUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
  setActive(u, !!(req.body || {}).active);
  audit.record({ user: req.user, ip: clientIp(req), action: `${u.active ? 'Activation' : 'Désactivation'} compte ${u.email}` });
  res.json({ user: adminUserView(u) });
});

// Gestion des rôles.
app.post('/api/admin/users/:id/role', requireRole(ROLES.ADMIN), (req, res) => {
  const u = findUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const { role, module } = req.body || {};
  if (!ADMIN_ASSIGNABLE_ROLES.includes(role) && role !== ROLES.CITIZEN) return res.status(400).json({ error: 'Rôle non autorisé.' });
  if (role === ROLES.MANAGER && !module) return res.status(400).json({ error: 'Un gestionnaire doit être rattaché à un module.' });
  setRole(u, role, module);
  audit.record({ user: req.user, ip: clientIp(req), action: `Changement de rôle ${u.email} → ${role}${module ? ' (module ' + module + ')' : ''}` });
  res.json({ user: adminUserView(u) });
});

// Journaux techniques (= journal d'audit consolidé).
app.get('/api/admin/logs', requireRole(ROLES.ADMIN), (req, res) => {
  res.json({ entries: audit.list({ limit: 500 }) });
});

// ============================================================================
// FICHIERS STATIQUES (front) + routage SPA
// ============================================================================
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Page publique de vérification d'acte via QR (lien direct).
app.get('/verify/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'verify.html'));
});

// Toute autre route non-API renvoie l'app (routing côté client).
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ============================================================================
// DÉMARRAGE
// ============================================================================
export function start() {
  load();
  // Amorçage automatique des comptes de dev au premier lancement.
  const res = seed({ force: false });
  console.log(`GMDI — comptes: ${res.totalUsers}, démarches: ${res.totalDemarches}`);
  return app.listen(PORT, () => {
    console.log(`GMDI en écoute sur http://localhost:${PORT}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { app };
