import { Language } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export function generateReferralCode(): string {
  return uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function formatPrice(amount: Prisma.Decimal | number | string): string {
  const num = typeof amount === 'object' ? amount.toNumber() : Number(amount);
  return `$${num.toFixed(2)}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getProductName(
  product: { nameEn: string; nameAr: string },
  lang: Language
): string {
  return lang === Language.ar ? product.nameAr : product.nameEn;
}

export function getProductDescription(
  product: { descriptionEn: string | null; descriptionAr: string | null },
  lang: Language
): string {
  return (lang === Language.ar ? product.descriptionAr : product.descriptionEn) ?? '';
}

export function getCategoryName(
  category: { nameEn: string; nameAr: string },
  lang: Language
): string {
  return lang === Language.ar ? category.nameAr : category.nameEn;
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): { items: T[]; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean } {
  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  const paginatedItems = items.slice(offset, offset + pageSize);

  return {
    items: paginatedItems,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export function formatTimeRemaining(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

export function isValidPrice(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value.trim()) && parseFloat(value) > 0;
}

export function isValidQuantity(value: string): boolean {
  return /^\d+$/.test(value.trim()) && parseInt(value) >= 0;
}

export function sanitizeText(text: string): string {
  return text.replace(/[<>&"']/g, (c) => {
    const map: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function getUserDisplayName(user: {
  firstName: string;
  lastName?: string | null;
  username?: string | null;
}): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return full || user.username || 'Unknown';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
