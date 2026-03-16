# Database Schema: Real Estate WhatsApp AI Agent

## 1. Schema Overview

PostgreSQL database (Supabase) with the following core tables:

```sql
┌──────────────────────────────────────────────────────────┐
│                    Core Tables                           │
├──────────────────────────────────────────────────────────┤
│
│  brokers (phone-based contacts)
│      ├── id (PK)
│      ├── phone_number (unique)
│      ├── name
│      ├── location_focus
│      ├── avg_price_range (inferred)
│      ├── last_active
│      ├── msg_count_today
│      ├── conversation_count
│      └── metadata (JSONB: notes, tags)
│
│  properties (curated listings)
│      ├── id (PK)
│      ├── broker_id (FK)
│      ├── carpet_area
│      ├── asking_price
│      ├── deposit_amount
│      ├── rera_registration
│      ├── building_age
│      ├── location
│      ├── amenities (array)
│      ├── status (asking, negotiating, rejected)
│      ├── score (financial fit)
│      └── created_at
│
│  conversations (message history)
│      ├── id (PK)
│      ├── broker_id (FK)
│      ├── property_id (FK)
│      ├── sender (broker|agent)
│      ├── text_content (PII-masked)
│      ├── message_type (text|voice|video|youtube|image)
│      ├── tokens_used
│      ├── cost_cents
│      ├── timestamp
│      └── metadata (JSONB: extracted_fields)
│
│  vector_embeddings (Pinecone + metadata)
│      ├── msg_id (PK in Pinecone)
│      ├── broker_id
│      ├── property_id
│      ├── text_snippet
│      ├── vector (1536-dim)
│      ├── timestamp
│      └── metadata (broker_name, location)
│
│  rate_limits (turn & cost tracking)
│      ├── id (PK)
│      ├── broker_id (FK)
│      ├── turn_count (today)
│      ├── api_calls (today)
│      ├── cost_cents (today)
│      ├── last_reset_at
│      └── max_turns (config)
│
│  audit_log (compliance & security)
│      ├── id (PK)
│      ├── broker_id
│      ├── action (msg_sent, pii_detected, injection_blocked)
│      ├── details (JSONB)
│      ├── timestamp
│      └── severity (info|warning|critical)
│
└──────────────────────────────────────────────────────────┘
```

---

## 2. Detailed Table Schemas

### 2.1 `brokers` Table

Contacts & metadata for all WhatsApp brokers.

```sql
CREATE TABLE brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,  -- e.g., "+919876543210"
  name VARCHAR(255),                         -- Broker name
  location_focus TEXT[],                     -- ['Andheri', 'Bandra', 'Marine Lines']
  total_properties_shared INT DEFAULT 0,     -- Count of shared listings
  
  -- Inferred Financial Data
  avg_asking_price BIGINT,                   -- Rolling average (in ₹)
  min_asking_price BIGINT,                   -- Minimum observed
  max_asking_price BIGINT,                   -- Maximum observed
  avg_carpet_area INT,                       -- Average size
  
  -- Engagement Tracking
  conversation_count INT DEFAULT 0,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  msg_count_today INT DEFAULT 0,             -- Reset daily (cron)
  turn_count_today INT DEFAULT 0,            -- Reset daily
  
  -- Safety & Tags
  negotiation_status VARCHAR(50),            -- 'cold', 'warm', 'hot', 'rejected'
  is_spam BOOLEAN DEFAULT FALSE,             -- Flag if broker is unreliable
  notes TEXT,                                -- Free-form notes
  metadata JSONB DEFAULT '{}'::JSONB,        -- Extensible data
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT phone_not_empty CHECK (phone_number != '')
);

CREATE INDEX idx_brokers_phone ON brokers(phone_number);
CREATE INDEX idx_brokers_last_active ON brokers(last_active DESC);
CREATE INDEX idx_brokers_turn_count ON brokers(turn_count_today);
```

---

### 2.2 `properties` Table

Real estate listings extracted from conversations.

