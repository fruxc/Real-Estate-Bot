# Cost Analysis & Optimization

Detailed breakdown of monthly costs with optimization strategies and budget recommendations.

---

## 1. Cost Breakdown (Monthly Estimate)

### 1.1 Per-Message Costs

```
TYPICAL INTERACTION FLOW:
Broker: "I have a 4BHK in Bandra, ₹3.8 Cr" (text)
  ↓
[Router + Security: $0.000] (local, no API)
  ↓
[Vector DB lookup + broker profile: $0.0001] (Pinecone free tier)
  ↓
[LLM response (~150 tokens): $0.0045] (Claude 3.5 Sonnet)
  ↓
Agent: "Carpet area? RERA status?" + [Extract details]
  ↓
[Database storage: $0.0000] (Supabase included)
  ↓
TOTAL COST: ~$0.005 per exchange

────────────────────────────────────────────────────

VOICE MESSAGE FLOW:
Broker sends: 2-minute voice note
  ↓
[Download + FFmpeg: $0.000] (local)
  ↓
[Whisper transcription: $0.04] (2 min @ $0.02/min)
  ↓
[LLM response: $0.005] (process + reply)
  ↓
TOTAL COST: ~$0.045 per voice message

────────────────────────────────────────────────────

VIDEO MESSAGE FLOW:
Broker sends: 4-minute property tour video
  ↓
[Download + FFmpeg audio extract: $0.000] (local)
  ↓
[Whisper transcription (4 min): $0.08] ($0.02/min)
  ↓
[Frame sampling + Vision classification: $0.01] (1 image)
  ↓
[LLM response (merged text): $0.005]
  ↓
TOTAL COST: ~$0.095 per video

────────────────────────────────────────────────────

YOUTUBE LINK FLOW:
Broker sends: "Check this property tour: https://youtube.com/..."
  ↓
[Transcript extraction (free API): $0.000]
  ↓
[LLM response (process transcript): $0.005]
  ↓
TOTAL COST: ~$0.005 per YouTube link (FREE transcript!)
```

### 1.2 Monthly Costs (10 Active Brokers)

```
SCENARIO: Moderate Activity (30 days)

Messages per Broker/Day: 5
- 3 text messages @ $0.005 = $0.015
- 1 voice note @ $0.045 = $0.045
- 1 video message @ $0.095 = $0.095
Subtotal/Broker/Day: $0.155

Total/Broker/Month: $0.155 × 30 = $4.65

Total for 10 Brokers: $4.65 × 10 = $46.50 (but with rate limits: ~$35-40)

BREAKDOWN:
┌─────────────────────────────────────────┐
│ Hosting (Render)              $7/month   │
│ Database (Supabase)           $0/month   │
│ Vector DB (Pinecone)          $0/month   │
│ API Costs:                    $30/month  │
│   - Whisper (audio)           $12/month  │
│   - Claude (LLM)              $15/month  │
│   - Vision (images)           $3/month   │
│ Total OpenAI/Anthropic: ──────$30/month  │
│────────────────────────────────────────  │
│ TOTAL MONTHLY:                $37/month  │
│ Per Broker:                   $3.70      │
│ Per Conversation:             $0.025     │
└─────────────────────────────────────────┘
```

### 1.3 Scaling Analysis

```
BROKERS  | MESSAGES/DAY | API COST/DAY | TOTAL MONTHLY | NOTES
─────────┼──────────────┼──────────────┼───────────────┼─────────────────
1        | 5            | $0.78        | $23           | Startup phase
5        | 25           | $3.90        | $117          | Beta testing
10       | 50           | $7.80        | $234          | Optimal efficiency
20       | 100          | $15.60       | $468          | Approaching limits
50       | 250          | $39.00       | $1,170        | Scale with warnings
100      | 500          | $78.00       | $2,340        | Needs optimization

RATE LIMIT IMPACT:
- Hard ceiling: $25/day = $750/month
- Per-broker limit: $12/day = $360/month for 30 brokers
- With 10 brokers: ~$35-40/month (well within budget)
```

---

## 2. Cost Drivers & Optimization

### 2.1 Whisper (Audio Transcription)

| Metric | Cost | Optimization |
|--------|------|--------------|
| Price | $0.02/minute | - Request bulk discount (>100 hrs/month) |
| Latency | ~3-5 sec per minute | - Batch transcription if possible |
| Quality | High | - Use language hint (en_US) to improve |
| Fallback | N/A | - Can't disable (critical for voice) |

