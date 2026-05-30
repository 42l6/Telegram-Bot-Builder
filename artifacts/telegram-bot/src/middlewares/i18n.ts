import { Language } from '@prisma/client';
import { BotContext } from '../types';
import { translate } from '../services/translation';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { logger } from '../utils/logger';

export async function i18nMiddleware(
  ctx: BotContext,
  next: () => Promise<void>
): Promise<void> {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      ctx.lang = Language.en;
      ctx.t = (key, params) => translate(Language.en, key, params);
      return next();
    }

    const cacheKey = CACHE_KEYS.user(telegramId);
    let lang: Language = Language.en;
    let dbUser = await cache.get<typeof ctx.dbUser>(cacheKey);

    if (!dbUser) {
      dbUser = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });
      if (dbUser) {
        await cache.set(cacheKey, dbUser, 300);
      }
    }

    if (dbUser) {
      lang = dbUser.language;
      ctx.dbUser = dbUser;
    } else {
      ctx.dbUser = null;
      lang = (ctx.session?.language as Language) ?? Language.en;
    }

    ctx.lang = lang;
    ctx.t = (key, params) => translate(lang, key, params);

    await next();
  } catch (error) {
    logger.error('i18n middleware error:', error);
    ctx.lang = Language.en;
    ctx.t = (key, params) => translate(Language.en, key, params);
    await next();
  }
}
