import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { config } from '../config';
import { backHomeKeyboard } from '../utils/keyboards';
import { formatDate } from '../utils/helpers';
import { logger } from '../utils/logger';
import { Markup } from 'telegraf';

export async function showSupportMenu(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(t('btn_new_ticket'), 'new_ticket')],
      [Markup.button.callback(t('btn_my_tickets'), 'my_tickets')],
      [Markup.button.callback(t('btn_home'), 'home')],
    ]);
    await safeEdit(ctx, `${t('support_title')}\n\n${t('support_menu')}`, keyboard);
  } catch (error) {
    logger.error('showSupportMenu error:', error);
  }
}

export async function showMyTickets(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;

    const tickets = await prisma.ticket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (tickets.length === 0) {
      await safeEdit(ctx, t('no_tickets'), backHomeKeyboard(t));
      return;
    }

    const rows = tickets.map((tk) => [
      Markup.button.callback(
        `#${tk.id} — ${tk.subject.slice(0, 30)} [${tk.status}]`,
        `ticket:${tk.id}`
      ),
    ]);
    rows.push([Markup.button.callback(t('btn_home'), 'home')]);

    await safeEdit(ctx, t('support_title'), Markup.inlineKeyboard(rows));
  } catch (error) {
    logger.error('showMyTickets error:', error);
  }
}

export async function showTicketDetail(ctx: BotContext, ticketId: number): Promise<void> {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!ticket) {
      await ctx.answerCbQuery('Ticket not found').catch(() => null);
      return;
    }

    const statusKey = `ticket_status_${ticket.status}` as const;
    let text = t('ticket_detail', {
      id: ticket.id,
      subject: ticket.subject,
      status: t(statusKey),
    });

    for (const msg of ticket.messages) {
      const who = msg.isAdmin ? '🔧 Admin' : '👤 You';
      text += t('ticket_message_item', { who, message: msg.message });
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💬 Reply', `ticket_reply:${ticket.id}`)],
      [Markup.button.callback(t('btn_back'), 'my_tickets')],
    ]);

    await safeEdit(ctx, text, keyboard);
  } catch (error) {
    logger.error('showTicketDetail error:', error);
  }
}

export async function adminReplyToTicket(
  ctx: BotContext,
  ticketId: number,
  message: string
): Promise<void> {
  try {
    const t = ctx.t;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { user: true },
    });

    if (!ticket) return;

    await prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: BigInt(ctx.from!.id),
        isAdmin: true,
        message,
      },
    });

    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'in_progress' },
    });

    // Notify user
    await ctx.telegram.sendMessage(
      Number(ticket.user.telegramId),
      ticket.user.language === 'ar'
        ? `💬 رد الإدارة على التذكرة #${ticketId}:\n\n${message}`
        : `💬 Admin replied to Ticket #${ticketId}:\n\n${message}`
    ).catch(() => null);

    await ctx.reply('✅ Reply sent to user.');
  } catch (error) {
    logger.error('adminReplyToTicket error:', error);
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
