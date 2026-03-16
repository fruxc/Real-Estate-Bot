/**
 * Vector Database Client
 * Pinecone integration for semantic search and conversation memory
 */

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import pino from 'pino';

export class VectorDB {
  private pinecone: Pinecone;
  private openai: OpenAI;
  private logger: pino.Logger;
  private indexName: string;

  constructor(logger: pino.Logger) {
    this.logger = logger;
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.indexName = process.env.PINECONE_INDEX_NAME || 'realestatebot';
  }

  async connect(): Promise<void> {
    try {
      const index = this.pinecone.Index(this.indexName);
      await index.describeIndexStats();
      this.logger.info('✅ Pinecone connected');
    } catch (error) {
      this.logger.error('Pinecone connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Pinecone has no explicit disconnect
    this.logger.info('✅ Pinecone disconnected');
  }

  async isConnected(): Promise<boolean> {
    try {
      const index = this.pinecone.Index(this.indexName);
      await index.describeIndexStats();
      return true;
    } catch {
      return false;
    }
  }

  async upsertEmbeddings(data: {
    broker_id: string;
    text: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      // Generate embedding
      const embedding = await this.generateEmbedding(data.text);

      // Upsert to Pinecone
      const index = this.pinecone.Index(this.indexName);
      await index.upsert([
        {
          id: `${data.broker_id}_${Date.now()}`,
          values: embedding,
          metadata: {
            broker_id: data.broker_id,
            text: data.text.substring(0, 500),
            timestamp: new Date().toISOString(),
            ...data.metadata,
          },
        },
      ]);

      this.logger.debug(`📝 Embedding upserted for broker: ${data.broker_id}`);
    } catch (error) {
      this.logger.error('Failed to upsert embedding:', error);
      throw error;
    }
  }

  async retrieveContext(
    brokerId: string,
    query: string,
    topK: number = 10
  ): Promise<Array<{ text: string; score: number }>> {
    try {
      // Generate query embedding
      const embedding = await this.generateEmbedding(query);

      // Query Pinecone
      const index = this.pinecone.Index(this.indexName);
      const results = await index.query({
        vector: embedding,
        topK,
        filter: { broker_id: { $eq: brokerId } },
      });

      // Extract and return results
      return results.matches
        .filter((m) => m.metadata?.text)
        .map((m) => ({
          text: m.metadata?.text || '',
          score: m.score || 0,
        }));
    } catch (error) {
      this.logger.error('Failed to retrieve context:', error);
      return []; // Return empty array on error (graceful degradation)
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.substring(0, 2000), // Limit text length
    });

    return response.data[0].embedding;
  }
}
