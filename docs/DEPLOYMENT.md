# Deployment Guide: Local & Production

Step-by-step setup for local development and production deployment.

---

## 1. Local Development (Docker Compose)

### 1.1 Prerequisites

```bash
# macOS (your system)
brew install docker docker-compose ffmpeg node@18

# Verify installations
docker --version
docker-compose --version
ffmpeg -version
node --version
```

### 1.2 Repository Setup

```bash
cd /Users/hammad/Projects/ClawBot/RealEstateBot

# Initialize git
git init
git add .
git commit -m "Initial commit: Real Estate WhatsApp AI Agent"

# Create .env.local (never commit)
cp config/env.example .env.local
```

### 1.3 Configure .env.local

```bash
# .env.local (git-ignored)

# WhatsApp
WHATSAPP_CLIENT=baileys                    # or 'whatsapp-web.js'
SECONDARY_SIM_PORT=/dev/ttyUSB0            # (if using hardware SIM)

# APIs
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Database (Supabase)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGci...
DATABASE_URL=postgresql://user:pass@db.supabase.co:5432/postgres

# Vector DB (Pinecone)
PINECONE_API_KEY=xxxx-xxxx-xxxx
PINECONE_INDEX_NAME=realestatebot
PINECONE_NAMESPACE=default

# Local Development
NODE_ENV=development
LOG_LEVEL=debug
PORT=3000
LOCALHOST=true                             # Disable all external APIs

# Autonomous Mode (March 22 - 31)
AUTONOMOUS_MODE_START=2026-03-22
AUTONOMOUS_MODE_END=2026-03-31
AUTONOMOUS_MODE_ENABLED=false              # Toggle on travel dates

# Cost Limits
MAX_DAILY_COST_CENTS=2500                  # $25/day
MAX_BROKER_COST_CENTS=1200                 # $12/broker/day
MAX_TURNS_PER_BROKER=10                    # Turn limit

# Email (for daily digest)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=app-specific-password            # Use Gmail App Passwords
DIGEST_EMAIL=your-email@gmail.com
```

### 1.4 Docker Compose Configuration

```yaml
# docker/docker-compose.yml

version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: realestatebot
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: dev_password_local
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres-init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Cache (for sessions & rate limiting)
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Node.js Application
  app:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://postgres:dev_password_local@postgres:5432/realestatebot
      REDIS_URL: redis://redis:6379
      LOCALHOST: "true"  # Disable external APIs in local mode
      LOG_LEVEL: debug
    volumes:
      - .:/app
      - /app/node_modules
      - /tmp:/tmp  # For FFmpeg temp files
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: npm run dev

volumes:
  postgres_data:

networks:
  default:
    name: realestatebot_network
```

### 1.5 Database Initialization

