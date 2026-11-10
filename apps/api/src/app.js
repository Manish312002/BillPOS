import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRouter from './routes/index.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { compressionMiddleware } from './middleware/compression.js';

export function createApp() {
  const app = express();
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());

  // Basic security and parsing middlewares
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : allowedOrigins,
      credentials: true,
    })
  );

  app.use(helmet());
  app.use(compressionMiddleware());

  if (env.NODE_ENV !== 'test') {
    app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }));
  }
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);


  // Root welcome ping
  app.get('/', (req, res) => {
    res.status(200).json({
      name: 'BillingBuddy API',
      version: '0.1.0',
      status: 'active',
      docs: `${env.API_PREFIX}/health`,
    });
  });

  // Main API Router
  app.use(env.API_PREFIX, apiRouter);

  // Fallthrough 404 handler
  app.use(notFoundHandler);

  // Centralized Error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;
