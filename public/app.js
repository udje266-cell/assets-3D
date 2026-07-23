// GMDI — Application front (vanilla JS, routeur par hash).
// Trois espaces derrière une seule app : Portail Citoyen, Back Office Maire,
// Back Office Gestionnaires (+ Auditeur). Le rôle est déduit à la connexion.

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById('app');
const modalRoot = () => document.getElementById('modal-root');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fcfa(n) { return (n || 0).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* pas de corps */ }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

// État global léger.
const state = { user: null, modules: [], statusLabels: {} };

function badge(status) {
  return `<span class="badge ${status}">${esc(state.statusLabels[status] || status)}</span>`;
}
function prioBadge(p) { return `<span class="badge prio-${p}">${esc(p)}</span>`; }

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function openModal({ title, bodyHTML, footHTML = '' }) {
  modalRoot().innerHTML = `
    <div class="modal-backdrop" id="mb">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="close-x" id="mx">&times;</button></div>
        <div class="modal-body">${bodyHTML}</div>
        ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}
      </div>
    </div>`;
  const close = () => (modalRoot().innerHTML = '');
  $('#mx').onclick = close;
  $('#mb').onclick = (e) => { if (e.target.id === 'mb') close(); };
  return close;
}
function closeModal() { modalRoot().innerHTML = ''; }

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------
function roleLabel(u) {
  if (!u) return '';
  return { mayor: 'Maire', manager: 'Gestionnaire', citizen: 'Citoyen', agent: 'Agent municipal', auditor: 'Auditeur' }[u.role] || u.role;
}
function topbar() {
  const u = state.user;
  const moduleName = u && u.module ? (state.modules.find((m) => m.code === u.module)?.name || u.module) : '';
  return `
    <div class="topbar">
      <div class="brand">
        <div class="logo">G</div>
        <div>GMDI<small>Gestion Municipale Digitale Intégrée</small></div>
      </div>
      <div class="spacer"></div>
      ${u ? `
        <div class="who"><b>${esc(u.name)}</b><span class="muted" style="color:#cbd5e6">${esc(u.email)}</span></div>
        <span class="role-chip">${esc(roleLabel(u))}${moduleName ? ' · ' + esc(moduleName) : ''}</span>
        <button class="btn secondary small" id="logout">Déconnexion</button>
      ` : ''}
    </div>`;
}
function wireTopbar() {
  const b = $('#logout');
  if (b) b.onclick = async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; location.hash = '#/'; };
}

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------
const routes = {};
function route(path, handler) { routes[path] = handler; }

async function render() {
  closeModal(); // toute navigation ferme une éventuelle fenêtre modale ouverte
  const hash = location.hash || '#/';
  const [pathRaw] = hash.slice(1).split('?');
  const parts = pathRaw.split('/').filter(Boolean); // ex: ['citizen'] ou ['mayor','module','01']
  const key = '/' + (parts[0] || '');
  const handler = routes[key] || routes['/'];
  try {
    await handler(parts.slice(1));
  } catch (err) {
    app().innerHTML = topbar() + `<div class="container"><div class="alert error">${esc(err.message)}</div></div>`;
    wireTopbar();
  }
}

async function ensureMeta() {
  if (state.modules.length) return;
  const m = await api('/modules');
  state.modules = m.modules;
  state.statusLabels = m.statusLabels;
}
async function ensureSession() {
  const me = await api('/auth/me');
  state.user = me.user;
  return me.user;
}

// Redirige un utilisateur connecté vers son espace.
function homeForUser(u) {
  if (!u) return '#/';
  if (u.role === 'mayor') return '#/mayor';
  if (u.role === 'manager') return '#/manager';
  if (u.role === 'auditor') return '#/audit';
  return '#/citizen';
}

