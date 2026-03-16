/**
 * Message Router
 * Routes incoming messages through appropriate pipelines
 */

import pino from 'pino';
import { DatabaseClient } from '../db/db-client';
import { VectorDB } from '../db/vector-db';
import { LLMEngine } from './llm-engine';

export interface MessageContext {
  senderId: string;
  messageId: string;
  content: string;
  mediaType: 'text' | 'audio' | 'video' | 'image' | 'youtube' | 'instagram';
  mediaUrl?: string;
  timestamp: Date;
  rawMessage?: any;
}

export class MessageRouter {
  private db: DatabaseClient;
  private vectorDb: VectorDB;
  private llmEngine: LLMEngine;
  private logger: pino.Logger;

  constructor(db: DatabaseClient, vectorDb: VectorDB, llmEngine: LLMEngine, logger: pino.Logger) {
    this.db = db;
    this.vectorDb = vectorDb;
    this.llmEngine = llmEngine;
    this.logger = logger;
  }

  async route(context: MessageContext): Promise<void> {
    this.logger.info(`🔀 Routing message: ${context.mediaType}`);

    try {
      // 1. Ensure broker exists in database
      const broker = await this.db.getBrokerByPhone(context.senderId);
      if (!broker) {
        await this.db.createBroker({
          phone_number: context.senderId,
          name: context.senderId, // Will be updated by LLM if name is extracted
        });
        this.logger.info(`✨ New broker registered: ${context.senderId}`);
      }

      // 2. Normalize and extract text from media
      let normalizedText = context.content;
      if (context.mediaType !== 'text') {
        // TODO: Implement media processing pipelines
        normalizedText = `[${context.mediaType.toUpperCase()}] ${context.content}`;
      }

      // 3. Apply security checks
      const { masked, flags } = await this.applySecurityChecks(normalizedText);

      // 4. Retrieve conversation context
      const conversationContext = await this.vectorDb.retrieveContext(
        context.senderId,
        masked,
        10 // top-k
      );

      // 5. Generate LLM response
      const response = await this.generateResponse(
        context.senderId,
        masked,
        conversationContext
      );

      // 6. Store conversation
      await this.db.storeConversation({
        broker_id: broker?.id || context.senderId,
        sender: 'broker',
        text_content: masked,
        message_type: context.mediaType,
        extracted_fields: {},
      });

      await this.db.storeConversation({
        broker_id: broker?.id || context.senderId,
        sender: 'agent',
        text_content: response.text,
        message_type: 'text',
        tokens_used: response.tokens,
        cost_cents: response.costCents,
        model_used: response.model,
      });

      // 7. Store embeddings
      await this.vectorDb.upsertEmbeddings({
        broker_id: context.senderId,
        text: masked,
      });

      this.logger.info(`✅ Message routed successfully`);
    } catch (error) {
      this.logger.error('Message routing failed:', error);
      throw error;
    }
  }

  private async applySecurityChecks(
    text: string
  ): Promise<{ masked: string; flags: string[] }> {
    // TODO: Implement PII masking and injection defense
    return { masked: text, flags: [] };
  }

  private async generateResponse(
    brokerId: string,
    message: string,
    context: any[]
  ): Promise<{ text: string; tokens: number; costCents: number; model: string }> {
    // TODO: Build system prompt
    // TODO: Construct conversation context
    // TODO: Call LLM

    const response = await this.llmEngine.generate({
      messages: [{ role: 'user', content: message }],
      systemPrompt: 'You are a helpful real estate negotiator.',
      model: 'sonnet',
    });

    return {
      text: response.text,
      tokens: response.tokens,
      costCents: response.costCents,
      model: response.model,
    };
  }
}