```sql
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  
  -- Physical Attributes
  carpet_area INT,                          -- Sq. ft.
  built_area INT,                           -- Sq. ft. (if available)
  bedrooms INT,
  bathrooms INT,
  location VARCHAR(255),                    -- e.g., "Andheri West"
  address TEXT,                             -- Full address (if shared)
  
  -- Financial Data
  asking_price BIGINT NOT NULL,             -- In ₹
  deposit_amount BIGINT,                    -- Security deposit
  price_negotiable BOOLEAN DEFAULT TRUE,
  
  -- Building Info
  building_age INT,                         -- Years
  rera_registration VARCHAR(50),            -- RERA ID
  builder_name VARCHAR(255),
  society_name VARCHAR(255),
  
  -- Amenities & Features
  amenities TEXT[],                         -- ['gym', 'pool', 'parking']
  furnishing VARCHAR(50),                   -- 'unfurnished', 'semi', 'fully'
  parking_type VARCHAR(50),                 -- 'open', 'covered', 'basement'
  
  -- Deal Evaluation
  financial_fit_score FLOAT DEFAULT 0.0,    -- 0.0-1.0 (match vs. budget)
  evaluation_notes TEXT,
  status VARCHAR(50) DEFAULT 'asking',      -- 'asking', 'negotiating', 'rejected', 'selected'
  
  -- Media References
  photos TEXT[],                            -- WhatsApp media URLs
  videos TEXT[],                            -- WhatsApp video URLs
  youtube_links TEXT[],                     -- YouTube property tours
  
  -- Context
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
CREATE INDEX idx_properties_location ON properties(location);
CREATE INDEX idx_properties_carpet_area ON properties(carpet_area);
```

---

### 2.3 `conversations` Table

Complete message history with PII masking & cost tracking.

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  
  -- Message Content (PII-masked)
  sender VARCHAR(20) NOT NULL,              -- 'broker' or 'agent'
  text_content TEXT NOT NULL,               -- Original text (masked)
  text_summary VARCHAR(500),                -- For display/search
  
  -- Message Type & Processing
  message_type VARCHAR(50) NOT NULL,        -- 'text', 'voice', 'video', 'youtube', 'image'
  media_url VARCHAR(500),                   -- WhatsApp media URL (temporary)
  media_processed BOOLEAN DEFAULT TRUE,
  processing_time_ms INT,
  
  -- Extracted Data (JSON)
  extracted_fields JSONB DEFAULT '{}'::JSONB,
  -- Example:
  -- {
  --   "asking_price": 3500000,
  --   "carpet_area": 1250,
  --   "location": "Bandra",
  --   "rera_registration": "P1234567",
  --   "building_age": 5,
  --   "amenities": ["gym", "pool"],
  --   "confidence": 0.95
  -- }
  
  -- Cost & Resource Usage
  tokens_used INT,                          -- LLM tokens
  cost_cents DECIMAL(10, 2),                -- Cost in cents ($0.56 = 56)
  model_used VARCHAR(50),                   -- 'claude-sonnet', 'gpt-4o', etc.
  
  -- Safety & Audit
  pii_masked BOOLEAN DEFAULT TRUE,
  injection_attempt BOOLEAN DEFAULT FALSE,
  safety_flags TEXT[],                      -- ['pii_detected', 'injection_blocked']
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  turn_number INT,                          -- Sequential turn for rate limiting
  
  CONSTRAINT sender_valid CHECK (sender IN ('broker', 'agent')),
  CONSTRAINT type_valid CHECK (message_type IN ('text', 'voice', 'video', 'youtube', 'image'))
);

