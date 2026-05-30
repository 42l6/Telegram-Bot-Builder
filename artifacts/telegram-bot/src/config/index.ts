import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig();

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ADMIN_IDS: z.string().default(''),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  DAILY_REWARD_POINTS: z.coerce.number().default(10),
  REFERRAL_BONUS_POINTS: z.coerce.number().default(50),
  BOT_USERNAME: z.string().optional(),
  WEBHOOK_DOMAIN: z.string().optional(),
  WEBHOOK_PORT: z.coerce.number().default(3000),
  MAX_CART_ITEMS: z.coerce.number().default(20),
  ITEMS_PER_PAGE: z.coerce.number().default(8),
  BROADCAST_DELAY_MS: z.coerce.number().default(100),
  ABANDONED_CART_HOURS: z.coerce.number().default(24),
  BONUS_POINTS_PER_ORDER_AMOUNT: z.coerce.number().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  adminIds: parsed.data.ADMIN_IDS
    ? parsed.data.ADMIN_IDS.split(',').map((id) => parseInt(id.trim())).filter(Boolean)
    : [],
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
};

export type Config = typeof config;
