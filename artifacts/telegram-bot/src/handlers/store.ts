import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { config } from '../config';
import {
  categoriesKeyboard,
  productsKeyboard,
  productDetailKeyboard,
  backHomeKeyboard,
} from '../utils/keyboards';
import {
  getProductName,
  getProductDescription,
  formatPrice,
  getCategoryName,
} from '../utils/helpers';
import { logger } from '../utils/logger';
import { Language } from '@prisma/client';
import { Markup } from 'telegraf';

export async function showStore(ctx: BotContext, page = 1): Promise<void> {
  try {
    const t = ctx.t;
    const lang = ctx.lang;

    let cats = await cache.get<Array<{ id: number; nameEn: string; nameAr: string; isActive: boolean }>>(
      CACHE_KEYS.categories()
    );
    if (!cats) {
      cats = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      await cache.set(CACHE_KEYS.categories(), cats, 600);
    }

    if (cats.length === 0) {
      await safeEdit(ctx, t('no_categories'), backHomeKeyboard(t));
      return;
    }

    await safeEdit(ctx, t('store_title'), categoriesKeyboard(cats, lang, t, page));
  } catch (error) {
    logger.error('showStore error:', error);
    await ctx.reply(ctx.t('error_occurred'));
  }
}

export async function showCategory(ctx: BotContext, categoryId: number, page = 1): Promise<void> {
  try {
    const t = ctx.t;
    const lang = ctx.lang;
    const pageSize = config.ITEMS_PER_PAGE;

    const cacheKey = CACHE_KEYS.products(categoryId, page);
    let cached = await cache.get<{ products: unknown[]; total: number }>(cacheKey);

    let products: Array<{
      id: number;
      nameEn: string;
      nameAr: string;
      price: { toNumber(): number };
      discountPrice: { toNumber(): number } | null;
      stock: number;
      imageFileId: string | null;
    }>;
    let total: number;

    if (cached) {
      products = cached.products as typeof products;
      total = cached.total;
    } else {
      total = await prisma.product.count({ where: { categoryId, isActive: true } });
      products = await prisma.product.findMany({
        where: { categoryId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      await cache.set(cacheKey, { products, total }, 300);
    }

    if (products.length === 0) {
      await safeEdit(ctx, t('no_products'), backHomeKeyboard(t));
      return;
    }

    const totalPages = Math.ceil(total / pageSize);
    await safeEdit(
      ctx,
      t('store_title'),
      productsKeyboard(products, lang, t, categoryId, page, totalPages)
    );
  } catch (error) {
    logger.error('showCategory error:', error);
    await ctx.reply(ctx.t('error_occurred'));
  }
}

export async function showProduct(ctx: BotContext, productId: number): Promise<void> {
  try {
    const t = ctx.t;
    const lang = ctx.lang;

    let product = await cache.get<{
      id: number;
      nameEn: string;
      nameAr: string;
      descriptionEn: string | null;
      descriptionAr: string | null;
      price: { toNumber(): number; toString(): string };
      discountPrice: { toNumber(): number; toString(): string } | null;
      stock: number;
      imageFileId: string | null;
      isActive: boolean;
    }>(CACHE_KEYS.product(productId));

    if (!product) {
      product = await prisma.product.findUnique({ where: { id: productId } });
      if (product) await cache.set(CACHE_KEYS.product(productId), product, 300);
    }

    if (!product || !product.isActive) {
      await ctx.answerCbQuery('Product not found').catch(() => null);
      return;
    }

    const name = getProductName(product, lang);
    const description = getProductDescription(product, lang);
    const price = formatPrice(product.price.toNumber());
    const discountText = product.discountPrice
      ? t('product_discounted', {
          original: price,
          discounted: formatPrice(product.discountPrice.toNumber()),
        })
      : '';

    let text = t('product_detail', {
      name,
      description: description || '—',
      price: product.discountPrice ? formatPrice(product.discountPrice.toNumber()) : price,
      discount: discountText,
      stock: product.stock > 0 ? product.stock : t('product_out_of_stock'),
    });

    // Check cart / favorites
    let inCart = false;
    let inFavorites = false;

    if (ctx.dbUser) {
      const [cartItem, fav] = await Promise.all([
        prisma.cartItem.findFirst({
          where: {
            cart: { userId: ctx.dbUser.id },
            productId,
          },
        }),
        prisma.favorite.findUnique({
          where: {
            userId_productId: { userId: ctx.dbUser.id, productId },
          },
        }),
      ]);
      inCart = !!cartItem;
      inFavorites = !!fav;
    }

    const keyboard = productDetailKeyboard(productId, inCart, inFavorites, product.stock > 0, t);

    if (product.imageFileId) {
      try {
        await ctx.deleteMessage().catch(() => null);
        await ctx.replyWithPhoto(product.imageFileId, {
          caption: text,
          parse_mode: 'Markdown',
          ...keyboard,
        });
        return;
      } catch {
        // Fall through to text-only
      }
    }

    await safeEdit(ctx, text, keyboard);
  } catch (error) {
    logger.error('showProduct error:', error);
    await ctx.reply(ctx.t('error_occurred'));
  }
}

export async function searchProducts(ctx: BotContext, query: string): Promise<void> {
  try {
    const t = ctx.t;
    const lang = ctx.lang;

    if (!query || query.length < 2) {
      await ctx.reply(t('invalid_input'));
      return;
    }

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { nameEn: { contains: query, mode: 'insensitive' } },
          { nameAr: { contains: query, mode: 'insensitive' } },
          { descriptionEn: { contains: query, mode: 'insensitive' } },
          { descriptionAr: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
      include: { category: true },
    });

    if (products.length === 0) {
      await ctx.reply(t('no_search_results', { query }), backHomeKeyboard(t));
      return;
    }

    const buttons = products.map((p) => [
      Markup.button.callback(
        `${getProductName(p, lang)} — ${formatPrice(p.discountPrice ?? p.price)}`,
        `prod:${p.id}`
      ),
    ]);
    buttons.push([Markup.button.callback(t('btn_home'), 'home')]);

    await ctx.reply(t('search_results', { query }), Markup.inlineKeyboard(buttons));
  } catch (error) {
    logger.error('searchProducts error:', error);
    await ctx.reply(ctx.t('error_occurred'));
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
