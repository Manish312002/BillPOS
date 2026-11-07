import { Router } from 'express';
import { getHealthStatus } from '../services/health.service.js';
import { successResponse } from '../utils/apiResponse.js';

const router = Router();

router.get('/', (req, res) => {
  const healthData = getHealthStatus();
  return res.status(200).json(successResponse(healthData, 'BillingBuddy API is healthy'));
});

export default router;
