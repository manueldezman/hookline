import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { Store } from './store.js';
import { systemClock } from './clock.js';
import { randomHex, sha256 } from './ids.js';
import { ApiError, unauthorized } from './errors.js';
import { RateLimiter } from './rate-limit.js';
import { DeliveryWorker } from './delivery/worker.js';
import { httpSender } from './http/sender.js';
import { verifyEndpointUrl } from './http/verifier.js';
import eventsRoutes from './routes/events.js';
import endpointsRoutes from './routes/endpoints.js';
import deliveriesRoutes from './routes/deliveries.js';
import accountRoutes from './routes/account.js';
import internalRoutes from './routes/internal.js';

export function createApp({
  db,
  config = loadConfig(),
  clock = systemClock,
  sender = httpSender,
  verifier = verifyEndpointUrl,
  startWorker = false,
  logger = false,
} = {}) {
  const database = db ?? openDatabase(config.databaseFile);
  const store = new Store(database);
  const { account, createdKeys } = store.ensureAccount({
    plan: config.plan,
    apiVersion: config.apiVersion,
    testKey: config.testKey,
    liveKey: config.liveKey,
    nowMs: clock.now(),
  });

  const app = Fastify({ logger, bodyLimit: config.bodyLimit });

  app.decorate('store', store);
  app.decorate('config', config);
  app.decorate('clock', clock);
  app.decorate('account', account);
  app.decorate('seededKeys', createdKeys);
  app.decorate('verifyEndpoint', (url) =>
    verifier(url, {
      allowPrivate: config.allowPrivateUrls,
      timeoutMs: config.verifyTimeoutMs,
    }),
  );

  const limiter = new RateLimiter({ clock, planLimits: config.planLimits });
  const worker = new DeliveryWorker({
    store,
    clock,
    config,
    sender,
    logger: app.log,
  });
  app.decorate('rateLimiter', limiter);
  app.decorate('worker', worker);

  app.addHook('onRequest', async (request, reply) => {
    request.requestId = `req_${randomHex(4)}`;
    reply.header('x-request-id', request.requestId);

    if (request.url === '/health') return;

    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    const found = store.findKeyByHash(sha256(token));
    if (!found) throw unauthorized();

    request.account = found.account;
    request.keyMode = found.mode;

    const version = request.headers['hookline-version'];
    if (version !== undefined) {
      if (!config.supportedVersions.includes(version)) {
        throw new ApiError(400, 'invalid_version', `Version ${version} is not supported.`);
      }
      request.apiVersion = version;
    } else {
      request.apiVersion = found.account.api_version;
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url.startsWith('/internal/')) return;

    const kind = request.method === 'GET' ? 'read' : 'write';
    const result = limiter.consume(request.account.id, request.account.plan, kind);

    reply.header('X-RateLimit-Limit', result.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.reset);

    if (!result.allowed) {
      const retryAfter = Math.max(1, result.reset - Math.floor(clock.now() / 1000));
      reply.header('Retry-After', retryAfter);
      throw new ApiError(
        429,
        'rate_limited',
        `Too many requests. Retry after ${retryAfter} seconds.`,
      );
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(eventsRoutes);
  app.register(endpointsRoutes);
  app.register(deliveriesRoutes);
  app.register(accountRoutes);
  app.register(internalRoutes);

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.requestId;

    if (error instanceof ApiError) {
      for (const [name, value] of Object.entries(error.headers)) {
        reply.header(name, value);
      }
      reply.code(error.status).send(error.body(requestId));
      return;
    }

    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      reply.code(413).send({
        error: {
          code: 'payload_too_large',
          message: 'The payload exceeds 256 KB.',
          request_id: requestId,
        },
      });
      return;
    }

    if (typeof error.code === 'string' && error.code.startsWith('FST_ERR_CTP_')) {
      reply.code(400).send({
        error: {
          code: 'malformed_request',
          message: 'The request body is not valid JSON.',
          request_id: requestId,
        },
      });
      return;
    }

    request.log.error(error);
    reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        request_id: requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: 'not_found',
        message: 'The resource does not exist.',
        request_id: request.requestId,
      },
    });
  });

  app.addHook('onClose', async () => {
    worker.stop();
    database.close();
  });

  if (startWorker) worker.start();

  return app;
}
