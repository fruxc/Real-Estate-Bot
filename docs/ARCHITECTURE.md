# System Architecture: Real Estate WhatsApp AI Agent

## 1. System Overview

This document provides a comprehensive architectural overview of the Real Estate WhatsApp AI Agent system, detailing the ingestion, routing, LLM processing, and persistence layers.

### Core Design Principles

- **Asynchronous & Non-Blocking**: All I/O operations (DB, API, WhatsApp) are non-blocking
- **Modular Routing**: Media types (text, voice, video, links) routed through specialized pipelines
- **Memory-Aware**: Vector DB + structured DB maintain conversation context across days
- **Cost-Optimized**: Frame sampling for videos, free transcript APIs, selective LLM calls
- **Safety-First**: Multi-layer defense against injection, PII leaks, and cost overruns

---

## 2. Architecture Layers

### 2.1 Ingestion Layer

```
┌─────────────────────────────────────────────────────────┐
│          WhatsApp Client (Baileys/whatsapp-web.js)      │
│                                                          │
│  - Maintains secondary SIM connection                   │
│  - Listens for incoming messages (text, audio, video)   │
│  - Maintains contact metadata (broker phone + name)     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
            ┌─────────────────┐
            │ Message Listener │
            │  Event Handler   │
            └────────┬─────────┘
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
    [Webhook]    [Polling]   [Event Emitter]
    (optional)   (reliable)   (real-time)
```

**Implementation**: See [src/core/whatsapp-client.ts](../src/core/whatsapp-client.ts)

---

### 2.2 Message Routing Layer

```
┌─────────────────────────────────────────────────────────┐
│            Message Router & Classifier                   │
│                                                          │
│  Determine message type & origin                        │
└────────────────┬────────────────────────────────────────┘
                 │
    ┌────────────┼────────────┬──────────────┬──────────┐
    │            │            │              │          │
    ↓            ↓            ↓              ↓          ↓
[Plain Text] [Voice Note] [Video MP4]  [URL Link]  [Image]
    │            │            │              │          │
    │            │            │              │          │
    ↓            ↓            ↓              ↓          ↓
  [Direct]  [Whisper]   [FFmpeg+        [YT API    [Vision
   Pass     Transcribe]  Whisper]    or Fallback]  Classify]
```

**Key Logic**:
- **text**: Regex checks for URLs (YouTube, Instagram, Twitter, etc.)
- **audio**: MIME type check → download → Whisper transcription
- **video**: MIME type check → download → FFmpeg extract audio → Whisper
- **image**: Regex checks for captions → Vision API classification
- **urls**: Domain parsing → YouTube API, fallback to conversational stall

**Implementation**: See [src/core/message-router.ts](../src/core/message-router.ts)

---

### 2.3 Media Pipeline Layer

#### 2.3.1 Video Pipeline (MP4/MOV → Text)

```
┌──────────────────────────────────────┐
│      Incoming Video File (MP4/MOV)   │
│      e.g., property tour, walkthrough│
└──────────────┬───────────────────────┘
               │
               ↓
    ┌──────────────────────┐
    │  FFmpeg Audio Extract │
    │  ffmpeg -i input.mp4 \│
    │  -vn -acodec pcm_s16le│
    │  -ar 44100 -ac 2     │
    │  output.wav          │
    └──────────┬───────────┘
               │
               ↓
    ┌──────────────────────┐
    │  FFmpeg Frame Sample  │
    │  Extract 1 keyframe @ │
    │  00:00:01 (cost opt)  │
    └──────────┬───────────┘
               │
         ┌─────┴─────┐
         ↓           ↓
    [Whisper]   [Vision API]
    Transcribe   Classify
    Audio        Frame
         │           │
         └─────┬─────┘
               ↓
    ┌──────────────────────┐
    │   Text Normalization  │
    │   Merge audio text +  │
    │   image description   │
    └──────────┬───────────┘
               ↓
    [Continue to Security Layer]
```

**Cost Optimization**:
- Single frame @ 1% of the video time → reduces Vision API calls by ~100x
- Audio extraction local → Whisper only charges for audio duration
- Average property video: 2-5 min audio = $0.04-0.10 cost

