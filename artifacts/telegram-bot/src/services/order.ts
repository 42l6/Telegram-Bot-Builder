import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { formatPrice, getProductName } from '../utils/helpers';
import { translate } from '../services/translation';
import { Language } from '@prisma/client';
import type { Telegram } from 'telegraf';

export interface PlaceOrderInput {
  userId: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes?: string;
  couponCode?: string;
  couponId?: number | null;
  discountAmount?: number;
}

export async function placeOrder(
  input: PlaceOrderInput,
  telegram: Telegram,
  adminIds: number[]
): Promise<{ orderId: number } | null> {
  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: input.userId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) return null;

    let subtotal = 0;
    const orderItems: Array<{
      productId: number;
      productName: string;
      price: number;
      quantity: number;
      subtotal: number;
    }> = [];

    for (const item of cart.items) {
      const p = item.product;
      if (!p.isActive || p.stock < item.quantity) {
        throw new Error(`Product ${p.nameEn} is out of stock`);
      }
      const price = p.discountPrice ? p.discountPrice.toNumber() : p.price.toNumber();
      const lineSubtotal = price * item.quantity;
      subtotal += lineSubtotal;
      orderItems.push({
        productId: p.id,
        productName: p.nameEn,
        price,
        quantity: item.quantity,
        subtotal: lineSubtotal,
      });
    }

    const discount = input.discountAmount ?? 0;
    const finalAmount = Math.max(0, subtotal - discount);

    // Use a transaction for atomicity
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          userId: input.userId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress,
          notes: input.notes ?? null,
          totalAmount: subtotal,
          discountAmount: discount,
          finalAmount,
          couponCode: input.couponCode ?? null,
          items: {
            create: orderItems.map((i) => ({
              productId: i.productId,
              productName: i.productName,
              price: i.price,
              quantity: i.quantity,
              subtotal: i.subtotal,
            })),
          },
        },
      });

      // Decrease stock
      for (const item of cart.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // Mark coupon as used
      if (input.couponId) {
        await tx.coupon.update({
          where: { id: input.couponId },
          data: { usedCount: { increment: 1 } },
        });
        await tx.couponUsage.create({
          data: {
            couponId: input.couponId,
            userId: input.userId,
            orderId: newOrder.id,
          },
        });
      }

      // Award bonus points
      const pointsEarned = Math.floor(finalAmount / config.BONUS_POINTS_PER_ORDER_AMOUNT);
      if (pointsEarned > 0) {
        await tx.user.update({
          where: { id: input.userId },
          data: { bonusPoints: { increment: pointsEarned } },
        });
      }

      // Clear cart
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });

    // Invalidate caches
    await Promise.all([
      cache.del(CACHE_KEYS.cart(input.userId)),
      cache.del(CACHE_KEYS.userOrders(input.userId)),
      cache.delPattern(`products:cat:*`),
    ]);

    // Notify admins
    const itemsText = orderItems
      .map((i) => `• ${i.productName} × ${i.quantity} = ${formatPrice(i.subtotal)}`)
      .join('\n');

    const adminNotification = `🛍️ *New Order #${order.id}*\n\n👤 Customer: ${input.customerName}\n📱 Phone: ${input.customerPhone}\n📍 Address: ${input.customerAddress}\n\n${itemsText}\n\n💰 Total: *${formatPrice(finalAmount)}*${input.notes ? `\n📝 Notes: ${input.notes}` : ''}`;

    for (const adminId of adminIds) {
      await telegram.sendMessage(adminId, adminNotification, { parse_mode: 'Markdown' }).catch(() => null);
    }

    // Track analytics
    await prisma.analyticsEvent.create({
      data: {
        userId: input.userId,
        event: 'order_placed',
        metadata: { orderId: order.id, amount: finalAmount },
      },
    }).catch(() => null);

    return { orderId: order.id };
  } catch (error) {
    logger.error('placeOrder error:', error);
    return null;
  }
}

export async function applyCoupon(
  code: string,
  userId: number,
  subtotal: number
): Promise<{ valid: true; discountAmount: number; couponId: number; description: string } | { valid: false; reason: 'invalid' | 'used' }> {
  try {
    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase(), isActive: true },
    });

    if (!coupon) return { valid: false, reason: 'invalid' };

    // Check expiry
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return { valid: false, reason: 'invalid' };
    }

    // Check max uses
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, reason: 'invalid' };
    }

    // Check if user already used this coupon
    const alreadyUsed = await prisma.couponUsage.findFirst({
      where: { couponId: coupon.id, userId },
    });
    if (alreadyUsed) return { valid: false, reason: 'used' };

    // Check minimum order
    if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount.toNumber()) {
      return { valid: false, reason: 'invalid' };
    }

    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
      discountAmount = (subtotal * coupon.discountValue.toNumber()) / 100;
    } else {
      discountAmount = coupon.discountValue.toNumber();
    }
    discountAmount = Math.min(discountAmount, subtotal);

    return {
      valid: true,
      discountAmount,
      couponId: coupon.id,
      description: coupon.descriptionEn ?? `${coupon.discountValue}${coupon.discountType === 'percentage' ? '%' : '$'} off`,
    };
  } catch (error) {
    logger.error('applyCoupon error:', error);
    return { valid: false, reason: 'invalid' };
  }
}
