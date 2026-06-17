import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';

export const supportTicketScene = new Scenes.BaseScene<BotContext>('support_ticket');

supportTicketScene.enter(async (ctx) => {
  const t = ctx.t;
  ctx.session.ticketData = { step: 'subject' } as any;
  await ctx.reply(t('ticket_subject'), { reply_markup: { remove_keyboard: true } });
});

supportTicketScene.on('text', async (ctx) => {
  try {
    const t = ctx.t;
    const text = ctx.message.text.trim();
    const data = ctx.session.ticketData ?? ({} as any);

    if (text === '/cancel') {
      await ctx.reply(t('operation_cancelled'));
      return ctx.scene.leave();
    }

    switch (data.step) {
      case 'subject': {
        if (text.length < 3 || text.length > 200) {
          await ctx.reply(t('invalid_input'));
          return;
        }
        data.subject = text;
        data.step = 'message';
        ctx.session.ticketData = data;
        await ctx.reply(t('ticket_message'));
        break;
      }
      case 'message': {
        if (text.length < 5) {
          await ctx.reply(t('invalid_input'));
          return;
        }
        data.message = text;
        ctx.session.ticketData = data;

        const userId = ctx.dbUser!.id;
        const ticket = await prisma.ticket.create({
          data: {
            userId,
            subject: data.subject,
            messages: {
              create: {
                senderId: BigInt(ctx.from!.id),
                isAdmin: false,
                message: data.message,
              },
            },
          },
        });

        // Notify admins
        const { config } = await import('../config');
        for (const adminId of config.adminIds) {
          await ctx.telegram.sendMessage(
            adminId,
            `🎟️ *New Support Ticket #${ticket.id}*\n\n👤 From: ${ctx.dbUser!.firstName}\n📌 Subject: ${data.subject}\n\n💬 ${data.message}`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback(`Reply to Ticket #${ticket.id}`, `admin_ticket_reply:${ticket.id}`)],
              ]),
            }
          ).catch(() => null);
        }

        ctx.session.ticketData = undefined;
        await ctx.reply(
          t('ticket_created', { id: ticket.id }),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_home'), 'home')]])
        );
        await ctx.scene.leave();
        break;
      }
    }
  } catch (error) {
    logger.error('supportTicketScene error:', error);
    await ctx.scene.leave();
  }
});