CREATE INDEX idx_conv_broker_id ON conversations(broker_id, created_at DESC);
CREATE INDEX idx_conv_property_id ON conversations(property_id);
CREATE INDEX idx_conv_timestamp ON conversations(created_at DESC);
CREATE INDEX idx_conv_type ON conversations(message_type);
CREATE UNIQUE INDEX idx_conv_media_url ON conversations(media_url) WHERE media_url IS NOT NULL;
```

---

### 2.4 `vector_embeddings` Table

Metadata for Pinecone vector entries (Pinecone stores the actual vectors).

```sql
CREATE TABLE vector_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pinecone_id VARCHAR(255) UNIQUE,         -- ID in Pinecone
  broker_id UUID NOT NULL REFERENCES brokers(id),
  property_id UUID REFERENCES properties(id),
  conversation_msg_id UUID REFERENCES conversations(id),
  
  -- Text & Embedding
  text_snippet VARCHAR(2000),              -- 200-300 chars for retrieval
  vector_dimension INT DEFAULT 1536,       -- OpenAI embedding dimension
  
  -- Indexing Metadata
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  message_role VARCHAR(20),                -- 'broker' or 'agent'
  message_type VARCHAR(50),
  
  -- Metadata for semantic search
  metadata_json JSONB DEFAULT '{}'::JSONB,
  -- Example:
  -- {
  --   "broker_name": "Rajesh Kumar",
  --   "location": "Bandra",
  --   "asking_price": 3500000,
  --   "keywords": ["4BHK", "sea view", "negotiable"]
  -- }
  
  -- Sync Status
  synced_to_pinecone BOOLEAN DEFAULT TRUE,
  last_sync TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vec_broker_id ON vector_embeddings(broker_id);
CREATE INDEX idx_vec_timestamp ON vector_embeddings(timestamp DESC);
CREATE INDEX idx_vec_pinecone_id ON vector_embeddings(pinecone_id);
CREATE INDEX idx_vec_property_id ON vector_embeddings(property_id);
```

---

### 2.5 `rate_limits` Table

Per-broker turn & cost limits (reset daily).

```sql
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL UNIQUE REFERENCES brokers(id) ON DELETE CASCADE,
  
  -- Daily Counters (reset at midnight IST)
  turn_count_today INT DEFAULT 0,          -- Messages + responses
  api_calls_today INT DEFAULT 0,           -- Total API calls
  cost_cents_today DECIMAL(10, 2) DEFAULT 0.00,
  
  -- Configuration
  max_turns_per_day INT DEFAULT 10,        -- Hard limit per broker
  max_api_calls_per_day INT DEFAULT 20,
  max_cost_cents_per_day DECIMAL(10, 2) DEFAULT 1500, -- $15/day
  
  -- Global Daily Ceiling
  total_cost_cents_all_brokers DECIMAL(10, 2) DEFAULT 0.00,
  max_total_cost_per_day DECIMAL(10, 2) DEFAULT 2500,  -- $25/day hard cap
  
  -- Timestamps
  last_reset_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rate_limits_broker_id ON rate_limits(broker_id);
```

---

### 2.6 `audit_log` Table

Compliance & security logging.

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID REFERENCES brokers(id),
  conversation_id UUID REFERENCES conversations(id),
  
  -- Event Details
  action VARCHAR(100) NOT NULL,            -- 'msg_sent', 'pii_detected', 'injection_blocked', 'rate_limit_exceeded'
  severity VARCHAR(20) DEFAULT 'info',     -- 'info', 'warning', 'critical'
  
  -- Details (JSON for extensibility)
  details JSONB DEFAULT '{}'::JSONB,
  -- Example:
  -- {
  --   "pii_type": "phone_number",
  --   "masked_value": "+91 XXXX",
  --   "original_hint": "+919..."
  -- }
  
  -- IP & Context (if applicable)
  actor VARCHAR(50),                       -- 'system', 'agent', 'broker'
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_broker_id ON audit_log(broker_id, timestamp DESC);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_severity ON audit_log(severity);
```

---

### 2.7 `autonomous_state` Table

Tracks autonomous agent state during 10-day travel window.

```sql
CREATE TABLE autonomous_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  
  -- Follow-up Queue
  requires_follow_up BOOLEAN DEFAULT FALSE,
  follow_up_reason VARCHAR(255),           -- 'physical_visit_requested', 'new_property'
  stall_response_sent BOOLEAN DEFAULT FALSE,
  stall_timestamp TIMESTAMPTZ,
  
  -- Daily Digest
  properties_found_today INT DEFAULT 0,
  negotiations_active INT DEFAULT 0,
  new_deal_flags TEXT[],                   -- 'under_budget', 'excellent_location'
  digest_priority FLOAT DEFAULT 0.5,       -- 0.0-1.0 (importance score)
  
  -- Autonomous Config
  is_autonomous BOOLEAN DEFAULT TRUE,      -- Can respond during travel?
  pause_after_march_31 BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  last_follow_up TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_autonomous_broker_id ON autonomous_state(broker_id);
CREATE INDEX idx_autonomous_requires_followup ON autonomous_state(requires_follow_up);
```

