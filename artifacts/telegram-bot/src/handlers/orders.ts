import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { config } from '../config';
import { ordersKeyboard, backHomeKeyboard } from '../utils/keyboards';
import { formatPrice, formatDate } from '../utils/helpers';
import { logger } from '../utils/logger';
import { Markup } from 'telegraf';

export async function showOrders(ctx: BotContext, page = 1): Promise<void> {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;
    const pageSize = config.ITEMS_PER_PAGE;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.order.count({ where: { userId } }),
    ]);

    if (orders.length === 0) {
      await safeEdit(ctx, t('no_orders'), backHomeKeyboard(t));
      return;
    }

    const totalPages = Math.ceil(total / pageSize);
    const text = `${t('orders_title')}\n\n${orders
      .map((o) =>
        t('order_item', {
          id: o.id,
          status: t(`order_status_${o.status}`),
          date: formatDate(o.createdAt),
          total: formatPrice(o.finalAmount),
        })
      )
      .join('\n\n')}`;

    await safeEdit(ctx, text, ordersKeyboard(orders.map(o => ({
      id: o.id,
      status: o.status,
      createdAt: o.createdAt,
      finalAmount: o.finalAmount,
    })), t, page, totalPages));
  } catch (error) {
    logger.error('showOrders error:', error);
    await ctx.reply(ctx.t('error_occurred'));
  }
}

export async function showOrderDetail(ctx: BotContext, orderId: number): Promise<void> {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });

    if (!order) {
      await ctx.answerCbQuery('Order not found').catch(() => null);
      return;
    }

    const itemLines = order.items
      .map((i) => `• ${i.productName} × ${i.quantity} = ${formatPrice(i.subtotal)}`)
      .join('\n');

    const notesLine = order.notes ? t('checkout_notes_line', { notes: order.notes }) : '';

    const text = t('order_detail', {
      id: order.id,
      date: formatDate(order.createdAt),
      status: t(`order_status_${order.status}`),
      items: itemLines,
      total: formatPrice(order.finalAmount),
      address: order.customerAddress,
      phone: order.customerPhone,
      notes: notesLine,
    });

    await safeEdit(ctx, text, backHomeKeyboard(t));
  } catch (error) {
    logger.error('showOrderDetail error:', error);
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
