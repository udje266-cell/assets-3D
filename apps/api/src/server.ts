import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env.js';
import { NoopRealtimeGateway, type AppContext, type RealtimeGateway } from './context.js';
import { createDb, createPool, type DB } from './db/index.js';
import authPlugin from './plugins/auth.js';
import errorsPlugin from './plugins/errors.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClientRoutes } from './routes/client.js';
import { registerDriverRoutes } from './routes/driver.js';
import { LogTransport, NoopTransport, NotificationService } from './services/notifications.js';
import {
  CashProvider,
  MockElectronicProvider,
  PaymentRouter,
  type PaymentProvider,
} from './services/payments.js';
import { HaversineRoutingProvider } from './services/routing.js';

export interface BuildServerOptions {
  env: Env;
  /** Permet aux tests d'injecter une base et une passerelle temps réel muettes. */
  db?: DB;
  realtime?: RealtimeGateway;
}

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
  close: () => Promise<void>;
}

export async function buildServer(options: BuildServerOptions): Promise<BuiltServer> {
  const { env } = options;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Les données personnelles ne doivent pas apparaître en clair dans les
      // journaux : téléphones, jetons et codes sont masqués (§12).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.code',
          'req.body.phone',
          'req.body.password',
          'req.body.refreshToken',
        ],
        censor: '***',
      },
    },
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  const pool = createPool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const db = options.db ?? createDb(pool);

  const paymentProviders: PaymentProvider[] = [new CashProvider()];
  if (env.PAYMENT_MOBILE_MONEY_PROVIDER === 'mock' || env.PAYMENT_CARD_PROVIDER === 'mock') {
    paymentProviders.push(new MockElectronicProvider());
  }

  const ctx: AppContext = {
    env,
    pool,
    db,
    routing: new HaversineRoutingProvider({
      detourFactor: env.ROUTING_DETOUR_FACTOR,
      averageSpeedKmh: env.ROUTING_AVERAGE_SPEED_KMH,
    }),
    notifications: new NotificationService([
      env.PUSH_PROVIDER === 'log'
        ? new LogTransport('push', (m, p) => app.log.info(p ?? {}, m))
        : new NoopTransport('push'),
      env.SMS_PROVIDER === 'log'
        ? new LogTransport('sms', (m, p) => app.log.info(p ?? {}, m))
        : new NoopTransport('sms'),
      new NoopTransport('in_app'),
      new NoopTransport('email'),
    ]),
    payments: new PaymentRouter(paymentProviders),
    realtime: options.realtime ?? new NoopRealtimeGateway(),
    log: {
      info: (payload, message) => app.log.info(payload as object, message),
      warn: (payload, message) => app.log.warn(payload as object, message),
      error: (payload, message) => app.log.error(payload as object, message),
    },
  };

  await app.register(errorsPlugin);
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCors, {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
    credentials: true,
  });
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Les tests et le développement ne doivent pas être bridés par le débit.
    ...(env.NODE_ENV === 'test' ? { max: 100_000 } : {}),
  });
  await app.register(authPlugin, {
    secret: env.JWT_SECRET,
    accessTtlSeconds: env.JWT_ACCESS_TTL,
  });

  app.get('/health', async () => {
    const start = Date.now();
    await db.selectFrom('vehicle_categories').select('id').limit(1).execute();
    return { status: 'ok', database: 'ok', latencyMs: Date.now() - start };
  });

  await registerAuthRoutes(app, ctx);
  await registerClientRoutes(app, ctx);
  await registerDriverRoutes(app, ctx);
  await registerAdminRoutes(app, ctx);

  return {
    app,
    ctx,
    close: async () => {
      await app.close();
      if (!options.db) {
        await db.destroy();
      } else {
        await pool.end();
      }
    },
  };
}
