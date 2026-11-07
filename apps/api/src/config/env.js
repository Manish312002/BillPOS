import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .optional()
    .default('postgresql://postgres:postgres@localhost:5432/billingbuddy?schema=public'),

  // Security & Cryptographic Pepper
  OTP_PEPPER_SECRET: z
    .string()
    .min(16, { message: 'OTP_PEPPER_SECRET must be at least 16 characters' })
    .default('dev_otp_pepper_secret_billingbuddy_2026'),

  // WhatsApp Provider Configuration
  WHATSAPP_PROVIDER: z.enum(['mock', 'meta', 'gupshup', 'twilio']).default('mock'),
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

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
