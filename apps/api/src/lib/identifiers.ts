import { randomInt } from 'node:crypto';
import { badRequest } from './errors.js';

/**
 * Identifiants lisibles et normalisation des numéros de téléphone.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans I, L, O, 0, 1 : lecture au téléphone

function randomSuffix(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

function datePart(now: Date): string {
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
}

/**
 * Référence de course, exigée au §18 (« chaque course doit avoir un identifiant
 * unique »). L'UUID reste la clé technique ; cette référence est ce que lisent
 * le client, le chauffeur et le support.
 * Format : CRS-20260807-K7X2QM
 */
export function generateRideReference(now = new Date()): string {
  return `CRS-${datePart(now)}-${randomSuffix(6)}`;
}

/** Référence de ticket d'assistance (§15). */
export function generateTicketReference(now = new Date()): string {
  return `TCK-${datePart(now)}-${randomSuffix(5)}`;
}

/**
 * Normalisation d'un numéro de téléphone au format E.164.
 *
 * Le pays par défaut est la Côte d'Ivoire (§1). Les numéros ivoiriens sont à
 * 10 chiffres depuis 2021 ; un numéro plus court est refusé plutôt que
 * « corrigé », pour ne pas créer de compte sur un numéro erroné.
 */
export function normalizePhone(input: string, defaultCountryCode = '225'): string {
  const trimmed = input.trim().replace(/[\s.\-()]/g, '');

  if (!/^\+?\d+$/.test(trimmed)) {
    throw badRequest('invalid_phone', 'Numéro de téléphone invalide.');
  }

  let digits: string;
  if (trimmed.startsWith('+')) {
    digits = trimmed.slice(1);
  } else if (trimmed.startsWith('00')) {
    digits = trimmed.slice(2);
  } else {
    // Numéro national : on retire un éventuel 0 de tête avant le préfixe pays.
    digits = defaultCountryCode + trimmed.replace(/^0+/, '');
  }

  if (digits.length < 8 || digits.length > 15) {
    throw badRequest('invalid_phone', 'Numéro de téléphone invalide.');
  }

  return `+${digits}`;
}

/** Masque un numéro pour les journaux et l'affichage : +225 07 ** ** ** 89. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 5)}${'*'.repeat(phone.length - 7)}${phone.slice(-2)}`;
}
