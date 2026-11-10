import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });
} else {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}
dotenv.config();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  APP_PUBLIC_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .optional()
    .default('postgresql://postgres:postgres@localhost:5432/billingbuddy?schema=public'),

  // Cryptographic Secrets (Required: strictly 32-byte UTF-8 or 64-hexadecimal characters)
  TOTP_ENCRYPTION_KEY: z
    .string({ required_error: 'TOTP_ENCRYPTION_KEY is required' })
    .min(1, { message: 'TOTP_ENCRYPTION_KEY cannot be empty' })
    .refine(
      (val) => {
        if (/^[0-9a-fA-F]{64}$/.test(val)) return true;
        return Buffer.byteLength(val, 'utf8') === 32;
      },
      {
        message:
          'TOTP_ENCRYPTION_KEY must be a valid 32-byte key (either exactly 32 UTF-8 characters or 64 hexadecimal characters)',
      }
    ),

  // Root Superadmin Bootstrap Defaults
  ROOT_SUPERADMIN_PHONE: z.string().default('+918380989776'),
  ROOT_SUPERADMIN_EMAIL: z.string().default('superadmin@billingbuddy.com'),
  ROOT_SUPERADMIN_INITIAL_PASSWORD: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables configuration:');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
export default env;