**Optimization Strategy**:
```
Current: $0.02/min for all audio
Optimized:
- Transcribe only broker's voice (skip background noise)
- Use lower quality (Whisper has no quality tiers)
- Batch: Group 10 files, send in parallel
- Result: Potential 10-20% savings
```

### 2.2 Vision (Image Analysis)

| Metric | Cost | Optimization |
|--------|------|--------------|
| Price | $0.01 per image | - Sample 1 frame per 100 frames (video) |
| Resolution | Up to 2048×2048 | - Use 768×768 (satisfactory, 60% cheaper) |
| Quality | High | - Accepted, don't compromise |
| Latency | 5-10 sec | - Acceptable |

**Optimization Strategy**:
```
Current: $0.01 per frame sample
Optimized:
- Only analyze frames with HIGH motion (use optical flow detection)
- Skip nearly-duplicate frames (compare pixel differences)
- Use GPT-4o Vision (sometimes cheaper than Claude Vision for simple tasks)
- Potential savings: 30-50% on vision costs

Example:
Without optimization: 10 videos × 1 frame each = 10 images @ $0.01 = $0.10/day
With optimization: 10 videos × 0.3 frames each = 3 images @ $0.01 = $0.03/day
Savings: $0.07/day = $2.10/month
```

### 2.3 Claude LLM (Negotiation & Response)

| Metric | Cost | Optimization |
|--------|------|--------------|
| Input | $0.003 per 1K tokens | - Reduce context window (use vector DB retrieval, not full history) |
| Output | $0.015 per 1K tokens | - Limit to 200 tokens per response |
| Model | Sonnet (mid-tier) | - Use Haiku for follow-ups (~50% cheaper) |
| Latency | 5-15 sec | - Acceptable for WhatsApp |

**Optimization Strategy**:
```
Current: Claude 3.5 Sonnet for all messages ($0.003/1K in, $0.015/1K out)
Optimized:
- Use Sonnet for negotiation messages ONLY (high complexity)
- Use Haiku for routine follow-ups ("Got it", acknowledgments) - 50% cheaper
- Reduce context: Instead of 50 tokens context, use 30 (vector DB retrieves relevant parts)
- Reduce output: Cap at 150-200 tokens instead of 300
- Result: 40-50% reduction in LLM cost

Example:
Day 1 - 10 messages:
  - 4 negotiations (Sonnet): 4 × $0.010 = $0.040
  - 6 routine (Haiku): 6 × $0.004 = $0.024
  Total: $0.064 (vs. $0.084 all Sonnet) = 24% savings
```

### 2.4 YouTube Transcription (FREE!)

**Best Deal**: `youtube-transcript-api` costs $0, no authentication needed.

```typescript
// Zero-cost transcript extraction
import { getTranscript } from 'youtube-transcript-api';

async function getYouTubeTranscript(videoId: string) {
  try {
    const transcript = await getTranscript({ videoId });
    return transcript.map(item => item.text).join(' ');
  } catch (error) {
    // ~5% of videos have no auto-generated captions
    return null;
  }
}

// Cost: $0 per property tour video shared
// Savings vs. Whisper: $0.04 per 2-minute video
// If 20% of properties shared via YouTube: Saves $0.64/day = $19.20/month
```

---

## 3. Hosting & Infrastructure Costs

### 3.1 Render (Node.js Hosting)

```
TIER               | CPU | RAM | COST/MONTH | AUTO-SCALE | NOTES
───────────────────┼─────┼─────┼────────────┼────────────┼──────────────────
Free               | - | - | $0 | No | Spins down after 15 min idle
Starter            | 0.5 | 512MB | $7 | No | Always running, suitable
Standard           | 1 | 1GB | $12 | No | More headroom
Pro (1)            | 1 | 2GB | $25 | Yes | Auto-scale (2-8 replicas)

RECOMMENDATION: Start with Starter ($7), scale to Standard ($12) if needed.
WHY: Bot is event-driven (sporadic broker messages), not continuous.
Idle cost: $0 (Render doesn't charge for idle).
```

### 3.2 Supabase (PostgreSQL Database)