**Implementation**: See [src/pipelines/video-pipeline.ts](../src/pipelines/video-pipeline.ts)

---

#### 2.3.2 YouTube Pipeline (URL → Transcript → Context)

```
┌──────────────────────────────────────┐
│    Incoming YouTube Link             │
│    e.g., "https://youtube.com/...    │
│    property tour, location vlog"      │
└──────────┬───────────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  youtube-transcript-api          │
│  Extract auto-generated caption  │
│  (ZERO COST, no API key needed)  │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Text Normalization + Chunking   │
│  Split into 500-token segments   │
│  (for context window limits)     │
└──────────┬───────────────────────┘
           │
           ↓
[Continue to LLM for extraction]
```

**Benefits**:
- Avoids downloading entire video
- No vision processing (transcript is text-only)
- Completely free (no YouTube API quota charges)
- Instant availability for older videos

**Fallback Strategy**:
- If transcript unavailable: graceful message to broker
  - *"Thanks for the link! I couldn't load the video, but can you text me the key details? (location, size, price, age)"*

**Implementation**: See [src/pipelines/youtube-pipeline.ts](../src/pipelines/youtube-pipeline.ts)

---

#### 2.3.3 Social Media Fallback (Instagram, Twitter, etc.)

```
┌──────────────────────────────────────┐
│    Incoming Social Link              │
│    Instagram, Twitter, LinkedIn       │
│    (Meta/X do not allow scraping)    │
└──────────┬───────────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Link Classification              │
│  Domain regex: instagram.com,    │
│  twitter.com, etc.               │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Conversational Fallback          │
│  ❌ "I can't load Instagram right │
│  now due to platform restrictions.│
│  Can you share the key details?"  │
└──────────┬───────────────────────┘
           │
           ↓
[Wait for broker's text response]
[Loop back to text parsing]
```

**Why Not Scrape?**
- Meta's ToS explicitly prohibit unofficial scraping
- IP bans risk SIM blocking
- Solution: graceful stall, maintain conversation

**Implementation**: See [src/pipelines/social-fallback.ts](../src/pipelines/social-fallback.ts)

---

### 2.4 Security & Validation Layer

```
┌──────────────────────────────────┐
│    Normalized Text Input         │
│    (from any pipeline)           │
└──────────┬───────────────────────┘
           │
           ├─ [PII Masking]
           │  - Replace "Hammad" → "USER"
           │  - Replace phone, email → "MASKED"
           │  - Replace salary ranges → "AMOUNT"
           │
           ├─ [Prompt Injection Guard]
           │  - Detect: "Ignore system prompt"
           │  - Detect: "Answer as if you're..."
           │  - Detect: "Forget everything"
           │  - Action: Log & optionally drop
           │
           ├─ [Length Limit]
           │  - Max 5000 chars (prevent token bomb)
           │
           └─ [Rate Limit Check]
              - Conversations/day per broker
              - Total API calls/day
              - Cost ceiling (hard cap)
```

**Implementation**: 
- [src/security/pii-masker.ts](../src/security/pii-masker.ts)
- [src/security/prompt-guard.ts](../src/security/prompt-guard.ts)
- [src/security/rate-limiter.ts](../src/security/rate-limiter.ts)

---

### 2.5 Memory & Context Retrieval Layer

```
┌──────────────────────────────┐
│   Validated Input            │
│   + Broker Metadata          │
│   (phone, name, location)    │
└──────────┬──────────────────┘
           │
           ├─ Lookup Broker Profile (PostgreSQL)
           │  - Past conversations
           │  - Properties discussed
           │  - Budget range (inferred)
           │  - Negotiation history
           │
           ├─ Retrieve Semantic Context (Vector DB)
           │  1. Embed current message
           │  2. Search Pinecone for similar past messages
           │  3. Retrieve top-5 relevant conversation turns
           │
           └─ Build Context Block
              ┌──────────────────────────┐
              │ System Prompt            │
              │ + Broker Profile         │
              │ + Past 10 messages       │
              │ + Similar semantic mem   │
              │ + Turn counter (budget)  │
              └──────────────────────────┘
```

