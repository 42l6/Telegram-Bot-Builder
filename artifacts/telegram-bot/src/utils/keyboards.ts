import { Markup } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/types';
import { Language } from '@prisma/client';
import { translate } from '../services/translation';
import { chunkArray } from './helpers';
import { config } from '../config';

type T = (key: string, params?: Record<string, string | number>) => string;

export function mainMenuKeyboard(t: T): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('btn_store'), 'store'), Markup.button.callback(t('btn_cart'), 'cart')],
    [Markup.button.callback(t('btn_orders'), 'orders'), Markup.button.callback(t('btn_favorites'), 'favorites')],
    [Markup.button.callback(t('btn_wallet'), 'wallet'), Markup.button.callback(t('btn_referral'), 'referral')],
    [Markup.button.callback(t('btn_daily_reward'), 'daily_reward'), Markup.button.callback(t('btn_support'), 'support')],
    [Markup.button.callback(t('btn_settings'), 'settings')],
  ]);
}

export function backHomeKeyboard(t: T): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('btn_back'), 'back'), Markup.button.callback(t('btn_home'), 'home')],
  ]);
}

export function categoriesKeyboard(
  categories: Array<{ id: number; nameEn: string; nameAr: string }>,
  lang: Language,
  t: T,
  page = 1
): ReturnType<typeof Markup.inlineKeyboard> {
  const pageSize = config.ITEMS_PER_PAGE;
  const start = (page - 1) * pageSize;
  const slice = categories.slice(start, start + pageSize);
  const totalPages = Math.ceil(categories.length / pageSize);

  const catButtons = chunkArray(
    slice.map((c) =>
      Markup.button.callback(
        lang === Language.ar ? c.nameAr : c.nameEn,
        `cat:${c.id}`
      )
    ),
    2
  );

  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 1) nav.push(Markup.button.callback(t('btn_prev'), `cat_page:${page - 1}`));
  if (page < totalPages) nav.push(Markup.button.callback(t('btn_next'), `cat_page:${page + 1}`));

  const rows = [...catButtons];
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback(t('btn_search'), 'search_product')]);
  rows.push([Markup.button.callback(t('btn_home'), 'home')]);

  return Markup.inlineKeyboard(rows);
}

export function productsKeyboard(
  products: Array<{ id: number; nameEn: string; nameAr: string; price: { toNumber(): number }; discountPrice: { toNumber(): number } | null }>,
  lang: Language,
  t: T,
  categoryId: number,
  page: number,
  totalPages: number
): ReturnType<typeof Markup.inlineKeyboard> {
  const productButtons = chunkArray(
    products.map((p) => {
      const name = lang === Language.ar ? p.nameAr : p.nameEn;
      const price = p.discountPrice ? p.discountPrice.toNumber() : p.price.toNumber();
      return Markup.button.callback(`${name} — $${price.toFixed(2)}`, `prod:${p.id}`);
    }),
    1
  );

  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 1) nav.push(Markup.button.callback(t('btn_prev'), `prod_page:${categoryId}:${page - 1}`));
  if (page < totalPages) nav.push(Markup.button.callback(t('btn_next'), `prod_page:${categoryId}:${page + 1}`));

  const rows = [...productButtons];
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback(t('btn_back'), `cat:${categoryId}`), Markup.button.callback(t('btn_home'), 'home')]);

  return Markup.inlineKeyboard(rows);
}

export function productDetailKeyboard(
  productId: number,
  inCart: boolean,
  inFavorites: boolean,
  inStock: boolean,
  t: T
): ReturnType<typeof Markup.inlineKeyboard> {
  const rows = [];

  if (inStock) {
    rows.push([
      inCart
        ? Markup.button.callback(t('btn_remove_from_cart'), `cart_remove:${productId}`)
        : Markup.button.callback(t('btn_add_to_cart'), `cart_add:${productId}`),
    ]);
    if (!inCart) {
      rows.push([Markup.button.callback(t('btn_buy_now'), `buy_now:${productId}`)]);
    }
  }

  rows.push([
    inFavorites
      ? Markup.button.callback(t('btn_remove_from_favorites'), `fav_remove:${productId}`)
      : Markup.button.callback(t('btn_add_to_favorites'), `fav_add:${productId}`),
  ]);

  rows.push([Markup.button.callback(t('btn_back'), 'store'), Markup.button.callback(t('btn_home'), 'home')]);

  return Markup.inlineKeyboard(rows);
}

