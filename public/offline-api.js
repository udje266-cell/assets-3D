// GMDI — Backend embarqué (mode APK / hors-ligne).
// Réimplémente l'API du serveur entièrement dans le navigateur, avec
// persistance dans localStorage. Activé en définissant window.__gmdiApi,
// que public/app.js utilise à la place de fetch().
//
// NOTE : version de démonstration autonome. Les mots de passe sont stockés
// localement sur l'appareil (pas de hachage serveur) ; les paiements et l'envoi
// de pièces sont simulés, comme pour la version web.
(function () {
  'use strict';

  // --- Constantes (miroir de src/config.js) --------------------------------
  const MODULES = [
    { code: '01', key: 'etat-civil', name: 'État Civil Numérique', short: 'État Civil', icon: '📋', citizen: true, demarches: [
      { key: 'declaration-naissance', label: 'Déclarer une naissance', fee: 0 },
      { key: 'declaration-deces', label: 'Déclarer un décès', fee: 0 },
      { key: 'extrait-acte', label: "Demander un extrait d'acte", fee: 1000 },
      { key: 'copie-integrale', label: 'Demander une copie intégrale', fee: 2000 } ] },
    { code: '02', key: 'finances', name: 'Finances Locales & Mobile Money', short: 'Finances', icon: '💰', citizen: true, demarches: [
      { key: 'paiement-taxe-fonciere', label: 'Payer la taxe foncière', fee: 25000 },
      { key: 'paiement-patente', label: 'Payer la patente', fee: 15000 },
      { key: 'paiement-taxe-marche', label: 'Payer la taxe de marché', fee: 3000 } ] },
    { code: '03', key: 'rh', name: 'Ressources Humaines (RH)', short: 'RH', icon: '👥', citizen: false, demarches: [] },
    { code: '04', key: 'urbanisme', name: 'Urbanisme, Cadastre & SIG', short: 'Urbanisme', icon: '🏗️', citizen: true, demarches: [
      { key: 'permis-construire', label: 'Déposer une demande de permis de construire', fee: 50000 },
      { key: 'certificat-urbanisme', label: "Demander un certificat d'urbanisme", fee: 5000 },
      { key: 'signalement-foncier', label: 'Signaler une construction illégale', fee: 0 } ] },
    { code: '05', key: 'services-techniques', name: 'Services Techniques & Maintenance', short: 'Services Techniques', icon: '🔧', citizen: true, demarches: [
      { key: 'signalement-voirie', label: 'Signaler un problème de voirie (nid de poule…)', fee: 0 },
      { key: 'signalement-eclairage', label: "Signaler un problème d'éclairage public", fee: 0 },
      { key: 'signalement-ordures', label: 'Signaler un dépôt sauvage / ordures', fee: 0 },
      { key: 'signalement-eau', label: "Signaler une fuite d'eau", fee: 0 } ] },
    { code: '06', key: 'communication', name: 'Communication Institutionnelle & Délibérations', short: 'Communication', icon: '📢', citizen: true, demarches: [
      { key: 'consultation-publique', label: 'Participer à une consultation publique', fee: 0 } ] },
    { code: '08', key: 'patrimoine', name: 'Patrimoine', short: 'Patrimoine', icon: '🏛️', citizen: true, demarches: [
      { key: 'occupation-domaine', label: "Demander l'occupation d'un espace public", fee: 10000 },
      { key: 'signalement-equipement', label: 'Signaler une dégradation sur un équipement public', fee: 0 } ] },
  ];
  const MODULE_BY_CODE = Object.fromEntries(MODULES.map((m) => [m.code, m]));

  const STATUS_LABELS = { pending: 'En attente', in_progress: 'En cours', to_complete: 'À compléter', validated: 'Validé', rejected: 'Refusé', completed: 'Terminé' };
  const PRIORITIES = ['normale', 'prioritaire', 'urgente'];

  const SEED_ACCOUNTS = [
    { email: 'maire@mairie-gmdi.ci', password: 'Maire@2026', role: 'mayor', name: 'Maire de la commune', module: null },
    { email: 'etatcivil@mairie-gmdi.ci', password: 'EtatCivil@2026', role: 'manager', name: 'Gestionnaire — État Civil', module: '01' },
    { email: 'finances@mairie-gmdi.ci', password: 'Finances@2026', role: 'manager', name: 'Gestionnaire — Finances', module: '02' },
    { email: 'rh@mairie-gmdi.ci', password: 'RH@2026', role: 'manager', name: 'Gestionnaire — Ressources Humaines', module: '03' },
    { email: 'urbanisme@mairie-gmdi.ci', password: 'Urbanisme@2026', role: 'manager', name: 'Gestionnaire — Urbanisme & SIG', module: '04' },
    { email: 'technique@mairie-gmdi.ci', password: 'Technique@2026', role: 'manager', name: 'Gestionnaire — Services Techniques', module: '05' },
    { email: 'communication@mairie-gmdi.ci', password: 'Communication@2026', role: 'manager', name: 'Gestionnaire — Communication', module: '06' },
    { email: 'patrimoine@mairie-gmdi.ci', password: 'Patrimoine@2026', role: 'manager', name: 'Gestionnaire — Patrimoine', module: '08' },
    { email: 'auditeur@mairie-gmdi.ci', password: 'Auditeur@2026', role: 'auditor', name: 'Auditeur', module: null },
    { email: 'admin@mairie-gmdi.ci', password: 'Admin@2026', role: 'admin', name: 'Administrateur Système', module: null },
  ];

  const PUBLIC_SITE = {
    mairie: { nom: 'Mairie de la commune', slogan: 'Une administration numérique, proche et transparente',
      presentation: "La mairie met à disposition des citoyens la plateforme GMDI, un guichet numérique unique regroupant l'ensemble des services municipaux. Effectuez vos démarches en ligne, suivez vos dossiers et recevez vos documents officiels sans vous déplacer." },
    actualites: [
      { date: '2026-07-20', titre: 'Ouverture du guichet numérique GMDI', resume: "Tous les services de la mairie sont désormais accessibles en ligne via un compte citoyen unique." },
      { date: '2026-07-15', titre: 'Paiement des taxes par Mobile Money', resume: 'Réglez vos taxes et redevances via Orange Money, MTN, Wave ou carte bancaire, 24h/24.' },
      { date: '2026-07-05', titre: 'Consultation publique : aménagement du marché central', resume: "Donnez votre avis sur le projet via le module Communication jusqu'au 31 août." },
    ],
    contacts: { adresse: "Hôtel de ville, Place de l'Indépendance", telephone: '+225 27 20 00 00 00', email: 'contact@mairie-gmdi.ci', horaires: 'Lun. – Ven. : 08h00 – 16h30' },
  };

  // --- Store (localStorage) -------------------------------------------------
  const DB_KEY = 'gmdi_db_v1';
  const SESSION_KEY = 'gmdi_session_v1';
  let db = null;

  const rid = (p, n) => p + Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();

  function save() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  function load() {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) { try { db = JSON.parse(raw); return; } catch { /* reseed */ } }
    seed();
  }
  function nextId(kind) { db.counters[kind] = (db.counters[kind] || 0) + 1; return db.counters[kind]; }
  function nextTracking(code) { return `GMDI-${code}-${new Date().getFullYear()}-${String(nextId('tracking')).padStart(5, '0')}`; }

  // --- Erreurs HTTP simulées ------------------------------------------------
  function fail(status, error) { const e = new Error(error); e.status = status; throw e; }

  // --- Utilisateurs ---------------------------------------------------------
  function createUser({ email, password, role, name, module = null, mustChangePassword = false }) {
    const u = { id: nextId('user'), email: String(email).trim().toLowerCase(), password, role, module,
      name: name || email, active: true, mustChangePassword, createdAt: new Date().toISOString() };
    db.users.push(u); return u;
  }
  const byEmail = (e) => db.users.find((u) => u.email === String(e || '').trim().toLowerCase());
  const byId = (id) => db.users.find((u) => u.id === Number(id));
  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, email: u.email, role: u.role, module: u.module || null, name: u.name, active: u.active !== false, mustChangePassword: !!u.mustChangePassword, createdAt: u.createdAt };
  }
  function labelForUser(u) {
    if (!u) return 'Système';
    if (u.role === 'admin') return 'Administrateur';
    if (u.role === 'mayor') return 'Maire';
    if (u.role === 'auditor') return 'Auditeur';
    if (u.role === 'manager') return `Gestionnaire ${u.module}`;
    if (u.role === 'agent') return `Agent — ${u.name}`;
    return `Citoyen — ${u.name}`;
  }

  // --- Audit & notifications ------------------------------------------------
  function audit(user, action, module = null) {
    db.audit.push({ id: nextId('audit'), userId: user ? user.id : null, userLabel: labelForUser(user), userEmail: user ? user.email : null,
      timestamp: new Date().toISOString(), ip: 'appareil-local', module, action });
  }
  function notify({ userId, type = 'info', title, message, demarcheId = null, module = null }) {
    if (!userId) return;
    db.notifications.push({ id: nextId('notification'), userId, type, title, message, demarcheId, module, channels: ['interne'], read: false, createdAt: new Date().toISOString() });
  }
  function notifyManagers(code, payload) {
    db.users.filter((u) => u.role === 'manager' && u.module === code && u.active !== false)
      .forEach((m) => notify({ userId: m.id, module: code, ...payload }));
  }

  // --- Démarches ------------------------------------------------------------
  const needsPayment = (d) => d.fee > 0 && !d.payment;
  const findDemarcheDef = (code, key) => (MODULE_BY_CODE[code] ? MODULE_BY_CODE[code].demarches.find((x) => x.key === key) : null);
  function hist(d, action, by) { d.history.push({ at: new Date().toISOString(), action, by }); }
  function generateActe(d) {
    return { number: `ACTE-${d.moduleCode}-${String(d.id).padStart(6, '0')}`, qrToken: rid('', 24), verifyUrl: `/verify/${rid('', 4)}`, generatedAt: new Date().toISOString() };
  }
  function createDemarche(citizen, code, key, formData) {
    const mod = MODULE_BY_CODE[code];
    if (!mod) return { error: 'Module inconnu.' };
    if (!mod.citizen) return { error: 'Ce module ne propose pas de démarche citoyenne.' };
    const def = findDemarcheDef(code, key);
    if (!def) return { error: 'Démarche inconnue pour ce module.' };
    const id = nextId('demarche');
    const fee = def.fee || 0;
    const d = { id, tracking: nextTracking(code), moduleCode: code, moduleKey: mod.key, demarcheKey: key, demarcheLabel: def.label,
      citizenId: citizen.id, citizenName: citizen.name, status: 'pending', priority: 'normale', fee,
      payment: fee > 0 ? null : { method: 'gratuit', paidAt: new Date().toISOString(), amount: 0 },
      formData: formData || {}, acte: null, rejectReason: null, completionRequest: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] };
    hist(d, 'Démarche déposée', `Citoyen — ${citizen.name}`);
    db.demarches.push(d);
    return { demarche: d };
  }
  const forCitizen = (id) => db.demarches.filter((d) => d.citizenId === id).sort((a, b) => b.id - a.id);
  const forModule = (code) => db.demarches.filter((d) => d.moduleCode === code).sort((a, b) => b.id - a.id);
  const demById = (id) => db.demarches.find((d) => d.id === Number(id));
  function statsForModule(code) {
    const rows = forModule(code);
    const byStatus = { pending: 0, in_progress: 0, to_complete: 0, validated: 0, rejected: 0, completed: 0 };
    let revenue = 0;
    rows.forEach((d) => { byStatus[d.status] = (byStatus[d.status] || 0) + 1; if (d.payment && d.payment.amount) revenue += d.payment.amount; });
    return { moduleCode: code, total: rows.length, pending: byStatus.pending + byStatus.in_progress + byStatus.to_complete,
      validated: byStatus.validated, completed: byStatus.completed, rejected: byStatus.rejected, byStatus, revenue };
  }
  function serialize(d, internal) {
    const b = { id: d.id, tracking: d.tracking, moduleCode: d.moduleCode, moduleName: MODULE_BY_CODE[d.moduleCode]?.name, moduleIcon: MODULE_BY_CODE[d.moduleCode]?.icon,
      demarcheKey: d.demarcheKey, demarcheLabel: d.demarcheLabel, status: d.status, statusLabel: STATUS_LABELS[d.status], priority: d.priority,
      fee: d.fee, payment: d.payment, needsPayment: needsPayment(d), acte: d.acte, rejectReason: d.rejectReason, completionRequest: d.completionRequest || null,
      createdAt: d.createdAt, updatedAt: d.updatedAt, history: d.history, formData: d.formData };
    if (internal) { b.citizenId = d.citizenId; b.citizenName = d.citizenName; }
    return b;
  }
  const touch = (d) => { d.updatedAt = new Date().toISOString(); };

  // --- Seed ----------------------------------------------------------------
  function seed() {
    db = { users: [], demarches: [], audit: [], notifications: [], counters: { user: 0, demarche: 0, audit: 0, tracking: 0, notification: 0 } };
    SEED_ACCOUNTS.forEach((a) => createUser({ ...a, mustChangePassword: false }));
    const citizen = createUser({ email: 'koffi.aya@example.ci', password: 'Citoyen@2026', role: 'citizen', name: 'Aya Koffi' });
    createUser({ email: 'agent.diallo@mairie-gmdi.ci', password: 'Agent@2026', role: 'agent', name: 'Mamadou Diallo', module: '03' });

    const pay = (d, method) => { d.payment = { method, amount: d.fee, reference: rid('PAY-', 6), receipt: rid('RECU-', 5), paidAt: new Date().toISOString() }; hist(d, `Paiement reçu (${method}) — ${d.fee} FCFA · reçu ${d.payment.receipt}`, `Citoyen — ${d.citizenName}`); };
    const validate = (d, by) => { d.status = 'validated'; d.acte = generateActe(d); hist(d, `Validée — acte ${d.acte.number} généré (QR ${d.acte.qrToken})`, by); };

    let r = createDemarche(citizen, '01', 'extrait-acte', { nom: 'Koffi', prenom: 'Aya', typeActe: 'Naissance' }).demarche;
    pay(r, 'Orange Money'); validate(r, 'Gestionnaire 01'); r.status = 'completed'; hist(r, 'Dossier clôturé — document délivré', 'Gestionnaire 01');
    notify({ userId: citizen.id, type: 'success', title: 'Dossier terminé', message: `Votre extrait d'acte (${r.acte.number}) est disponible.`, demarcheId: r.id, module: '01' });

    createDemarche(citizen, '05', 'signalement-voirie', { lieu: 'Rue des Jardins', description: 'Nid de poule profond', gps: '5.345,-4.024' });

    r = createDemarche(citizen, '04', 'permis-construire', { parcelle: 'P-1024', surface: '120 m²' }).demarche;
    pay(r, 'Wave'); r.status = 'rejected'; r.rejectReason = 'Zone non constructible selon le SIG.'; hist(r, 'Refusée — motif : Zone non constructible selon le SIG.', 'Gestionnaire 04');
    notify({ userId: citizen.id, type: 'error', title: 'Démarche refusée', message: 'Permis de construire : zone non constructible selon le SIG.', demarcheId: r.id, module: '04' });

    r = createDemarche(citizen, '02', 'paiement-taxe-fonciere', { bien: 'Villa Cocody' }).demarche;
    pay(r, 'MTN Mobile Money'); validate(r, 'Gestionnaire 02');

    r = createDemarche(citizen, '01', 'copie-integrale', { nom: 'Koffi', typeActe: 'Mariage' }).demarche;
    pay(r, 'Carte bancaire'); r.status = 'in_progress'; hist(r, 'Prise en charge — vérification en cours', 'Gestionnaire 01');

    r = createDemarche(citizen, '08', 'occupation-domaine', { lieu: 'Place du marché', usage: 'Kiosque' }).demarche;
    pay(r, 'Orange Money'); r.status = 'to_complete'; r.completionRequest = "Merci de joindre un plan d'implantation du kiosque."; hist(r, "Complément demandé : Merci de joindre un plan d'implantation du kiosque.", 'Gestionnaire 08');
    notify({ userId: citizen.id, type: 'warning', title: 'Dossier à compléter', message: "Occupation du domaine : joindre un plan d'implantation.", demarcheId: r.id, module: '08' });

    save();
  }

  // --- Sessions -------------------------------------------------------------
  let currentUserId = Number(localStorage.getItem(SESSION_KEY)) || null;
  const setSession = (id) => { currentUserId = id; if (id) localStorage.setItem(SESSION_KEY, String(id)); else localStorage.removeItem(SESSION_KEY); };
  const currentUser = () => (currentUserId ? byId(currentUserId) : null);
  function requireRole() {
    const u = currentUser();
    if (!u) fail(401, 'Authentification requise.');
    if (arguments.length && !Array.from(arguments).includes(u.role)) fail(403, 'Accès non autorisé pour votre rôle.');
    return u;
  }
  const guardModule = (u, d) => d && d.moduleCode === u.module;

  // --- Routeur --------------------------------------------------------------
  const routes = [];
  function route(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    routes.push({ method, rx, keys, handler });
  }

  // AUTH
  route('POST', '/auth/register', (p, body) => {
    if (!body.email || !body.password || !body.name) fail(400, 'Nom, email et mot de passe requis.');
    if (String(body.password).length < 6) fail(400, 'Mot de passe trop court (min. 6 caractères).');
    if (byEmail(body.email)) fail(409, 'Un compte existe déjà avec cet email.');
    const u = createUser({ email: body.email, password: body.password, role: 'citizen', name: body.name });
    setSession(u.id); audit(u, 'Création de compte citoyen'); save();
    return { user: publicUser(u) };
  });
  route('POST', '/auth/login', (p, body) => {
    if (!body.email || !body.password) fail(400, 'Email et mot de passe requis.');
    const u = byEmail(body.email);
    if (!u) fail(401, 'Identifiants incorrects.');
    if (u.active === false) fail(403, "Ce compte est désactivé. Contactez l'administrateur.");
    if (u.password !== body.password) fail(401, 'Identifiants incorrects.');
    setSession(u.id); audit(u, 'Connexion réussie', u.module || null); save();
    return { user: publicUser(u) };
  });
  route('POST', '/auth/logout', () => { const u = currentUser(); if (u) audit(u, 'Déconnexion', u.module || null); setSession(null); save(); return { ok: true }; });
  route('GET', '/auth/me', () => ({ user: publicUser(currentUser()) }));
  route('POST', '/auth/change-password', (p, body) => {
    const u = requireRole();
    if (!body.newPassword || String(body.newPassword).length < 6) fail(400, 'Nouveau mot de passe trop court (min. 6 caractères).');
    if (!u.mustChangePassword && u.password !== body.currentPassword) fail(401, 'Mot de passe actuel incorrect.');
    u.password = body.newPassword; u.mustChangePassword = false; audit(u, 'Modification du mot de passe', u.module || null); save();
    return { ok: true };
  });

  // META / PUBLIC
  route('GET', '/modules', () => ({ modules: MODULES.map((m) => ({ code: m.code, key: m.key, name: m.name, short: m.short, icon: m.icon, citizen: m.citizen, demarches: m.demarches })), statusLabels: STATUS_LABELS }));
  route('GET', '/verify/:token', (p) => {
    const d = db.demarches.find((x) => x.acte && x.acte.qrToken === p.token);
    if (!d) fail(404, 'Aucun acte ne correspond à ce code.');
    return { valid: true, acte: d.acte.number, module: MODULE_BY_CODE[d.moduleCode]?.name, demarche: d.demarcheLabel, delivrePar: 'Mairie GMDI', date: d.acte.generatedAt, beneficiaire: d.citizenName };
  });
  route('GET', '/public/site', () => ({ ...PUBLIC_SITE, services: MODULES.filter((m) => m.citizen).map((m) => ({ code: m.code, name: m.name, short: m.short, icon: m.icon, demarches: m.demarches.map((d) => d.label) })) }));

  // CITOYEN
  route('GET', '/citizen/demarches', () => { const u = requireRole('citizen'); return { demarches: forCitizen(u.id).map((d) => serialize(d)) }; });
  route('POST', '/citizen/demarches', (p, body) => {
    const u = requireRole('citizen');
    const r = createDemarche(u, body.moduleCode, body.demarcheKey, body.formData);
    if (r.error) fail(400, r.error);
    audit(u, `Dépôt démarche ${r.demarche.tracking}`, body.moduleCode);
    notify({ userId: u.id, type: 'info', title: 'Démarche enregistrée', message: `Votre démarche « ${r.demarche.demarcheLabel} » a été déposée (${r.demarche.tracking}).`, demarcheId: r.demarche.id, module: body.moduleCode });
    if (!needsPayment(r.demarche)) notifyManagers(body.moduleCode, { type: 'info', title: 'Nouvelle demande', message: `${r.demarche.tracking} — ${r.demarche.demarcheLabel} (${u.name})`, demarcheId: r.demarche.id });
    save();
    return { demarche: serialize(r.demarche) };
  });
  route('GET', '/citizen/demarches/:id', (p) => { const u = requireRole('citizen'); const d = demById(p.id); if (!d || d.citizenId !== u.id) fail(404, 'Démarche introuvable.'); return { demarche: serialize(d) }; });
  route('POST', '/citizen/demarches/:id/pay', (p, body) => {
    const u = requireRole('citizen'); const d = demById(p.id);
    if (!d || d.citizenId !== u.id) fail(404, 'Démarche introuvable.');
    if (!needsPayment(d)) fail(400, "Aucun paiement n'est attendu pour cette démarche.");
    if (d.status !== 'pending') fail(400, "Cette démarche n'est pas en attente de paiement.");
    if (!['Orange Money', 'MTN Mobile Money', 'Wave', 'Carte bancaire'].includes(body.method)) fail(400, 'Moyen de paiement non supporté.');
    d.payment = { method: body.method, amount: d.fee, reference: rid('PAY-', 6), receipt: rid('RECU-', 5), paidAt: new Date().toISOString() };
    touch(d); hist(d, `Paiement reçu (${body.method}) — ${d.fee} FCFA · reçu ${d.payment.receipt}`, `Citoyen — ${d.citizenName}`);
    audit(u, `Paiement démarche ${d.tracking} (${body.method})`, d.moduleCode);
    notify({ userId: u.id, type: 'success', title: 'Paiement confirmé', message: `Reçu ${d.payment.receipt} — ${d.demarcheLabel}. Votre dossier est transmis au service.`, demarcheId: d.id, module: d.moduleCode });
    notifyManagers(d.moduleCode, { type: 'info', title: 'Nouvelle demande (payée)', message: `${d.tracking} — ${d.demarcheLabel} (${d.citizenName})`, demarcheId: d.id });
    save();
    return { demarche: serialize(d) };
  });
  route('POST', '/citizen/demarches/:id/complete', (p, body) => {
    const u = requireRole('citizen'); const d = demById(p.id);
    if (!d || d.citizenId !== u.id) fail(404, 'Démarche introuvable.');
    if (d.status !== 'to_complete') fail(400, "Aucun complément n'est attendu pour cette démarche.");
    d.formData = { ...(d.formData || {}), complement: (body.info || '').trim() };
    d.status = 'in_progress'; d.completionRequest = null; touch(d);
    hist(d, `Complément fourni par le citoyen${body.info ? ' : ' + body.info.trim() : ''}`, `Citoyen — ${d.citizenName}`);
    audit(u, `Complément fourni ${d.tracking}`, d.moduleCode);
    notifyManagers(d.moduleCode, { type: 'info', title: 'Complément reçu', message: `${d.tracking} — le citoyen a complété son dossier.`, demarcheId: d.id });
    save();
    return { demarche: serialize(d) };
  });

  // GESTIONNAIRE
  route('GET', '/manager/demarches', () => { const u = requireRole('manager'); return { module: u.module, demarches: forModule(u.module).map((d) => serialize(d, true)) }; });
  route('GET', '/manager/stats', () => { const u = requireRole('manager'); return { stats: statsForModule(u.module) }; });
  function managerAction(id, fn) {
    const u = requireRole('manager'); const d = demById(id);
    if (!guardModule(u, d)) fail(404, 'Démarche introuvable dans votre module.');
    fn(u, d); touch(d); save();
    return { demarche: serialize(d, true) };
  }
  route('POST', '/manager/demarches/:id/review', (p) => managerAction(p.id, (u, d) => {
    if (!['pending', 'to_complete'].includes(d.status)) fail(400, 'Dossier non traitable dans son état actuel.');
    if (needsPayment(d)) fail(400, 'Paiement en attente : dossier non traitable.');
    d.status = 'in_progress'; hist(d, 'Prise en charge — vérification en cours', labelForUser(u)); audit(u, `Prise en charge ${d.tracking}`, d.moduleCode);
  }));
  route('POST', '/manager/demarches/:id/priority', (p, body) => managerAction(p.id, (u, d) => {
    if (!PRIORITIES.includes(body.priority)) fail(400, 'Priorité invalide.');
    d.priority = body.priority; audit(u, `Priorité ${d.priority} — ${d.tracking}`, d.moduleCode);
  }));
  route('POST', '/manager/demarches/:id/request-completion', (p, body) => managerAction(p.id, (u, d) => {
    if (!['pending', 'in_progress'].includes(d.status)) fail(400, "Impossible de demander un complément dans l'état actuel.");
    if (!body.message || !body.message.trim()) fail(400, 'Précisez ce qui doit être complété.');
    d.status = 'to_complete'; d.completionRequest = body.message.trim(); hist(d, `Complément demandé : ${d.completionRequest}`, labelForUser(u));
    audit(u, `Complément demandé ${d.tracking}`, d.moduleCode);
    notify({ userId: d.citizenId, type: 'warning', title: 'Dossier à compléter', message: `${d.demarcheLabel} : ${d.completionRequest}`, demarcheId: d.id, module: d.moduleCode });
  }));
  route('POST', '/manager/demarches/:id/validate', (p) => managerAction(p.id, (u, d) => {
    if (!['pending', 'in_progress'].includes(d.status)) fail(400, 'Ce dossier ne peut pas être validé dans son état actuel.');
    if (needsPayment(d)) fail(400, 'Paiement en attente : validation impossible.');
    d.status = 'validated'; d.acte = generateActe(d); d.rejectReason = null; hist(d, `Validée — acte ${d.acte.number} généré (QR ${d.acte.qrToken})`, labelForUser(u));
    audit(u, `Validation ${d.tracking} — acte ${d.acte.number}`, d.moduleCode);
    notify({ userId: d.citizenId, type: 'success', title: 'Démarche validée', message: `${d.demarcheLabel} : votre document (${d.acte.number}) est disponible.`, demarcheId: d.id, module: d.moduleCode });
  }));
  route('POST', '/manager/demarches/:id/close', (p) => managerAction(p.id, (u, d) => {
    if (d.status !== 'validated') fail(400, 'Seul un dossier validé peut être clôturé.');
    d.status = 'completed'; hist(d, 'Dossier clôturé — document délivré', labelForUser(u)); audit(u, `Clôture ${d.tracking}`, d.moduleCode);
    notify({ userId: d.citizenId, type: 'success', title: 'Dossier terminé', message: `${d.demarcheLabel} : dossier clôturé.`, demarcheId: d.id, module: d.moduleCode });
  }));
  route('POST', '/manager/demarches/:id/reject', (p, body) => managerAction(p.id, (u, d) => {
    if (!['pending', 'in_progress', 'to_complete'].includes(d.status)) fail(400, 'Ce dossier ne peut pas être refusé dans son état actuel.');
    if (!body.reason || !body.reason.trim()) fail(400, 'Le motif de refus est obligatoire.');
    d.status = 'rejected'; d.rejectReason = body.reason.trim(); hist(d, `Refusée — motif : ${d.rejectReason}`, labelForUser(u)); audit(u, `Refus ${d.tracking}`, d.moduleCode);
    notify({ userId: d.citizenId, type: 'error', title: 'Démarche refusée', message: `${d.demarcheLabel} : ${d.rejectReason}`, demarcheId: d.id, module: d.moduleCode });
  }));

  // MAIRE
  route('GET', '/mayor/dashboard', () => {
    requireRole('mayor');
    const perModule = MODULES.map((m) => ({ code: m.code, name: m.name, short: m.short, icon: m.icon, citizen: m.citizen, ...statsForModule(m.code) }));
    const totals = perModule.reduce((a, m) => { a.total += m.total; a.pending += m.pending; a.validated += m.validated; a.completed += m.completed; a.rejected += m.rejected; a.revenue += m.revenue; return a; }, { total: 0, pending: 0, validated: 0, completed: 0, rejected: 0, revenue: 0 });
    return { perModule, totals, citizens: db.users.filter((u) => u.role === 'citizen').length };
  });
  route('GET', '/mayor/modules/:code', (p) => {
    requireRole('mayor'); const mod = MODULE_BY_CODE[p.code]; if (!mod) fail(404, 'Module inconnu.');
    return { module: { code: mod.code, name: mod.name }, stats: statsForModule(mod.code), demarches: forModule(mod.code).map((d) => serialize(d, true)) };
  });

  // AUDIT
  route('GET', '/audit', () => {
    requireRole('auditor', 'mayor', 'admin');
    return { entries: db.audit.slice().sort((a, b) => b.id - a.id).slice(0, 500) };
  });

  // NOTIFICATIONS
  route('GET', '/notifications', () => {
    const u = requireRole();
    const list = db.notifications.filter((n) => n.userId === u.id).sort((a, b) => b.id - a.id).slice(0, 50);
    return { notifications: list, unread: db.notifications.filter((n) => n.userId === u.id && !n.read).length };
  });
  route('POST', '/notifications/read', (p, body) => {
    const u = requireRole();
    db.notifications.forEach((n) => { if (n.userId === u.id && (!body.id || n.id === Number(body.id))) n.read = true; });
    save();
    return { unread: db.notifications.filter((n) => n.userId === u.id && !n.read).length };
  });

  // ADMIN
  const ASSIGNABLE = ['manager', 'mayor', 'auditor', 'admin', 'agent'];
  const adminView = (u) => ({ ...publicUser(u), label: labelForUser(u) });
  route('GET', '/admin/users', () => { requireRole('admin'); return { users: db.users.slice().sort((a, b) => a.id - b.id).map(adminView), modules: MODULES.map((m) => ({ code: m.code, name: m.name })) }; });
  route('POST', '/admin/users', (p, body) => {
    const admin = requireRole('admin');
    if (!body.email || !body.name || !body.role) fail(400, 'Email, nom et rôle requis.');
    if (!ASSIGNABLE.includes(body.role)) fail(400, 'Rôle non autorisé.');
    if (body.role === 'manager' && !body.module) fail(400, 'Un gestionnaire doit être rattaché à un module.');
    if (byEmail(body.email)) fail(409, 'Un compte existe déjà avec cet email.');
    const temp = body.password && body.password.length >= 6 ? body.password : 'Gmdi@' + Math.floor(1000 + Math.random() * 9000);
    const u = createUser({ email: body.email, password: temp, role: body.role, name: body.name, module: body.role === 'manager' ? body.module : null, mustChangePassword: true });
    audit(admin, `Création compte ${u.email} (${body.role})`); save();
    return { user: adminView(u), tempPassword: temp };
  });
  route('POST', '/admin/users/:id/reset-password', (p) => {
    const admin = requireRole('admin'); const u = byId(p.id); if (!u) fail(404, 'Utilisateur introuvable.');
    const temp = 'Gmdi@' + Math.floor(1000 + Math.random() * 9000); u.password = temp; u.mustChangePassword = true;
    audit(admin, `Réinitialisation mot de passe ${u.email}`); save();
    return { tempPassword: temp };
  });
  route('POST', '/admin/users/:id/active', (p, body) => {
    const admin = requireRole('admin'); const u = byId(p.id); if (!u) fail(404, 'Utilisateur introuvable.');
    if (u.id === admin.id) fail(400, 'Vous ne pouvez pas désactiver votre propre compte.');
    u.active = !!body.active; audit(admin, `${u.active ? 'Activation' : 'Désactivation'} compte ${u.email}`); save();
    return { user: adminView(u) };
  });
  route('POST', '/admin/users/:id/role', (p, body) => {
    const admin = requireRole('admin'); const u = byId(p.id); if (!u) fail(404, 'Utilisateur introuvable.');
    if (!ASSIGNABLE.includes(body.role) && body.role !== 'citizen') fail(400, 'Rôle non autorisé.');
    if (body.role === 'manager' && !body.module) fail(400, 'Un gestionnaire doit être rattaché à un module.');
    u.role = body.role; u.module = body.role === 'manager' ? body.module : null;
    audit(admin, `Changement de rôle ${u.email} → ${body.role}${body.module ? ' (module ' + body.module + ')' : ''}`); save();
    return { user: adminView(u) };
  });
  route('GET', '/admin/logs', () => { requireRole('admin'); return { entries: db.audit.slice().sort((a, b) => b.id - a.id).slice(0, 500) }; });

  // --- Point d'entrée exposé -----------------------------------------------
  window.__gmdiApi = function (path, opts) {
    const method = (opts && opts.method) || 'GET';
    const body = (opts && opts.body) || {};
    if (!db) load();
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        return Promise.resolve(r.handler(params, body));
      } catch (e) {
        return Promise.reject(new Error(e.message || 'Erreur'));
      }
    }
    return Promise.reject(new Error('Route inconnue : ' + method + ' ' + path));
  };

  // Outil de démonstration : réinitialiser les données locales.
  window.__gmdiReset = function () { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); location.reload(); };
})();