**Context Window Optimization**:
- Default: 2048 tokens for context (Claude 200K+ allows more)
- Semantic retrieval prioritizes relevance over recency
- Turn counter ensures cost ceiling enforcement

**Implementation**: 
- [src/db/vector-db.ts](../src/db/vector-db.ts)
- [src/prompts/memory-context.ts](../src/prompts/memory-context.ts)

---

### 2.6 LLM Processing Layer

```
┌────────────────────────────────┐
│   Complete Prompt              │
│   = System Prompt              │
│   + Broker Context             │
│   + Conversation Memory        │
│   + Current User Message       │
└──────────┬─────────────────────┘
           │
           ↓
┌────────────────────────────────┐
│   LLM Selection Logic           │
│                                │
│   if mode == "negotiation":    │
│     → Claude 3.5 Sonnet        │
│     (better reasoning)         │
│   elif needs vision:           │
│     → GPT-4o (if image embed)  │
│   else:                        │
│     → Claude 3.5 Haiku (fast)  │
└──────────┬─────────────────────┘
           │
           ↓
┌────────────────────────────────┐
│   API Call                     │
│   messages.create() via SDK    │
│   temperature: 0.7             │
│   max_tokens: 500              │
│   stop: ["Broker:", "Me:"]     │
└──────────┬─────────────────────┘
           │
           ↓
┌────────────────────────────────┐
│   Response Generation          │
│   Streaming if > 200 tokens    │
│   Real-time typing indicator   │
└──────────┬─────────────────────┘
           │
           ↓
┌────────────────────────────────┐
│   PII Re-masking               │
│   Replace "USER" → "Hammad"?   │
│   (or keep masked in DB)       │
└──────────┬─────────────────────┘
           │
           ↓
[WhatsApp Response Queue]
```

**Model Selection Matrix**:

| Scenario | Model | Reason |
|----------|-------|--------|
| Negotiation/reasoning | Claude 3.5 Sonnet | Superior reasoning, evasiveness |
| Image included | GPT-4o | Multimodal native support |
| Fast/cheap follow-up | Claude Haiku | 50% cheaper, 80% capable |
| Video text extraction | Claude Sonnet | Dense text parsing |

**Implementation**: See [src/core/llm-engine.ts](../src/core/llm-engine.ts)

---

### 2.7 Persistence & State Layer

```
┌────────────────────────────────┐
│   LLM Response Generated       │
└──────────┬─────────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ↓             ↓
[PostgreSQL]  [Pinecone]
│             │
├─ Store:    ├─ Embed response
│  - msg_id  │
│  - broker_ ├─ Upsert to vector DB
│    id      │  (timestamp: current)
│  - text    │
│  - role    ├─ Enable semantic search
│  - tokens  │  for future conversations
│  - cost    │
│  - timestamp
│
├─ Update broker profile
│  - last_active
│  - msg_count (for turn limit)
│  - inferred_budget
│  - negotiation_status
│
├─ Update property properties
│  - asking_price (if extracted)
│  - carpet_area (if extracted)
│  - rera_registration (if extracted)
│  - location (if extracted)
│  - building_age (if extracted)
│
└─ Log to audit trail
   - timestamp
   - broker_id
   - message_hash
   - cost_used
   - safety_flags (if any)
```

**Database Implementation**: See [src/db/schema.sql](../src/db/schema.sql)

---

## 3. Data Flow Diagrams

### 3.1 Complete Message Lifecycle

```
1. Incoming Message
   └─→ Message Router (type detection)
       ├─→ [Text] → Direct to security layer
       ├─→ [Audio] → Whisper transcription
       ├─→ [Video] → FFmpeg + Whisper + Vision
       ├─→ [URL] → YouTube API / Social fallback
       └─→ [Image] → Vision classification
           │
           └─→ Normalize Text
               └─→ PII Masking
                   └─→ Prompt Guard (injection defense)
                       └─→ Rate Limit Check
                           └─→ Vector DB Retrieval (context)
                               └─→ DB Lookup (broker profile)
                                   └─→ Build Complete Prompt
                                       └─→ LLM Processing (Claude/GPT)
                                           └─→ Generate Response
                                               └─→ PII Re-masking
                                                   └─→ WhatsApp Send
                                                       └─→ Store in DB
                                                           └─→ Upsert Vector DB
                                                               └─→ Update Broker State
```

