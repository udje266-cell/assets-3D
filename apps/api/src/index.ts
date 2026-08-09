import { loadEnv } from './config/env.js';
import { createRealtimeGateway } from './realtime/socket.js';
import { buildServer } from './server.js';
import { sweepExpiredOffers } from './services/dispatch.js';
import { runMigrations } from './db/migrate.js';

/**
 * Point d'entrée du serveur.
 *
 * Séquence : configuration → migrations → serveur HTTP → passerelle temps réel
 * → boucle de fond. Les migrations sont appliquées au démarrage pour qu'un
 * déploiement ne puisse pas tourner sur un schéma périmé.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  const migration = await runMigrations(env.DATABASE_URL, { log: (m) => console.log(m) });
  if (migration.applied.length > 0) {
    console.log(`${migration.applied.length} migration(s) appliquée(s).`);
  }

  const { app, ctx, close } = await buildServer({ env });

  await app.listen({ port: env.PORT, host: env.HOST });

  // La passerelle temps réel se greffe sur le serveur HTTP de Fastify.
  const { gateway } = createRealtimeGateway(app.server, ctx, {
    verifyToken: (token) => app.jwt.verify(token),
  });
  ctx.realtime = gateway;

  /**
   * Boucle de fond : les offres non honorées sont expirées et la recherche
   * reprend auprès du chauffeur suivant (§19). L'intervalle est volontairement
   * court par rapport à la durée de vie d'une offre.
   */
  const sweepInterval = setInterval(() => {
    void sweepExpiredOffers(ctx).catch((error: Error) => {
      app.log.error({ err: error }, 'Balayage des offres expirées en échec');
    });
  }, 5_000);
  sweepInterval.unref();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Arrêt en cours');
    clearInterval(sweepInterval);
    await close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  app.log.info(
    { port: env.PORT, env: env.NODE_ENV },
    'URIGO — API démarrée',
  );
}

main().catch((error: Error) => {
  console.error('Démarrage impossible :', error.message);
  process.exit(1);
});
