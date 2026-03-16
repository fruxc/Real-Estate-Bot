/**
 * Real Estate WhatsApp AI Agent
 * Main entry point
 */

import 'dotenv/config';
import pino from 'pino';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { WhatsAppClient } from './core/whatsapp-client';
import { DatabaseClient } from './db/db-client';
import { VectorDB } from './db/vector-db';
import { LLMEngine } from './core/llm-engine';
import { MessageRouter } from './core/message-router';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : { target: 'pino/file' },
});

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const uptime = process.uptime();
    const dbConnected = await db.isConnected();
    const vectorDbConnected = await vectorDb.isConnected();

    res.json({
      status: 'ok',
      uptime: Math.floor(uptime),
      database: dbConnected ? 'connected' : 'disconnected',
      vectorDb: vectorDbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({ status: 'error', error: String(error) });
  }
});

// Test endpoint
app.post('/test/llm', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const response = await llmEngine.generate({
      messages: [{ role: 'user', content: message }],
      systemPrompt: 'You are a helpful assistant.',
    });

    res.json({ response });
  } catch (error) {
    logger.error('LLM test failed:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize services
const db = new DatabaseClient(logger);
const vectorDb = new VectorDB(logger);
const llmEngine = new LLMEngine(logger);
const messageRouter = new MessageRouter(db, vectorDb, llmEngine, logger);
const whatsappClient = new WhatsAppClient(messageRouter, logger);

// Startup sequence
async function startup() {
  try {
    logger.info('🚀 Starting Real Estate WhatsApp AI Agent...');

    // Connect to database
    logger.info('📦 Connecting to database...');
    await db.connect();
    logger.info('✅ Database connected');

    // Connect to vector DB
    logger.info('🔍 Connecting to vector database...');
    await vectorDb.connect();
    logger.info('✅ Vector DB connected');

    // Initialize LLM engine
    logger.info('🤖 Initializing LLM engine...');
    await llmEngine.initialize();
    logger.info('✅ LLM engine ready');

    // Connect to WhatsApp
    if (!process.env.SKIP_WHATSAPP_CONNECTION) {
      logger.info('💬 Connecting to WhatsApp...');
      await whatsappClient.connect();
      logger.info('✅ WhatsApp connected');
    } else {
      logger.warn('⚠️ WhatsApp connection skipped (SKIP_WHATSAPP_CONNECTION=true)');
    }

    // Start HTTP server
    const port = parseInt(process.env.PORT || '3000', 10);
    app.listen(port, () => {
      logger.info(`📡 HTTP server listening on port ${port}`);
      logger.info('✨ Bot is ready to handle messages!');
    });
  } catch (error) {
    logger.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🛑 Received SIGINT, shutting down gracefully...');
  try {
    await db.disconnect();
    await vectorDb.disconnect();
    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Shutdown error:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Received SIGTERM, shutting down gracefully...');
  try {
    await db.disconnect();
    await vectorDb.disconnect();
    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Shutdown error:', error);
    process.exit(1);
  }
});

// Start the bot
startup().catch((error) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});

export { app, db, vectorDb, llmEngine, messageRouter, whatsappClient };
