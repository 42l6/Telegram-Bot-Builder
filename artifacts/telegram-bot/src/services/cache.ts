import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

class CacheService {
  private client: Redis;

  constructor() {
    this.client = new Redis(config.REDIS_URL, {
      retryStrategy: (times) => Math.min(times * 100, 3000),
      enableReadyCheck: true,
    });

    this.client.on('connect', () => logger.info('✅ Redis connected'));
    this.client.on('error', (err) => logger.error('Redis error:', err));
    this.client.on('reconnecting', () => logger.warn('Redis reconnecting...'));
  }

  async get<T>(key: string): Promise<T | null> {
    const val = await this.client.get(key);
    return val ? (JSON.parse(val) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    await this.client.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async delPattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async hset(key: string, field: string, value: unknown): Promise<void> {
    await this.client.hset(key, field, JSON.stringify(value));
  }

  async hget<T>(key: string, field: string): Promise<T | null> {
    const val = await this.client.hget(key, field);
    return val ? (JSON.parse(val) as T) : null;
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  async lpush(key: string, value: unknown): Promise<void> {
    await this.client.lpush(key, JSON.stringify(value));
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const vals = await this.client.lrange(key, start, stop);
    return vals.map((v) => JSON.parse(v) as T);
  }

  getClient(): Redis {
    return this.client;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}

export const cache = new CacheService();

export const CACHE_KEYS = {
  user: (id: number | bigint) => `user:${id}`,
  categories: () => 'categories:all',
  category: (id: number) => `category:${id}`,
  products: (categoryId: number, page: number) => `products:cat:${categoryId}:page:${page}`,
  product: (id: number) => `product:${id}`,
  cart: (userId: number) => `cart:${userId}`,
  userOrders: (userId: number) => `orders:user:${userId}`,
  analytics: () => 'analytics:summary',
  settings: (key: string) => `settings:${key}`,
  rateLimit: (userId: bigint, action: string) => `rate:${userId}:${action}`,
  channelSubs: () => 'channels:required',
  autoReplies: () => 'auto_replies:all',
  dailyReward: (userId: number) => `daily_reward:${userId}`,
  searchResults: (query: string) => `search:${query}`,
};
