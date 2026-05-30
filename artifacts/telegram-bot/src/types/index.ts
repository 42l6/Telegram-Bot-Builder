import { Context, Scenes } from 'telegraf';
import { Language, UserRole } from '@prisma/client';

export interface SessionData extends Scenes.SceneSessionData {
  language?: Language;
  userId?: number;
  cartStep?: string;
  checkoutData?: Partial<CheckoutData>;
  adminData?: Record<string, unknown>;
  searchQuery?: string;
  currentPage?: number;
  lastMessageId?: number;
  broadcastData?: Partial<BroadcastData>;
  ticketData?: Partial<TicketData>;
}

export interface BotContext extends Context {
  session: SessionData;
  scene: Scenes.SceneContextScene<BotContext, Scenes.SceneSessionData>;
  dbUser: DbUser | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  lang: Language;
}

export interface DbUser {
  id: number;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  language: Language;
  role: UserRole;
  isBanned: boolean;
  banReason: string | null;
  phone: string | null;
  walletBalance: import('@prisma/client').Prisma.Decimal;
  bonusPoints: number;
  referralCode: string;
  referredBy: number | null;
}

export interface CheckoutData {
  name: string;
  phone: string;
  address: string;
  notes: string;
  couponCode: string;
  discountAmount: number;
  couponId: number | null;
  step: 'name' | 'phone' | 'address' | 'notes' | 'coupon' | 'confirm';
}

export interface BroadcastData {
  messageEn: string;
  messageAr: string;
  imageFileId: string;
  scheduledAt: Date | null;
  step: 'message_en' | 'message_ar' | 'image' | 'schedule' | 'confirm';
}

export interface TicketData {
  subject: string;
  message: string;
  step: 'subject' | 'message';
}

export interface AdminProductData {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  price: string;
  discountPrice: string;
  stock: string;
  imageFileId: string;
  categoryId: number;
  step: string;
  editingId?: number;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
  total: number;
}

export interface CartWithItems {
  id: number;
  items: Array<{
    id: number;
    quantity: number;
    product: {
      id: number;
      nameEn: string;
      nameAr: string;
      price: import('@prisma/client').Prisma.Decimal;
      discountPrice: import('@prisma/client').Prisma.Decimal | null;
      stock: number;
      imageFileId: string | null;
    };
  }>;
}

export interface OrderWithItems {
  id: number;
  status: import('@prisma/client').OrderStatus;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string | null;
  totalAmount: import('@prisma/client').Prisma.Decimal;
  discountAmount: import('@prisma/client').Prisma.Decimal;
  finalAmount: import('@prisma/client').Prisma.Decimal;
  couponCode: string | null;
  createdAt: Date;
  items: Array<{
    id: number;
    productName: string;
    price: import('@prisma/client').Prisma.Decimal;
    quantity: number;
    subtotal: import('@prisma/client').Prisma.Decimal;
  }>;
}
