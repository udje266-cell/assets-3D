/**
 * Arithmétique monétaire.
 *
 * Tous les montants de la plateforme sont des entiers dans l'unité de la devise
 * (le FCFA n'a pas de sous-unité). Aucun calcul d'argent ne passe par un
 * flottant : les taux sont exprimés en points de base (bps, 1/10000) et les
 * divisions sont arrondies explicitement.
 */

/** 100 % exprimé en points de base. */
export const BPS_DENOMINATOR = 10_000;

export function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} doit être un entier sûr, reçu : ${value}`);
  }
}

/** Applique un taux en points de base, arrondi au plus proche (0,5 vers le haut). */
export function applyBps(amount: number, bps: number): number {
  assertInteger(amount, 'montant');
  return Math.round((amount * bps) / BPS_DENOMINATOR);
}

/** Arrondit au multiple de `step` le plus proche (step = 1 : aucun arrondi). */
export function roundToNearest(amount: number, step: number): number {
  if (step <= 1) return Math.round(amount);
  return Math.round(amount / step) * step;
}

/** Borne un montant dans un intervalle. */
export function clamp(amount: number, min: number, max: number): number {
  return Math.min(Math.max(amount, min), max);
}

/** Formatage lisible : 5000 → « 5 000 FCFA ». */
export function formatAmount(amount: number, currency = 'XOF'): string {
  const symbol = currency === 'XOF' ? 'FCFA' : currency;
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${digits} ${symbol}`;
}
