// GMDI — Notifications (cahier des charges technique §7).
// Toute action importante génère une notification interne. Les canaux Email/SMS
// sont simulés (champ `channels`) ; la notification interne est réellement stockée.

import { get, saveSoon, nextId } from './store.js';

export function notify({ userId, type = 'info', title, message, demarcheId = null, module = null, channels = ['interne'] }) {
  if (!userId) return null;
  const n = {
    id: nextId('notification'),
    userId,
    type, // info | success | warning | error
    title,
    message,
    demarcheId,
    module,
    channels,
    read: false,
    createdAt: new Date().toISOString(),
  };
  get().notifications.push(n);
  saveSoon();
  return n;
}

export function listForUser(userId, { limit = 50 } = {}) {
  return get()
    .notifications.filter((n) => n.userId === userId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export function unreadCount(userId) {
  return get().notifications.filter((n) => n.userId === userId && !n.read).length;
}

export function markRead(userId, id) {
  const n = get().notifications.find((x) => x.id === Number(id) && x.userId === userId);
  if (n) { n.read = true; saveSoon(); }
  return n;
}

export function markAllRead(userId) {
  let count = 0;
  for (const n of get().notifications) {
    if (n.userId === userId && !n.read) { n.read = true; count++; }
  }
  if (count) saveSoon();
  return count;
}
