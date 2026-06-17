import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { placeOrder, applyCoupon } from '../services/order';
import { config } from '../config';
import { formatPrice, getProductName, isValidPrice } from '../utils/helpers';
import { logger } from '../utils/logger';

export const checkoutScene = new Scenes.BaseScene<BotContext>('checkout');

checkoutScene.enter(async (ctx) => {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      await ctx.reply(t('cart_empty'));
      return ctx.scene.leave();
    }

    ctx.session.checkoutData = { step: 'name' };
    await ctx.reply(t('checkout_name'), { reply_markup: { remove_keyboard: true } });
  } catch (error) {
    logger.error('checkout enter error:', error);
    await ctx.scene.leave();
  }
});

checkoutScene.on('text', async (ctx) => {
  try {
    const t = ctx.t;
    const text = ctx.message.text.trim();
    const data = ctx.session.checkoutData ?? { step: 'name' };

    if (text === '/cancel' || text === t('btn_cancel')) {
      await ctx.reply(t('operation_cancelled'));
      return ctx.scene.leave();
    }

    switch (data.step) {
      case 'name': {
        if (text.length < 2 || text.length > 100) {
          await ctx.reply(t('invalid_input'));
          return;
        }
        data.name = text;
        data.step = 'phone';
        ctx.session.checkoutData = data;
        await ctx.reply(t('checkout_phone'));
        break;
      }

      case 'phone': {
        if (text.length < 5 || text.length > 20) {
          await ctx.reply(t('invalid_input'));
          return;
        }
        data.phone = text;
        data.step = 'address';
        ctx.session.checkoutData = data;
        await ctx.reply(t('checkout_address'));
        break;
      }

      case 'address': {
        if (text.length < 5 || text.length > 300) {
          await ctx.reply(t('invalid_input'));
          return;
        }
        data.address = text;
        data.step = 'notes';
        ctx.session.checkoutData = data;
        await ctx.reply(
          t('checkout_notes'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_notes')]])
        );
        break;
      }

      case 'notes': {
        data.notes = text;
        data.step = 'coupon';
        ctx.session.checkoutData = data;
        await ctx.reply(
          t('checkout_coupon'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_coupon')]])
        );
        break;
      }

      case 'coupon': {
        const userId = ctx.dbUser!.id;
        const cart = await prisma.cart.findUnique({
          where: { userId },
          include: { items: { include: { product: true } } },
        });

        let subtotal = 0;
        for (const item of cart?.items ?? []) {
          const price = item.product.discountPrice ?? item.product.price;
          subtotal += price.toNumber() * item.quantity;
        }

        const result = await applyCoupon(text, userId, subtotal);
        if (!result.valid) {
          const reason = result.reason === 'used' ? t('coupon_already_used') : t('coupon_invalid');
          await ctx.reply(reason);
          return;
        }

        data.couponCode = text.toUpperCase();
        data.couponId = result.couponId;
        data.discountAmount = result.discountAmount;
        data.step = 'confirm';
        ctx.session.checkoutData = data;

        await ctx.reply(
          t('coupon_valid', { discount: formatPrice(result.discountAmount) })
        );
        await showOrderSummary(ctx);
        break;
      }
    }
  } catch (error) {
    logger.error('checkout text handler error:', error);
  }
});

checkoutScene.action('skip_notes', async (ctx) => {
  const t = ctx.t;
  const data = ctx.session.checkoutData ?? {};
  data.notes = '';
  data.step = 'coupon';
  ctx.session.checkoutData = data;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply(
    t('checkout_coupon'),
    Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_coupon')]])
  );
});

checkoutScene.action('skip_coupon', async (ctx) => {
  const data = ctx.session.checkoutData ?? {};
  data.couponCode = '';
  data.couponId = null;
  data.discountAmount = 0;
  data.step = 'confirm';
  ctx.session.checkoutData = data;
  await ctx.answerCbQuery().catch(() => null);
  await showOrderSummary(ctx);
});

checkoutScene.action('confirm_order', async (ctx) => {
  try {
    const t = ctx.t;
    const data = ctx.session.checkoutData;

    if (!data?.name || !data.phone || !data.address) {
      await ctx.answerCbQuery(t('error_occurred'), { show_alert: true }).catch(() => null);
      return ctx.scene.leave();
    }

    await ctx.answerCbQuery().catch(() => null);
    await ctx.editMessageText('⏳ Placing your order...').catch(() => null);

    const result = await placeOrder(
      {
        userId: ctx.dbUser!.id,
        customerName: data.name,
        customerPhone: data.phone,
        customerAddress: data.address,
        notes: data.notes,
        couponCode: data.couponCode,
        couponId: data.couponId,
        discountAmount: data.discountAmount,
      },
      ctx.telegram,
      config.adminIds
    );

    if (!result) {
      await ctx.reply(t('order_error'));
    } else {
      await ctx.reply(
        t('order_placed', { id: result.orderId }),
        Markup.inlineKeyboard([[Markup.button.callback(t('btn_home'), 'home')]])
      );
    }

    ctx.session.checkoutData = undefined;
    await ctx.scene.leave();
  } catch (error) {
    logger.error('confirm_order error:', error);
    await ctx.scene.leave();
  }
});

checkoutScene.action('cancel_order', async (ctx) => {
  const t = ctx.t;
  ctx.session.checkoutData = undefined;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply(
    t('operation_cancelled'),
    Markup.inlineKeyboard([[Markup.button.callback(t('btn_home'), 'home')]])
  );
  await ctx.scene.leave();
});

async function showOrderSummary(ctx: BotContext): Promise<void> {
  const t = ctx.t;
  const lang = ctx.lang;
  const data = ctx.session.checkoutData!;
  const userId = ctx.dbUser!.id;

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: { include: { product: true } } },
  });

  if (!cart) return;

  let subtotal = 0;
  const itemLines = cart.items.map((item) => {
    const price = item.product.discountPrice ?? item.product.price;
    const lineTotal = price.toNumber() * item.quantity;
    subtotal += lineTotal;
    const name = getProductName(item.product, lang);
    return `• ${name} × ${item.quantity} = ${formatPrice(lineTotal)}`;
  });

  const discount = data.discountAmount ?? 0;
  const total = Math.max(0, subtotal - discount);

  const discountLine = discount > 0
    ? `\n🎟️ Discount: *-${formatPrice(discount)}*`
    : '';

  const notesLine = data.notes ? t('checkout_notes_line', { notes: data.notes }) : '';

  const text = t('checkout_summary', {
    items: itemLines.join('\n'),
    subtotal: formatPrice(subtotal),
    discount: discountLine,
    total: formatPrice(total),
    name: data.name ?? '',
    phone: data.phone ?? '',
    address: data.address ?? '',
    notes: notesLine,
  });

  await ctx.reply(
    text,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(t('btn_confirm'), 'confirm_order'),
          Markup.button.callback(t('btn_cancel'), 'cancel_order'),
        ],
      ]),
    }
  );
}
