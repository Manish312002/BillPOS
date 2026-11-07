import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string(),
  version: z.string(),
  environment: z.enum(['development', 'test', 'production']),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.string(),
  nodeVersion: z.string().optional(),
  memoryUsageMB: z
    .object({
      rss: z.number().nonnegative(),
      heapTotal: z.number().nonnegative(),
      heapUsed: z.number().nonnegative(),
    })
    .optional(),
});
