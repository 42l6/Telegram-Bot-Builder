import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { config } from '../config';
import { languageKeyboard, mainMenuKeyboard } from '../utils/keyboards';
import { generateReferralCode, getUserDisplayName } from '../utils/helpers';
import { translate } from '../services/translation';
import { Language } from '@prisma/client';
import { logger } from '../utils/logger';

export async function handleStart(ctx: BotContext): Promise<void> {
  const telegramUser = ctx.from!;

  try {
    // Handle referral code from deep link
    const startPayload = (ctx.message as { text?: string } | undefined)?.text?.split(' ')[1];
    let referrerId: number | null = null;

    if (startPayload?.startsWith('ref_')) {
      const code = startPayload.slice(4);
      const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
      if (referrer && referrer.telegramId !== BigInt(telegramUser.id)) {
        referrerId = referrer.id;
      }
    }

    let dbUser = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) },
    });

    if (!dbUser) {
      // New user — show language selection
      ctx.session.language = Language.en;
      if (referrerId) ctx.session.adminData = { referrerId };

      await ctx.reply(
        translate(Language.en, 'welcome', { name: telegramUser.first_name }),
        languageKeyboard()
      );
      return;
    }

    // Existing user
    await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        username: telegramUser.username ?? null,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        lastActiveAt: new Date(),
      },
    });

    await cache.del(CACHE_KEYS.user(telegramUser.id));

    const t = (key: string, params?: Record<string, string | number>) =>
      translate(dbUser!.language, key, params);

    await ctx.reply(
      t('welcome_back', { name: telegramUser.first_name }),
      mainMenuKeyboard(t)
    );

    // Track analytics
    await prisma.analyticsEvent.create({
      data: {
        userId: dbUser.id,
        event: 'start',
      },
    }).catch(() => null);

  } catch (error) {
    logger.error('Start command error:', error);
    await ctx.reply('Welcome! Please try again.');
  }
}

export async function handleLanguageSelection(
  ctx: BotContext,
  lang: Language
): Promise<void> {
  const telegramUser = ctx.from!;

  try {
    ctx.session.language = lang;

    const referrerId = ctx.session.adminData?.referrerId as number | undefined;

    let dbUser = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          telegramId: BigInt(telegramUser.id),
          username: telegramUser.username ?? null,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name ?? null,
          language: lang,
          role: config.adminIds.includes(telegramUser.id) ? 'admin' : 'user',
          referralCode: generateReferralCode(),
          referredBy: referrerId ?? null,
        },
      });

      // Give referral bonus
      if (referrerId) {
        await prisma.user.update({
          where: { id: referrerId },
          data: { bonusPoints: { increment: config.REFERRAL_BONUS_POINTS } },
        });

        // Notify referrer
        const referrer = await prisma.user.findUnique({ where: { id: referrerId } });
        if (referrer) {
          await ctx.telegram.sendMessage(
            Number(referrer.telegramId),
            translate(referrer.language, 'referral_bonus', {
              points: config.REFERRAL_BONUS_POINTS,
            })
          ).catch(() => null);
        }
      }

      // Track new user
      await prisma.analyticsEvent.create({
        data: { userId: dbUser.id, event: 'new_user', metadata: { lang } },
      }).catch(() => null);
    } else {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { language: lang },
      });
    }

    await cache.del(CACHE_KEYS.user(telegramUser.id));
    ctx.dbUser = dbUser;
    ctx.lang = lang;

    const t = (key: string, params?: Record<string, string | number>) =>
      translate(lang, key, params);

    await ctx.editMessageText(t('language_selected')).catch(() => null);
    await ctx.reply(
      t('welcome_back', { name: telegramUser.first_name }),
      mainMenuKeyboard(t)
    );
  } catch (error) {
    logger.error('Language selection error:', error);
  }
}
