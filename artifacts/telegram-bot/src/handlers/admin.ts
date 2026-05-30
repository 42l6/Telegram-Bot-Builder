import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { config } from '../config';
import {
  adminMenuKeyboard,
  orderStatusKeyboard,
  adminOrdersFilterKeyboard,
  backHomeKeyboard,
  paginationRow,
} from '../utils/keyboards';
import { formatPrice, formatDate, getUserDisplayName, chunkArray } from '../utils/helpers';
import { logger } from '../utils/logger';
import { Markup } from 'telegraf';
import { OrderStatus } from '@prisma/client';
import { createObjectCsvWriter } from 'csv-writer';
import * as path from 'path';
import * as fs from 'fs';

export async function showAdminOrders(
  ctx: BotContext,
  statusFilter: OrderStatus | 'all' = 'all',
  page = 1
): Promise<void> {
  try {
    const t = ctx.t;
    const pageSize = config.ITEMS_PER_PAGE;
    const where = statusFilter !== 'all' ? { status: statusFilter } : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    const rows = orders.map((o) => [
      Markup.button.callback(
        `#${o.id} ${o.status} — ${formatPrice(o.finalAmount)} — ${getUserDisplayName(o.user)}`,
        `admin_order:${o.id}`
      ),
    ]);

    const nav = paginationRow(page, totalPages, `admin_orders_page_${statusFilter}`, t);
    if (nav.length) rows.push(nav);

    rows.push([
      Markup.button.callback('🔽 Filter', 'admin_orders_filter_menu'),
      Markup.button.callback(t('btn_back'), 'admin_panel'),
    ]);

    const statusLabel = statusFilter === 'all' ? 'All' : statusFilter;
    await safeEdit(
      ctx,
      t('admin_orders', { status: statusLabel, count: total }),
      Markup.inlineKeyboard(rows)
    );
  } catch (error) {
    logger.error('showAdminOrders error:', error);
    await ctx.reply(ctx.t('error_occurred'));
  }
}

export async function showAdminOrderDetail(ctx: BotContext, orderId: number): Promise<void> {
  try {
    const t = ctx.t;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true, items: true },
    });

    if (!order) {
      await ctx.answerCbQuery('Order not found').catch(() => null);
      return;
    }

    const itemLines = order.items
      .map((i) => `• ${i.productName} × ${i.quantity} = ${formatPrice(i.subtotal)}`)
      .join('\n');

    const notesLine = order.notes ? t('admin_order_notes', { notes: order.notes }) : '';
    const adminNoteLine = order.adminNote ? `\n🔧 Admin Note: ${order.adminNote}` : '';

    const text = t('admin_order_detail', {
      id: order.id,
      user: getUserDisplayName(order.user),
      phone: order.customerPhone,
      address: order.customerAddress,
      status: t(`order_status_${order.status}`),
      total: formatPrice(order.finalAmount),
      date: formatDate(order.createdAt),
      items: itemLines,
      notes: notesLine,
    }) + adminNoteLine;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(t('btn_update_status'), `update_order_status:${orderId}`)],
      [Markup.button.callback(t('btn_add_admin_note'), `admin_note:${orderId}`)],
      [Markup.button.callback(t('btn_back'), 'admin_orders')],
    ]);

    await safeEdit(ctx, text, keyboard);
  } catch (error) {
    logger.error('showAdminOrderDetail error:', error);
  }
}

export async function updateOrderStatus(
  ctx: BotContext,
  orderId: number,
  status: OrderStatus
): Promise<void> {
  try {
    const t = ctx.t;

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { status },
      include: { user: true },
    });

    await cache.del(CACHE_KEYS.userOrders(order.userId));

    // Notify user
    await ctx.telegram.sendMessage(
      Number(order.user.telegramId),
      `📦 Order #${orderId} status updated: *${status}*`,
      { parse_mode: 'Markdown' }
    ).catch(() => null);

    await ctx.answerCbQuery(t('order_status_updated', { status })).catch(() => null);
    await showAdminOrderDetail(ctx, orderId);
  } catch (error) {
    logger.error('updateOrderStatus error:', error);
  }
}

