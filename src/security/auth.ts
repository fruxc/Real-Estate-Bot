/**
 * WhatsApp Message Authentication & Rate Limiting
 * Validates sender, checks message rate, and enforces security policies
 */

import { DatabaseClient } from '../db/db-client';

export interface SecurityContext {
  senderId: string;
  timestamp: Date;
  messageCount?: number;
  isBlocked?: boolean;
  rateLimitExceeded?: boolean;
  lastMessageTime?: Date;
}

export interface SecurityPolicy {
  maxMessagesPerMinute: number;
  maxMessagesPerHour: number;
  blockListedNumbers: string[];
  requireVerification: boolean;
  auditLogging: boolean;
}

/**
 * Default security policy
 */
const DEFAULT_POLICY: SecurityPolicy = {
  maxMessagesPerMinute: 10,
  maxMessagesPerHour: 100,
  blockListedNumbers: [],
  requireVerification: false,
  auditLogging: true,
};

export class SecurityManager {
  private readonly db: DatabaseClient;
  private readonly logger: any;
  private readonly policy: SecurityPolicy;
  private readonly messageStore: Map<string, number[]> = new Map(); // sender -> timestamps

  constructor(
    db: DatabaseClient,
    logger: any,
    policy: Partial<SecurityPolicy> = {}
  ) {
    this.db = db;
    this.logger = logger;
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  /**
   * Validate incoming message security
   */
  async validateMessage(senderId: string): Promise<SecurityContext> {
    const context: SecurityContext = {
      senderId,
      timestamp: new Date(),
    };

    // Check if sender is blocked
    if (this.policy.blockListedNumbers.includes(senderId)) {
      context.isBlocked = true;
      this.logger.warn(`🚫 Blocked message from: ${senderId}`);
      return context;
    }

    // Check rate limits
    const rateLimitCheck = this.checkRateLimit(senderId);
    context.rateLimitExceeded = rateLimitCheck.exceeded;
    context.messageCount = rateLimitCheck.count;

    if (rateLimitCheck.exceeded) {
      this.logger.warn(`⚠️  Rate limit exceeded for: ${senderId}`);
      if (this.policy.auditLogging) {
        await this.logSecurityEvent('RATE_LIMIT_EXCEEDED', senderId, {
          count: rateLimitCheck.count,
          limit: this.policy.maxMessagesPerMinute,
        });
      }
    }

    return context;
  }

  /**
   * Check if sender exceeds rate limits
   */
  private checkRateLimit(senderId: string): { exceeded: boolean; count: number } {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // Get or initialize message timestamps for this sender
    let timestamps = this.messageStore.get(senderId) || [];

    // Remove timestamps older than 1 minute
    timestamps = timestamps.filter((ts) => ts > oneMinuteAgo);

    // Check against minute limit
    const minuteExceeded = timestamps.length >= this.policy.maxMessagesPerMinute;

    // Add current timestamp
    timestamps.push(now);

    // Store updated timestamps
    this.messageStore.set(senderId, timestamps);

    return {
      exceeded: minuteExceeded,
      count: timestamps.length,
    };
  }

  /**
   * Log security events to database
   */
  async logSecurityEvent(
    eventType: string,
    senderId: string,
    details: Record<string, any>
  ): Promise<void> {
    try {
      // This would write to audit_logs table in production
      // For now, just log
      this.logger.info(`🔒 Security Event: ${eventType}`, {
        senderId,
        details,
      });
    } catch (error) {
      this.logger.error(`Failed to log security event: ${error}`);
    }
  }

  /**
   * Block a sender (e.g., after abuse)
   */
  blockSender(senderId: string): void {
    if (!this.policy.blockListedNumbers.includes(senderId)) {
      this.policy.blockListedNumbers.push(senderId);
      this.logger.warn(`🚫 Blocked sender: ${senderId}`);
    }
  }

  /**
   * Unblock a sender
   */
  unblockSender(senderId: string): void {
    this.policy.blockListedNumbers = this.policy.blockListedNumbers.filter(
      (num) => num !== senderId
    );
    this.logger.info(`✅ Unblocked sender: ${senderId}`);
  }

  /**
   * Get security metrics
   */
  getMetrics(): {
    blockedCount: number;
    activeConnections: number;
    rateLimitViolations: number;
  } {
    return {
      blockedCount: this.policy.blockListedNumbers.length,
      activeConnections: this.messageStore.size,
      rateLimitViolations: 0, // Would track from database
    };
  }
}

export function createSecurityManager(
  db: DatabaseClient,
  logger: any,
  policy?: Partial<SecurityPolicy>
): SecurityManager {
  return new SecurityManager(db, logger, policy);
}
