# Video & Media Routing Pipeline

Detailed logic flow for handling incoming video, audio, YouTube links, and Instagram/social media content before it reaches the main conversational LLM.

---

## 1. Message Classification (Router Entry Point)

### 1.1 Detection Logic

```typescript
interface MessageInput {
  senderId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document';
  messageId: string;
  timestamp: Date;
}

function classifyMessage(msg: MessageInput): MessageClass {
  // 1. Check for URL (YouTube, Instagram, Twitter, etc.)
  const urlMatch = msg.content.match(
    /https?:\/\/(www\.)?(youtube\.com|youtu\.be|instagram\.com|twitter\.com|linkedin\.com|tiktok\.com)\S+/i
  );
  if (urlMatch) {
    const domain = urlMatch[2] || urlMatch[1];
    return classifyUrlType(domain);
  }

  // 2. Check for media attachment
  if (msg.mediaType === 'audio') return 'voice';
  if (msg.mediaType === 'video') return 'video';
  if (msg.mediaType === 'image') return 'image';

  // 3. Default: plain text
  return 'text';
}

type MessageClass = 'text' | 'voice' | 'video' | 'youtube' | 'instagram' | 'twitter' | 'image' | 'unknown';
```

---

## 2. Routing Matrix

```
Message Input
    ↓
    ├─ [PLAIN TEXT]
    │   └─→ No media processing
    │   └─→ Direct to security layer
    │   └─→ Cost: $0.003 (LLM only)
    │
    ├─ [VOICE NOTE] (.m4a, .ogg, .mp3, .wav)
    │   ├─→ Download from WhatsApp servers
    │   ├─→ Validate: not corrupted, < 5MB
    │   ├─→ Transcribe via Whisper
    │   ├─→ Normalize transcript text
    │   └─→ Cost: $0.02/min audio
    │
    ├─ [VIDEO MP4/MOV] (WhatsApp video, < 16MB)
    │   ├─→ Download from WhatsApp
    │   ├─→ FFmpeg audio extract
    │   ├─→ Whisper transcribe audio
    │   ├─→ FFmpeg frame sample @ 1%
    │   ├─→ Vision API classify frame
    │   ├─→ Merge: audio text + image description
    │   └─→ Cost: $0.04-0.06 total
    │
    ├─ [YOUTUBE LINK]
    │   ├─→ Extract video ID
    │   ├─→ youtube-transcript-api
    │   ├─→ Fallback: "I couldn't get the transcript"
    │   ├─→ Chunk transcript (500 tokens)
    │   └─→ Cost: $0.00 (free API)
    │
    ├─ [INSTAGRAM LINK] (instagram.com/...)
    │   ├─→ Detect domain
    │   ├─→ Send graceful stall
    │   │   "I can't load Instagram, can you text the details?"
    │   ├─→ Wait for text response
    │   └─→ Cost: $0.003 (LLM stall only)
    │
    ├─ [TWITTER/X LINK]
    │   ├─→ Detect domain
    │   ├─→ Send graceful stall
    │   │   "I can't access Twitter. Please share the details here."
    │   └─→ Cost: $0.003 (LLM stall only)
    │
    └─ [IMAGE] (jpeg, png, webp)
        ├─→ Download from WhatsApp
        ├─→ Vision API classify (low-res)
        ├─→ Extract: rooms, condition, amenities
        └─→ Cost: $0.01-0.02 per image
```

---

## 3. Detailed Pipeline: MP4 Video Processing

### 3.1 Workflow

