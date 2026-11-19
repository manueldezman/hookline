import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp({
  config,
  startWorker: true,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Hookline API listening at http://${config.host}:${config.port}/v2`);
  for (const seeded of app.seededKeys) {
    app.log.info(`Seeded ${seeded.mode} key: ${seeded.key}`);
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
