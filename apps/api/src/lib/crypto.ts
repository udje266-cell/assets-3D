import {
  randomBytes,
  randomInt,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Hachage des secrets (§12).
 *
 * scrypt est retenu plutôt qu'un module natif (argon2, bcrypt) : il est fourni
 * par Node, sans compilation, et reste un algorithme à coût mémoire adapté.
 * Paramètres : N = 2^15, sel aléatoire de 16 octets, clé de 64 octets.
 */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(secret, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Vérification à temps constant. Ne lève jamais : renvoie false si le format est invalide. */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, 'hex');
    const derived = await scrypt(secret, Buffer.from(saltHex, 'hex'), expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Code OTP numérique tiré d'une source cryptographique.
 * `randomInt` évite le biais modulo d'un `Math.random()` ou d'un `% 10`.
 */
export function generateOtp(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

/** Jeton opaque destiné au rafraîchissement de session. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Empreinte d'un jeton de rafraîchissement.
 *
 * SHA-256 suffit ici, contrairement aux mots de passe : le jeton est déjà une
 * valeur aléatoire de 256 bits, il n'y a pas d'espace de recherche à ralentir.
 * Le hachage sert à ce qu'une fuite de la base ne livre pas de session utilisable.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
