import { createApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db.js';

const db = openDb();
const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`LEVEL UP API listening on http://localhost:${config.port}`);
  console.log(config.anthropicKey ? 'AI coach: enabled' : 'AI coach: no ANTHROPIC_API_KEY set, using the built-in rule-based coach');
  if (!config.isProd && !process.env.JWT_SECRET) console.warn('Using the development JWT secret. Set JWT_SECRET before deploying.');
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