```
Incoming WhatsApp Video
  ↓
[1. Validate & Download]
  - File size check: max 100MB (vs. 16MB WhatsApp limit)
  - MIME type: video/mp4, video/quicktime
  - Download to temp: /tmp/video_<msg_id>.mp4
  - Verify: file not corrupt
  ↓
[2. Extract Audio]
  - FFmpeg command:
    ffmpeg -i /tmp/video_<msg_id>.mp4 \
      -vn \                           # No video
      -acodec libmp3lame \            # MP3 codec
      -ab 128k \                      # 128kbps
      -ar 44100 \                     # 44.1kHz
      /tmp/audio_<msg_id>.mp3
  
  - Output: /tmp/audio_<msg_id>.mp3
  - Validation: file size > 0
  ↓
[3. Transcribe Audio (Whisper)]
  - API: OpenAI Whisper (async)
  - Language: auto-detect or 'hi' (Hindi)
  - Temperature: 0 (deterministic)
  - Timeout: 30 seconds per 5 min audio
  - Output: { text: "...", language: "en" }
  ↓
[4. Sample Video Frame]
  - Extract 1 keyframe @ time T = 1% of duration
    (For 5 min video: extract frame at 3 seconds)
  - FFmpeg command:
    ffmpeg -i /tmp/video_<msg_id>.mp4 \
      -vf "select=eq(pict_type\,I)" \
      -vframes 1 \                    # 1 frame only
      -ss 0:00:03 \                   # Seek to 3 seconds
      /tmp/frame_<msg_id>.jpg
  
  - Resize to: 768x768 (OpenAI Vision max)
  - Output: /tmp/frame_<msg_id>.jpg
  ↓
[5. Classify Frame (Vision API)]
  - OpenAI GPT-4o Vision or Claude Vision
  - Prompt:
    "Analyze this real estate property photo.
     Describe: condition, rooms (if visible), 
     amenities, lighting, and any red flags.
     Be concise (3-4 sentences)."
  - Output: description_text
  ↓
[6. Merge Audio + Visual]
  - Combined text:
    "PROPERTY TOUR VIDEO
     Audio: [Whisper transcript]
     Visual: [Vision description]"
  ↓
[7. Normalize Text]
  - Remove stutters, filler words
  - Capitalize property names
  - Extract structured fields (optional)
  ↓
[8. Cleanup & Store]
  - Delete temp files: /tmp/video_*, /tmp/audio_*, /tmp/frame_*
  - Store original result in DB
  - Update conversation record
  ↓
[Continue to Security Layer]
```

### 3.2 Cost Calculation

```
Example: 4-minute property video

1. Audio Transcription (Whisper):
   - 4 minutes × $0.02/min = $0.08

2. Vision Frame Classification:
   - 1 image × $0.01 = $0.01

3. LLM Response (negotiation):
   - 200 tokens out × $0.003 = $0.006

TOTAL: ~$0.10 per video

Per Broker/Day (10 videos):
   $0.10 × 10 = $1.00
```

### 3.3 TypeScript Implementation Skeleton

```typescript
// src/pipelines/video-pipeline.ts

import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function processVideoMessage(
  mediaUrl: string,
  messageId: string
): Promise<{ transcript: string; frameDescription: string; mergedText: string }> {
  const tmpDir = '/tmp';
  const videoPath = path.join(tmpDir, `video_${messageId}.mp4`);
  const audioPath = path.join(tmpDir, `audio_${messageId}.mp3`);
  const framePath = path.join(tmpDir, `frame_${messageId}.jpg`);

  try {
    // Step 1: Download video
    console.log('📥 Downloading video...');
    const videoData = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(videoPath, videoData.data);

    // Step 2: Extract audio
    console.log('🎵 Extracting audio...');
    const audioDuration = await extractAudio(videoPath, audioPath);

    // Step 3: Transcribe audio
    console.log('🎙️ Transcribing audio...');
    const transcript = await transcribeAudio(audioPath);

    // Step 4: Sample frame
    console.log('📸 Sampling video frame...');
    const frameSampleTime = Math.max(1, Math.floor(audioDuration * 0.01));
    await sampleFrame(videoPath, framePath, frameSampleTime);

    // Step 5: Classify frame
    console.log('👁️ Analyzing frame...');
    const frameDescription = await classifyFrame(framePath);

    // Step 6: Merge
    const mergedText = `
PROPERTY VIDEO ANALYSIS
═════════════════════════

📝 AUDIO TRANSCRIPT:
${transcript}

