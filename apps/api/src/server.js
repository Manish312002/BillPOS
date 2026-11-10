import { app } from './app.js';
import { env } from './config/env.js';
import { prisma, disconnectPrisma } from './db/client.js';

let server;

async function start() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`; // confirms the DB actually responds
    console.log('[BillingBuddy API] Database connected.');
  } catch (err) {
    console.error('[BillingBuddy API] Database connection failed:', err);
    process.exit(1);
  }

  server = app.listen(env.PORT, () => {
    console.log(`[BillingBuddy API] Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

start();

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
