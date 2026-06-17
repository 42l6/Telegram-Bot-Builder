import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { sleep } from '../utils/helpers';
import { config } from '../config';
import { logger } from '../utils/logger';

export const adminBroadcastScene = new Scenes.BaseScene<BotContext>('admin_broadcast');

adminBroadcastScene.enter(async (ctx) => {
  const t = ctx.t;
  ctx.session.broadcastData = { step: 'message_en' } as any;
  await ctx.reply(t('broadcast_message_en'), { reply_markup: { remove_keyboard: true } });
});

adminBroadcastScene.on('text', async (ctx) => {
  try {
    const t = ctx.t;
    const text = ctx.message.text.trim();
    const data = ctx.session.broadcastData ?? ({} as any);

    if (text === '/cancel') {
      await ctx.reply(t('operation_cancelled'));
      return ctx.scene.leave();
    }

    switch (data.step) {
      case 'message_en': {
        data.messageEn = text;
        data.step = 'message_ar';
        ctx.session.broadcastData = data;
        await ctx.reply(
          t('broadcast_message_ar'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_broadcast_ar')]])
        );
        break;
      }
      case 'message_ar': {
        data.messageAr = text;
        data.step = 'image';
        ctx.session.broadcastData = data;
        await ctx.reply(
          t('broadcast_image'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_broadcast_image')]])
        );
        break;
      }
      case 'schedule': {
        const parsed = new Date(text);
        if (isNaN(parsed.getTime())) {
          await ctx.reply('❌ Invalid date format. Use YYYY-MM-DD HH:MM');
          return;
        }
        data.scheduledAt = parsed;
        data.step = 'confirm';
        ctx.session.broadcastData = data;
        await sendBroadcastConfirm(ctx);
        break;
      }
    }
  } catch (error) {
    logger.error('adminBroadcastScene text error:', error);
  }
});

adminBroadcastScene.on('photo', async (ctx) => {
  try {
    const data = ctx.session.broadcastData ?? ({} as any);
    if (data.step === 'image') {
      const photos = ctx.message.photo;
      data.imageFileId = photos[photos.length - 1].file_id;
      data.step = 'schedule';
      ctx.session.broadcastData = data;
      await askSchedule(ctx);
    }
  } catch (error) {
    logger.error('adminBroadcastScene photo error:', error);
  }
});

adminBroadcastScene.action('skip_broadcast_ar', async (ctx) => {
  const data = ctx.session.broadcastData ?? ({} as any);
  data.messageAr = '';
  data.step = 'image';
  ctx.session.broadcastData = data;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply(
    ctx.t('broadcast_image'),
    Markup.inlineKeyboard([[Markup.button.callback(ctx.t('btn_skip'), 'skip_broadcast_image')]])
  );
});

adminBroadcastScene.action('skip_broadcast_image', async (ctx) => {
  const data = ctx.session.broadcastData ?? ({} as any);
  data.imageFileId = '';
  data.step = 'schedule';
  ctx.session.broadcastData = data;
  await ctx.answerCbQuery().catch(() => null);
  await askSchedule(ctx);
});

adminBroadcastScene.action('broadcast_now', async (ctx) => {
  try {
    const t = ctx.t;
    const data = ctx.session.broadcastData ?? ({} as any);
    data.scheduledAt = null;
    await ctx.answerCbQuery().catch(() => null);
    await ctx.editMessageText('📤 Sending broadcast...').catch(() => null);
    await executeBroadcast(ctx, data);
    ctx.session.broadcastData = undefined;
    await ctx.scene.leave();
  } catch (error) {
    logger.error('broadcast_now error:', error);
    await ctx.scene.leave();
  }
});

adminBroadcastScene.action('broadcast_schedule', async (ctx) => {
  const data = ctx.session.broadcastData ?? ({} as any);
  data.step = 'schedule';
  ctx.session.broadcastData = data;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply('📅 Enter date/time (YYYY-MM-DD HH:MM):');
});

async function askSchedule(ctx: BotContext): Promise<void> {
  const t = ctx.t;
  await ctx.reply(
    t('broadcast_schedule'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t('btn_send_now'), 'broadcast_now')],
      [Markup.button.callback('📅 Schedule', 'broadcast_schedule')],
    ])
  );
}

async function sendBroadcastConfirm(ctx: BotContext): Promise<void> {
  const t = ctx.t;
  const data = ctx.session.broadcastData ?? ({} as any);
  const preview = `📢 *Broadcast Preview*\n\n${data.messageEn ?? ''}${data.scheduledAt ? `\n\n📅 Scheduled: ${data.scheduledAt}` : ''}`;
  await ctx.reply(
    preview,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(t('btn_confirm'), 'broadcast_now'),
          Markup.button.callback(t('btn_cancel'), 'cancel_broadcast'),
        ],
      ]),
    }
  );
}

adminBroadcastScene.action('cancel_broadcast', async (ctx) => {
  ctx.session.broadcastData = undefined;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply(ctx.t('operation_cancelled'));
  await ctx.scene.leave();
});

async function executeBroadcast(ctx: BotContext, data: Record<string, any>): Promise<void> {
  const t = ctx.t;

  const broadcast = await prisma.broadcast.create({
    data: {
      title: `Broadcast ${new Date().toISOString()}`,
      messageEn: data.messageEn || null,
      messageAr: data.messageAr || null,
      imageFileId: data.imageFileId || null,
      status: 'sending',
      scheduledAt: data.scheduledAt ?? null,
    },
  });

  const users = await prisma.user.findMany({
    where: { isBanned: false },
    select: { telegramId: true, language: true },
  });

  let sentCount = 0;
  let failedCount = 0;

  for (const user of users) {
    try {
      const message = user.language === 'ar' && data.messageAr
        ? data.messageAr
        : (data.messageEn ?? '');

      if (!message) continue;

      if (data.imageFileId) {
        await ctx.telegram.sendPhoto(Number(user.telegramId), data.imageFileId, {
          caption: message,
          parse_mode: 'Markdown',
        });
      } else {
        await ctx.telegram.sendMessage(Number(user.telegramId), message, {
          parse_mode: 'Markdown',
        });
      }
      sentCount++;
    } catch {
      failedCount++;
    }

    await sleep(config.BROADCAST_DELAY_MS);
  }

  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      status: 'completed',
      sentCount,
      failedCount,
      completedAt: new Date(),
    },
  });

  await ctx.reply(t('broadcast_confirmed', { count: sentCount }));
}