```
TIER       | STORAGE | CONNECTIONS | BACKUPS | COST/MONTH | NOTES
───────────┼─────────┼──────────────┼─────────┼────────────┼──────────────────
Free       | 500MB | 50K | Daily | $0 | Generous free tier
Pro        | 8GB | 100K | Daily | $25 | For serious projects
Enterprise | Custom | Custom | Custom | Custom | For 1000+ users

RECOMMENDATION: Free tier is sufficient.
Why: 500MB stores ~5 years of conversational data (see SCHEMA.md).
Connection pool: 50K connections >> 10 brokers needing 1-2 connections each.
```

### 3.3 Pinecone (Vector Database)

```
TIER       | VECTORS | STORAGE | QUERIES/SEC | COST/MONTH | NOTES
───────────┼─────────┼─────────┼─────────────┼────────────┼──────────────────
Free       | 100K | 1GB | 10 | $0 | 3-month trial
Starter    | Unlimited | Unlimited | 100 | $10 | Or pay-as-you-go
Enterprise | Unlimited | Unlimited | Unlimited | Custom | For scale

RECOMMENDATION: Free tier for MVP, Starter if scaling beyond 5 brokers.
Why: 100K vectors = ~5000 conversations (each with 20 vectors from variations).
Expected usage: ~500 vectors/month for 10 brokers = well within free tier.
```

---

## 4. Monthly Cost Breakdown (All Scenarios)

### Scenario A: MVP (1-2 Brokers, Testing)

```
Render (Starter)         $7
Supabase                 $0
Pinecone                 $0
Whisper (10 hrs/month)   $12
Claude LLM               $5
Vision                   $0.50
────────────────────────────
TOTAL/MONTH:             $24.50
TOTAL/BROKER:            $12.25
DAILY COST:              $0.80
```

### Scenario B: Growth (10 Active Brokers)

```
Render (Starter)         $7
Supabase                 $0
Pinecone                 $0
Whisper (50 hrs/month)   $60
Claude LLM               $20
Vision (50 images)       $5
────────────────────────────
TOTAL/MONTH:             $92
TOTAL/BROKER:            $9.20
DAILY COST:              $3.07
```

### Scenario C: Scale (50 Brokers, Heavy Activity)

```
Render (Standard)        $12
Supabase                 $0
Pinecone (Starter)       $10
Whisper (250 hrs/month)  $300
Claude LLM               $80
Vision (500 images)      $50
────────────────────────────
TOTAL/MONTH:             $452
TOTAL/BROKER:            $9.04
DAILY COST:              $15.07
```

### Scenario D: Fully Optimized (50 Brokers)

```
Render (Standard)        $12
Supabase                 $0
Pinecone (Starter)       $10
Whisper (150 hrs/month)  $180 [40% reduction with batching]
Claude LLM               $40 [50% reduction with Haiku routing]
Vision (150 images)      $15 [70% reduction with frame filtering]
────────────────────────────
TOTAL/MONTH:             $257
TOTAL/BROKER:            $5.14
DAILY COST:              $8.57
```

---

## 5. Cost Per Key Metric

| Metric | Cost | Notes |
|--------|------|-------|
| Per broker/month | $3-10 | Depends on activity & optimization |
| Per conversation | $0.01-0.05 | Text: $0.01, Video: $0.05 |
| Per property found | $0.50-2.00 | Includes all extraction & negotiation |
| Per deal closed | $20-50 | Full negotiation cycle (multiple conversations) |

---

## 6. Budget Recommendations

### For Your Use Case (March 22 - May 2026)

```
PHASE 1: Development & Testing (March 1-21)
- 2 brokers, manual testing
- Budget: $30
- Purpose: Validate system, fix bugs
- Cost focus: Keep low (use local Docker)

PHASE 2: Autonomous 10-Day Travel (March 22-31)
- 5-10 brokers, full autopilot
- Budget: $50
- Purpose: Stress test, real negotiations
- Cost focus: Enforce rate limits strictly

PHASE 3: Post-Travel Follow-up (April 1-30)
- 20-30 brokers, manual follow-ups
- Budget: $150
- Purpose: Visit properties, finalize deals
- Cost focus: Negotiate hard, finalize winners

PHASE 4: Extended Search (May 1-31)
- 10-15 brokers, maintenance mode
- Budget: $100
- Purpose: Ongoing monitoring, new opportunities
- Cost focus: Optimize, reduce unnecessary chats

─────────────────────────────────────────────
TOTAL 3-MONTH BUDGET: $330
DAILY AVERAGE: $3.67
WEEKLY AVERAGE: $25.69
MONTHLY AVERAGE: $110
```

---

## 7. Cost Monitoring & Alerts