```sql
-- docker/postgres-init.sql

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create brokers table
CREATE TABLE brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(255),
  location_focus TEXT[],
  total_properties_shared INT DEFAULT 0,
  avg_asking_price BIGINT,
  conversation_count INT DEFAULT 0,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  msg_count_today INT DEFAULT 0,
  turn_count_today INT DEFAULT 0,
  negotiation_status VARCHAR(50),
  is_spam BOOLEAN DEFAULT FALSE,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_brokers_phone ON brokers(phone_number);
CREATE INDEX idx_brokers_last_active ON brokers(last_active DESC);

-- Create properties table
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  carpet_area INT,
  built_area INT,
  bedrooms INT,
  bathrooms INT,
  location VARCHAR(255),
  address TEXT,
  asking_price BIGINT NOT NULL,
  deposit_amount BIGINT,
  price_negotiable BOOLEAN DEFAULT TRUE,
  building_age INT,
  rera_registration VARCHAR(50),
  builder_name VARCHAR(255),
  society_name VARCHAR(255),
  amenities TEXT[],
  furnishing VARCHAR(50),
  parking_type VARCHAR(50),
  financial_fit_score FLOAT DEFAULT 0.0,
  evaluation_notes TEXT,
  status VARCHAR(50) DEFAULT 'asking',
  photos TEXT[],
  videos TEXT[],
  youtube_links TEXT[],
  first_mentioned TIMESTAMPTZ DEFAULT NOW(),
  last_mentioned TIMESTAMPTZ,
  times_mentioned INT DEFAULT 1,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_properties_broker_id ON properties(broker_id);
CREATE INDEX idx_properties_asking_price ON properties(asking_price);
CREATE INDEX idx_properties_status ON properties(status);

-- Create conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  sender VARCHAR(20) NOT NULL,
  text_content TEXT NOT NULL,
  text_summary VARCHAR(500),
  message_type VARCHAR(50) NOT NULL,
  media_url VARCHAR(500),
  media_processed BOOLEAN DEFAULT TRUE,
  processing_time_ms INT,
  extracted_fields JSONB DEFAULT '{}'::JSONB,
  tokens_used INT,
  cost_cents DECIMAL(10, 2),
  model_used VARCHAR(50),
  pii_masked BOOLEAN DEFAULT TRUE,
  injection_attempt BOOLEAN DEFAULT FALSE,
  safety_flags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  turn_number INT
);

CREATE INDEX idx_conv_broker_id ON conversations(broker_id, created_at DESC);
CREATE INDEX idx_conv_timestamp ON conversations(created_at DESC);

-- Create rate_limits table
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL UNIQUE REFERENCES brokers(id) ON DELETE CASCADE,
  turn_count_today INT DEFAULT 0,
  api_calls_today INT DEFAULT 0,
  cost_cents_today DECIMAL(10, 2) DEFAULT 0.00,
  max_turns_per_day INT DEFAULT 10,
  max_api_calls_per_day INT DEFAULT 20,
  max_cost_cents_per_day DECIMAL(10, 2) DEFAULT 1500,
  last_reset_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rate_limits_broker_id ON rate_limits(broker_id);

-- Create audit_log table
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID REFERENCES brokers(id),
  conversation_id UUID REFERENCES conversations(id),
  action VARCHAR(100) NOT NULL,
  severity VARCHAR(20) DEFAULT 'info',
  details JSONB DEFAULT '{}'::JSONB,
  actor VARCHAR(50),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_severity ON audit_log(severity);

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
```

### 1.6 Start Local Stack

```bash
cd /Users/hammad/Projects/ClawBot/RealEstateBot

# Start all services
docker-compose -f docker/docker-compose.yml up -d

# Verify services are running
docker-compose ps

# Check logs
docker-compose logs -f app

# Stop services
docker-compose down
```

### 1.7 Local Testing

```bash
# Install dependencies
npm install

# Run tests
npm run test

# Check for errors
npm run lint

# Start bot in dev mode
npm run dev

# Output should show:
# ✅ WhatsApp listener initialized
# ✅ Database connected
# ✅ Vector DB connected
# 🤖 Bot ready for messages...
```

---

## 2. Production Deployment (Render + Supabase + Pinecone)

### 2.1 Create Supabase Database

```bash
# 1. Go to https://app.supabase.com
# 2. Click "New Project"
# 3. Fill in:
#    - Name: realestatebot
#    - Password: Generate strong password
#    - Region: Singapore (closest to Mumbai)
#    - Pricing: Free tier
# 4. Click "Create new project"

# Wait for provisioning (~2 min)

# 5. Get credentials:
#    - Go to Settings → API Keys
#    - Copy "Project URL" (SUPABASE_URL)
#    - Copy "anon public" key for frontend use
#    - Copy "service_role" key for backend (SECRET!)

# 6. Upload schema:
#    - Go to SQL Editor
#    - Paste content of docker/postgres-init.sql
#    - Click "Run"
```

### 2.2 Setup Pinecone (Vector DB)

```bash
# 1. Go to https://www.pinecone.io
# 2. Sign up (free tier)
# 3. Create index:
#    - Name: realestatebot
#    - Dimension: 1536 (OpenAI embeddings)
#    - Metric: cosine
#    - Environment: us-east-1

# 4. Get credentials:
#    - API Key: copy from dashboard
#    - Index Name: realestatebot
#    - Environment: us-east-1
```

