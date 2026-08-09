import type { Env } from '../config/env.js';

/**
 * Limitation de débit par route (§12).
 *
 * Les points d'accès sensibles — demande de code, vérification, connexion
 * administrateur — sont bridés par adresse IP en plus des garde-fous par
 * numéro appliqués dans `services/auth.ts`.
 *
 * En environnement de test la limite est neutralisée : une suite d'intégration
 * enchaîne des dizaines d'authentifications depuis la même adresse, et ce qui
 * doit être vérifié là est la logique métier, pas le compteur de débit.
 */
export function routeRateLimit(
  env: Env,
  max: number,
  timeWindow: string,
): { rateLimit: { max: number; timeWindow: string } } {
  return {
    rateLimit: {
      max: env.NODE_ENV === 'test' ? 1_000_000 : max,
      timeWindow,
    },
  };
}