### Automated Alert Thresholds

```typescript
// config/cost-monitoring.ts

const COST_ALERTS = {
  daily_threshold: 25.00,        // $25/day
  weekly_threshold: 150.00,      // $150/week
  monthly_threshold: 500.00,     // $500/month
  per_broker_daily: 12.00,       // $12/day per broker
};

// Alert Conditions:
if (dailyCost > COST_ALERTS.daily_threshold) {
  sendEmail('⚠️ Daily cost threshold exceeded!');
  // Reduce max_tokens, switch to Haiku
}

if (weeklyCost > COST_ALERTS.weekly_threshold) {
  sendEmail('⚠️⚠️ Weekly cost trending high!');
  // Review: too many brokers? too many videos?
}

if (perBrokerCost > COST_ALERTS.per_broker_daily) {
  sendEmail('🚨 Broker exceeding daily limit!');
  // Auto-pause: stop new conversations with this broker
}
```

### Cost Dashboard Query

```sql
-- Daily cost summary
SELECT
  DATE(created_at) as day,
  COUNT(DISTINCT broker_id) as brokers_engaged,
  COUNT(*) as total_messages,
  SUM(cost_cents) / 100.0 as total_cost_usd,
  ROUND(AVG(cost_cents) / 100.0, 4) as avg_cost_per_msg,
  SUM(CASE WHEN message_type = 'text' THEN 1 ELSE 0 END) as text_msgs,
  SUM(CASE WHEN message_type = 'voice' THEN 1 ELSE 0 END) as voice_msgs,
  SUM(CASE WHEN message_type = 'video' THEN 1 ELSE 0 END) as video_msgs,
  SUM(CASE WHEN message_type = 'youtube' THEN 1 ELSE 0 END) as youtube_links
FROM conversations
GROUP BY DATE(created_at)
ORDER BY day DESC
LIMIT 30;
```

---

## 8. Cost Optimization Roadmap

### Month 1: Foundation (Cost: ~$100)
- ✅ Deploy with stock models (Sonnet, full context)
- ✅ Establish baseline metrics
- ✅ Monitor API usage

### Month 2: Optimization (Cost: ~$70)
- ✅ Switch to Haiku for follow-ups (-30% LLM cost)
- ✅ Reduce context window (-20% LLM cost)
- ✅ Implement frame filtering (-40% vision cost)
- Result: 35-40% cost reduction

### Month 3: Advanced Optimization (Cost: ~$50)
- ✅ Batch Whisper transcriptions (-20% audio cost)
- ✅ Smart caching of market comps (-15% LLM calls)
- ✅ Use YouTube transcripts for 30% of videos
- Result: Additional 25-30% cost reduction

### Month 4+: Maintenance (Cost: ~$40/month)
- ✅ Fully optimized operations
- ✅ Focus on deal quality, not volume
- ✅ Archive old conversations (archive videos to S3)

---

## 9. Backup Cost Scenarios

### If Cost Exceeds Budget

```
Daily cost > $25 → Automatic failsafe:

1. REDUCE CONTEXT:
   - Disable vector DB retrieval
   - Only use last 5 messages (instead of 10)
   - Saves: ~$0.001/message = $3-5/day

2. SWITCH MODELS:
   - All messages use Haiku instead of Sonnet
   - Saves: ~$0.003/message = $10-15/day

3. RATE LIMIT:
   - Reduce max_turns_per_broker from 10 → 5
   - Reduces message volume by 50%
   - Saves: $10-12/day

4. DISABLE VIDEO:
   - Auto-stall on videos: "Can you share details as text?"
   - Saves: ~$0.095 per video = $5-20/day

Combined: Potential savings = $30-50/day
(Usually triggers when cost is already high, so impact is significant)
```

---

## 10. ROI Calculation

### Value Delivered

```
Assumption: Save ₹10 Lakhs on property purchase through negotiation

Cost: $330 over 3 months
Value: ₹1,000,000 ($12,000 USD)

ROI = (Value - Cost) / Cost × 100
    = ($12,000 - $330) / $330 × 100
    = 3,530%

Even if you save ₹5 Lakhs:
ROI = ($6,000 - $330) / $330 × 100
    = 1,718%

Break-even: Save as little as ₹25,000 ($300) to cover costs
```

---

**Summary**: This system is extremely cost-effective. At ~$3-10 per broker per month, the value of a single negotiated property easily justifies the expense.
