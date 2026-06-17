import 'dotenv/config';
import { Telegraf, Scenes, session } from 'telegraf';
import { config } from './config';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './database/prisma';
import { prisma } from './database/prisma';
import { initScheduler } from './jobs/scheduler';
import { BotContext } from './types';

// Middlewares
import { authMiddleware, requireAdmin, ensureRegistered, checkChannelSubscriptions } from './middlewares/auth';
import { i18nMiddleware } from './middlewares/i18n';
import { globalRateLimit } from './middlewares/rateLimit';

// Commands & handlers
import { handleStart, handleLanguageSelection } from './commands/start';
import { showMainMenu, showAdminPanel } from './handlers/menu';
import { showStore, showCategory, showProduct, searchProducts } from './handlers/store';
import { showCart, addToCart, removeFromCart, updateQuantity, clearCart } from './handlers/cart';
import { showOrders, showOrderDetail } from './handlers/orders';
import {
  showWallet, showReferral, claimDailyReward,
  showFavorites, toggleFavorite, showSettings, changeLanguage,
} from './handlers/user';
import {
  showAdminOrders, showAdminOrderDetail, updateOrderStatus,
  showAdminUsers, showAdminUserDetail, banUser, unbanUser,
  showAnalytics, exportCsv, manageChannels,
} from './handlers/admin';
import { showSupportMenu, showMyTickets, showTicketDetail, adminReplyToTicket } from './handlers/support';

// Scenes
import { checkoutScene } from './scenes/checkout';
import { adminProductScene } from './scenes/admin-product';
import { adminBroadcastScene } from './scenes/admin-broadcast';
import { supportTicketScene } from './scenes/support-ticket';

