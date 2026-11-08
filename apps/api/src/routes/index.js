import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import platformRoutes from './platform.routes.js';
import ownerRoutes from './owner.routes.js';

const apiRouter = Router();

// Mount feature routes
apiRouter.use('/health', healthRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/platform', platformRoutes);
apiRouter.use('/owner', ownerRoutes);

export default apiRouter;
