/**
 * Audit Logging for RealEstateBot
 * Tracks all significant events and actions
 */

import { DatabaseClient } from '../db/db-client';

export interface AuditLogEntry {
  id?: number;
  event_type: string;
  sender_id: string;
  action: string;
  old_value?: string;
  new_value?: string;
  reason?: string;
  ip_address?: string;
  user_agent?: string;
  status: 'SUCCESS' | 'FAILED';
  error_message?: string;
  created_at?: Date;
}

/**
 * Audit Logger for tracking all events
 */
export class AuditLogger {
  private readonly logger: any;

  constructor(_db: DatabaseClient, logger: any) {
    this.logger = logger;
  }

  /**
   * Log a significant event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      const timestamp = new Date().toISOString();

      // Log to console for visibility
      this.logger.info(`📝 Audit: ${entry.event_type}`, {
        sender: entry.sender_id,
        action: entry.action,
        status: entry.status,
        timestamp,
      });

      // In production, write to database audit_logs table
      // This would be implemented when adding PostgreSQL to RealEstateBot
      // await this.db.logAuditEvent(entry);
    } catch (error) {
      this.logger.error(`Failed to log audit event: ${error}`);
    }
  }

  /**
   * Log a message received event
   */
  async logMessageReceived(senderId: string, mediaType: string): Promise<void> {
    await this.log({
      event_type: 'MESSAGE_RECEIVED',
      sender_id: senderId,
      action: `Received ${mediaType} message`,
      status: 'SUCCESS',
    });
  }

  /**
   * Log a message processed event
   */
  async logMessageProcessed(
    senderId: string,
    action: string,
    result: string
  ): Promise<void> {
    await this.log({
      event_type: 'MESSAGE_PROCESSED',
      sender_id: senderId,
      action,
      new_value: result,
      status: 'SUCCESS',
    });
  }

  /**
   * Log a negotiation event
   */
  async logNegotiation(
    senderId: string,
    propertyId: string,
    action: string,
    oldValue?: string,
    newValue?: string
  ): Promise<void> {
    await this.log({
      event_type: 'NEGOTIATION',
      sender_id: senderId,
      action: `${action} for property ${propertyId}`,
      old_value: oldValue,
      new_value: newValue,
      status: 'SUCCESS',
    });
  }

  /**
   * Log security violations
   */
  async logSecurityEvent(
    senderId: string,
    eventType: string,
    reason: string,
    status: 'SUCCESS' | 'FAILED' = 'FAILED'
  ): Promise<void> {
    await this.log({
      event_type: `SECURITY_${eventType}`,
      sender_id: senderId,
      action: reason,
      status,
      error_message:
        status === 'FAILED' ? reason : undefined,
    });
  }

  /**
   * Log authentication events
   */
  async logAuthEvent(
    senderId: string,
    action: string,
    status: 'SUCCESS' | 'FAILED' = 'SUCCESS'
  ): Promise<void> {
    await this.log({
      event_type: 'AUTHENTICATION',
      sender_id: senderId,
      action,
      status,
    });
  }

  /**
   * Get audit logs for a sender (for investigation)
   */
  async getLogsForSender(senderId: string, _limit: number = 100): Promise<AuditLogEntry[]> {
    // In production, would query database
    // SELECT * FROM audit_logs WHERE sender_id = ? ORDER BY created_at DESC LIMIT ?
    this.logger.info(`Fetching audit logs for: ${senderId}`);
    return [];
  }

  /**
   * Get recent security events
   */
  async getSecurityEvents(hours: number = 24): Promise<AuditLogEntry[]> {
    // In production, would query database for recent security events
    this.logger.info(`Fetching security events from last ${hours} hours`);
    return [];
  }
}

export function createAuditLogger(db: DatabaseClient, logger: any): AuditLogger {
  return new AuditLogger(db, logger);
}