📷 VISUAL ANALYSIS:
${frameDescription}

MERGED CONTEXT: Property tour video processed successfully.
    `.trim();

    // Step 7: Cleanup
    cleanupTempFiles([videoPath, audioPath, framePath]);

    return { transcript, frameDescription, mergedText };
  } catch (error) {
    console.error('❌ Video processing failed:', error);
    cleanupTempFiles([videoPath, audioPath, framePath]);
    throw error;
  }
}

async function extractAudio(videoPath: string, audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .audioFrequency(44100)
      .on('end', () => {
        const duration = fs.statSync(videoPath).size; // Placeholder
        resolve(duration);
      })
      .on('error', reject)
      .save(audioPath);
  });
}

async function transcribeAudio(audioPath: string): Promise<string> {
  const audioFile = fs.createReadStream(audioPath);
  const response = await openai.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'en',
    temperature: 0,
  });
  return response.text;
}

async function sampleFrame(videoPath: string, framePath: string, timeSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timeSeconds)
      .frames(1)
      .output(framePath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function classifyFrame(framePath: string): Promise<string> {
  const imageData = fs.readFileSync(framePath, { encoding: 'base64' });
  const response = await openai.vision.beta.imageAnalysis.create({
    model: 'gpt-4o',
    image_source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: imageData,
    },
    prompt:
      'Analyze this real estate property photo. Describe: condition, rooms (if visible), amenities, lighting, and any red flags. Be concise (3-4 sentences).',
  });
  return response.content[0].type === 'text' ? response.content[0].text : '';
}

function cleanupTempFiles(paths: string[]): void {
  paths.forEach((p) => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
}
```

---

## 4. YouTube Pipeline

### 4.1 Workflow

```
Incoming YouTube Link
  ├─→ Extract video ID
  │   youtube.com/watch?v=abc123 → "abc123"
  │   youtu.be/abc123 → "abc123"
  │
  ├─→ Fetch Captions (youtube-transcript-api)
  │   API call: getTranscript(videoId)
  │   Response: [{text, start, duration}, ...]
  │
  ├─→ Concatenate captions
  │   Result: "Welcome to this property tour...
  │            This beautiful 4BHK apartment..."
  │
  ├─→ Chunk text (500 tokens max per chunk)
  │   Use: js-tiktoken to count tokens
  │
  ├─→ Normalize & Extract
  │   - Remove timestamps
  │   - Capitalize property details
  │   - Extract: price, area, location (if mentioned)
  │
  └─→ Continue to LLM
      Pass full transcript context
```

### 4.2 Cost Advantage

- **Whisper (video audio)**: $0.02 per minute
- **YouTube Transcript**: **$0.00** (completely free)
- **Vision (frame analysis)**: $0.01 per image

**Why YouTube is ideal**:
1. Brokers share property tour YouTube links
2. Zero cost to extract transcript
3. Already transcribed by YouTube's auto-captions
4. Often better quality than WhatsApp video audio

### 4.3 Fallback Strategy

```typescript
async function getYouTubeTranscript(videoId: string): Promise<string> {
  try {
    const captions = await youtubeCaptions.getTranscript({ videoId });
    return captions.map((c) => c.text).join(' ');
  } catch (error) {
    // Gracefully handle missing captions
    return `[Transcript unavailable for video ${videoId}]`;
  }
}

// In LLM conversation:
if (transcript.includes('[Transcript unavailable')) {
  return `Thanks for sharing! I couldn't load that YouTube video. 
          Could you share the key details here? 
          (Location, size, asking price, building age)`;
}
```

### 4.4 Implementation