// ===========================================================================
// LANDING
// ===========================================================================
route('/', async () => {
  await ensureMeta();
  await ensureSession();
  if (state.user) { location.hash = homeForUser(state.user); return; }
  app().innerHTML = topbar() + `
    <div class="landing">
      <div class="logo-big" style="width:64px;height:64px;border-radius:14px;background:var(--navy);color:#fff;display:grid;place-items:center;font-weight:800;font-size:26px;margin:0 auto 18px">G</div>
      <h1>Plateforme municipale GMDI</h1>
      <p class="muted">Une plateforme unique et intégrée pour l'ensemble des services de la mairie : un compte citoyen unique, une supervision transversale pour le Maire, et un espace de gestion dédié par module.</p>
      <div class="choices">
        <div class="card choice">
          <div class="icon">🧑‍💼</div>
          <h3>Portail Citoyen</h3>
          <p class="muted">Effectuez vos démarches en ligne, payez, suivez vos dossiers et recevez vos actes.</p>
          <a class="btn" href="#/portail">Accéder au Portail Citoyen</a>
        </div>
        <div class="card choice">
          <div class="icon">🏛️</div>
          <h3>Back Office (personnel municipal)</h3>
          <p class="muted">Maire, gestionnaires de module et auditeur. Une seule page de connexion sécurisée.</p>
          <a class="btn secondary" href="#/login">Connexion Back Office</a>
        </div>
      </div>
      <p class="muted" style="margin-top:34px;font-size:12.5px">Vérifier l'authenticité d'un acte ? Scannez son QR Code ou saisissez son code sur la page de vérification.</p>
    </div>`;
  wireTopbar();
});

// ===========================================================================
// AUTH — Portail Citoyen (inscription / connexion)
// ===========================================================================
route('/portail', async () => {
  await ensureMeta();
  await ensureSession();
  if (state.user) { location.hash = homeForUser(state.user); return; }
  renderAuth('citizen');
});

// AUTH — Back Office (connexion unique Maire/Gestionnaire/Auditeur)
route('/login', async () => {
  await ensureMeta();
  await ensureSession();
  if (state.user) { location.hash = homeForUser(state.user); return; }
  renderAuth('backoffice');
});

