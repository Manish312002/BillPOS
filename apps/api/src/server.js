import { app } from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './db/client.js';

const server = app.listen(env.PORT, () => {
  console.log(`[BillingBuddy API] Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`[BillingBuddy API] Health check endpoint: http://localhost:${env.PORT}${env.API_PREFIX}/health`);
});

async function shutdown(signal) {
  console.log(`\n[BillingBuddy API] Received ${signal}. Initiating graceful shutdown...`);
  server.close(async () => {
    try {
      await disconnectPrisma();
      console.log('[BillingBuddy API] Database connections closed.');
    } catch (err) {
      console.error('[BillingBuddy API] Error during disconnect:', err);
    }
    console.log('[BillingBuddy API] Process terminated gracefully.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
