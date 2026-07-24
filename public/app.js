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

// Teinte de l'espace courant (couleurs du drapeau ivoirien via CSS).
function setSpace(s) { document.body.dataset.space = s; }
function spaceForRole(r) {
  return { mayor: 'mayor', manager: 'manager', auditor: 'auditor', citizen: 'citizen', agent: 'citizen' }[r] || 'public';
}

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
  return { mayor: 'Maire', manager: 'Gestionnaire', citizen: 'Citoyen', agent: 'Agent municipal', auditor: 'Auditeur', admin: 'Administrateur' }[u.role] || u.role;
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
        <button class="bell" id="bell" title="Notifications">🔔<span class="count" id="bell-count" style="display:none">0</span></button>
        <button class="btn secondary small" id="logout">Déconnexion</button>
      ` : ''}
    </div>`;
}
function wireTopbar() {
  const b = $('#logout');
  if (b) b.onclick = async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; location.hash = '#/'; };
  const bell = $('#bell');
  if (bell) { bell.onclick = openNotifications; refreshBell(); }
}

// --- Notifications ---------------------------------------------------------
async function refreshBell() {
  try {
    const { unread } = await api('/notifications');
    const el = $('#bell-count');
    if (!el) return;
    if (unread > 0) { el.textContent = unread > 99 ? '99+' : unread; el.style.display = 'grid'; }
    else el.style.display = 'none';
  } catch { /* non connecté */ }
}
async function openNotifications() {
  const { notifications } = await api('/notifications');
  const body = notifications.length
    ? `<ul class="notif-list">${notifications.map((n) => `
        <li class="${n.read ? '' : 'unread'}">
          <span class="notif-dot ${esc(n.type)}"></span>
          <div>
            <div class="n-title">${esc(n.title)}</div>
            <div class="n-msg">${esc(n.message)}</div>
            <div class="n-time">${fmtDate(n.createdAt)}${n.channels ? ' · ' + n.channels.map(esc).join(', ') : ''}</div>
          </div>
        </li>`).join('')}</ul>`
    : '<div class="empty">Aucune notification.</div>';
  const close = openModal({
    title: 'Notifications',
    bodyHTML: body,
    footHTML: notifications.some((n) => !n.read) ? '<button class="btn ghost" id="n-close">Fermer</button><button class="btn" id="n-read">Tout marquer comme lu</button>' : '<button class="btn" id="n-close">Fermer</button>',
  });
  $('#n-close').onclick = close;
  const r = $('#n-read');
  if (r) r.onclick = async () => { await api('/notifications/read', { method: 'POST', body: {} }); close(); refreshBell(); };
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
  if (u.role === 'admin') return '#/admin';
  return '#/citizen';
}