function renderAuth(context) {
  const isCitizen = context === 'citizen';
  app().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-hero">
        <div class="logo-big">G</div>
        <h1>${isCitizen ? 'Portail Citoyen' : 'Back Office GMDI'}</h1>
        <p>${isCitizen
          ? "Un seul compte pour toutes vos démarches municipales, quel que soit le service concerné."
          : "Espace réservé au personnel municipal. Le système identifie automatiquement votre rôle et votre module."}</p>
        <ul>
          ${isCitizen
            ? '<li>État civil, taxes, urbanisme, signalements…</li><li>Paiement en ligne (Mobile Money, carte)</li><li>Suivi centralisé « Mes démarches »</li>'
            : '<li>Supervision transversale (Maire)</li><li>Gestion opérationnelle par module</li><li>Journal d\'audit et traçabilité</li>'}
        </ul>
      </div>
      <div class="auth-panel">
        <div class="auth-box">
          ${isCitizen ? `
            <div class="auth-tabs">
              <button data-tab="login" class="active">Connexion</button>
              <button data-tab="register">Créer un compte</button>
            </div>` : `<h2>Connexion sécurisée</h2><p class="muted">Adresse professionnelle et mot de passe.</p>`}
          <div id="auth-form"></div>
          <p style="margin-top:18px;font-size:13px"><a href="#/">← Retour à l'accueil</a></p>
          ${!isCitizen ? demoAccountsHint() : ''}
        </div>
      </div>
    </div>`;

  let tab = 'login';
  const paint = () => {
    $('#auth-form').innerHTML = tab === 'register' ? registerForm() : loginForm(isCitizen);
    wireAuthForm(tab, isCitizen);
  };
  if (isCitizen) {
    document.querySelectorAll('.auth-tabs button').forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab;
        document.querySelectorAll('.auth-tabs button').forEach((x) => x.classList.toggle('active', x === b));
        paint();
      };
    });
  }
  paint();
}

function demoAccountsHint() {
  return `<details style="margin-top:20px;font-size:12.5px"><summary class="muted" style="cursor:pointer">Comptes de démonstration</summary>
    <div class="kv" style="margin-top:10px;grid-template-columns:1fr">
      <div>Maire : <code>maire@mairie-gmdi.ci</code> / <code>Maire@2026</code></div>
      <div>État Civil : <code>etatcivil@mairie-gmdi.ci</code> / <code>EtatCivil@2026</code></div>
      <div>Finances : <code>finances@mairie-gmdi.ci</code> / <code>Finances@2026</code></div>
      <div>Urbanisme : <code>urbanisme@mairie-gmdi.ci</code> / <code>Urbanisme@2026</code></div>
      <div>Auditeur : <code>auditeur@mairie-gmdi.ci</code> / <code>Auditeur@2026</code></div>
    </div></details>`;
}

function loginForm(isCitizen) {
  return `
    <div id="auth-alert"></div>
    <label class="field"><span>${isCitizen ? 'Adresse email' : 'Adresse professionnelle'}</span>
      <input id="email" type="email" autocomplete="username" placeholder="${isCitizen ? 'vous@example.ci' : 'module@mairie-gmdi.ci'}" /></label>
    <label class="field"><span>Mot de passe</span>
      <input id="password" type="password" autocomplete="current-password" placeholder="••••••••" /></label>
    <button class="btn" id="submit" style="width:100%">Se connecter</button>`;
}
function registerForm() {
  return `
    <div id="auth-alert"></div>
    <label class="field"><span>Nom complet</span><input id="name" placeholder="Prénom Nom" /></label>
    <label class="field"><span>Adresse email</span><input id="email" type="email" placeholder="vous@example.ci" /></label>
    <label class="field"><span>Mot de passe</span><input id="password" type="password" placeholder="min. 6 caractères" /></label>
    <button class="btn" id="submit" style="width:100%">Créer mon compte citoyen</button>`;
}

function wireAuthForm(tab, isCitizen) {
  const alert = (msg) => ($('#auth-alert').innerHTML = `<div class="alert error">${esc(msg)}</div>`);
  $('#submit').onclick = async () => {
    try {
      $('#submit').disabled = true;
      if (tab === 'register') {
        const body = { name: $('#name').value.trim(), email: $('#email').value.trim(), password: $('#password').value };
        const r = await api('/auth/register', { method: 'POST', body });
        state.user = r.user;
      } else {
        const body = { email: $('#email').value.trim(), password: $('#password').value };
        const r = await api('/auth/login', { method: 'POST', body });
        state.user = r.user;
      }
      if (state.user.mustChangePassword) { location.hash = '#/change-password'; return; }
      location.hash = homeForUser(state.user);
    } catch (err) {
      $('#submit').disabled = false;
      alert(err.message);
    }
  };
  ['email', 'password', 'name'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#submit').click(); });
  });
}

// ===========================================================================
// CHANGEMENT DE MOT DE PASSE
// ===========================================================================
route('/change-password', async () => {
  const u = await ensureSession();
  if (!u) { location.hash = '#/'; return; }
  await ensureMeta();
  app().innerHTML = topbar() + `
    <div class="container" style="max-width:460px">
      <h1 class="page-title">Modifier le mot de passe</h1>
      <p class="page-sub">${u.mustChangePassword ? 'Vous devez définir un nouveau mot de passe avant de continuer.' : ''}</p>
      <div class="card pad">
        <div id="cp-alert"></div>
        ${u.mustChangePassword ? '' : '<label class="field"><span>Mot de passe actuel</span><input id="cur" type="password" /></label>'}
        <label class="field"><span>Nouveau mot de passe</span><input id="np" type="password" placeholder="min. 6 caractères" /></label>
        <div class="btn-row"><button class="btn" id="save">Enregistrer</button>
        <a class="btn ghost" href="${homeForUser(u)}">Annuler</a></div>
      </div>
    </div>`;
  wireTopbar();
  $('#save').onclick = async () => {
    try {
      const body = { newPassword: $('#np').value };
      if ($('#cur')) body.currentPassword = $('#cur').value;
      await api('/auth/change-password', { method: 'POST', body });
      state.user.mustChangePassword = false;
      $('#cp-alert').innerHTML = '<div class="alert success">Mot de passe mis à jour.</div>';
      setTimeout(() => (location.hash = homeForUser(state.user)), 800);
    } catch (err) {
      $('#cp-alert').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  };
});

// ===========================================================================
// ESPACE CITOYEN
// ===========================================================================
route('/citizen', async () => {
  const u = await ensureSession();
  await ensureMeta();
  if (!u) { location.hash = '#/portail'; return; }
  if (u.role !== 'citizen') { location.hash = homeForUser(u); return; }

  const { demarches } = await api('/citizen/demarches');
  const pending = demarches.filter((d) => ['submitted', 'paid', 'in_review'].includes(d.status)).length;
  const done = demarches.filter((d) => d.status === 'validated').length;

  app().innerHTML = topbar() + `
    <div class="container">
      <h1 class="page-title">Bonjour ${esc(u.name)} 👋</h1>
      <p class="page-sub">Votre tableau de bord personnel. Vous ne voyez que vos propres démarches.</p>

      <div class="grid cols-3" style="margin-bottom:8px">
        <div class="card stat"><div class="label">Démarches en cours</div><div class="value">${pending}</div></div>
        <div class="card stat"><div class="label">Démarches abouties</div><div class="value">${done}</div></div>
        <div class="card stat"><div class="label">Total démarches</div><div class="value">${demarches.length}</div></div>
      </div>

      <div class="section-title">🚀 Nouvelle démarche</div>
      <div class="grid cols-4" id="module-grid"></div>

      <div class="section-title">📁 Mes démarches</div>
      <div class="card table-wrap" id="mydemarches"></div>
    </div>`;
  wireTopbar();

  // Cartes des modules ouverts au citoyen.
  $('#module-grid').innerHTML = state.modules.filter((m) => m.citizen).map((m) => `
    <div class="card module-card" data-mod="${m.code}">
      <div class="head"><span class="icon">${m.icon}</span><div><div class="code">MODULE ${m.code}</div><div class="name">${esc(m.short)}</div></div></div>
      <div class="muted" style="font-size:12.5px">${m.demarches.length} démarche(s) disponible(s)</div>
    </div>`).join('');
  document.querySelectorAll('#module-grid .module-card').forEach((c) => {
    c.onclick = () => openNewDemarche(c.dataset.mod);
  });

  // Table des démarches.
  const wrap = $('#mydemarches');
  if (!demarches.length) {
    wrap.innerHTML = '<div class="empty">Aucune démarche pour le moment. Choisissez un module ci-dessus pour commencer.</div>';
  } else {
    wrap.innerHTML = `<table><thead><tr>
      <th>N° de suivi</th><th>Module</th><th>Démarche</th><th>Statut</th><th>Créée le</th><th></th>
    </tr></thead><tbody>${demarches.map((d) => `
      <tr><td><code>${esc(d.tracking)}</code></td>
      <td>${d.moduleIcon} ${esc(d.moduleName)}</td>
      <td>${esc(d.demarcheLabel)}</td>
      <td>${badge(d.status)}</td>
      <td class="muted">${fmtDate(d.createdAt)}</td>
      <td><button class="btn ghost small" data-open="${d.id}">Détails</button></td></tr>`).join('')}
    </tbody></table>`;
    wrap.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openCitizenDemarche(Number(b.dataset.open))));
  }
});

function openNewDemarche(moduleCode) {
  const mod = state.modules.find((m) => m.code === moduleCode);
  if (!mod || !mod.demarches.length) { openModal({ title: mod.name, bodyHTML: '<p class="muted">Aucune démarche citoyenne disponible pour ce module.</p>' }); return; }
  const options = mod.demarches.map((d) => `<option value="${d.key}" data-fee="${d.fee}">${esc(d.label)}${d.fee ? ' — ' + fcfa(d.fee) : ' — gratuit'}</option>`).join('');
  const close = openModal({
    title: `${mod.icon} ${mod.name}`,
    bodyHTML: `
      <div id="nd-alert"></div>
      <label class="field"><span>Type de démarche</span><select id="nd-type">${options}</select></label>
      <label class="field"><span>Informations (objet / description)</span><textarea id="nd-desc" placeholder="Décrivez votre demande, adresse concernée, etc."></textarea></label>
      <label class="field"><span>Référence / pièce (simulé)</span><input id="nd-ref" placeholder="Ex. numéro de parcelle, nom du défunt, adresse…" /></label>
      <p class="muted" style="font-size:12.5px">Les pièces justificatives seront téléversées à l'étape suivante (simulé dans ce prototype).</p>`,
    footHTML: `<button class="btn ghost" id="nd-cancel">Annuler</button><button class="btn" id="nd-submit">Déposer la démarche</button>`,
  });
  $('#nd-cancel').onclick = close;
  $('#nd-submit').onclick = async () => {
    try {
      const key = $('#nd-type').value;
      const formData = { description: $('#nd-desc').value.trim(), reference: $('#nd-ref').value.trim() };
      const r = await api('/citizen/demarches', { method: 'POST', body: { moduleCode, demarcheKey: key, formData } });
      close();
      // Si payante et non payée, ouvre directement le paiement.
      if (r.demarche.status === 'submitted' && r.demarche.fee > 0) openCitizenDemarche(r.demarche.id);
      else render();
    } catch (err) {
      $('#nd-alert').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  };
}

