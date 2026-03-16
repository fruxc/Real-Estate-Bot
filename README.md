# Real Estate WhatsApp AI Agent

A highly autonomous, multimodal AI agent for sourcing, filtering, and negotiating real estate properties in Mumbai via WhatsApp. Runs on autopilot with advanced safety guardrails, cost optimization, and a dedicated 10-day high-autonomy window.

## 🚀 Key Features

- **Multimodal Processing**: Voice notes (Whisper), image classification (Vision API), video extraction
- **YouTube & Social Fallback**: Auto-extract transcripts; gracefully handle Instagram/blocked sources
- **Advanced Negotiation**: LLM-driven pressure tactics with evasive budget disclosure
- **Autonomous Operation**: 10-day autopilot window (March 22-31) with daily digest compilation
- **Safety & Security**: PII masking, prompt injection defense, API cost ceilings
- **Vector DB Memory**: Conversational context across multiple days
- **Broker & Property Tracking**: Structured database schema for deal evaluation

## 📋 Tech Stack

| Component | Choice | Reasoning |
|-----------|--------|-----------|
| **WhatsApp Integration** | Baileys / whatsapp-web.js | Avoid Meta API restrictions, use secondary SIM |
| **LLM** | Claude 3.5 Sonnet (or GPT-4o for vision) | Advanced reasoning, vision multimodal capability |
| **Voice/Audio** | OpenAI Whisper | Fast, accurate speech-to-text, low cost |
| **Vision** | Claude Vision or GPT-4o Vision | Image classification, property inspection |
| **Vector DB** | Pinecone (free tier) or Qdrant (self-hosted) | Semantic search, conversation memory |
| **Database** | PostgreSQL + Supabase | Structured schema, real-time sync, affordable |
| **Video Processing** | FFmpeg (local) | MP4 audio extraction, frame sampling |
| **YouTube Transcripts** | youtube-transcript-api | Free transcript extraction |
| **Backend Runtime** | Node.js / TypeScript | Event-driven, non-blocking I/O |
| **Hosting (Production)** | Render + Supabase + Pinecone Free | $0-20/month startup tier |
| **Hosting (Dev/Test)** | Docker Compose (local) | Offline development, cost-free testing |

## 📂 Project Structure

```
RealEstateBot/
├── src/
│   ├── core/
│   │   ├── whatsapp-client.ts       # Baileys/whatsapp-web.js wrapper
│   │   ├── message-router.ts        # Route msg by type (text/media/video)
│   │   ├── llm-engine.ts            # Claude/GPT integration
│   │   └── broker-state.ts          # Broker session manager
│   ├── pipelines/
│   │   ├── video-pipeline.ts        # MP4 → audio extract → Whisper
│   │   ├── youtube-pipeline.ts      # YouTube link → transcript → LLM
│   │   ├── image-pipeline.ts        # Image → vision classification
│   │   ├── social-fallback.ts       # IG/Twitter/etc graceful stall
│   │   └── media-router.ts          # Dispatcher for all media types
│   ├── db/
│   │   ├── schema.sql               # PostgreSQL schema (brokers, properties, convs)
│   │   ├── db-client.ts             # Supabase/PostgreSQL wrapper
│   │   ├── vector-db.ts             # Pinecone/Qdrant integration
│   │   └── models.ts                # TypeScript types
│   ├── security/
│   │   ├── pii-masker.ts            # PII redaction rules
│   │   ├── prompt-guard.ts          # Prompt injection defense
│   │   ├── rate-limiter.ts          # API call & turn ceiling
│   │   └── compliance.ts            # Audit logging
│   ├── prompts/
│   │   ├── negotiation-system.md    # Main negotiation system prompt
│   │   ├── safety-guardrails.md     # Safety instructions
│   │   └── memory-context.ts        # Dynamic context builder
│   ├── agents/
│   │   ├── follow-up-agent.ts       # Autonomous follow-up handler
│   │   └── digest-compiler.ts       # Daily digest generation
│   └── index.ts                      # Main entry point
├── config/
│   ├── env.example                   # Environment template
│   ├── llm-config.ts                 # LLM model selection
│   └── db-config.ts                  # Database credentials
├── docker/
│   ├── Dockerfile                    # Production image
│   ├── docker-compose.yml            # Local dev env
│   └── postgres-init.sql             # DB initialization
├── docs/
│   ├── ARCHITECTURE.md               # System design & flow diagrams
│   ├── SCHEMA.md                     # Database schema details
│   ├── VIDEO-ROUTING.md              # Media pipeline logic
│   ├── SYSTEM-PROMPT.md              # Complete prompt structure
│   ├── COST-ANALYSIS.md              # Detailed cost breakdown
│   ├── DEPLOYMENT.md                 # Production & local setup
│   └── SAFETY.md                     # Security & PII handling
├── tests/
│   ├── media-pipeline.test.ts        # Video/audio processing tests
│   ├── llm-integration.test.ts       # LLM & negotiation tests
│   └── security.test.ts              # Safety guardrail tests
├── package.json
├── tsconfig.json
└── .env.local (git-ignored)
```