export async function showAdminUsers(ctx: BotContext, page = 1): Promise<void> {
  try {
    const t = ctx.t;
    const pageSize = config.ITEMS_PER_PAGE;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count(),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    const rows = users.map((u) => [
      Markup.button.callback(
        `${getUserDisplayName(u)}${u.isBanned ? ' 🚫' : ''} — @${u.username ?? 'no_username'}`,
        `admin_user:${u.id}`
      ),
    ]);

    const nav = paginationRow(page, totalPages, 'admin_users_page', t);
    if (nav.length) rows.push(nav);
    rows.push([Markup.button.callback(t('btn_back'), 'admin_panel')]);

    await safeEdit(ctx, t('admin_users', { count: total }), Markup.inlineKeyboard(rows));
  } catch (error) {
    logger.error('showAdminUsers error:', error);
  }
}

export async function showAdminUserDetail(ctx: BotContext, userId: number): Promise<void> {
  try {
    const t = ctx.t;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const orderCount = await prisma.order.count({ where: { userId } });

    const text = t('admin_user_detail', {
      id: user.id,
      name: getUserDisplayName(user),
      username: user.username ?? 'N/A',
      status: user.isBanned ? '🚫 Banned' : '✅ Active',
      wallet: formatPrice(user.walletBalance),
      points: user.bonusPoints,
      date: formatDate(user.createdAt),
      orders: orderCount,
    });

    const keyboard = Markup.inlineKeyboard([
      user.isBanned
        ? [Markup.button.callback(t('btn_unban_user'), `unban:${userId}`)]
        : [Markup.button.callback(t('btn_ban_user'), `ban:${userId}`)],
      [Markup.button.callback(t('btn_back'), 'admin_users')],
    ]);

    await safeEdit(ctx, text, keyboard);
  } catch (error) {
    logger.error('showAdminUserDetail error:', error);
  }
}

export async function banUser(ctx: BotContext, userId: number, reason: string): Promise<void> {
  try {
    const t = ctx.t;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isBanned: true, banReason: reason },
    });

    await cache.del(CACHE_KEYS.user(Number(user.telegramId)));

    await ctx.telegram.sendMessage(
      Number(user.telegramId),
      `🚫 Your account has been banned.\n\nReason: ${reason}`
    ).catch(() => null);

    await ctx.reply(t('user_banned'));
  } catch (error) {
    logger.error('banUser error:', error);
  }
}

export async function unbanUser(ctx: BotContext, userId: number): Promise<void> {
  try {
    const t = ctx.t;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isBanned: false, banReason: null },
    });

    await cache.del(CACHE_KEYS.user(Number(user.telegramId)));

    await ctx.telegram.sendMessage(
      Number(user.telegramId),
      '✅ Your account ban has been lifted. You can use the bot again.'
    ).catch(() => null);

    await ctx.reply(t('user_unbanned'));
    await showAdminUserDetail(ctx, userId);
  } catch (error) {
    logger.error('unbanUser error:', error);
  }
}

export async function showAnalytics(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      totalUsers,
      newToday,
      activeWeek,
      totalOrders,
      completedOrders,
      revenue,
      todayRevenue,
      topProducts,
      referrals,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { lastActiveAt: { gte: weekAgo } } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'completed' } }),
      prisma.order
        .aggregate({ where: { status: 'completed' }, _sum: { finalAmount: true } })
        .then((r) => r._sum.finalAmount ?? 0),
      prisma.order
        .aggregate({
          where: { status: 'completed', createdAt: { gte: today } },
          _sum: { finalAmount: true },
        })
        .then((r) => r._sum.finalAmount ?? 0),
      prisma.orderItem.groupBy({
        by: ['productId', 'productName'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      prisma.user.count({ where: { referredBy: { not: null } } }),
    ]);

    const topProductsText = topProducts
      .map((p, i) =>
        t('top_product_item', {
          rank: i + 1,
          name: p.productName,
          count: p._sum.quantity ?? 0,
        })
      )
      .join('\n') || 'N/A';

    const text = t('analytics_data', {
      total_users: totalUsers,
      new_today: newToday,
      active_week: activeWeek,
      total_orders: totalOrders,
      completed_orders: completedOrders,
      revenue: formatPrice(revenue),
      today_revenue: formatPrice(todayRevenue),
      top_products: topProductsText,
      referrals,
    });

    await safeEdit(ctx, text, backHomeKeyboard(t));
  } catch (error) {
    logger.error('showAnalytics error:', error);
  }
}