export function cartKeyboard(
  items: Array<{ id: number; quantity: number; product: { id: number; nameEn: string; nameAr: string } }>,
  lang: Language,
  t: T
): ReturnType<typeof Markup.inlineKeyboard> {
  const rows = items.map((item) => {
    const name = lang === Language.ar ? item.product.nameAr : item.product.nameEn;
    return [
      Markup.button.callback(t('btn_decrease_qty'), `qty_dec:${item.product.id}`),
      Markup.button.callback(`${name} (${item.quantity})`, `prod:${item.product.id}`),
      Markup.button.callback(t('btn_increase_qty'), `qty_inc:${item.product.id}`),
      Markup.button.callback('🗑️', `cart_remove:${item.product.id}`),
    ];
  });

  rows.push([Markup.button.callback(t('btn_checkout'), 'checkout')]);
  rows.push([
    Markup.button.callback(t('btn_clear_cart'), 'cart_clear'),
    Markup.button.callback(t('btn_home'), 'home'),
  ]);

  return Markup.inlineKeyboard(rows);
}

export function ordersKeyboard(
  orders: Array<{ id: number; status: string; createdAt: Date; finalAmount: { toNumber(): number } }>,
  t: T,
  page: number,
  totalPages: number
): ReturnType<typeof Markup.inlineKeyboard> {
  const rows = orders.map((o) => [
    Markup.button.callback(`#${o.id} — ${o.status} — $${o.finalAmount.toNumber().toFixed(2)}`, `order:${o.id}`),
  ]);

  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 1) nav.push(Markup.button.callback(t('btn_prev'), `orders_page:${page - 1}`));
  if (page < totalPages) nav.push(Markup.button.callback(t('btn_next'), `orders_page:${page + 1}`));
  if (nav.length) rows.push(nav);

  rows.push([Markup.button.callback(t('btn_home'), 'home')]);
  return Markup.inlineKeyboard(rows);
}

export function orderStatusKeyboard(orderId: number, t: T): ReturnType<typeof Markup.inlineKeyboard> {
  const statuses = ['confirmed', 'shipped', 'completed', 'cancelled'];
  const rows = chunkArray(
    statuses.map((s) => Markup.button.callback(s.toUpperCase(), `set_status:${orderId}:${s}`)),
    2
  );
  rows.push([Markup.button.callback(t('btn_back'), `admin_order:${orderId}`)]);
  return Markup.inlineKeyboard(rows);
}

export function adminMenuKeyboard(t: T): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('btn_manage_products'), 'admin_products'), Markup.button.callback(t('btn_manage_categories'), 'admin_categories')],
    [Markup.button.callback(t('btn_manage_orders'), 'admin_orders'), Markup.button.callback(t('btn_manage_users'), 'admin_users')],
    [Markup.button.callback(t('btn_broadcast'), 'admin_broadcast'), Markup.button.callback(t('btn_analytics'), 'admin_analytics')],
    [Markup.button.callback(t('btn_coupons'), 'admin_coupons'), Markup.button.callback(t('btn_channels'), 'admin_channels')],
    [Markup.button.callback(t('btn_export_csv'), 'admin_export'), Markup.button.callback(t('btn_auto_replies'), 'admin_auto_replies')],
    [Markup.button.callback(t('btn_home'), 'home')],
  ]);
}

export function languageKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇺🇸 English', 'lang:en'),
      Markup.button.callback('🇸🇦 العربية', 'lang:ar'),
    ],
  ]);
}

export function paginationRow(
  current: number,
  total: number,
  callbackPrefix: string,
  t: T
): ReturnType<typeof Markup.button.callback>[] {
  const row: ReturnType<typeof Markup.button.callback>[] = [];
  if (current > 1) row.push(Markup.button.callback(t('btn_prev'), `${callbackPrefix}:${current - 1}`));
  row.push(Markup.button.callback(`${current}/${total}`, 'noop'));
  if (current < total) row.push(Markup.button.callback(t('btn_next'), `${callbackPrefix}:${current + 1}`));
  return row;
}

export function adminOrdersFilterKeyboard(t: T): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏳ Pending', 'admin_orders_filter:pending'), Markup.button.callback('✅ Confirmed', 'admin_orders_filter:confirmed')],
    [Markup.button.callback('🚚 Shipped', 'admin_orders_filter:shipped'), Markup.button.callback('✅ Completed', 'admin_orders_filter:completed')],
    [Markup.button.callback('❌ Cancelled', 'admin_orders_filter:cancelled'), Markup.button.callback('📋 All', 'admin_orders_filter:all')],
    [Markup.button.callback(t('btn_back'), 'admin_panel')],
  ]);
}

export function skipKeyboard(t: T): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([[Markup.button.callback(t('btn_skip'), 'skip')]]);
}

export function confirmCancelKeyboard(t: T): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('btn_confirm'), 'confirm'), Markup.button.callback(t('btn_cancel'), 'cancel')],
  ]);
}