async function openCitizenDemarche(id) {
  const { demarche: d } = await api('/citizen/demarches/' + id);
  const canPay = d.status === 'submitted' && d.fee > 0;
  const body = `
    <div id="cd-alert"></div>
    <dl class="kv">
      <dt>N° de suivi</dt><dd><code>${esc(d.tracking)}</code></dd>
      <dt>Module</dt><dd>${d.moduleIcon} ${esc(d.moduleName)}</dd>
      <dt>Démarche</dt><dd>${esc(d.demarcheLabel)}</dd>
      <dt>Statut</dt><dd>${badge(d.status)}</dd>
      <dt>Montant</dt><dd>${d.fee ? fcfa(d.fee) : 'Gratuit'}</dd>
      ${d.payment ? `<dt>Paiement</dt><dd>${esc(d.payment.method)}${d.payment.reference ? ' · ' + esc(d.payment.reference) : ''}</dd>` : ''}
      ${d.rejectReason ? `<dt>Motif de refus</dt><dd style="color:var(--red)">${esc(d.rejectReason)}</dd>` : ''}
    </dl>
    ${d.acte ? acteBlock(d.acte) : ''}
    ${canPay ? paymentBlock() : ''}
    <div class="section-title" style="margin:20px 0 8px;font-size:14px">Historique</div>
    <ul class="timeline">${d.history.map((h) => `<li><b>${esc(h.action)}</b><br><span class="muted">${fmtDate(h.at)} · ${esc(h.by)}</span></li>`).join('')}</ul>`;
  const foot = canPay ? `<button class="btn ghost" id="cd-close">Fermer</button><button class="btn success" id="cd-pay">Payer maintenant</button>` : `<button class="btn" id="cd-close">Fermer</button>`;
  const close = openModal({ title: 'Suivi de la démarche', bodyHTML: body, footHTML: foot });
  $('#cd-close').onclick = close;
  if (canPay) {
    $('#cd-pay').onclick = async () => {
      try {
        const method = $('#pay-method').value;
        await api(`/citizen/demarches/${id}/pay`, { method: 'POST', body: { method } });
        close(); render();
      } catch (err) { $('#cd-alert').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    };
  }
}
function paymentBlock() {
  return `<div class="card pad" style="margin-top:16px;background:#f7f9fd">
    <b>Paiement en ligne</b>
    <label class="field" style="margin-top:10px"><span>Moyen de paiement</span>
      <select id="pay-method">
        <option>Orange Money</option><option>MTN Mobile Money</option><option>Wave</option><option>Carte bancaire</option>
      </select></label>
    <p class="muted" style="font-size:12px;margin:0">Transaction simulée — aucun paiement réel n'est effectué.</p>
  </div>`;
}
function acteBlock(acte) {
  return `<div class="card pad" style="margin-top:16px;display:flex;gap:16px;align-items:center;background:var(--green-bg)">
    <div class="qr" title="${esc(acte.qrToken)}">QR</div>
    <div>
      <b>Acte délivré</b><br>
      <span class="muted">N° ${esc(acte.number)}</span><br>
      <span class="muted" style="font-size:12px">Code QR : ${esc(acte.qrToken)}</span><br>
      <a href="#/verify/${esc(acte.qrToken)}" target="_blank">Vérifier l'authenticité →</a>
    </div>
  </div>`;
}

// ===========================================================================
// ESPACE GESTIONNAIRE
// ===========================================================================
route('/manager', async () => {
  const u = await ensureSession();
  await ensureMeta();
  if (!u) { location.hash = '#/login'; return; }
  if (u.role !== 'manager') { location.hash = homeForUser(u); return; }

  const mod = state.modules.find((m) => m.code === u.module);
  const [{ demarches }, { stats }] = await Promise.all([api('/manager/demarches'), api('/manager/stats')]);

  app().innerHTML = topbar() + `
    <div class="container">
      <h1 class="page-title">${mod ? mod.icon : ''} Back Office — ${esc(mod ? mod.name : u.module)}</h1>
      <p class="page-sub">Gestion opérationnelle de votre module uniquement. Vous n'avez accès à aucun autre module.</p>

      <div class="grid cols-4" style="margin-bottom:8px">
        <div class="card stat"><div class="label">En attente</div><div class="value">${stats.pending}</div></div>
        <div class="card stat"><div class="label">Validées</div><div class="value" style="color:var(--green)">${stats.validated}</div></div>
        <div class="card stat"><div class="label">Refusées</div><div class="value" style="color:var(--red)">${stats.rejected}</div></div>
        <div class="card stat"><div class="label">Recettes encaissées</div><div class="value small">${fcfa(stats.revenue)}</div></div>
      </div>

      <div class="pill-tabs" id="filters">
        <button data-f="all" class="active">Tous (${demarches.length})</button>
        <button data-f="pending">À traiter (${stats.pending})</button>
        <button data-f="validated">Validés</button>
        <button data-f="rejected">Refusés</button>
      </div>
      <div class="card table-wrap" id="mgr-table"></div>
    </div>`;
  wireTopbar();

  let filter = 'all';
  const paint = () => {
    let rows = demarches;
    if (filter === 'pending') rows = demarches.filter((d) => ['submitted', 'paid', 'in_review'].includes(d.status));
    else if (filter === 'validated') rows = demarches.filter((d) => d.status === 'validated');
    else if (filter === 'rejected') rows = demarches.filter((d) => d.status === 'rejected');
    const t = $('#mgr-table');
    if (!rows.length) { t.innerHTML = '<div class="empty">Aucun dossier dans cette catégorie.</div>'; return; }
    t.innerHTML = `<table><thead><tr>
      <th>N° de suivi</th><th>Démarche</th><th>Citoyen</th><th>Priorité</th><th>Statut</th><th>Paiement</th><th>Actions</th>
    </tr></thead><tbody>${rows.map((d) => `<tr>
      <td><code>${esc(d.tracking)}</code></td>
      <td>${esc(d.demarcheLabel)}</td>
      <td>${esc(d.citizenName)}</td>
      <td>${prioBadge(d.priority)}</td>
      <td>${badge(d.status)}</td>
      <td>${d.payment ? esc(d.payment.method) : (d.fee ? '<span class="muted">non payé</span>' : 'gratuit')}</td>
      <td><button class="btn ghost small" data-open="${d.id}">Traiter</button></td>
    </tr>`).join('')}</tbody></table>`;
    t.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openManagerDemarche(Number(b.dataset.open))));
  };
  document.querySelectorAll('#filters button').forEach((b) => {
    b.onclick = () => { filter = b.dataset.f; document.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('active', x === b)); paint(); };
  });
  paint();
});