## 🏗️ System Architecture

### High-Level Flow

```
WhatsApp Message (Text/Audio/Video/Link)
         ↓
    [Message Router]
         ↓
   ┌────┴────┬────────┬──────────┬────────┐
   ↓         ↓        ↓          ↓        ↓
[Text]  [Voice]  [Video]    [YouTube]  [Image/IG]
   ↓         ↓        ↓          ↓        ↓
[Direct]  [Whisper][FFmpeg+  [API]   [Vision/
   ↓       Whisper]  Whisper]  ↓       Fallback]
   ├─────────┴────────┴─────────┴────────┤
   ↓
[Text Normalization + PII Masking]
   ↓
[Prompt Guard (Injection Defense)]
   ↓
[Vector DB Retrieval (Conversation Memory)]
   ↓
[Rate Limiter Check (Cost/Turn Ceiling)]
   ↓
[LLM Engine (Claude/GPT with System Prompt)]
   ↓
[Response Generation + PII Re-masking]
   ↓
[WhatsApp Client → Send Reply]
   ↓
[Store Conversation + Vector Embedding]
   ↓
[Update Broker/Property State]
   ↓
[Autonomous Agent Check (If 10-day window active)]
         ↓
    [Follow-up Queue]
    ↓     ↓     ↓
  [Next] [Stall] [Digest]
```

## 🎯 Quick Start

### Local Development (Docker)

```bash
# Clone and navigate
cd /Users/hammad/Projects/ClawBot/RealEstateBot

# Copy env template
cp config/env.example .env.local

# Edit .env.local with your API keys (optional for local testing)
# Start local stack
docker-compose -f docker/docker-compose.yml up -d

# Install dependencies
npm install

# Run tests
npm run test

# Start bot in local mode
npm run dev
```

### Production Deployment (Render + Supabase + Pinecone)

1. **Database**: Create Supabase project (free tier)
2. **Vector DB**: Sign up for Pinecone (free tier, 3-month trial)
3. **Hosting**: Deploy to Render (Docker container, $7/month)
4. **Secrets**: Store API keys in Render environment
5. **See `docs/DEPLOYMENT.md` for step-by-step**

## 💰 Cost Breakdown (Monthly)

| Service | Cost | Notes |
|---------|------|-------|
| Supabase (PostgreSQL) | $0 | Free tier, 500MB storage |
| Pinecone (Vector DB) | $0 | Free tier, 100K vectors |
| Render (Hosting) | $7 | 0.5 CPU, 512MB RAM |
| OpenAI Whisper | ~$1-5 | ~100 voice messages @ $0.02/min |
| Claude API | ~$10-20 | ~500 conversations @ $0.003/msg |
| YouTube API | $0 | Free (transcript extraction) |
| **Total** | **~$20-35** | Highly scalable, minimal overhead |

## 🔒 Security Features

1. **PII Masking**: Hardcoded rules redact your name, employer, financials
2. **Prompt Injection**: Pre-processing layer detects adversarial commands
3. **API Rate Limiting**: Hard ceiling on conversations/day per broker
4. **Audit Logging**: All interactions logged with timestamps
5. **Offline Capability**: Local Docker stack requires zero cloud credentials

## 📖 Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Complete system design with flow diagrams
- [SCHEMA.md](docs/SCHEMA.md) — Database tables, relationships, indexing strategy
- [VIDEO-ROUTING.md](docs/VIDEO-ROUTING.md) — Media pipeline logic & fallback handling
- [SYSTEM-PROMPT.md](docs/SYSTEM-PROMPT.md) — Negotiation tactics & safety guardrails
- [COST-ANALYSIS.md](docs/COST-ANALYSIS.md) — Detailed cost breakdown & optimization
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Local + production setup guide
- [SAFETY.md](docs/SAFETY.md) — Security policies & compliance

## 🎮 Key Behaviors

### Negotiation Mode
- Pressures brokers for lowest asking price *first*
- Evasive about your maximum budget
- Evaluates deals against backend financial criteria
- Maintains conversational flow while extracting data

### Autonomous Mode (March 22-31)
- Responds to follow-ups automatically
- Stalls on physical visit requests gracefully
- Compiles daily digest of new properties & negotiations
- Respects conversation turn limits to control costs

### Safety Mode
- Never reveals your full name or exact employer
- Detects & blocks prompt injection attempts
- Logs all conversations for audit trail
- Gracefully handles social media links (Instagram, Twitter)

## 🚀 Next Steps

1. **Update `.env.local`** with your API keys (Claude/OpenAI, Supabase, Pinecone)
2. **Review `docs/SYSTEM-PROMPT.md`** to customize negotiation tactics
3. **Run local tests**: `npm run test`
4. **Start local bot**: `npm run dev`
5. **Deploy to Render**: Follow `docs/DEPLOYMENT.md`
6. **Activate 10-day autonomous mode**: Set `AUTONOMOUS_MODE_START=2026-03-22` in env

---

**Built with ❤️ for autonomous property sourcing in Mumbai**