### 3.2 Autonomous Agent Loop (March 22-31)

```
[Daily Cron: 9 AM, 3 PM, 8 PM]
│
└─→ Fetch brokers with pending follow-ups
    │
    └─→ For each broker:
        ├─→ Check if 10-day window active (AUTONOMOUS_MODE_START)
        ├─→ Check if turn limit allows conversation
        │
        └─→ If physical visit requested:
            │
            └─→ Generate stall response
                ├─→ "I'm traveling until the 31st, can we schedule after?"
                ├─→ Store as follow-up for April 1
                └─→ Don't count against turn limit
        │
        └─→ If new property data available:
            │
            └─→ Extract details (price, area, location)
            ├─→ Compare against inferred budget
            ├─→ Add to daily digest
            └─→ Queue response (if within turn limit)
            │
            └─→ Generate daily digest (8 PM cron)
                ├─→ Compile all new properties
                ├─→ Score by deal quality
                ├─→ Flag for post-travel follow-up
                └─→ Send to your email / private channel
```

**Implementation**: See [src/agents/follow-up-agent.ts](../src/agents/follow-up-agent.ts)

---

## 4. Technology Stack & Dependencies

### Backend Runtime
- **Node.js 18+** (async/await, Streams API)
- **TypeScript** (type safety, LSP support)

### Key Libraries

```json
{
  "dependencies": {
    "whatsapp-web.js": "^1.x",           // WhatsApp client
    "baileys": "^latest",                // Alternative WhatsApp client
    "axios": "^latest",                  // HTTP client
    "openai": "^latest",                 // Claude + Whisper
    "youtube-transcript-api": "^latest", // Free transcripts
    "ffmpeg-static": "^latest",          // Video processing
    "fluent-ffmpeg": "^latest",          // FFmpeg wrapper
    "@pinecone-database/pinecone": "latest", // Vector DB
    "@supabase/supabase-js": "latest",   // PostgreSQL client
    "dotenv": "^latest",                 // Env config
    "pino": "^latest",                   // Structured logging
    "uuid": "^latest",                   // Unique IDs
    "date-fns": "^latest"                // Date utilities
  }
}
```

---

## 5. Deployment Architecture

### 5.1 Local Development (Docker Compose)

```
┌────────────────────────────────────┐
│       Docker Compose Stack         │
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Node.js App (Port 3000)     │  │
│  │  - WhatsApp listener         │  │
│  │  - Media processors          │  │
│  │  - LLM orchestration         │  │
│  └──────────────────────────────┘  │
│              │                      │
│  ┌───────────┴──────────┐           │
│  │                      │           │
│  ↓                      ↓           │
│┌──────────────┐  ┌──────────────┐  │
││ PostgreSQL   │  │  Redis Cache │  │
││ (Port 5432)  │  │  (Port 6379) │  │
││ - Brokers    │  │  - Sessions  │  │
││ - Properties │  │  - Counters  │  │
││ - Messages   │  │  - Rate limit│  │
│└──────────────┘  └──────────────┘  │
│                                    │
│  [Offline mode - NO external APIs] │
│  Pinecone disabled for local dev   │
│                                    │
└────────────────────────────────────┘
```

### 5.2 Production Deployment (Cloud)

```
┌───────────────────────────────────────┐
│         Render (Hosting)              │
│       $7/month (starter)              │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  Node.js Container              │  │
│  │  - WhatsApp listener (Baileys) │  │
│  │  - Autoscales on queue depth   │  │
│  │  - Health checks every 30s     │  │
│  └─────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
    ↓          ↓          ↓
┌──────────┐ ┌──────────┐ ┌──────────┐
│Supabase  │ │ Pinecone │ │ OpenAI   │
│PostgreSQL│ │ Vector DB│ │ API Keys │
│$0 (free) │ │$0 (free) │ │(PAYG)    │
│          │ │100K vecs │ │$10-20/mo │
└──────────┘ └──────────┘ └──────────┘
```

