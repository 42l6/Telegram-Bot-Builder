import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../types';
import { prisma } from '../database/prisma';
import { cache, CACHE_KEYS } from '../services/cache';
import { isValidPrice, isValidQuantity } from '../utils/helpers';
import { logger } from '../utils/logger';

export const adminProductScene = new Scenes.BaseScene<BotContext>('admin_product');

adminProductScene.enter(async (ctx) => {
  const t = ctx.t;
  ctx.session.adminData = ctx.session.adminData ?? {};
  ctx.session.adminData.step = 'name_en';
  await ctx.reply(t('admin_product_name_en'), { reply_markup: { remove_keyboard: true } });
});

adminProductScene.on('text', async (ctx) => {
  try {
    const t = ctx.t;
    const text = ctx.message.text.trim();
    const data = (ctx.session.adminData ?? {}) as Record<string, string | number>;

    if (text === '/cancel') {
      await ctx.reply(t('operation_cancelled'));
      return ctx.scene.leave();
    }

    const step = data.step as string;

    switch (step) {
      case 'name_en': {
        data.nameEn = text;
        data.step = 'name_ar';
        await ctx.reply(t('admin_product_name_ar'));
        break;
      }
      case 'name_ar': {
        data.nameAr = text;
        data.step = 'desc_en';
        await ctx.reply(
          t('admin_product_desc_en'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_desc_en')]])
        );
        break;
      }
      case 'desc_en': {
        data.descriptionEn = text;
        data.step = 'desc_ar';
        await ctx.reply(
          t('admin_product_desc_ar'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_desc_ar')]])
        );
        break;
      }
      case 'desc_ar': {
        data.descriptionAr = text;
        data.step = 'price';
        await ctx.reply(t('admin_product_price'));
        break;
      }
      case 'price': {
        if (!isValidPrice(text)) {
          await ctx.reply(t('invalid_price'));
          return;
        }
        data.price = text;
        data.step = 'discount';
        await ctx.reply(
          t('admin_product_discount'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_discount')]])
        );
        break;
      }
      case 'discount': {
        if (!isValidPrice(text)) {
          await ctx.reply(t('invalid_price'));
          return;
        }
        data.discountPrice = text;
        data.step = 'stock';
        await ctx.reply(t('admin_product_stock'));
        break;
      }
      case 'stock': {
        if (!isValidQuantity(text)) {
          await ctx.reply(t('invalid_quantity'));
          return;
        }
        data.stock = text;
        data.step = 'image';
        await ctx.reply(
          t('admin_product_image'),
          Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip_image')]])
        );
        break;
      }
      default:
        break;
    }

    ctx.session.adminData = data;
  } catch (error) {
    logger.error('adminProductScene text error:', error);
  }
});

// Handle photo upload
adminProductScene.on('photo', async (ctx) => {
  try {
    const t = ctx.t;
    const data = (ctx.session.adminData ?? {}) as Record<string, string | number>;

    if (data.step === 'image') {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      data.imageFileId = largest.file_id;
      data.step = 'category';
      ctx.session.adminData = data;
      await showCategorySelection(ctx);
    }
  } catch (error) {
    logger.error('adminProductScene photo error:', error);
  }
});

adminProductScene.action('skip_desc_en', async (ctx) => {
  const data = (ctx.session.adminData ?? {}) as Record<string, string | number>;
  data.descriptionEn = '';
  data.step = 'desc_ar';
  ctx.session.adminData = data;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply(ctx.t('admin_product_desc_ar'),
    Markup.inlineKeyboard([[Markup.button.callback(ctx.t('btn_skip'), 'skip_desc_ar')]])
  );
});

adminProductScene.action('skip_desc_ar', async (ctx) => {
  const data = (ctx.session.adminData ?? {}) as Record<string, string | number>;
  data.descriptionAr = '';
  data.step = 'price';
  ctx.session.adminData = data;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply(ctx.t('admin_product_price'));
});

adminProductScene.action('skip_discount', async (ctx) => {
  const data = (ctx.session.adminData ?? {}) as Record<string, string | number>;
  data.discountPrice = '';
  data.step = 'stock';
  ctx.session.adminData = data;
  await ctx.answerCbQuery().catch(() => null);
  await ctx.reply(ctx.t('admin_product_stock'));
});

adminProductScene.action('skip_image', async (ctx) => {
  const data = (ctx.session.adminData ?? {}) as Record<string, string | number>;
  data.imageFileId = '';
  data.step = 'category';
  ctx.session.adminData = data;
  await ctx.answerCbQuery().catch(() => null);
  await showCategorySelection(ctx);
});

adminProductScene.action(/^select_cat:(\d+)$/, async (ctx) => {
  try {
    const t = ctx.t;
    const categoryId = parseInt(ctx.match[1]);
    const data = (ctx.session.adminData ?? {}) as Record<string, string | number>;

    await prisma.product.create({
      data: {
        categoryId,
        nameEn: String(data.nameEn),
        nameAr: String(data.nameAr),
        descriptionEn: data.descriptionEn ? String(data.descriptionEn) : null,
        descriptionAr: data.descriptionAr ? String(data.descriptionAr) : null,
        price: parseFloat(String(data.price)),
        discountPrice: data.discountPrice ? parseFloat(String(data.discountPrice)) : null,
        stock: parseInt(String(data.stock)),
        imageFileId: data.imageFileId ? String(data.imageFileId) : null,
      },
    });

    await cache.del(CACHE_KEYS.categories());
    await cache.delPattern('products:cat:*');

    await ctx.answerCbQuery().catch(() => null);
    await ctx.reply(t('admin_product_added'));
    ctx.session.adminData = {};
    await ctx.scene.leave();
  } catch (error) {
    logger.error('adminProductScene select_cat error:', error);
    await ctx.reply(ctx.t('error_occurred'));
    await ctx.scene.leave();
  }
});

async function showCategorySelection(ctx: BotContext): Promise<void> {
  const t = ctx.t;
  const lang = ctx.lang;

  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (categories.length === 0) {
    await ctx.reply('No categories. Create one first.');
    return ctx.scene.leave();
  }

  const rows = categories.map((c) => [
    Markup.button.callback(
      lang === 'ar' ? c.nameAr : c.nameEn,
      `select_cat:${c.id}`
    ),
  ]);

  await ctx.reply(t('admin_product_category'), Markup.inlineKeyboard(rows));
}