// Language
import { Language } from '@prisma/client';
import { cache as cacheService, CACHE_KEYS } from './services/cache';
import { Markup } from 'telegraf';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const bot = new Telegraf<BotContext>(config.BOT_TOKEN);

  // Session middleware (in-memory; use telegraf-session-redis for production scale)
  const stage = new Scenes.Stage<BotContext>([
    checkoutScene,
    adminProductScene,
    adminBroadcastScene,
    supportTicketScene,
  ]);

  bot.use(session());
  bot.use(stage.middleware());
  bot.use(globalRateLimit);
  bot.use(i18nMiddleware);
  bot.use(authMiddleware);

  // ── /start ──────────────────────────────────────────────────────────────────
  bot.start(handleStart);

  // ── Language selection ───────────────────────────────────────────────────────
  bot.action('lang:en', (ctx) => handleLanguageSelection(ctx, Language.en));
  bot.action('lang:ar', (ctx) => handleLanguageSelection(ctx, Language.ar));

  // ── Channel subscription check ───────────────────────────────────────────────
  bot.action('check_subscription', async (ctx) => {
    const channels = await prisma.channelSubscription.findMany({ where: { isActive: true } });
    for (const ch of channels) {
      try {
        const member = await ctx.telegram.getChatMember(ch.channelId, ctx.from!.id);
        if (['kicked', 'left'].includes(member.status)) {
          await ctx.answerCbQuery(ctx.t('subscription_failed'), { show_alert: true }).catch(() => null);
          return;
        }
      } catch { /* ignore */ }
    }
    await ctx.answerCbQuery(ctx.t('subscription_verified')).catch(() => null);
    await showMainMenu(ctx);
  });

  // ── /admin command ───────────────────────────────────────────────────────────
  bot.command('admin', requireAdmin, showAdminPanel);

  // ── Main menu ────────────────────────────────────────────────────────────────
  bot.action('home', ensureRegistered, checkChannelSubscriptions, showMainMenu);
  bot.action('back', ensureRegistered, showMainMenu);

  // ── Store ────────────────────────────────────────────────────────────────────
  bot.action('store', ensureRegistered, checkChannelSubscriptions, (ctx) => showStore(ctx));
  bot.action(/^cat_page:(\d+)$/, ensureRegistered, (ctx) => showStore(ctx, parseInt(ctx.match[1])));
  bot.action(/^cat:(\d+)$/, ensureRegistered, (ctx) => showCategory(ctx, parseInt(ctx.match[1])));
  bot.action(/^prod_page:(\d+):(\d+)$/, ensureRegistered, (ctx) =>
    showCategory(ctx, parseInt(ctx.match[1]), parseInt(ctx.match[2]))
  );
  bot.action(/^prod:(\d+)$/, ensureRegistered, (ctx) => showProduct(ctx, parseInt(ctx.match[1])));

  // Search
  bot.action('search_product', ensureRegistered, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    ctx.session.adminData = { ...ctx.session.adminData, awaitingSearch: true };
    await ctx.reply(ctx.t('search_prompt'));
  });

  // ── Cart ─────────────────────────────────────────────────────────────────────
  bot.action('cart', ensureRegistered, checkChannelSubscriptions, showCart);
  bot.action(/^cart_add:(\d+)$/, ensureRegistered, (ctx) => addToCart(ctx, parseInt(ctx.match[1])));
  bot.action(/^cart_remove:(\d+)$/, ensureRegistered, (ctx) => removeFromCart(ctx, parseInt(ctx.match[1])));
  bot.action(/^qty_inc:(\d+)$/, ensureRegistered, (ctx) => updateQuantity(ctx, parseInt(ctx.match[1]), 1));
  bot.action(/^qty_dec:(\d+)$/, ensureRegistered, (ctx) => updateQuantity(ctx, parseInt(ctx.match[1]), -1));
  bot.action('cart_clear', ensureRegistered, clearCart);
  bot.action('checkout', ensureRegistered, (ctx) => ctx.scene.enter('checkout'));

  // Buy now shortcut
  bot.action(/^buy_now:(\d+)$/, ensureRegistered, async (ctx) => {
    await addToCart(ctx, parseInt(ctx.match[1]));
    await ctx.scene.enter('checkout');
  });

  // ── Favorites ────────────────────────────────────────────────────────────────
  bot.action('favorites', ensureRegistered, (ctx) => showFavorites(ctx));
  bot.action(/^fav_add:(\d+)$/, ensureRegistered, async (ctx) => {
    await toggleFavorite(ctx, parseInt(ctx.match[1]), true);
    await showProduct(ctx, parseInt(ctx.match[1]));
  });
  bot.action(/^fav_remove:(\d+)$/, ensureRegistered, async (ctx) => {
    await toggleFavorite(ctx, parseInt(ctx.match[1]), false);
    await showProduct(ctx, parseInt(ctx.match[1]));
  });

  // ── Orders ───────────────────────────────────────────────────────────────────
  bot.action('orders', ensureRegistered, (ctx) => showOrders(ctx));
  bot.action(/^orders_page:(\d+)$/, ensureRegistered, (ctx) => showOrders(ctx, parseInt(ctx.match[1])));
  bot.action(/^order:(\d+)$/, ensureRegistered, (ctx) => showOrderDetail(ctx, parseInt(ctx.match[1])));

  // ── User features ────────────────────────────────────────────────────────────
  bot.action('wallet', ensureRegistered, showWallet);
  bot.action('referral', ensureRegistered, showReferral);
  bot.action('daily_reward', ensureRegistered, claimDailyReward);
  bot.action('settings', ensureRegistered, showSettings);
  bot.action('change_language', ensureRegistered, changeLanguage);

  // ── Support ──────────────────────────────────────────────────────────────────
  bot.action('support', ensureRegistered, showSupportMenu);
  bot.action('new_ticket', ensureRegistered, (ctx) => ctx.scene.enter('support_ticket'));
  bot.action('my_tickets', ensureRegistered, showMyTickets);
  bot.action(/^ticket:(\d+)$/, ensureRegistered, (ctx) => showTicketDetail(ctx, parseInt(ctx.match[1])));
  bot.action(/^ticket_reply:(\d+)$/, ensureRegistered, async (ctx) => {
    const ticketId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery().catch(() => null);
    ctx.session.adminData = { replyTicketId: ticketId };
    await ctx.reply('💬 Type your reply:');
  });

  // ── Admin panel ──────────────────────────────────────────────────────────────
  bot.action('admin_panel', requireAdmin, showAdminPanel);

  bot.action('admin_orders', requireAdmin, (ctx) => showAdminOrders(ctx));
  bot.action('admin_orders_filter_menu', requireAdmin, (ctx) => {
    ctx.answerCbQuery().catch(() => null);
    const rows = [
      [Markup.button.callback('⏳ Pending', 'admin_orders_filter:pending'), Markup.button.callback('✅ Confirmed', 'admin_orders_filter:confirmed')],
      [Markup.button.callback('🚚 Shipped', 'admin_orders_filter:shipped'), Markup.button.callback('✅ Completed', 'admin_orders_filter:completed')],
      [Markup.button.callback('❌ Cancelled', 'admin_orders_filter:cancelled'), Markup.button.callback('📋 All', 'admin_orders_filter:all')],
      [Markup.button.callback('⬅️ Back', 'admin_orders')],
    ];
    return ctx.editMessageText('Filter orders by status:', Markup.inlineKeyboard(rows)).catch(() => null);
  });
  bot.action(/^admin_orders_filter:(.+)$/, requireAdmin, (ctx) => {
    const filter = ctx.match[1] as any;
    return showAdminOrders(ctx, filter);
  });
  bot.action(/^admin_orders_page_(.+):(\d+)$/, requireAdmin, (ctx) => {
    const filter = ctx.match[1] as any;
    return showAdminOrders(ctx, filter, parseInt(ctx.match[2]));
  });
  bot.action(/^admin_order:(\d+)$/, requireAdmin, (ctx) => showAdminOrderDetail(ctx, parseInt(ctx.match[1])));
  bot.action(/^update_order_status:(\d+)$/, requireAdmin, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery().catch(() => null);
    const rows = [
      ['confirmed', 'shipped', 'completed', 'cancelled'].map((s) =>
        Markup.button.callback(s, `set_status:${orderId}:${s}`)
      ),
      [Markup.button.callback('⬅️ Back', `admin_order:${orderId}`)],
    ];
    await ctx.editMessageText('Select new status:', Markup.inlineKeyboard(rows)).catch(() => null);
  });
  bot.action(/^set_status:(\d+):(.+)$/, requireAdmin, (ctx) =>
    updateOrderStatus(ctx, parseInt(ctx.match[1]), ctx.match[2] as any)
  );
  bot.action(/^admin_note:(\d+)$/, requireAdmin, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery().catch(() => null);
    ctx.session.adminData = { awaitingNoteForOrder: orderId };
    await ctx.reply('📝 Enter admin note for this order:');
  });

  bot.action('admin_products', requireAdmin, async (ctx) => {
    const t = ctx.t;
    await ctx.answerCbQuery().catch(() => null);
    const count = await prisma.product.count();
    const rows = [
      [Markup.button.callback(t('btn_add_product'), 'admin_add_product')],
      [Markup.button.callback('⬅️ Back', 'admin_panel')],
    ];
    await ctx.editMessageText(t('admin_products', { count }), Markup.inlineKeyboard(rows)).catch(() => null);
  });
  bot.action('admin_add_product', requireAdmin, (ctx) => ctx.scene.enter('admin_product'));

  bot.action('admin_categories', requireAdmin, async (ctx) => {
    const t = ctx.t;
    await ctx.answerCbQuery().catch(() => null);
    const count = await prisma.category.count();
    const rows = [
      [Markup.button.callback(t('btn_add_category'), 'admin_add_category')],
      [Markup.button.callback('⬅️ Back', 'admin_panel')],
    ];
    await ctx.editMessageText(t('admin_categories', { count }), Markup.inlineKeyboard(rows)).catch(() => null);
  });
  bot.action('admin_add_category', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    ctx.session.adminData = { awaitingCategoryNameEn: true };
    await ctx.reply(ctx.t('admin_category_name_en'));
  });

  bot.action('admin_users', requireAdmin, (ctx) => showAdminUsers(ctx));
  bot.action(/^admin_users_page:(\d+)$/, requireAdmin, (ctx) => showAdminUsers(ctx, parseInt(ctx.match[1])));
  bot.action(/^admin_user:(\d+)$/, requireAdmin, (ctx) => showAdminUserDetail(ctx, parseInt(ctx.match[1])));
  bot.action(/^ban:(\d+)$/, requireAdmin, async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery().catch(() => null);
    ctx.session.adminData = { banningUserId: userId };
    await ctx.reply(ctx.t('ban_reason_prompt'));
  });
  bot.action(/^unban:(\d+)$/, requireAdmin, (ctx) => unbanUser(ctx, parseInt(ctx.match[1])));

  bot.action('admin_analytics', requireAdmin, showAnalytics);
  bot.action('admin_export', requireAdmin, exportCsv);
  bot.action('admin_broadcast', requireAdmin, (ctx) => ctx.scene.enter('admin_broadcast'));
  bot.action('admin_channels', requireAdmin, manageChannels);
  bot.action(/^remove_channel:(\d+)$/, requireAdmin, async (ctx) => {
    const id = parseInt(ctx.match[1]);
    await prisma.channelSubscription.update({ where: { id }, data: { isActive: false } });
    await cacheService.del(CACHE_KEYS.channelSubs());
    await ctx.answerCbQuery(ctx.t('channel_removed')).catch(() => null);
    await manageChannels(ctx);
  });
  bot.action('add_channel', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    ctx.session.adminData = { awaitingChannelInfo: true };
    await ctx.reply('📡 Send the channel ID (e.g. @mychannel or -100123456789):');
  });

  bot.action(/^admin_ticket_reply:(\d+)$/, requireAdmin, async (ctx) => {
    const ticketId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery().catch(() => null);
    ctx.session.adminData = { adminReplyTicketId: ticketId };
    await ctx.reply(`💬 Reply to Ticket #${ticketId}:`);
  });

  // Noop for pagination display buttons
  bot.action('noop', (ctx) => ctx.answerCbQuery().catch(() => null));

  // ── Text message handler ─────────────────────────────────────────────────────
  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const adminData = ctx.session.adminData ?? {};

    // Search mode
    if (adminData.awaitingSearch) {
      ctx.session.adminData = { ...adminData, awaitingSearch: false };
      await searchProducts(ctx, text);
      return;
    }

    // Admin order note
    if (adminData.awaitingNoteForOrder) {
      const orderId = adminData.awaitingNoteForOrder as number;
      await prisma.order.update({ where: { id: orderId }, data: { adminNote: text } });
      ctx.session.adminData = {};
      await ctx.reply('✅ Note saved.');
      await showAdminOrderDetail(ctx, orderId);
      return;
    }

    // Ban reason
    if (adminData.banningUserId) {
      const userId = adminData.banningUserId as number;
      ctx.session.adminData = {};
      await banUser(ctx, userId, text);
      await showAdminUserDetail(ctx, userId);
      return;
    }

    // Category name EN
    if (adminData.awaitingCategoryNameEn) {
      ctx.session.adminData = { awaitingCategoryNameAr: true, categoryNameEn: text };
      await ctx.reply(ctx.t('admin_category_name_ar'));
      return;
    }

    // Category name AR
    if (adminData.awaitingCategoryNameAr) {
      const nameEn = adminData.categoryNameEn as string;
      await prisma.category.create({ data: { nameEn, nameAr: text } });
      await cacheService.del(CACHE_KEYS.categories());
      ctx.session.adminData = {};
      await ctx.reply(ctx.t('admin_category_added'));
      await showAdminPanel(ctx);
      return;
    }

    // Admin ticket reply
    if (adminData.adminReplyTicketId) {
      const ticketId = adminData.adminReplyTicketId as number;
      ctx.session.adminData = {};
      await adminReplyToTicket(ctx, ticketId, text);
      return;
    }

    // User ticket reply
    if (adminData.replyTicketId) {
      const ticketId = adminData.replyTicketId as number;
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, userId: ctx.dbUser!.id },
      });
      if (ticket) {
        await prisma.ticketMessage.create({
          data: {
            ticketId,
            senderId: BigInt(ctx.from!.id),
            isAdmin: false,
            message: text,
          },
        });
        ctx.session.adminData = {};
        await ctx.reply('✅ Reply sent.');
        // Notify admins
        for (const adminId of config.adminIds) {
          await ctx.telegram.sendMessage(adminId, `💬 User replied to Ticket #${ticketId}:\n\n${text}`).catch(() => null);
        }
      }
      return;
    }

    // Channel ID for admin
    if (adminData.awaitingChannelInfo) {
      ctx.session.adminData = {};
      try {
        const chat = await ctx.telegram.getChat(text);
        const channelId = String(chat.id);
        const channelName = 'title' in chat ? (chat as any).title : text;
        await prisma.channelSubscription.upsert({
          where: { channelId },
          create: { channelId, channelName },
          update: { isActive: true, channelName },
        });
        await cacheService.del(CACHE_KEYS.channelSubs());
        await ctx.reply(ctx.t('channel_added'));
      } catch {
        await ctx.reply('❌ Invalid channel or bot is not a member of that channel.');
      }
      await manageChannels(ctx);
      return;
    }

    // Auto reply check
    const autoReplies = await cacheService.get<Array<{ trigger: string; replyEn: string; replyAr: string }>>(
      CACHE_KEYS.autoReplies()
    );
    let replies = autoReplies;
    if (!replies) {
      const dbReplies = await prisma.autoReply.findMany({ where: { isActive: true } });
      replies = dbReplies;
      await cacheService.set(CACHE_KEYS.autoReplies(), replies, 600);
    }
    const matched = replies.find((r) => text.toLowerCase().includes(r.trigger.toLowerCase()));
    if (matched) {
      const reply = ctx.lang === 'ar' ? matched.replyAr : matched.replyEn;
      await ctx.reply(reply);
      return;
    }

    await next();
  });

  // ── Error handler ────────────────────────────────────────────────────────────
  bot.catch((err, ctx) => {
    logger.error(`Bot error for user ${ctx.from?.id}:`, err);
    ctx.reply(ctx.t?.('error_occurred') ?? '❌ An error occurred.').catch(() => null);
  });

  // ── Launch ───────────────────────────────────────────────────────────────────
  initScheduler(bot.telegram);

  if (config.WEBHOOK_DOMAIN && config.isProd) {
    const webhookPath = `/webhook/${config.BOT_TOKEN}`;
    await bot.launch({
      webhook: {
        domain: config.WEBHOOK_DOMAIN,
        port: config.WEBHOOK_PORT,
        path: webhookPath,
      },
    });
    logger.info(`✅ Bot started via webhook on port ${config.WEBHOOK_PORT}`);
  } else {
    await bot.launch();
    logger.info('✅ Bot started in polling mode');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    bot.stop(signal);
    await disconnectDatabase();
    await cache.disconnect();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