async function openManagerDemarche(id) {
  const { demarches } = await api('/manager/demarches');
  const d = demarches.find((x) => x.id === id);
  if (!d) return;
  const actionable = ['submitted', 'paid', 'in_review'].includes(d.status);
  const body = `
    <div id="md-alert"></div>
    <dl class="kv">
      <dt>N° de suivi</dt><dd><code>${esc(d.tracking)}</code></dd>
      <dt>Démarche</dt><dd>${esc(d.demarcheLabel)}</dd>
      <dt>Citoyen</dt><dd>${esc(d.citizenName)}</dd>
      <dt>Statut</dt><dd>${badge(d.status)}</dd>
      <dt>Priorité</dt><dd>${prioBadge(d.priority)}</dd>
      <dt>Paiement</dt><dd>${d.payment ? esc(d.payment.method) + ' · ' + fcfa(d.payment.amount) : (d.fee ? 'En attente' : 'Gratuit')}</dd>
      ${d.formData && d.formData.description ? `<dt>Description</dt><dd>${esc(d.formData.description)}</dd>` : ''}
      ${d.formData && d.formData.reference ? `<dt>Référence</dt><dd>${esc(d.formData.reference)}</dd>` : ''}
      ${d.rejectReason ? `<dt>Motif refus</dt><dd style="color:var(--red)">${esc(d.rejectReason)}</dd>` : ''}
    </dl>
    ${d.acte ? acteBlock(d.acte) : ''}
    ${actionable ? `
      <label class="field" style="margin-top:16px"><span>Priorité du dossier</span>
        <select id="md-prio">
          <option value="normale"${d.priority === 'normale' ? ' selected' : ''}>Normale</option>
          <option value="prioritaire"${d.priority === 'prioritaire' ? ' selected' : ''}>Prioritaire</option>
          <option value="urgente"${d.priority === 'urgente' ? ' selected' : ''}>Urgente</option>
        </select></label>
      <label class="field"><span>Motif (obligatoire en cas de refus)</span>
        <textarea id="md-reason" placeholder="Ex. pièces manquantes, zone non constructible…"></textarea></label>` : ''}
    <div class="section-title" style="margin:16px 0 8px;font-size:14px">Historique</div>
    <ul class="timeline">${d.history.map((h) => `<li><b>${esc(h.action)}</b><br><span class="muted">${fmtDate(h.at)} · ${esc(h.by)}</span></li>`).join('')}</ul>`;
  const foot = actionable
    ? `<button class="btn ghost small" id="md-prio-save">Enregistrer priorité</button>
       <div style="flex:1"></div>
       <button class="btn danger" id="md-reject">Refuser</button>
       <button class="btn success" id="md-validate">Valider &amp; générer l'acte</button>`
    : `<button class="btn" id="md-close">Fermer</button>`;
  const close = openModal({ title: 'Traitement du dossier', bodyHTML: body, footHTML: foot });
  const err = (m) => ($('#md-alert').innerHTML = `<div class="alert error">${esc(m)}</div>`);
  if ($('#md-close')) $('#md-close').onclick = close;
  if (actionable) {
    $('#md-prio-save').onclick = async () => {
      try { await api(`/manager/demarches/${id}/priority`, { method: 'POST', body: { priority: $('#md-prio').value } }); close(); render(); }
      catch (e) { err(e.message); }
    };
    $('#md-validate').onclick = async () => {
      try { await api(`/manager/demarches/${id}/validate`, { method: 'POST' }); close(); render(); }
      catch (e) { err(e.message); }
    };
    $('#md-reject').onclick = async () => {
      try { await api(`/manager/demarches/${id}/reject`, { method: 'POST', body: { reason: $('#md-reason').value } }); close(); render(); }
      catch (e) { err(e.message); }
    };
  }
}

