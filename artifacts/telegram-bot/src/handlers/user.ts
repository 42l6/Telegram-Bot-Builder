import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { config } from '../config';
import { backHomeKeyboard, languageKeyboard } from '../utils/keyboards';
import { formatPrice, formatTimeRemaining } from '../utils/helpers';
import { logger } from '../utils/logger';
import { Markup } from 'telegraf';

export async function showWallet(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const user = ctx.dbUser!;
    const text = t('wallet_balance', {
      balance: formatPrice(user.walletBalance),
      points: user.bonusPoints,
    });
    await safeEdit(ctx, `${t('wallet_title')}\n\n${text}`, backHomeKeyboard(t));
  } catch (error) {
    logger.error('showWallet error:', error);
  }
}

export async function showReferral(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const user = ctx.dbUser!;

    const botUsername = config.BOT_USERNAME;
    const link = botUsername
      ? `https://t.me/${botUsername}?start=ref_${user.referralCode}`
      : `ref_${user.referralCode}`;

    const [referralCount, totalPoints] = await Promise.all([
      prisma.user.count({ where: { referredBy: user.id } }),
      prisma.user
        .count({ where: { referredBy: user.id } })
        .then((c) => c * config.REFERRAL_BONUS_POINTS),
    ]);

    const text = t('referral_info', {
      link,
      count: referralCount,
      points: totalPoints,
    });

    await safeEdit(ctx, text, backHomeKeyboard(t));
  } catch (error) {
    logger.error('showReferral error:', error);
  }
}

export async function claimDailyReward(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const user = ctx.dbUser!;

    const cacheKey = CACHE_KEYS.dailyReward(user.id);
    const alreadyClaimed = await cache.exists(cacheKey);

    if (alreadyClaimed) {
      const remaining = await cache.ttl(cacheKey);
      const ms = remaining * 1000;
      await safeEdit(
        ctx,
        t('daily_reward_already', { time: formatTimeRemaining(ms) }),
        backHomeKeyboard(t)
      );
      return;
    }

    const points = config.DAILY_REWARD_POINTS;

    await Promise.all([
      prisma.user.update({
        where: { id: user.id },
        data: { bonusPoints: { increment: points } },
      }),
      prisma.dailyReward.create({ data: { userId: user.id, points } }),
      cache.set(cacheKey, true, 86400),
      cache.del(CACHE_KEYS.user(Number(user.telegramId))),
    ]);

    await safeEdit(ctx, t('daily_reward_claimed', { points }), backHomeKeyboard(t));
  } catch (error) {
    logger.error('claimDailyReward error:', error);
  }
}

export async function showFavorites(ctx: BotContext, page = 1): Promise<void> {
  try {
    const t = ctx.t;
    const lang = ctx.lang;
    const user = ctx.dbUser!;

    const favorites = await prisma.favorite.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            id: true, nameEn: true, nameAr: true,
            price: true, discountPrice: true, isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (favorites.length === 0) {
      await safeEdit(ctx, t('no_favorites'), backHomeKeyboard(t));
      return;
    }

    const rows = favorites
      .filter((f) => f.product.isActive)
      .map((f) => {
        const name = lang === 'ar' ? f.product.nameAr : f.product.nameEn;
        const price = f.product.discountPrice ?? f.product.price;
        return [Markup.button.callback(`${name} — ${formatPrice(price)}`, `prod:${f.product.id}`)];
      });

    rows.push([Markup.button.callback(t('btn_home'), 'home')]);

    await safeEdit(ctx, `${t('favorites_title')}\n\n`, Markup.inlineKeyboard(rows));
  } catch (error) {
    logger.error('showFavorites error:', error);
  }
}

export async function toggleFavorite(
  ctx: BotContext,
  productId: number,
  add: boolean
): Promise<void> {
  try {
    const t = ctx.t;
    const user = ctx.dbUser!;

    if (add) {
      await prisma.favorite.upsert({
        where: { userId_productId: { userId: user.id, productId } },
        create: { userId: user.id, productId },
        update: {},
      });
      await ctx.answerCbQuery(t('added_to_favorites'), { show_alert: true }).catch(() => null);
    } else {
      await prisma.favorite.deleteMany({ where: { userId: user.id, productId } });
      await ctx.answerCbQuery(t('removed_from_favorites'), { show_alert: true }).catch(() => null);
    }
  } catch (error) {
    logger.error('toggleFavorite error:', error);
  }
}

export async function showSettings(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(t('btn_language'), 'change_language')],
      [Markup.button.callback(t('btn_home'), 'home')],
    ]);
    await safeEdit(ctx, `${t('settings_title')}\n\n${t('settings_menu')}`, keyboard);
  } catch (error) {
    logger.error('showSettings error:', error);
  }
}

export async function changeLanguage(ctx: BotContext): Promise<void> {
  try {
    await safeEdit(ctx, ctx.t('choose_language'), languageKeyboard());
  } catch (error) {
    logger.error('changeLanguage error:', error);
  }
}

async function safeEdit(
  ctx: BotContext,
  text: string,
  keyboard: ReturnType<typeof Markup.inlineKeyboard>
): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { ...keyboard, parse_mode: 'Markdown' }).catch(async () => {
      await ctx.reply(text, { ...keyboard, parse_mode: 'Markdown' });
    });
    await ctx.answerCbQuery().catch(() => null);
  } else {
    await ctx.reply(text, { ...keyboard, parse_mode: 'Markdown' });
  }
}