// ===========================================================================
// LANDING
// ===========================================================================
route('/', async () => {
  await ensureMeta();
  await ensureSession();
  if (state.user) { location.hash = homeForUser(state.user); return; }
  setSpace('public');
  const site = await api('/public/site');
  app().innerHTML = topbar() + `
    <div class="public-hero">
      <div class="inner">
        <div class="logo-big" style="width:64px;height:64px;border-radius:14px;background:#fff;color:var(--ci-orange-strong);display:grid;place-items:center;font-weight:800;font-size:26px;margin:0 auto 6px">G</div>
        <h1>${esc(site.mairie.nom)} — Plateforme GMDI</h1>
        <p>${esc(site.mairie.slogan)}</p>
        <div class="cta">
          <a class="btn secondary" href="#/portail">Accéder au Portail Citoyen</a>
          <a class="btn ghost" href="#/login">Connexion Back Office</a>
        </div>
      </div>
    </div>

    <div class="public-section">
      <div class="grid cols-2" style="align-items:start">
        <div>
          <div class="section-title">🏛️ La mairie & GMDI</div>
          <div class="card pad"><p class="muted" style="margin:0">${esc(site.mairie.presentation)}</p></div>
          <div class="section-title">📞 Nous contacter</div>
          <div class="card contact-card">
            <div><b>Adresse</b><br><span class="muted">${esc(site.contacts.adresse)}</span></div>
            <div><b>Téléphone</b><br><span class="muted">${esc(site.contacts.telephone)}</span></div>
            <div><b>Email</b><br><span class="muted">${esc(site.contacts.email)}</span></div>
            <div><b>Horaires</b><br><span class="muted">${esc(site.contacts.horaires)}</span></div>
          </div>
        </div>
        <div>
          <div class="section-title">📰 Actualités</div>
          <div class="grid" style="gap:12px">
            ${site.actualites.map((a) => `<div class="card actu"><div class="date">${new Date(a.date).toLocaleDateString('fr-FR')}</div><h4>${esc(a.titre)}</h4><p>${esc(a.resume)}</p></div>`).join('')}
          </div>
        </div>
      </div>

      <div class="section-title">🧩 Nos services en ligne</div>
      <div class="grid cols-3">
        ${site.services.map((s) => `
          <div class="card module-card" onclick="location.hash='#/portail'">
            <div class="head"><span class="icon">${s.icon}</span><div><div class="code">MODULE ${s.code}</div><div class="name">${esc(s.short)}</div></div></div>
            <div>${s.demarches.slice(0, 3).map((d) => `<span class="service-tag">${esc(d)}</span>`).join('')}</div>
          </div>`).join('')}
      </div>

      <p class="muted" style="margin-top:28px;font-size:12.5px;text-align:center">Vérifier l'authenticité d'un acte ? Scannez son QR Code ou saisissez son code sur la page de vérification.</p>
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
  setSpace(isCitizen ? 'citizen' : 'mayor'); // portail = orange · back office = vert
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
      <div>Admin système : <code>admin@mairie-gmdi.ci</code> / <code>Admin@2026</code></div>
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
  setSpace(spaceForRole(u.role));
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
  setSpace('citizen');

  const { demarches } = await api('/citizen/demarches');
  const pending = demarches.filter((d) => ['pending', 'in_progress', 'to_complete'].includes(d.status)).length;
  const done = demarches.filter((d) => ['validated', 'completed'].includes(d.status)).length;

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
      // Si un paiement est attendu, ouvre directement le paiement.
      if (r.demarche.needsPayment) openCitizenDemarche(r.demarche.id);
      else render();
    } catch (err) {
      $('#nd-alert').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  };
}

async function openCitizenDemarche(id) {
  const { demarche: d } = await api('/citizen/demarches/' + id);
  const canPay = d.needsPayment;
  const toComplete = d.status === 'to_complete';
  const body = `
    <div id="cd-alert"></div>
    <dl class="kv">
      <dt>N° de suivi</dt><dd><code>${esc(d.tracking)}</code></dd>
      <dt>Module</dt><dd>${d.moduleIcon} ${esc(d.moduleName)}</dd>
      <dt>Démarche</dt><dd>${esc(d.demarcheLabel)}</dd>
      <dt>Statut</dt><dd>${badge(d.status)}</dd>
      <dt>Montant</dt><dd>${d.fee ? fcfa(d.fee) : 'Gratuit'}</dd>
      ${d.payment ? `<dt>Paiement</dt><dd>${esc(d.payment.method)}${d.payment.receipt ? ' · reçu ' + esc(d.payment.receipt) : ''}</dd>` : ''}
      ${d.rejectReason ? `<dt>Motif de refus</dt><dd style="color:var(--red)">${esc(d.rejectReason)}</dd>` : ''}
    </dl>
    ${toComplete ? `<div class="alert info" style="margin-top:14px"><b>Complément demandé :</b> ${esc(d.completionRequest || '')}</div>
      <label class="field"><span>Votre réponse / complément</span><textarea id="cd-complete" placeholder="Ajoutez les informations demandées…"></textarea></label>` : ''}
    ${d.acte ? acteBlock(d.acte) : ''}
    ${canPay ? paymentBlock() : ''}
    <div class="section-title" style="margin:20px 0 8px;font-size:14px">Historique</div>
    <ul class="timeline">${d.history.map((h) => `<li><b>${esc(h.action)}</b><br><span class="muted">${fmtDate(h.at)} · ${esc(h.by)}</span></li>`).join('')}</ul>`;
  let foot = `<button class="btn" id="cd-close">Fermer</button>`;
  if (canPay) foot = `<button class="btn ghost" id="cd-close">Fermer</button><button class="btn success" id="cd-pay">Payer maintenant</button>`;
  else if (toComplete) foot = `<button class="btn ghost" id="cd-close">Fermer</button><button class="btn" id="cd-send">Envoyer le complément</button>`;
  const close = openModal({ title: 'Suivi de la démarche', bodyHTML: body, footHTML: foot });
  $('#cd-close').onclick = close;
  const err = (m) => ($('#cd-alert').innerHTML = `<div class="alert error">${esc(m)}</div>`);
  if (canPay) {
    $('#cd-pay').onclick = async () => {
      try {
        const method = $('#pay-method').value;
        await api(`/citizen/demarches/${id}/pay`, { method: 'POST', body: { method } });
        close(); render();
      } catch (e) { err(e.message); }
    };
  } else if (toComplete) {
    $('#cd-send').onclick = async () => {
      try {
        await api(`/citizen/demarches/${id}/complete`, { method: 'POST', body: { info: $('#cd-complete').value } });
        close(); render();
      } catch (e) { err(e.message); }
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
  setSpace('manager');

  const mod = state.modules.find((m) => m.code === u.module);
  const [{ demarches }, { stats }] = await Promise.all([api('/manager/demarches'), api('/manager/stats')]);

  app().innerHTML = topbar() + `
    <div class="container">
      <h1 class="page-title">${mod ? mod.icon : ''} Back Office — ${esc(mod ? mod.name : u.module)}</h1>
      <p class="page-sub">Gestion opérationnelle de votre module uniquement. Vous n'avez accès à aucun autre module.</p>

      <div class="grid cols-4" style="margin-bottom:8px">
        <div class="card stat"><div class="label">À traiter</div><div class="value">${stats.pending}</div></div>
        <div class="card stat"><div class="label">Validées / Terminées</div><div class="value" style="color:var(--green)">${stats.validated + stats.completed}</div></div>
        <div class="card stat"><div class="label">Refusées</div><div class="value" style="color:var(--red)">${stats.rejected}</div></div>
        <div class="card stat"><div class="label">Recettes encaissées</div><div class="value small">${fcfa(stats.revenue)}</div></div>
      </div>

      <div class="pill-tabs" id="filters">
        <button data-f="all" class="active">Tous (${demarches.length})</button>
        <button data-f="pending">À traiter (${stats.pending})</button>
        <button data-f="validated">Validés</button>
        <button data-f="completed">Terminés</button>
        <button data-f="rejected">Refusés</button>
      </div>
      <div class="card table-wrap" id="mgr-table"></div>
    </div>`;
  wireTopbar();

  let filter = 'all';
  const paint = () => {
    let rows = demarches;
    if (filter === 'pending') rows = demarches.filter((d) => ['pending', 'in_progress', 'to_complete'].includes(d.status));
    else if (filter === 'validated') rows = demarches.filter((d) => d.status === 'validated');
    else if (filter === 'completed') rows = demarches.filter((d) => d.status === 'completed');
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
  const open = ['pending', 'in_progress', 'to_complete'].includes(d.status);
  const canValidate = ['pending', 'in_progress'].includes(d.status);
  const canRequest = ['pending', 'in_progress'].includes(d.status);
  const canClose = d.status === 'validated';
  const unpaid = d.needsPayment;
  const body = `
    <div id="md-alert"></div>
    ${unpaid ? '<div class="alert info">Paiement en attente : la validation sera possible une fois le paiement reçu.</div>' : ''}
    <dl class="kv">
      <dt>N° de suivi</dt><dd><code>${esc(d.tracking)}</code></dd>
      <dt>Démarche</dt><dd>${esc(d.demarcheLabel)}</dd>
      <dt>Citoyen</dt><dd>${esc(d.citizenName)}</dd>
      <dt>Statut</dt><dd>${badge(d.status)}</dd>
      <dt>Priorité</dt><dd>${prioBadge(d.priority)}</dd>
      <dt>Paiement</dt><dd>${d.payment ? esc(d.payment.method) + ' · ' + fcfa(d.payment.amount) + (d.payment.receipt ? ' · ' + esc(d.payment.receipt) : '') : (d.fee ? '<span style="color:var(--red)">En attente</span>' : 'Gratuit')}</dd>
      ${d.formData && d.formData.description ? `<dt>Description</dt><dd>${esc(d.formData.description)}</dd>` : ''}
      ${d.formData && d.formData.reference ? `<dt>Référence</dt><dd>${esc(d.formData.reference)}</dd>` : ''}
      ${d.formData && d.formData.complement ? `<dt>Complément citoyen</dt><dd>${esc(d.formData.complement)}</dd>` : ''}
      ${d.completionRequest ? `<dt>Complément demandé</dt><dd style="color:var(--amber)">${esc(d.completionRequest)}</dd>` : ''}
      ${d.rejectReason ? `<dt>Motif refus</dt><dd style="color:var(--red)">${esc(d.rejectReason)}</dd>` : ''}
    </dl>
    ${d.acte ? acteBlock(d.acte) : ''}
    ${open ? `
      <label class="field" style="margin-top:16px"><span>Priorité du dossier</span>
        <select id="md-prio">
          <option value="normale"${d.priority === 'normale' ? ' selected' : ''}>Normale</option>
          <option value="prioritaire"${d.priority === 'prioritaire' ? ' selected' : ''}>Prioritaire</option>
          <option value="urgente"${d.priority === 'urgente' ? ' selected' : ''}>Urgente</option>
        </select></label>
      <label class="field"><span>Motif de refus / message de complément</span>
        <textarea id="md-reason" placeholder="Motif du refus, ou pièces/informations à compléter…"></textarea></label>` : ''}
    <div class="section-title" style="margin:16px 0 8px;font-size:14px">Historique</div>
    <ul class="timeline">${d.history.map((h) => `<li><b>${esc(h.action)}</b><br><span class="muted">${fmtDate(h.at)} · ${esc(h.by)}</span></li>`).join('')}</ul>`;
  let foot;
  if (open) {
    foot = `<button class="btn ghost small" id="md-prio-save">Priorité</button>
       ${canRequest ? '<button class="btn ghost small" id="md-request">À compléter</button>' : ''}
       <div style="flex:1"></div>
       <button class="btn danger" id="md-reject">Refuser</button>
       <button class="btn success" id="md-validate"${unpaid ? ' disabled title="Paiement en attente"' : ''}>Valider &amp; générer l'acte</button>`;
  } else if (canClose) {
    foot = `<button class="btn ghost" id="md-close">Fermer</button><button class="btn success" id="md-closefile">Clôturer (Terminé)</button>`;
  } else {
    foot = `<button class="btn" id="md-close">Fermer</button>`;
  }
  const close = openModal({ title: 'Traitement du dossier', bodyHTML: body, footHTML: foot });
  const err = (m) => ($('#md-alert').innerHTML = `<div class="alert error">${esc(m)}</div>`);
  const act = async (path, payload) => {
    try { await api(`/manager/demarches/${id}/${path}`, { method: 'POST', body: payload }); close(); render(); }
    catch (e) { err(e.message); }
  };
  if ($('#md-close')) $('#md-close').onclick = close;
  if (open) {
    $('#md-prio-save').onclick = () => act('priority', { priority: $('#md-prio').value });
    if ($('#md-request')) $('#md-request').onclick = () => act('request-completion', { message: $('#md-reason').value });
    $('#md-validate').onclick = () => act('validate', {});
    $('#md-reject').onclick = () => act('reject', { reason: $('#md-reason').value });
  } else if (canClose) {
    $('#md-closefile').onclick = () => act('close', {});
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
  setSpace('mayor');

  if (sub[0] === 'module' && sub[1]) return renderMayorModule(sub[1]);

  const { perModule, totals, citizens } = await api('/mayor/dashboard');
  app().innerHTML = topbar() + `
    <div class="container">
      <h1 class="page-title">Tableau de bord du Maire</h1>
      <p class="page-sub">Supervision transversale de tous les modules. Rôle stratégique et décisionnel — consultation uniquement.</p>

      <div class="grid cols-4" style="margin-bottom:8px">
        <div class="card stat"><div class="label">Démarches totales</div><div class="value">${totals.total}</div></div>
        <div class="card stat"><div class="label">En attente</div><div class="value" style="color:var(--amber)">${totals.pending}</div></div>
        <div class="card stat"><div class="label">Validées / Terminées</div><div class="value" style="color:var(--green)">${totals.validated + totals.completed}</div></div>
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
  setSpace(u.role === 'mayor' ? 'mayor' : 'auditor');

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
// ADMINISTRATION SYSTÈME — gestion technique des comptes (CDC technique §2.5)
// ===========================================================================
route('/admin', async (sub) => {
  const u = await ensureSession();
  await ensureMeta();
  if (!u) { location.hash = '#/login'; return; }
  if (u.role !== 'admin') { location.hash = homeForUser(u); return; }
  setSpace('admin');

  if (sub[0] === 'logs') return renderAdminLogs();

  const { users, modules } = await api('/admin/users');
  const pro = users.filter((x) => x.role !== 'citizen');
  const citizens = users.filter((x) => x.role === 'citizen');
  app().innerHTML = topbar() + `
    <div class="container">
      <h1 class="page-title">Administration Système</h1>
      <p class="page-sub">Gestion technique de la plateforme : comptes, mots de passe, rôles et journaux. L'administrateur n'intervient jamais dans les traitements métiers.</p>

      <div class="grid cols-4" style="margin-bottom:8px">
        <div class="card stat"><div class="label">Comptes pro.</div><div class="value">${pro.length}</div></div>
        <div class="card stat"><div class="label">Comptes citoyens</div><div class="value">${citizens.length}</div></div>
        <div class="card stat"><div class="label">Comptes actifs</div><div class="value" style="color:var(--green)">${users.filter((x) => x.active).length}</div></div>
        <div class="card stat"><div class="label">Désactivés</div><div class="value" style="color:var(--red)">${users.filter((x) => !x.active).length}</div></div>
      </div>

      <div class="btn-row" style="margin-bottom:6px">
        <button class="btn" id="new-account">+ Créer un compte professionnel</button>
        <a class="btn secondary" href="#/admin/logs">Journaux techniques</a>
      </div>

      <div class="section-title">👥 Comptes professionnels</div>
      <div class="card table-wrap" id="pro-table"></div>

      <div class="section-title">🧑 Comptes citoyens</div>
      <div class="card table-wrap" id="cit-table"></div>
    </div>`;
  wireTopbar();

  const rowActions = (x) => `
    <div class="admin-actions">
      <button class="btn ghost small" data-reset="${x.id}">Réinit. MDP</button>
      <button class="btn ${x.active ? 'danger' : 'success'} small" data-active="${x.id}" data-to="${x.active ? '0' : '1'}">${x.active ? 'Désactiver' : 'Activer'}</button>
      <button class="btn ghost small" data-role="${x.id}">Rôle</button>
    </div>`;
  const renderTable = (sel, list, showModule) => {
    const t = $(sel);
    if (!list.length) { t.innerHTML = '<div class="empty">Aucun compte.</div>'; return; }
    t.innerHTML = `<table><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th>${showModule ? '<th>Module</th>' : ''}<th>État</th><th>Actions</th></tr></thead>
      <tbody>${list.map((x) => `<tr>
        <td>${esc(x.name)}</td>
        <td><code>${esc(x.email)}</code></td>
        <td>${esc(roleLabel(x))}</td>
        ${showModule ? `<td>${x.module ? 'Module ' + esc(x.module) : '<span class="muted">—</span>'}</td>` : ''}
        <td><span class="badge ${x.active ? 'active' : 'inactive'}">${x.active ? 'Actif' : 'Désactivé'}</span>${x.mustChangePassword ? ' <span class="badge to_complete">MDP à changer</span>' : ''}</td>
        <td>${rowActions(x)}</td></tr>`).join('')}</tbody></table>`;
    t.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = () => adminReset(Number(b.dataset.reset))));
    t.querySelectorAll('[data-active]').forEach((b) => (b.onclick = () => adminSetActive(Number(b.dataset.active), b.dataset.to === '1')));
    t.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => adminChangeRole(Number(b.dataset.role), list.find((x) => x.id === Number(b.dataset.role)), modules)));
  };
  renderTable('#pro-table', pro, true);
  renderTable('#cit-table', citizens, false);
  $('#new-account').onclick = () => adminCreateAccount(modules);
});

function adminCreateAccount(modules) {
  const close = openModal({
    title: 'Créer un compte professionnel',
    bodyHTML: `
      <div id="ac-alert"></div>
      <label class="field"><span>Nom complet</span><input id="ac-name" placeholder="Prénom Nom" /></label>
      <label class="field"><span>Adresse professionnelle</span><input id="ac-email" type="email" placeholder="service@mairie-gmdi.ci" /></label>
      <label class="field"><span>Rôle</span>
        <select id="ac-role">
          <option value="manager">Gestionnaire de module</option>
          <option value="mayor">Maire</option>
          <option value="auditor">Auditeur</option>
          <option value="admin">Administrateur</option>
        </select></label>
      <label class="field" id="ac-modwrap"><span>Module de rattachement</span>
        <select id="ac-module">${modules.map((m) => `<option value="${m.code}">Module ${m.code} — ${esc(m.name)}</option>`).join('')}</select></label>
      <p class="muted" style="font-size:12px">Un mot de passe temporaire sera généré ; le compte devra le changer à la première connexion.</p>`,
    footHTML: `<button class="btn ghost" id="ac-cancel">Annuler</button><button class="btn" id="ac-create">Créer le compte</button>`,
  });
  const toggleMod = () => ($('#ac-modwrap').style.display = $('#ac-role').value === 'manager' ? 'block' : 'none');
  $('#ac-role').onchange = toggleMod; toggleMod();
  $('#ac-cancel').onclick = close;
  $('#ac-create').onclick = async () => {
    try {
      const body = { name: $('#ac-name').value.trim(), email: $('#ac-email').value.trim(), role: $('#ac-role').value };
      if (body.role === 'manager') body.module = $('#ac-module').value;
      const r = await api('/admin/users', { method: 'POST', body });
      close();
      openModal({ title: 'Compte créé', bodyHTML: `<p>Compte <b>${esc(r.user.email)}</b> créé.</p><p>Mot de passe temporaire : <code style="font-size:15px">${esc(r.tempPassword)}</code></p><p class="muted" style="font-size:12.5px">Communiquez-le au titulaire ; il devra le modifier à la première connexion.</p>`, footHTML: '<button class="btn" onclick="document.getElementById(\'modal-root\').innerHTML=\'\';location.reload()">Fermer</button>' });
    } catch (e) { $('#ac-alert').innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
  };
}

async function adminReset(id) {
  try {
    const r = await api(`/admin/users/${id}/reset-password`, { method: 'POST' });
    openModal({ title: 'Mot de passe réinitialisé', bodyHTML: `<p>Nouveau mot de passe temporaire :</p><p><code style="font-size:16px">${esc(r.tempPassword)}</code></p><p class="muted" style="font-size:12.5px">L'utilisateur devra le changer à sa prochaine connexion.</p>`, footHTML: '<button class="btn" id="ok">Fermer</button>' });
    $('#ok').onclick = closeModal;
  } catch (e) { alert(e.message); }
}
async function adminSetActive(id, active) {
  try { await api(`/admin/users/${id}/active`, { method: 'POST', body: { active } }); render(); }
  catch (e) { alert(e.message); }
}
function adminChangeRole(id, user, modules) {
  const close = openModal({
    title: 'Changer le rôle',
    bodyHTML: `
      <div id="rc-alert"></div>
      <p class="muted" style="font-size:13px">${esc(user.name)} — <code>${esc(user.email)}</code></p>
      <label class="field"><span>Nouveau rôle</span>
        <select id="rc-role">
          ${['manager', 'mayor', 'auditor', 'admin', 'citizen', 'agent'].map((r) => `<option value="${r}"${user.role === r ? ' selected' : ''}>${esc(roleLabel({ role: r }))}</option>`).join('')}
        </select></label>
      <label class="field" id="rc-modwrap"><span>Module de rattachement</span>
        <select id="rc-module">${modules.map((m) => `<option value="${m.code}"${user.module === m.code ? ' selected' : ''}>Module ${m.code} — ${esc(m.name)}</option>`).join('')}</select></label>`,
    footHTML: `<button class="btn ghost" id="rc-cancel">Annuler</button><button class="btn" id="rc-save">Enregistrer</button>`,
  });
  const toggle = () => ($('#rc-modwrap').style.display = $('#rc-role').value === 'manager' ? 'block' : 'none');
  $('#rc-role').onchange = toggle; toggle();
  $('#rc-cancel').onclick = close;
  $('#rc-save').onclick = async () => {
    try {
      const body = { role: $('#rc-role').value };
      if (body.role === 'manager') body.module = $('#rc-module').value;
      await api(`/admin/users/${id}/role`, { method: 'POST', body });
      close(); render();
    } catch (e) { $('#rc-alert').innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
  };
}

async function renderAdminLogs() {
  const { entries } = await api('/admin/logs');
  app().innerHTML = topbar() + `
    <div class="container">
      <p style="margin:0 0 6px"><a href="#/admin">← Administration</a></p>
      <h1 class="page-title">Journaux techniques</h1>
      <p class="page-sub">Historique consolidé des actions (${entries.length} entrées).</p>
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
}

// ===========================================================================
// Vérification publique d'un acte (route SPA, aussi servie par verify.html)
// ===========================================================================
route('/verify', async (sub) => {
  const token = sub[0];
  await ensureMeta();
  setSpace('public');
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