```typescript
// src/pipelines/youtube-pipeline.ts

import { getTranscript } from 'youtube-captions-scraper'; // or youtube-transcript-api

export async function processYouTubeLink(url: string): Promise<string> {
  try {
    // Extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('Invalid YouTube URL');

    // Fetch transcript
    console.log(`📺 Fetching transcript for: ${videoId}`);
    const transcript = await getTranscript({ videoId });

    // Join captions
    const fullText = transcript.map((item) => item.text).join(' ');

    // Normalize
    const normalized = fullText
      .replace(/\s+/g, ' ') // Remove extra spaces
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .join('\n');

    console.log(`✅ Transcript extracted: ${normalized.length} characters`);
    return normalized;
  } catch (error) {
    console.error('❌ YouTube processing failed:', error);
    return ''; // Return empty to trigger fallback
  }
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
```

---

## 5. Instagram / Social Media Fallback

### 5.1 Why Not Scrape?

```
❌ Meta's Terms of Service:
   - Explicitly prohibit unofficial API use
   - Scraping violations result in account/SIM suspension

❌ Technical Risk:
   - Require browser automation (Puppeteer, Selenium)
   - IP bans, captcha challenges
   - 2FA/account lockdown

❌ Cost:
   - Browser automation + proxy costs exceed savings
   - High latency (30+ seconds per link)
```

### 5.2 Graceful Fallback Strategy

```typescript
// src/pipelines/social-fallback.ts

const SOCIAL_DOMAINS = {
  instagram: ['instagram.com', 'instagr.am'],
  twitter: ['twitter.com', 'x.com'],
  linkedin: ['linkedin.com'],
  tiktok: ['tiktok.com'],
  facebook: ['facebook.com', 'fb.com'],
};

export async function detectAndHandleSocialLink(
  url: string,
  brokerName: string
): Promise<{ blocked: boolean; fallbackMessage: string }> {
  const domain = new URL(url).hostname;

  if (domain.includes('instagram')) {
    return {
      blocked: true,
      fallbackMessage: `Hi ${brokerName}! I can't load Instagram due to platform restrictions. 
                       Could you share the property details here? 
                       (Location, price, size, age) 🏠`,
    };
  }

  if (domain.includes('twitter') || domain.includes('x.com')) {
    return {
      blocked: true,
      fallbackMessage: `Hey ${brokerName}! I can't access Twitter/X. 
                       Please share the property info in a message instead. 😊`,
    };
  }

  return { blocked: false, fallbackMessage: '' };
}

export async function handleSocialFallback(
  brokerPhone: string,
  fallbackMsg: string
): Promise<void> {
  // 1. Send stall message
  await sendWhatsAppMessage(brokerPhone, fallbackMsg);

  // 2. Log in DB for manual review
  await logAudit({
    action: 'social_link_blocked',
    broker_phone: brokerPhone,
    message: fallbackMsg,
    timestamp: new Date(),
  });

  // 3. Set flag for follow-up agent
  // (May need to manually check LinkedIn later)
}
```

### 5.3 Conversation Flow Example

```
Broker: "Check out this property on Instagram: https://instagram.com/p/xyz123"

Bot: "Hi Rajesh! I can't load Instagram due to platform restrictions. 
     Could you share the property details here? 
     (Location, price, size, building age) 🏠"

Broker: "It's a 4BHK in Bandra, 1500 sqft, ₹3.5 Cr, 8 years old. Built by Lodha."

Bot: [Process as text]
     [Extract: Bandra, 4BHK, 1500 sqft, ₹3.5 Cr, 8 yrs]
     [Create property record]
     [Evaluate against budget]
```

---

## 6. Image Processing

### 6.1 Classification Logic

```typescript
export async function processPropertyImage(imagePath: string): Promise<string> {
  // Resize to 768×768 (OpenAI Vision max)
  await resizeImage(imagePath, 768);

  const imageBase64 = fs.readFileSync(imagePath, { encoding: 'base64' });

  const response = await openai.vision.beta.imageAnalysis.create({
    model: 'gpt-4o',
    image_source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: imageBase64,
    },
    prompt: `Analyze this real estate property photo. Describe:
1. Room type (bedroom, kitchen, living area, etc.)
2. Condition (excellent, good, needs work)
3. Visible amenities (AC, fans, balcony, etc.)
4. Any red flags (water damage, cracks, outdated)
5. Lighting & natural ventilation