// ===========================================================================
// ESPACE MAIRE — supervision consolidée
// ===========================================================================
route('/mayor', async (sub) => {
  const u = await ensureSession();
  await ensureMeta();
  if (!u) { location.hash = '#/login'; return; }
  if (u.role !== 'mayor') { location.hash = homeForUser(u); return; }

  if (sub[0] === 'module' && sub[1]) return renderMayorModule(sub[1]);

  const { perModule, totals, citizens } = await api('/mayor/dashboard');
  app().innerHTML = topbar() + `
    <div class="container">
      <h1 class="page-title">Tableau de bord du Maire</h1>
      <p class="page-sub">Supervision transversale de tous les modules. Rôle stratégique et décisionnel — consultation uniquement.</p>

      <div class="grid cols-4" style="margin-bottom:8px">
        <div class="card stat"><div class="label">Démarches totales</div><div class="value">${totals.total}</div></div>
        <div class="card stat"><div class="label">En attente</div><div class="value" style="color:var(--amber)">${totals.pending}</div></div>
        <div class="card stat"><div class="label">Validées</div><div class="value" style="color:var(--green)">${totals.validated}</div></div>
        <div class="card stat"><div class="label">Recettes consolidées</div><div class="value small">${fcfa(totals.revenue)}</div></div>
      </div>
      <div class="grid cols-2" style="margin-bottom:8px">
        <div class="card stat"><div class="label">Citoyens inscrits</div><div class="value small">${citizens}</div></div>
        <div class="card stat"><div class="label">Dossiers refusés</div><div class="value small" style="color:var(--red)">${totals.rejected}</div></div>
      </div>

      <div class="section-title">📊 Vue par module</div>
      <div class="grid cols-3" id="mayor-modules"></div>

      <div class="section-title">🔍 Traçabilité</div>
      <a class="btn secondary" href="#/audit">Consulter le journal d'audit</a>
    </div>`;
  wireTopbar();
  $('#mayor-modules').innerHTML = perModule.map((m) => `
    <div class="card module-card" data-mod="${m.code}">
      <div class="head"><span class="icon">${m.icon}</span><div><div class="code">MODULE ${m.code}</div><div class="name">${esc(m.short)}</div></div></div>
      <div class="metrics">
        <span><b>${m.total}</b> total</span>
        <span><b>${m.pending}</b> en attente</span>
        <span><b>${m.validated}</b> validées</span>
      </div>
      ${m.revenue ? `<div class="muted" style="font-size:12.5px">Recettes : <b>${fcfa(m.revenue)}</b></div>` : ''}
    </div>`).join('');
  document.querySelectorAll('#mayor-modules .module-card').forEach((c) => {
    c.onclick = () => (location.hash = '#/mayor/module/' + c.dataset.mod);
  });
});