**Why This Stack?**
- **Render**: Cheapest Node.js hosting with free tier options
- **Supabase**: Generous free tier (500MB, 50K connections)
- **Pinecone**: Free tier (100K vectors, 1GB storage)
- **OpenAI**: Pay-as-you-go, no monthly minimum

---

## 6. Cost Optimization Strategies

### Per-Message Costs

| Component | Cost | Optimization |
|-----------|------|--------------|
| Text message | $0.003 | Pass-through, minimal LLM cost |
| Voice (2 min) | $0.04 | Whisper cheaper than speech APIs |
| Video (3 min) | $0.06 | Sample 1 frame + audio only |
| YouTube | $0.00 | Free transcript API |
| Vision (1 image) | $0.01 | Low-res mode for properties |
| LLM response (200 tokens) | $0.003 | Sonnet cheaper than GPT-4 |
| **Total/message** | **~$0.10-0.12** | **Budget: $2-3/day per broker** |

### Turn Limits

- **Per broker/day**: 10 turns (questions + answers)
- **Per day total**: 100 turns (10 brokers max)
- **Cost ceiling**: $12-15/day hard cap
- **Turn cost tracking**: Logged in `msg_costs` table

---

## 7. Security Architecture

See [docs/SAFETY.md](./SAFETY.md) for comprehensive security details.

**Quick Summary**:
- PII masking removes name, phone, salary before storage
- Prompt guard detects injection with regex + semantic patterns
- Rate limiter enforces API call ceiling
- Audit logging tracks all interactions with timestamps
- Local mode requires zero external credentials

---

## 8. Monitoring & Observability

### Logging Strategy

```
All events logged to Pino JSON logger:
{
  "timestamp": "2026-03-16T10:30:00Z",
  "level": "info",
  "broker_id": "62a8b3c1",
  "msg": "Negotiation response sent",
  "context": {
    "property_id": "prop_123",
    "asking_price": 3500000,
    "response_tokens": 187,
    "cost_cents": 0.56,
    "cumulative_cost_today": 12.34
  }
}
```

### Metrics

- **Latency**: Message → Response (target: < 30 seconds)
- **Cost tracking**: Total API spend vs. budget ceiling
- **Engagement**: Messages/day per broker, turn utilization
- **Deal extraction**: Properties found, price negotiations, closed deals

**Implementation**: See [src/core/logger.ts](../src/core/logger.ts)

---

## 9. Scalability Considerations

### Current Architecture Limits

- **Single-thread WhatsApp listener**: Up to 5 concurrent conversations
- **API rate limits**: OpenAI (3,500 RPM), Pinecone (1K QPS)
- **Database**: Supabase free tier (50K concurrent connections)

### Scaling to 50+ Brokers

1. **Horizontal scaling**: Deploy multiple Render containers with load balancer
2. **Message queue**: Add Bull/RabbitMQ for async processing
3. **Distributed vector DB**: Move to Pinecone paid tier
4. **Multi-SIM support**: Rotate between secondary SIM numbers for rate limit evasion

---

## 10. API Integrations Summary

| API | Purpose | Cost | Auth |
|-----|---------|------|------|
| Claude API | LLM core | PAYG ($0.003/msg) | API Key |
| OpenAI Whisper | Voice transcription | PAYG ($0.02/min) | API Key |
| YouTube Transcript | Property tour transcripts | Free | None |
| Pinecone | Vector storage & retrieval | Free (100K) | API Key |
| Supabase | PostgreSQL database | Free (500MB) | API Key |
| Baileys/whatsapp-web.js | WhatsApp client | Free (unofficial) | SIM card |

---

## Next Steps

1. **Review [SCHEMA.md](./SCHEMA.md)** for database design
2. **Review [VIDEO-ROUTING.md](./VIDEO-ROUTING.md)** for media pipeline details
3. **Review [SYSTEM-PROMPT.md](./SYSTEM-PROMPT.md)** for negotiation tactics
4. **Review [DEPLOYMENT.md](./DEPLOYMENT.md)** for setup instructions
