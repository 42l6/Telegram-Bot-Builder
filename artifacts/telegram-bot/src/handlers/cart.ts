import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { config } from '../config';
import { cartKeyboard, backHomeKeyboard } from '../utils/keyboards';
import { formatPrice, getProductName } from '../utils/helpers';
import { logger } from '../utils/logger';
import { Markup } from 'telegraf';

export async function showCart(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const lang = ctx.lang;
    const userId = ctx.dbUser!.id;

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true, nameEn: true, nameAr: true,
                price: true, discountPrice: true, stock: true, imageFileId: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      await safeEdit(ctx, t('cart_empty'), backHomeKeyboard(t));
      return;
    }

    let total = 0;
    let itemLines = '';
    for (const item of cart.items) {
      const p = item.product;
      const price = p.discountPrice ? p.discountPrice.toNumber() : p.price.toNumber();
      const subtotal = price * item.quantity;
      total += subtotal;
      const name = getProductName(p, lang);
      itemLines += `${t('cart_item', { name, qty: item.quantity, subtotal: formatPrice(subtotal) })}\n`;
    }

    const text = `${t('cart_title')}\n\n${itemLines}${t('cart_total', { total: formatPrice(total) })}`;
    const keyboard = cartKeyboard(cart.items, lang, t);

    await safeEdit(ctx, text, keyboard);
  } catch (error) {
    logger.error('showCart error:', error);
    await ctx.reply(ctx.t('error_occurred'));
  }
}

export async function addToCart(ctx: BotContext, productId: number): Promise<void> {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive || product.stock <= 0) {
      await ctx.answerCbQuery(t('product_out_of_stock'), { show_alert: true }).catch(() => null);
      return;
    }

    let cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await prisma.cart.create({ data: { userId } });
    }

    const existing = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });

    if (existing) {
      await ctx.answerCbQuery(t('already_in_cart'), { show_alert: true }).catch(() => null);
      return;
    }

    const cartCount = await prisma.cartItem.count({ where: { cartId: cart.id } });
    if (cartCount >= config.MAX_CART_ITEMS) {
      await ctx.answerCbQuery('Cart is full (max 20 items)', { show_alert: true }).catch(() => null);
      return;
    }

    await prisma.cartItem.create({
      data: { cartId: cart.id, productId, quantity: 1 },
    });

    await cache.del(CACHE_KEYS.cart(userId));
    await ctx.answerCbQuery(t('added_to_cart'), { show_alert: true }).catch(() => null);

    // Refresh product view
    await showProductWithCartState(ctx, productId);
  } catch (error) {
    logger.error('addToCart error:', error);
    await ctx.answerCbQuery(ctx.t('error_occurred'), { show_alert: true }).catch(() => null);
  }
}

export async function removeFromCart(ctx: BotContext, productId: number): Promise<void> {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;

    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) return;

    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id, productId },
    });

    await cache.del(CACHE_KEYS.cart(userId));
    await ctx.answerCbQuery(t('removed_from_cart'), { show_alert: true }).catch(() => null);
    await showCart(ctx);
  } catch (error) {
    logger.error('removeFromCart error:', error);
  }
}

export async function updateQuantity(
  ctx: BotContext,
  productId: number,
  delta: number
): Promise<void> {
  try {
    const userId = ctx.dbUser!.id;

    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) return;

    const item = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
      include: { product: true },
    });

    if (!item) return;

    const newQty = item.quantity + delta;

    if (newQty <= 0) {
      await prisma.cartItem.delete({
        where: { cartId_productId: { cartId: cart.id, productId } },
      });
    } else if (newQty > item.product.stock) {
      await ctx.answerCbQuery(`Max stock: ${item.product.stock}`, { show_alert: true }).catch(() => null);
      return;
    } else {
      await prisma.cartItem.update({
        where: { cartId_productId: { cartId: cart.id, productId } },
        data: { quantity: newQty },
      });
    }

    await cache.del(CACHE_KEYS.cart(userId));
    await showCart(ctx);
  } catch (error) {
    logger.error('updateQuantity error:', error);
  }
}

export async function clearCart(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const userId = ctx.dbUser!.id;

    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await cache.del(CACHE_KEYS.cart(userId));
    }

    await ctx.answerCbQuery(t('cart_cleared')).catch(() => null);
    await safeEdit(ctx, t('cart_empty'), backHomeKeyboard(t));
  } catch (error) {
    logger.error('clearCart error:', error);
  }
}

async function showProductWithCartState(ctx: BotContext, productId: number): Promise<void> {
  // Just answer and let user see the updated state
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