### 2.3 Configure Render Deployment

```bash
# 1. Push code to GitHub
git remote add origin https://github.com/your-username/RealEstateBot.git
git push -u origin main

# 2. Go to https://render.com
# 3. Sign up, connect GitHub

# 4. Create new Web Service:
#    - Repository: RealEstateBot
#    - Branch: main
#    - Environment: Node
#    - Build command: npm install && npm run build
#    - Start command: npm start
#    - Plan: Starter ($7/month)

# 5. Add environment variables:
#    (Copy from .env.local)
#    - OPENAI_API_KEY
#    - ANTHROPIC_API_KEY
#    - SUPABASE_URL
#    - SUPABASE_KEY
#    - PINECONE_API_KEY
#    - AUTONOMOUS_MODE_START
#    - etc.

# 6. Click "Create Web Service"
# 7. Wait for build & deployment (~5 min)
```

### 2.4 Production Environment Variables

```bash
# Render → Environment Tab

NODE_ENV=production
PORT=3000

# APIs
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Database (Supabase)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGci...  # service_role key
DATABASE_URL=postgresql://postgres:password@db.supabase.co:5432/postgres

# Vector DB
PINECONE_API_KEY=xxxx-xxxx-xxxx
PINECONE_INDEX_NAME=realestatebot

# Security
WHATSAPP_SECRET=generate-random-secret-key

# Autonomous Mode
AUTONOMOUS_MODE_START=2026-03-22
AUTONOMOUS_MODE_END=2026-03-31
AUTONOMOUS_MODE_ENABLED=true

# Cost Limits
MAX_DAILY_COST_CENTS=2500
MAX_BROKER_COST_CENTS=1200
MAX_TURNS_PER_BROKER=10

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=app-specific-password
DIGEST_EMAIL=your-email@gmail.com

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Monitoring
SENTRY_DSN=https://...  # Error tracking
DATADOG_API_KEY=...      # Optional monitoring
```

### 2.5 Dockerfile for Production

```dockerfile
# docker/Dockerfile

FROM node:18-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache ffmpeg

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src
COPY config ./config

# Build
RUN npm run build

# Start
EXPOSE 3000
CMD ["npm", "start"]
```

### 2.6 Post-Deployment Checklist

```bash
# 1. Test WhatsApp Connection
curl -X POST https://your-render-url.com/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Expected: 200 OK

# 2. Check Database Connection
curl -X GET https://your-render-url.com/health
# Expected: { "status": "ok", "db": "connected" }

# 3. Test LLM Integration
curl -X POST https://your-render-url.com/test/llm \
  -d '{"message": "Hello, test message"}'
# Expected: LLM response

# 4. Verify Rate Limiter
# (Create test broker, send 11 messages, verify rejection on 11th)

# 5. Setup Error Tracking
# Sentry: https://sentry.io → Create project → Add DSN to env

# 6. Enable Monitoring
# Datadog/LogRocket: Optional, add to env

# 7. Setup Alerts
# Render → Settings → Notifications → Slack/Email
# Alert on: failed deploys, high error rate
```

---

## 3. WhatsApp Connection Setup

### 3.1 Baileys (Unofficial, Recommended)

```typescript
// src/core/whatsapp-client.ts

import makeWASocket from 'Baileys';
import { Boom } from '@hapi/boom';

export class WhatsAppClient {
  async connect() {
    const sock = makeWASocket({
      auth: this.state.creds,
      printQRInTerminal: true,  // Print QR to terminal
      browser: ['Real Estate Bot', 'Chrome', '120.0'],
      logger: pino({ level: 'silent' }),  // Suppress logs
    });

    // Handle QR code (scan with secondary SIM WhatsApp)
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 Scan QR code with secondary SIM WhatsApp:');
        console.log(qr); // Terminal will display QR
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp connected!');
      }

      if (connection === 'close') {
        const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== 401;
        if (shouldReconnect) {
          this.connect(); // Auto-reconnect
        }
      }
    });

    // Listen for messages
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        this.handleMessage(msg);
      }
    });

    return sock;
  }

  private async handleMessage(message: any) {
    const senderId = message.key.remoteJid;  // Broker's phone number
    const content = message.message?.conversation || message.message?.extendedTextMessage?.text;

    console.log(`📨 From ${senderId}: ${content}`);

    // Route to message router
    await messageRouter.process(senderId, content, message);
  }
}
```

