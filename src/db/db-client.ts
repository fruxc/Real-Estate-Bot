/**
 * Database Client
 * PostgreSQL wrapper for brokers, properties, conversations
 */

import { Pool, PoolClient } from 'pg';
import pino from 'pino';

export class DatabaseClient {
  private pool: Pool;
  private logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger;
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      this.logger.info('✅ Database connected');
    } catch (error) {
      this.logger.error('Database connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    this.logger.info('✅ Database disconnected');
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async getBrokerByPhone(phoneNumber: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM brokers WHERE phone_number = $1',
      [phoneNumber]
    );
    return result.rows[0];
  }

  async createBroker(broker: any): Promise<any> {
    const result = await this.pool.query(
      `INSERT INTO brokers (phone_number, name)
       VALUES ($1, $2)
       RETURNING *`,
      [broker.phone_number, broker.name]
    );
    return result.rows[0];
  }

  async storeConversation(conversation: any): Promise<any> {
    const result = await this.pool.query(
      `INSERT INTO conversations (
         broker_id, sender, text_content, message_type,
         tokens_used, cost_cents, model_used, extracted_fields
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        conversation.broker_id,
        conversation.sender,
        conversation.text_content,
        conversation.message_type,
        conversation.tokens_used || 0,
        conversation.cost_cents || 0,
        conversation.model_used || null,
        JSON.stringify(conversation.extracted_fields || {}),
      ]
    );
    return result.rows[0];
  }

  async query(sql: string, params: any[] = []): Promise<any> {
    const result = await this.pool.query(sql, params);
    return result;
  }
}
