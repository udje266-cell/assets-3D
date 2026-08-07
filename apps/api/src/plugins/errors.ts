import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

/**
 * Traduction uniforme des erreurs.
 *
 * Toute réponse d'erreur a la même forme :
 *   { "error": { "code": "...", "message": "...", "details": ... } }
 *
 * Une erreur inattendue est journalisée intégralement mais renvoyée sans
 * détail : un message d'erreur de base de données ne doit jamais atteindre une
 * application mobile (§12).
 */
async function errorsPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Requête invalide.',
          details: error.issues.map((issue) => ({
            champ: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    // Erreurs levées par Fastify lui-même (validation de schéma, limite de débit).
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    const statusCode = fastifyError.statusCode ?? 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: fastifyError.code ?? 'bad_request',
          message: fastifyError.message ?? 'Requête invalide.',
        },
      });
    }

    request.log.error({ err: error }, 'Erreur non gérée');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Une erreur interne est survenue.' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'route_not_found',
        message: `Route inconnue : ${request.method} ${request.url}`,
      },
    });
  });
}

export default fp(errorsPlugin, { name: 'errors' });
