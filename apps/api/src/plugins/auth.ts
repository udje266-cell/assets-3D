import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AccountType, AdminRole } from '../db/types.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * Authentification par jeton — §12.
 *
 * Le jeton d'accès est court (15 min par défaut) et porte uniquement
 * l'identifiant du sujet et son type de compte. Les droits fins (rôle
 * d'administration) sont revérifiés en base à chaque requête sensible plutôt
 * que déduits d'un jeton potentiellement obsolète.
 */

export interface AccessTokenPayload {
  sub: string;
  type: AccountType;
  role?: AdminRole;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireClient: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireDriver: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminRole: (
      roles: readonly AdminRole[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    account?: AccessTokenPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

export interface AuthPluginOptions {
  secret: string;
  accessTtlSeconds: number;
}

async function authPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  await app.register(fastifyJwt, {
    secret: options.secret,
    sign: { expiresIn: options.accessTtlSeconds },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify<AccessTokenPayload>();
      request.account = payload;
    } catch {
      throw unauthorized('Jeton d’accès absent ou invalide.');
    }
  });

  const requireType =
    (type: AccountType) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await app.authenticate(request, reply);
      if (request.account?.type !== type) {
        throw forbidden('Ce point d’accès n’est pas destiné à votre type de compte.');
      }
    };

  app.decorate('requireClient', requireType('client'));
  app.decorate('requireDriver', requireType('driver'));
  app.decorate('requireAdmin', requireType('admin'));

  app.decorate(
    'requireAdminRole',
    (roles: readonly AdminRole[]) =>
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        await app.requireAdmin(request, reply);
        const role = request.account?.role;
        if (!role || (!roles.includes(role) && role !== 'super_admin')) {
          throw forbidden('Votre rôle ne permet pas cette action.');
        }
      },
  );
}

export default fp(authPlugin, { name: 'auth' });

/** Identifiant du compte authentifié — lève si la requête n'est pas authentifiée. */
export function accountId(request: FastifyRequest): string {
  const id = request.account?.sub;
  if (!id) throw unauthorized();
  return id;
}