export async function exportCsv(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;

    const [users, orders] = await Promise.all([
      prisma.user.findMany({ take: 5000, orderBy: { id: 'asc' } }),
      prisma.order.findMany({ take: 5000, orderBy: { id: 'asc' }, include: { user: true } }),
    ]);

    const tmpDir = '/tmp';

    const usersCsv = path.join(tmpDir, 'users_export.csv');
    const usersWriter = createObjectCsvWriter({
      path: usersCsv,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'telegramId', title: 'Telegram ID' },
        { id: 'name', title: 'Name' },
        { id: 'username', title: 'Username' },
        { id: 'language', title: 'Language' },
        { id: 'role', title: 'Role' },
        { id: 'isBanned', title: 'Banned' },
        { id: 'walletBalance', title: 'Wallet' },
        { id: 'bonusPoints', title: 'Points' },
        { id: 'createdAt', title: 'Joined' },
      ],
    });

    await usersWriter.writeRecords(
      users.map((u) => ({
        id: u.id,
        telegramId: u.telegramId.toString(),
        name: getUserDisplayName(u),
        username: u.username ?? '',
        language: u.language,
        role: u.role,
        isBanned: u.isBanned,
        walletBalance: u.walletBalance.toString(),
        bonusPoints: u.bonusPoints,
        createdAt: formatDate(u.createdAt),
      }))
    );

    const ordersCsv = path.join(tmpDir, 'orders_export.csv');
    const ordersWriter = createObjectCsvWriter({
      path: ordersCsv,
      header: [
        { id: 'id', title: 'Order ID' },
        { id: 'customer', title: 'Customer' },
        { id: 'phone', title: 'Phone' },
        { id: 'address', title: 'Address' },
        { id: 'status', title: 'Status' },
        { id: 'total', title: 'Total' },
        { id: 'date', title: 'Date' },
      ],
    });

    await ordersWriter.writeRecords(
      orders.map((o) => ({
        id: o.id,
        customer: o.customerName,
        phone: o.customerPhone,
        address: o.customerAddress,
        status: o.status,
        total: o.finalAmount.toString(),
        date: formatDate(o.createdAt),
      }))
    );

    await ctx.replyWithDocument({ source: usersCsv, filename: 'users.csv' });
    await ctx.replyWithDocument({ source: ordersCsv, filename: 'orders.csv' });

    fs.unlinkSync(usersCsv);
    fs.unlinkSync(ordersCsv);

    await ctx.reply(t('export_ready', { count: users.length + orders.length }));
  } catch (error) {
    logger.error('exportCsv error:', error);
    await ctx.reply(ctx.t('error_occurred'));
  }
}

export async function manageChannels(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;

    const channels = await prisma.channelSubscription.findMany({
      where: { isActive: true },
    });

    const rows = channels.map((c) => [
      Markup.button.callback(`❌ Remove: ${c.channelName}`, `remove_channel:${c.id}`),
    ]);

    rows.push([Markup.button.callback('➕ Add Channel', 'add_channel')]);
    rows.push([Markup.button.callback(t('btn_back'), 'admin_panel')]);

    const channelList = channels.length
      ? channels.map((c) => `• ${c.channelName} (${c.channelId})`).join('\n')
      : 'No channels configured';

    await safeEdit(ctx, t('channel_list', { list: channelList }), Markup.inlineKeyboard(rows));
  } catch (error) {
    logger.error('manageChannels error:', error);
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
