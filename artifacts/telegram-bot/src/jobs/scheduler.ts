import cron from 'node-cron';
import { prisma } from '../database/prisma';
import { config } from '../config';
import { sleep } from '../utils/helpers';
import { logger } from '../utils/logger';
import type { Telegram } from 'telegraf';

let telegramInstance: Telegram;

export function initScheduler(telegram: Telegram): void {
  telegramInstance = telegram;

  // Abandoned cart reminder — every day at 10am
  cron.schedule('0 10 * * *', async () => {
    await sendAbandonedCartReminders();
  });

  // Scheduled broadcasts — check every minute
  cron.schedule('* * * * *', async () => {
    await processScheduledBroadcasts();
  });

  // Daily analytics snapshot — midnight
  cron.schedule('0 0 * * *', async () => {
    await captureAnalyticsSnapshot();
  });

  logger.info('✅ Scheduler initialized');
}

async function sendAbandonedCartReminders(): Promise<void> {
  try {
    const hoursAgo = new Date();
    hoursAgo.setHours(hoursAgo.getHours() - config.ABANDONED_CART_HOURS);

    const cartsWithItems = await prisma.cart.findMany({
      where: {
        updatedAt: { lte: hoursAgo },
        items: { some: {} },
        user: { isBanned: false },
      },
      include: {
        user: {
          select: { telegramId: true, language: true },
        },
      },
      take: 100,
    });

    for (const cart of cartsWithItems) {
      try {
        const message =
          cart.user.language === 'ar'
            ? '🛒 لديك منتجات في سلتك!\n\nلا تنسَ إتمام طلبك.'
            : '🛒 You have items in your cart!\n\nDon\'t forget to complete your order.';

        await telegramInstance.sendMessage(Number(cart.user.telegramId), message);
        await sleep(config.BROADCAST_DELAY_MS);
      } catch {
        // User blocked the bot or other error — ignore
      }
    }

    logger.info(`Abandoned cart reminders sent to ${cartsWithItems.length} users`);
  } catch (error) {
    logger.error('sendAbandonedCartReminders error:', error);
  }
}

async function processScheduledBroadcasts(): Promise<void> {
  try {
    const now = new Date();

    const broadcasts = await prisma.broadcast.findMany({
      where: {
        status: 'draft',
        scheduledAt: { lte: now },
      },
    });

    for (const broadcast of broadcasts) {
      try {
        await prisma.broadcast.update({
          where: { id: broadcast.id },
          data: { status: 'sending' },
        });

        const users = await prisma.user.findMany({
          where: { isBanned: false },
          select: { telegramId: true, language: true },
        });

        let sentCount = 0;
        let failedCount = 0;

        for (const user of users) {
          try {
            const message =
              user.language === 'ar' && broadcast.messageAr
                ? broadcast.messageAr
                : (broadcast.messageEn ?? '');

            if (!message) continue;

            if (broadcast.imageFileId) {
              await telegramInstance.sendPhoto(Number(user.telegramId), broadcast.imageFileId, {
                caption: message,
                parse_mode: 'Markdown',
              });
            } else {
              await telegramInstance.sendMessage(Number(user.telegramId), message, {
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

        logger.info(`Broadcast #${broadcast.id} completed: ${sentCount} sent, ${failedCount} failed`);
      } catch (error) {
        logger.error(`processScheduledBroadcasts error for broadcast ${broadcast.id}:`, error);
        await prisma.broadcast.update({
          where: { id: broadcast.id },
          data: { status: 'failed' },
        }).catch(() => null);
      }
    }
  } catch (error) {
    logger.error('processScheduledBroadcasts error:', error);
  }
}

async function captureAnalyticsSnapshot(): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalUsers, newUsers, totalOrders, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.order.count(),
      prisma.order.aggregate({
        where: { status: 'completed' },
        _sum: { finalAmount: true },
      }),
    ]);

    await prisma.analyticsEvent.create({
      data: {
        event: 'daily_snapshot',
        metadata: {
          totalUsers,
          newUsers,
          totalOrders,
          revenue: revenue._sum.finalAmount?.toString() ?? '0',
          date: today.toISOString(),
        },
      },
    });

    logger.info('Daily analytics snapshot saved');
  } catch (error) {
    logger.error('captureAnalyticsSnapshot error:', error);
  }
}
