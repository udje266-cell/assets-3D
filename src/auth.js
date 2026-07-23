// GMDI — Authentification commune à tout le Back Office + Portail Citoyen.
// Une seule logique de connexion ; le système déduit le rôle et le module
// de rattachement (cahier des charges §2.4).

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { get, saveSoon, nextId } from './store.js';
import {
  SESSION_TTL_MS,
  MAX_LOGIN_ATTEMPTS,
  LOCK_DURATION_MS,
  ROLES,
} from './config.js';

// Sessions en mémoire (suffisant pour un prototype mono-instance).
const sessions = new Map(); // sid -> { userId, createdAt, lastSeen }

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

export function findUserByEmail(email) {
  if (!email) return null;
  const target = String(email).trim().toLowerCase();
  return get().users.find((u) => u.email.toLowerCase() === target) || null;
}

export function findUserById(id) {
  return get().users.find((u) => u.id === id) || null;
}

// Vue publique d'un utilisateur (jamais le hash).
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    module: u.module || null,
    name: u.name,
    mustChangePassword: !!u.mustChangePassword,
  };
}

export function createUser({ email, password, role, name, module = null, mustChangePassword = false }) {
  const user = {
    id: nextId('user'),
    email: String(email).trim().toLowerCase(),
    passwordHash: hashPassword(password),
    role,
    module,
    name: name || email,
    mustChangePassword,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: new Date().toISOString(),
  };
  get().users.push(user);
  saveSoon();
  return user;
}

// Résultat de connexion : { ok, user } ou { ok:false, error, locked }.
export function attemptLogin(email, password) {
  const user = findUserByEmail(email);
  // Message générique volontaire (cahier des charges §2.4) : on ne précise pas
  // si c'est l'email ou le mot de passe qui est erroné.
  const genericError = { ok: false, error: 'Identifiants incorrects.' };

  if (!user) return genericError;

  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil > now) {
    const mins = Math.ceil((user.lockedUntil - now) / 60000);
    return { ok: false, error: `Compte temporairement bloqué. Réessayez dans ${mins} min.`, locked: true };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    user.failedAttempts = (user.failedAttempts || 0) + 1;
    if (user.failedAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockedUntil = now + LOCK_DURATION_MS;
      user.failedAttempts = 0;
      saveSoon();
      return { ok: false, error: 'Trop de tentatives. Compte bloqué temporairement.', locked: true };
    }
    saveSoon();
    return genericError;
  }

  // Succès : réinitialise les compteurs.
  user.failedAttempts = 0;
  user.lockedUntil = 0;
  saveSoon();
  return { ok: true, user };
}

export function createSession(userId) {
  const sid = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  sessions.set(sid, { userId, createdAt: now, lastSeen: now });
  return sid;
}

export function destroySession(sid) {
  sessions.delete(sid);
}

// Renvoie l'utilisateur d'une session valide, ou null. Gère l'expiration
// par inactivité (déconnexion automatique).
export function userFromSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  const now = Date.now();
  if (now - s.lastSeen > SESSION_TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  s.lastSeen = now;
  const user = findUserById(s.userId);
  return user || null;
}

export function changePassword(user, newPassword) {
  user.passwordHash = hashPassword(newPassword);
  user.mustChangePassword = false;
  saveSoon();
}

// Réinitialisation par un administrateur autorisé (cahier des charges §2.4).
export function resetPasswordByAdmin(user, tempPassword) {
  user.passwordHash = hashPassword(tempPassword);
  user.mustChangePassword = true;
  user.failedAttempts = 0;
  user.lockedUntil = 0;
  saveSoon();
}

export function labelForUser(user) {
  if (!user) return 'Inconnu';
  if (user.role === ROLES.MAYOR) return 'Maire';
  if (user.role === ROLES.AUDITOR) return 'Auditeur';
  if (user.role === ROLES.MANAGER) return `Gestionnaire ${user.module}`;
  if (user.role === ROLES.AGENT) return `Agent — ${user.name}`;
  return `Citoyen — ${user.name}`;
}