---

## 3. Views & Aggregations

### 3.1 Broker Summary View

```sql
CREATE VIEW broker_summary AS
SELECT
  b.id,
  b.phone_number,
  b.name,
  COUNT(DISTINCT p.id) as total_properties,
  COUNT(DISTINCT c.id) as total_messages,
  SUM(CASE WHEN c.sender = 'agent' THEN 1 ELSE 0 END) as agent_messages,
  SUM(CASE WHEN c.sender = 'broker' THEN 1 ELSE 0 END) as broker_messages,
  SUM(c.cost_cents) / 100.0 as total_cost_usd,
  MAX(b.last_active) as last_message_time,
  b.negotiation_status
FROM brokers b
LEFT JOIN properties p ON b.id = p.broker_id
LEFT JOIN conversations c ON b.id = c.broker_id
GROUP BY b.id, b.phone_number, b.name, b.negotiation_status;
```

### 3.2 Property Rankings View

```sql
CREATE VIEW property_rankings AS
SELECT
  p.id,
  p.broker_id,
  b.name as broker_name,
  p.asking_price,
  p.carpet_area,
  p.location,
  p.financial_fit_score,
  COUNT(DISTINCT c.id) as mention_count,
  MAX(c.created_at) as last_mentioned,
  CASE
    WHEN p.status = 'selected' THEN 1
    WHEN p.status = 'negotiating' THEN 0.8
    WHEN p.status = 'asking' THEN 0.5
    ELSE 0.2
  END * p.financial_fit_score as final_score
FROM properties p
LEFT JOIN brokers b ON p.broker_id = b.id
LEFT JOIN conversations c ON p.id = c.property_id
GROUP BY p.id, b.name, p.asking_price, p.carpet_area, p.location, p.financial_fit_score, p.status
ORDER BY final_score DESC;
```

---

## 4. Indexes & Query Optimization

### Critical Indexes

```sql
-- Broker lookups (frequent)
CREATE INDEX CONCURRENTLY idx_brokers_phone_hash ON brokers USING HASH (phone_number);

-- Conversation retrieval (frequent & large table)
CREATE INDEX CONCURRENTLY idx_conv_broker_created ON conversations(broker_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_conv_type_broker ON conversations(message_type, broker_id);

-- Property searches
CREATE INDEX CONCURRENTLY idx_prop_price_range ON properties(asking_price);
CREATE INDEX CONCURRENTLY idx_prop_area_range ON properties(carpet_area);
CREATE INDEX CONCURRENTLY idx_prop_location_status ON properties(location, status);

-- Rate limit checks (hot path)
CREATE INDEX CONCURRENTLY idx_rate_limits_broker ON rate_limits(broker_id);

-- Audit trail searches
CREATE INDEX CONCURRENTLY idx_audit_timestamp_severity ON audit_log(timestamp DESC, severity);

-- Vector DB sync
CREATE INDEX CONCURRENTLY idx_vec_sync_status ON vector_embeddings(synced_to_pinecone, last_sync DESC);
```

---

## 5. Data Types & Constraints

### Key Decisions

| Field | Type | Rationale |
|-------|------|-----------|
| `id` | UUID | Distributed, partition-friendly |
| `phone_number` | VARCHAR(20) | International format |
| `asking_price` | BIGINT | Avoid float rounding errors (₹) |
| `cost_cents` | DECIMAL(10,2) | Precise currency handling |
| `metadata` | JSONB | Extensible, queryable |
| `created_at` | TIMESTAMPTZ | Timezone-aware, audit trail |
| `extracted_fields` | JSONB | Variable extraction results |

---

## 6. Data Lifecycle & Archival