Be concise (4-5 sentences).`,
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}
```

---

## 7. Error Handling & Resilience

### 7.1 Failure Modes

```
[Video Download Fails]
  → Retry 2x with exponential backoff
  → After 2 retries: "Video temporarily unavailable, can you resend?"

[Whisper Timeout]
  → Timeout: 60 seconds per call
  → Max retries: 1
  → On failure: "Audio transcription failed, try again?"

[YouTube Transcript Missing]
  → Check if video is private/age-restricted
  → Return graceful message: "I couldn't extract the transcript..."

[Vision API Error]
  → Fallback to OCR if available
  → Log to alert system
  → Don't block conversation

[FFmpeg Corrupt File]
  → Validate file with mediainfo
  → Skip frame sampling if corrupt
  → Continue with audio-only
```

### 7.2 Circuit Breaker Pattern

```typescript
const circuitBreaker = {
  maxFailures: 5,
  resetTimeout: 3600000, // 1 hour
  failures: 0,
  lastFailureTime: 0,
  state: 'closed' as 'closed' | 'open' | 'half-open',

  async execute(fn: () => Promise<any>) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker open');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.maxFailures) {
        this.state = 'open';
      }

      throw error;
    }
  },
};
```

---

## 8. Performance Metrics

| Stage | Latency | Cost | Optimization |
|-------|---------|------|--------------|
| Video download | 2-5s | $0 | Parallel download + decompress |
| Audio extraction | 1-3s | $0 | Local FFmpeg |
| Whisper API | 10-20s | $0.02/min | Async, batch if possible |
| Vision frame | 3-5s | $0.01 | Single frame @ 1% duration |
| YouTube fetch | 1-2s | $0 | Cache transcripts (1 week) |
| LLM response | 5-10s | $0.003 | Streaming, concurrent requests |
| **Total** | **~25-45s** | **~$0.10** | Use for high-value negotiations |

---

## 9. Monitoring & Logging

```typescript
// Log pipeline events for debugging
logger.info('media_pipeline', {
  message_id: msgId,
  media_type: 'video',
  file_size_mb: 12.5,
  duration_seconds: 240,
  stages: {
    download: { duration_ms: 3000, status: 'success' },
    audio_extract: { duration_ms: 1500, status: 'success' },
    transcribe: { duration_ms: 18000, status: 'success', char_count: 2350 },
    frame_sample: { duration_ms: 2000, status: 'success' },
    vision: { duration_ms: 4000, status: 'success', char_count: 180 },
  },
  total_pipeline_duration_ms: 28500,
  total_cost_cents: 10,
  broker_id: 'broker_123',
});
```

---

## Summary: Routing Decision Tree

```
Incoming Message
  │
  ├─ Has URL? → Extract & classify domain
  │   ├─ YouTube → youtube-transcript-api (FREE)
  │   ├─ Instagram/Twitter/LinkedIn → Graceful stall (SAFE)
  │   └─ Other → Try general link preview
  │
  ├─ Has video media? → Video pipeline (MP4 → audio + frame)
  │   ├─ Extract audio (FFmpeg)
  │   ├─ Transcribe (Whisper) → $0.02/min
  │   ├─ Sample frame (FFmpeg @ 1%)
  │   └─ Classify frame (Vision) → $0.01
  │
  ├─ Has audio? → Voice pipeline
  │   └─ Transcribe directly (Whisper) → $0.02/min
  │
  ├─ Has image? → Image pipeline
  │   └─ Classify (Vision) → $0.01
  │
  └─ Plain text? → Direct to security layer
      └─ No media cost → $0.003 (LLM only)
```

---

**Cost Summary per Broker/Day** (with 10 interactions):
- 5 text messages: $0.015
- 2 voice notes: $0.04
- 2 videos: $0.20
- 1 YouTube link: $0.00
- **Total: ~$0.26/day per broker**

**For 10 concurrent brokers**: ~$2.60/day (sustainable budget)