### 3.2 First-Time QR Setup

```bash
# 1. Start bot on Render
npm start

# 2. Render logs will show QR code
# Copy QR code (terminal output)

# 3. On your phone with secondary SIM:
#    - Open WhatsApp
#    - Settings → Linked Devices
#    - Scan QR code

# 4. Bot will authenticate
# ✅ WhatsApp connected!

# 5. First message from any broker will trigger bot response
```

---

## 4. Monitoring & Maintenance

### 4.1 Health Checks

```bash
# Check bot health (every 5 min)
watch -n 300 'curl -s https://your-render-url.com/health | jq'

# Expected output:
# {
#   "status": "ok",
#   "uptime": 3600,
#   "database": "connected",
#   "whatsapp": "connected",
#   "brokers_active": 8,
#   "daily_cost": 2.34
# }
```

### 4.2 Log Monitoring

```bash
# View Render logs (real-time)
# Via Render Dashboard → Logs tab

# Or via CLI:
render logs --service realestatebot --follow

# Query specific errors:
grep "ERROR" /var/log/realestatebot.log | tail -20
```

### 4.3 Database Backups

```bash
# Automatic backups (Supabase):
# Go to Settings → Backups
# Enable daily backups (free tier includes 1 day)

# Manual backup to S3:
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz
aws s3 cp backup_$(date +%Y%m%d).sql.gz s3://your-bucket/backups/
```

### 4.4 Cost Monitoring

```bash
# Daily cost report (email)
# Runs at 8 PM IST automatically
# Queries: SELECT SUM(cost_cents) FROM conversations WHERE DATE(created_at) = TODAY;

# View in Render dashboard:
# Billing → Usage → Compute, Storage, Bandwidth
```

---

## 5. Rollback & Disaster Recovery

### 5.1 Quick Rollback

```bash
# If deployment breaks production:

# 1. Render: Go to Deployments → Previous version
#    Click "Deploy"
#    (Automatic rollback in ~2 min)

# 2. Check health:
curl https://your-render-url.com/health

# 3. Notify via error tracking (Sentry)
#    Incident auto-created
```

### 5.2 Database Recovery

```bash
# If database is corrupted:

# 1. Supabase → Backups tab
# 2. Click "Restore to point-in-time"
# 3. Select time (e.g., 1 hour ago)
# 4. Confirm restoration (~5 min)
```

---

## 6. Performance Optimization

### 6.1 Database Connection Pooling

```typescript
// config/db-config.ts

import { createPool } from 'pg';

export const pool = createPool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### 6.2 Render Auto-Scaling

```yaml
# For heavy load (50+ brokers):
# Upgrade to "Pro" plan with auto-scaling

# Render → Settings → Auto-Scaling
# Min instances: 2
# Max instances: 8
# Scale up: CPU > 70% for 5 min
# Scale down: CPU < 30% for 10 min
```

---

## Next Steps

1. ✅ **Local setup**: Run `docker-compose up -d`
2. ✅ **Test locally**: `npm run test`
3. ✅ **Deploy to Render**: Push to GitHub, connect Render
4. ✅ **Setup Supabase**: Create project, upload schema
5. ✅ **Setup Pinecone**: Free tier, create index
6. ✅ **Configure env**: Add all credentials to Render
7. ✅ **Test WhatsApp**: Scan QR code, send test message
8. ✅ **Monitor**: Check logs, health, costs daily

**Support**: See [docs/README.md](./README.md) or open an issue on GitHub.
