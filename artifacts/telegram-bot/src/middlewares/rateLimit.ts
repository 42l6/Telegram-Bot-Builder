import { BotContext } from '../types';
import { cache, CACHE_KEYS } from '../services/cache';
import { logger } from '../utils/logger';

interface RateLimitOptions {
  action: string;
  maxRequests: number;
  windowSeconds: number;
}

export function rateLimitMiddleware(opts: RateLimitOptions) {
  return async (ctx: BotContext, next: () => Promise<void>): Promise<void> => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    try {
      const key = CACHE_KEYS.rateLimit(BigInt(telegramId), opts.action);
      const count = await cache.incr(key);

      if (count === 1) {
        await cache.expire(key, opts.windowSeconds);
      }

      if (count > opts.maxRequests) {
        logger.warn(`Rate limit hit: user ${telegramId}, action ${opts.action}`);
        if ('callbackQuery' in ctx) {
          await ctx.answerCbQuery('⏳ Too many requests. Please slow down.', { show_alert: true }).catch(() => null);
        }
        return;
      }

      await next();
    } catch (error) {
      logger.error('Rate limit middleware error:', error);
      await next();
    }
  };
}

export const globalRateLimit = rateLimitMiddleware({
  action: 'global',
  maxRequests: 30,
  windowSeconds: 60,
});

export const messageRateLimit = rateLimitMiddleware({
  action: 'message',
  maxRequests: 10,
  windowSeconds: 10,
});

export const callbackRateLimit = rateLimitMiddleware({
  action: 'callback',
  maxRequests: 20,
  windowSeconds: 10,
});
