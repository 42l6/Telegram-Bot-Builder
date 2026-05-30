import { BotContext } from '../types';
import { mainMenuKeyboard, adminMenuKeyboard } from '../utils/keyboards';
import { logger } from '../utils/logger';

export async function showMainMenu(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const keyboard = mainMenuKeyboard(t);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(t('main_menu'), { ...keyboard, parse_mode: 'Markdown' }).catch(async () => {
        await ctx.reply(t('main_menu'), { ...keyboard, parse_mode: 'Markdown' });
      });
      await ctx.answerCbQuery().catch(() => null);
    } else {
      await ctx.reply(t('main_menu'), { ...keyboard, parse_mode: 'Markdown' });
    }
  } catch (error) {
    logger.error('showMainMenu error:', error);
  }
}

export async function showAdminPanel(ctx: BotContext): Promise<void> {
  try {
    const t = ctx.t;
    const keyboard = adminMenuKeyboard(t);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(`🔧 *${t('admin_panel')}*\n\n${t('admin_menu')}`, { ...keyboard, parse_mode: 'Markdown' }).catch(async () => {
        await ctx.reply(`🔧 *${t('admin_panel')}*\n\n${t('admin_menu')}`, { ...keyboard, parse_mode: 'Markdown' });
      });
      await ctx.answerCbQuery().catch(() => null);
    } else {
      await ctx.reply(`🔧 *${t('admin_panel')}*\n\n${t('admin_menu')}`, { ...keyboard, parse_mode: 'Markdown' });
    }
  } catch (error) {
    logger.error('showAdminPanel error:', error);
  }
}