async function renderMayorModule(code) {
  const { module, stats, demarches } = await api('/mayor/modules/' + code);
  app().innerHTML = topbar() + `
    <div class="container">
      <p style="margin:0 0 6px"><a href="#/mayor">← Tableau de bord</a></p>
      <h1 class="page-title">Module ${esc(module.code)} — ${esc(module.name)}</h1>
      <p class="page-sub">Consultation des indicateurs et dossiers. Le Maire ne traite pas les dossiers.</p>
      <div class="grid cols-4" style="margin-bottom:8px">
        <div class="card stat"><div class="label">Total</div><div class="value">${stats.total}</div></div>
        <div class="card stat"><div class="label">En attente</div><div class="value" style="color:var(--amber)">${stats.pending}</div></div>
        <div class="card stat"><div class="label">Validées</div><div class="value" style="color:var(--green)">${stats.validated}</div></div>
        <div class="card stat"><div class="label">Recettes</div><div class="value small">${fcfa(stats.revenue)}</div></div>
      </div>
      <div class="card table-wrap">
        ${demarches.length ? `<table><thead><tr><th>N° de suivi</th><th>Démarche</th><th>Citoyen</th><th>Statut</th><th>Mise à jour</th></tr></thead>
        <tbody>${demarches.map((d) => `<tr><td><code>${esc(d.tracking)}</code></td><td>${esc(d.demarcheLabel)}</td><td>${esc(d.citizenName)}</td><td>${badge(d.status)}</td><td class="muted">${fmtDate(d.updatedAt)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Aucun dossier dans ce module.</div>'}
      </div>
    </div>`;
  wireTopbar();
}

// ===========================================================================
// ESPACE AUDITEUR (et Maire) — journal d'audit en lecture seule
// ===========================================================================
route('/audit', async () => {
  const u = await ensureSession();
  await ensureMeta();
  if (!u) { location.hash = '#/login'; return; }
  if (!['auditor', 'mayor'].includes(u.role)) { location.hash = homeForUser(u); return; }

  const { entries } = await api('/audit');
  app().innerHTML = topbar() + `
    <div class="container">
      ${u.role === 'mayor' ? '<p style="margin:0 0 6px"><a href="#/mayor">← Tableau de bord</a></p>' : ''}
      <h1 class="page-title">Journal d'audit</h1>
      <p class="page-sub">Traçabilité complète, tous modules — consultation en lecture seule (${entries.length} entrées).</p>
      <div class="card table-wrap">
        ${entries.length ? `<table><thead><tr><th>Date / heure</th><th>Utilisateur</th><th>Module</th><th>Action</th><th>IP</th></tr></thead>
        <tbody>${entries.map((e) => `<tr>
          <td class="muted">${fmtDate(e.timestamp)}</td>
          <td>${esc(e.userLabel)}${e.userEmail ? `<br><span class="muted" style="font-size:11px">${esc(e.userEmail)}</span>` : ''}</td>
          <td>${e.module ? 'Module ' + esc(e.module) : '<span class="muted">—</span>'}</td>
          <td>${esc(e.action)}</td>
          <td class="muted">${esc(e.ip)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Aucune entrée.</div>'}
      </div>
    </div>`;
  wireTopbar();
});

// ===========================================================================
// Vérification publique d'un acte (route SPA, aussi servie par verify.html)
// ===========================================================================
route('/verify', async (sub) => {
  const token = sub[0];
  await ensureMeta();
  let html;
  try {
    const r = await api('/verify/' + token);
    html = `<div class="card pad" style="max-width:520px;margin:40px auto">
      <div class="alert success">✔ Acte authentique</div>
      <dl class="kv">
        <dt>N° d'acte</dt><dd>${esc(r.acte)}</dd>
        <dt>Module</dt><dd>${esc(r.module)}</dd>
        <dt>Démarche</dt><dd>${esc(r.demarche)}</dd>
        <dt>Bénéficiaire</dt><dd>${esc(r.beneficiaire)}</dd>
        <dt>Délivré par</dt><dd>${esc(r.delivrePar)}</dd>
        <dt>Date</dt><dd>${fmtDate(r.date)}</dd>
      </dl></div>`;
  } catch (e) {
    html = `<div class="card pad" style="max-width:520px;margin:40px auto"><div class="alert error">✘ ${esc(e.message)}</div></div>`;
  }
  app().innerHTML = topbar() + `<div class="container"><h1 class="page-title">Vérification d'acte</h1><p class="page-sub">Code : <code>${esc(token)}</code></p>${html}<p style="text-align:center"><a href="#/">Retour à l'accueil</a></p></div>`;
  wireTopbar();
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
window.addEventListener('hashchange', render);
render();
