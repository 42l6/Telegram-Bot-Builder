import { Language } from '@prisma/client';
import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { generateReferralCode } from '../utils/helpers';
import { Markup } from 'telegraf';
import { translate } from '../services/translation';

export async function authMiddleware(
  ctx: BotContext,
  next: () => Promise<void>
): Promise<void> {
  const telegramUser = ctx.from;
  if (!telegramUser) return next();

  try {
    const cacheKey = CACHE_KEYS.user(telegramUser.id);
    let dbUser = await cache.get<typeof ctx.dbUser>(cacheKey);

    if (!dbUser) {
      dbUser = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramUser.id) },
      });

      if (dbUser) {
        await cache.set(cacheKey, dbUser, 300);
      }
    }

    if (!dbUser) {
      ctx.dbUser = null;
      ctx.lang = Language.en;
      ctx.t = (key, params) => translate(Language.en, key, params);
      return next();
    }

    if (dbUser.isBanned) {
      await ctx.reply(translate(dbUser.language, 'banned_message', {
        reason: dbUser.banReason ?? 'No reason provided',
      }));
      return;
    }

    await prisma.user.update({
      where: { id: dbUser.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => null);

    ctx.dbUser = dbUser;
    await next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    await next();
  }
}

export async function requireAdmin(
  ctx: BotContext,
  next: () => Promise<void>
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const isAdmin =
    config.adminIds.includes(telegramId) ||
    ctx.dbUser?.role === 'admin' ||
    ctx.dbUser?.role === 'superadmin';

  if (!isAdmin) {
    await ctx.reply(ctx.t('not_authorized'));
    return;
  }

  await next();
}

export async function ensureRegistered(
  ctx: BotContext,
  next: () => Promise<void>
): Promise<void> {
  if (!ctx.dbUser) {
    const telegramUser = ctx.from!;
    const lang: Language =
      (ctx.session?.language as Language) ?? Language.en;

    const newUser = await prisma.user.create({
      data: {
        telegramId: BigInt(telegramUser.id),
        username: telegramUser.username ?? null,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        language: lang,
        role: config.adminIds.includes(telegramUser.id) ? 'admin' : 'user',
        referralCode: generateReferralCode(),
      },
    });

    await cache.set(CACHE_KEYS.user(telegramUser.id), newUser, 300);
    ctx.dbUser = newUser;
  }

  await next();
}

export async function checkChannelSubscriptions(
  ctx: BotContext,
  next: () => Promise<void>
): Promise<void> {
  try {
    const channels = await cache.get<Array<{ channelId: string; channelName: string; inviteLink: string | null }>>(
      CACHE_KEYS.channelSubs()
    );

    let requiredChannels = channels;
    if (!requiredChannels) {
      const dbChannels = await prisma.channelSubscription.findMany({
        where: { isActive: true },
      });
      requiredChannels = dbChannels.map((c) => ({
        channelId: c.channelId,
        channelName: c.channelName,
        inviteLink: c.inviteLink,
      }));
      await cache.set(CACHE_KEYS.channelSubs(), requiredChannels, 600);
    }

    if (!requiredChannels || requiredChannels.length === 0) {
      return next();
    }

    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    for (const ch of requiredChannels) {
      try {
        const member = await ctx.telegram.getChatMember(ch.channelId, telegramId);
        if (['kicked', 'left'].includes(member.status)) {
          const channelList = requiredChannels
            .map((c) => `• ${c.channelName}${c.inviteLink ? ` — ${c.inviteLink}` : ''}`)
            .join('\n');

          await ctx.reply(
            translate(ctx.lang, 'subscribe_channels', { channels: channelList }),
            Markup.inlineKeyboard([
              [Markup.button.callback(translate(ctx.lang, 'btn_check_subscription'), 'check_subscription')],
            ])
          );
          return;
        }
      } catch {
        // If we can't check (bot not in channel), skip
      }
    }

    await next();
  } catch (error) {
    logger.error('Channel check error:', error);
    await next();
  }
}