### Retention Policy

```
- Conversations: Keep 90 days (archive to S3)
- Audit logs: Keep 180 days (compliance)
- Properties: Keep indefinitely (deal tracking)
- Brokers: Keep indefinitely (historical)
- Vector embeddings: Delete after conversation archival
```

### Archival SQL

```sql
-- Archive old conversations (run daily)
INSERT INTO conversations_archive
SELECT * FROM conversations
WHERE created_at < NOW() - INTERVAL '90 days';

DELETE FROM conversations
WHERE created_at < NOW() - INTERVAL '90 days';

-- Cleanup vector embeddings
DELETE FROM vector_embeddings
WHERE conversation_msg_id IN (
  SELECT id FROM conversations
  WHERE created_at < NOW() - INTERVAL '90 days'
);
```

---

## 7. Backup & Disaster Recovery

### Supabase Backups

- **Automatic daily backups** (Supabase manages)
- **Point-in-time recovery** available
- **Export to S3** for long-term storage

### Manual Backup Script

```bash
# Backup PostgreSQL (run daily)
pg_dump "postgresql://user:pass@db.supabase.co/postgres" \
  --exclude-table=vector_embeddings \
  > backup_$(date +%Y%m%d).sql

# Compress
gzip backup_$(date +%Y%m%d).sql
```

---

## 8. Sample Queries

### Find Top Brokers by Deal Quality

```sql
SELECT
  b.id,
  b.name,
  COUNT(DISTINCT p.id) as total_properties,
  AVG(p.financial_fit_score) as avg_fit_score,
  SUM(CASE WHEN p.status = 'selected' THEN 1 ELSE 0 END) as selected_count
FROM brokers b
LEFT JOIN properties p ON b.id = p.broker_id
GROUP BY b.id, b.name
ORDER BY selected_count DESC, avg_fit_score DESC
LIMIT 10;
```

### Properties Within Budget & Timeframe

```sql
SELECT
  p.*,
  b.name as broker_name,
  COUNT(c.id) as mention_count
FROM properties p
LEFT JOIN brokers b ON p.broker_id = b.id
LEFT JOIN conversations c ON p.id = c.property_id
WHERE
  p.asking_price BETWEEN 3000000 AND 5000000  -- Your budget
  AND p.carpet_area BETWEEN 1000 AND 1500     -- Your size
  AND p.location IN ('Bandra', 'Andheri', 'Worli')  -- Preferred areas
  AND p.status IN ('asking', 'negotiating')
  AND p.first_mentioned > NOW() - INTERVAL '7 days'
GROUP BY p.id, b.name
ORDER BY p.financial_fit_score DESC;
```

### Cost Analysis (Daily)

```sql
SELECT
  DATE(c.created_at) as day,
  COUNT(DISTINCT c.broker_id) as brokers_engaged,
  COUNT(*) as total_messages,
  SUM(c.cost_cents) / 100.0 as total_cost_usd,
  AVG(c.tokens_used) as avg_tokens,
  SUM(CASE WHEN c.safety_flags != '{}' THEN 1 ELSE 0 END) as safety_flags_triggered
FROM conversations c
GROUP BY DATE(c.created_at)
ORDER BY day DESC;
```

---

## 9. Implementation Notes

### Connection Pooling (Supabase)

```typescript
// Supabase uses built-in connection pooling
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!,
  {
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: false,
    },
  }
);
```

### Transaction Handling (Multi-step ops)

```typescript
// Insert broker + property + conversation atomically
const { data, error } = await supabase
  .from('conversations')
  .insert({
    broker_id: brokerId,
    property_id: propertyId,
    sender: 'agent',
    text_content: maskedText,
    message_type: 'text',
    extracted_fields: extractedData,
    tokens_used: usedTokens,
    cost_cents: costValue,
  })
  .select()
  .single();

if (error) throw error;
```

---

## Next Steps

1. Run schema migrations: `psql -f docker/postgres-init.sql`
2. Set up Supabase: [docs/DEPLOYMENT.md](./DEPLOYMENT.md)
3. Create indexes before production use
4. Test backup & recovery process
