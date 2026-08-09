import { z } from 'zod';

/**
 * Lecture et validation de la configuration.
 *
 * Le serveur refuse de démarrer si une valeur est absente ou incohérente :
 * mieux vaut un échec au démarrage qu'un comportement dégradé en production.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_DEBUG_RETURN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  SMS_PROVIDER: z.enum(['log', 'none']).default('log'),
  PUSH_PROVIDER: z.enum(['log', 'none']).default('log'),
  PAYMENT_MOBILE_MONEY_PROVIDER: z.enum(['mock', 'none']).default('mock'),
  PAYMENT_CARD_PROVIDER: z.enum(['mock', 'none']).default('mock'),

  DISPATCH_SEARCH_RADIUS_KM: z.coerce.number().positive().default(5),
  DISPATCH_MAX_CANDIDATES: z.coerce.number().int().positive().default(10),
  DISPATCH_OFFER_TTL_SECONDS: z.coerce.number().int().positive().default(20),
  /** Position plus ancienne que ce seuil : le chauffeur n'est pas considéré joignable. */
  DISPATCH_LOCATION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(120),
  /**
   * Facteur de sinuosité : rapport entre distance routière réelle et distance à
   * vol d'oiseau, utilisé tant qu'aucun service cartographique n'est branché.
   */
  ROUTING_DETOUR_FACTOR: z.coerce.number().min(1).default(1.35),
  /** Vitesse moyenne retenue pour l'estimation de durée, en km/h. */
  ROUTING_AVERAGE_SPEED_KMH: z.coerce.number().positive().default(25),

  CURRENCY: z.string().length(3).default('XOF'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
});

export type Env = z.infer<typeof schema> & { corsOrigins: string[] };

const INSECURE_SECRETS = [
  'change-me-en-production-32-caracteres-minimum',
  'dev-secret-a-remplacer-en-production-0123456789',
];

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }

  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    if (INSECURE_SECRETS.includes(env.JWT_SECRET)) {
      throw new Error('JWT_SECRET porte encore sa valeur d\'exemple : refus de démarrer en production.');
    }
    if (env.OTP_DEBUG_RETURN) {
      throw new Error('OTP_DEBUG_RETURN doit être désactivé en production : un OTP ne transite que par SMS.');
    }
    if (env.PAYMENT_MOBILE_MONEY_PROVIDER === 'mock' || env.PAYMENT_CARD_PROVIDER === 'mock') {
      throw new Error(
        'Les simulateurs de paiement sont interdits en production : brancher un prestataire agréé (§9).',
      );
    }
  }

  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
