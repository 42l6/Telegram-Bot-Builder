# 🤖 Telegram Business Bot

A production-ready, feature-rich Telegram bot for businesses — built with Node.js, TypeScript, Telegraf, Prisma, and Redis.

---

## ✨ Features

- 🛍️ **Store System** — Categories, products, images (file_id), pricing, discounts, stock tracking
- 🛒 **Cart & Checkout** — Multi-item cart, quantity control, coupon codes, order placement
- 📦 **Order Management** — Full order lifecycle with status updates and admin notifications
- 🔧 **Admin Panel** — In-bot admin panel for products, categories, orders, users, analytics
- 📢 **Broadcasts** — Instant or scheduled broadcasts to all users, with language support
- 🎁 **User Rewards** — Daily rewards, bonus points, referral system, wallet balance
- 🎧 **Support Tickets** — User-submitted tickets with admin replies
- 📊 **Analytics** — Users, orders, revenue, top products, referral stats
- 🌐 **Multi-language** — Full Arabic (RTL) and English support with locale files
- 📡 **Force Subscribe** — Require channel subscription before bot access
- 🤖 **Auto Replies** — Keyword-triggered automatic responses
- 🔒 **Security** — Rate limiting, anti-spam, admin authorization, input validation

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5 |
| Bot Framework | Telegraf 4 |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache | Redis 7 + ioredis |
| Scheduler | node-cron |
| Logging | Winston |
| Deployment | Docker + Docker Compose + PM2 |

---

## 🚀 Quick Start

### 1. Create your bot with BotFather

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts to choose a name and username
4. Copy the **BOT_TOKEN** you receive
5. Send `/setprivacy` → select your bot → **Disable** (to allow reading messages in groups)

### 2. Get your Telegram User ID (for ADMIN_IDS)

Send any message to **@userinfobot** — it will reply with your numeric user ID.

### 3. Clone and configure

```bash
git clone <your-repo>
cd telegram-bot
cp .env.example .env
```

Edit `.env` and fill in:
- `BOT_TOKEN` — from BotFather
- `ADMIN_IDS` — your Telegram user ID (comma-separated for multiple admins)
- `BOT_USERNAME` — your bot's username (without @)

### 4. Install dependencies

```bash
npm install
```

### 5. Set up the database

**Option A — Docker (recommended)**:
```bash
docker compose up postgres redis -d
```

**Option B — Local PostgreSQL**:
- Install PostgreSQL and create a database named `telegram_bot`
- Update `DATABASE_URL` in your `.env`

### 6. Push database schema

```bash
npx prisma db push
# or for production migrations:
npx prisma migrate deploy
```

### 7. Generate Prisma client

```bash
npm run prisma:generate
```

### 8. Run in development

```bash
npm run dev
```

---

## 🐳 Docker Deployment (Production)

### Full stack with Docker Compose

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your values

# Build and start everything
docker compose up -d --build

# View logs
docker compose logs -f bot

# Stop
docker compose down
```

### Environment variables for Docker

The `docker-compose.yml` automatically sets `DATABASE_URL` and `REDIS_URL` to point to the containers. You only need to set:

```env
BOT_TOKEN=your_token
ADMIN_IDS=your_id
BOT_USERNAME=your_bot
POSTGRES_PASSWORD=a_strong_password
```

---

## 🖥️ VPS Deployment with PM2

### 1. Install dependencies on VPS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

### 2. Set up PostgreSQL and Redis

```bash
# PostgreSQL
sudo apt install postgresql
sudo -u postgres createdb telegram_bot

# Redis
sudo apt install redis-server
```

### 3. Build and start

```bash
npm install
npx prisma migrate deploy
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 4. Monitor

```bash
pm2 status
pm2 logs telegram-bot
pm2 monit
```

---

## 🚂 Railway Deployment

1. Push your code to GitHub
2. Create a new project on [railway.app](https://railway.app)
3. Add **PostgreSQL** and **Redis** services
4. Set environment variables in Railway dashboard
5. Railway auto-builds and runs `node dist/index.js`

---

## 🗄️ Database Backup

### Automated backup with cron

```bash
# Add to crontab (crontab -e)
0 2 * * * pg_dump -U postgres telegram_bot | gzip > /backups/bot_$(date +\%Y\%m\%d).sql.gz

# With Docker
0 2 * * * docker exec telegram_bot_postgres pg_dump -U postgres telegram_bot | gzip > /backups/bot_$(date +\%Y\%m\%d).sql.gz
```

### Manual backup

```bash
pg_dump -U postgres telegram_bot > backup.sql

# Restore
psql -U postgres telegram_bot < backup.sql
```

---

## 📁 Project Structure

```
src/
├── commands/
│   └── start.ts          # /start command, language selection
├── handlers/
│   ├── menu.ts           # Main menu, admin panel
│   ├── store.ts          # Categories, products, search
│   ├── cart.ts           # Cart add/remove/update
│   ├── orders.ts         # User order history
│   ├── admin.ts          # Admin order/user management, analytics, CSV export
│   ├── user.ts           # Wallet, referral, daily reward, favorites, settings
│   └── support.ts        # Support tickets
├── scenes/
│   ├── checkout.ts       # Multi-step checkout flow
│   ├── admin-product.ts  # Admin add product wizard
│   ├── admin-broadcast.ts# Broadcast creation wizard
│   └── support-ticket.ts # User submit ticket wizard
├── middlewares/
│   ├── auth.ts           # Auth, admin check, channel subscription
│   ├── i18n.ts           # Language injection
│   └── rateLimit.ts      # Anti-spam rate limiting
├── services/
│   ├── cache.ts          # Redis cache service
│   ├── translation.ts    # i18n translation engine
│   └── order.ts          # Order placement & coupon logic
├── database/
│   └── prisma.ts         # Prisma client singleton
├── jobs/
│   └── scheduler.ts      # Cron jobs (abandoned cart, scheduled broadcasts)
├── utils/
│   ├── keyboards.ts      # All inline keyboard builders
│   ├── helpers.ts        # Formatting, pagination, validation utilities
│   └── logger.ts         # Winston logger
├── types/
│   └── index.ts          # TypeScript types for BotContext, sessions
├── config/
│   └── index.ts          # Validated environment config (zod)
└── index.ts              # Main entry point
locales/
├── en.json               # English translations
└── ar.json               # Arabic translations
prisma/
└── schema.prisma         # Database schema
```

---

## 🔒 Security Notes

- Never commit your `.env` file
- Use strong `POSTGRES_PASSWORD` in production
- Set `ADMIN_IDS` carefully — admins have full control over the bot
- The bot validates all inputs and rate-limits all interactions
- Media files are stored only as Telegram `file_id` — never locally

---

## 📝 Adding Translations

Edit `locales/en.json` and `locales/ar.json`. All strings support `{variable}` placeholders.

The translation engine is hot-loadable — restart the bot after changes.

---

## 🤝 Admin Commands

From inside Telegram, send `/admin` to open the admin panel. You must be listed in `ADMIN_IDS`.

From the admin panel you can:
- Add/edit/delete products and categories
- View and manage all orders
- Ban/unban users
- Send broadcasts (instant or scheduled)
- View analytics dashboard
- Export users and orders to CSV
- Manage required channel subscriptions
- Configure auto-reply triggers
