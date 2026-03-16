/**
 * WhatsApp Client Wrapper
 * Handles connection, message listening, and sending
 */

import makeWASocket, { DisconnectReason } from 'Baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { MessageRouter } from './message-router';

export class WhatsAppClient {
  private sock: any;
  private messageRouter: MessageRouter;
  private logger: pino.Logger;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(messageRouter: MessageRouter, logger: pino.Logger) {
    this.messageRouter = messageRouter;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    try {
      this.sock = makeWASocket({
        auth: {
          creds: {},  // Baileys manages credentials
          keys: {},
        },
        printQRInTerminal: true,
        browser: ['Real Estate Bot', 'Chrome', '120.0'],
        logger: pino({ level: 'error' }),
        getMessage: async () => ({ conversation: 'Message not found' }),
      });

      this.setupEventHandlers();
      this.logger.info('✅ WhatsApp client initialized');
    } catch (error) {
      this.logger.error('WhatsApp connection failed:', error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    // Connection update
    this.sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.logger.info('📱 QR Code generated, scan with your secondary SIM WhatsApp');
      }

      if (connection === 'open') {
        this.logger.info('✅ WhatsApp connection established');
        this.reconnectAttempts = 0;
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== 401; // 401 = Invalid credentials

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          this.logger.warn(`🔄 Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          setTimeout(() => this.connect(), 5000);
        } else {
          this.logger.error('❌ Connection closed and cannot reconnect');
        }
      }
    });

    // Messages received
    this.sock.ev.on('messages.upsert', async ({ messages }: any) => {
      for (const message of messages) {
        try {
          await this.handleMessage(message);
        } catch (error) {
          this.logger.error('Error handling message:', error);
        }
      }
    });

    // Credentials updated
    this.sock.ev.on('creds.update', () => {
      // Baileys automatically saves credentials
      this.logger.debug('Credentials updated');
    });
  }

  private async handleMessage(message: any): Promise<void> {
    const senderId = message.key.remoteJid;
    const messageId = message.key.id;

    // Skip own messages and status updates
    if (message.key.fromMe || senderId === 'status@broadcast') {
      return;
    }

    // Extract content
    const content = message.message?.conversation || message.message?.extendedTextMessage?.text;
    const mediaType = message.message?.audioMessage
      ? 'audio'
      : message.message?.videoMessage
        ? 'video'
        : message.message?.imageMessage
          ? 'image'
          : 'text';

    this.logger.info(`📨 Message from ${senderId} (${mediaType}): ${content?.substring(0, 50)}...`);

    // Route to message handler
    await this.messageRouter.route({
      senderId,
      messageId,
      content: content || '',
      mediaType,
      mediaUrl: message.message?.[`${mediaType}Message`]?.url,
      timestamp: new Date(message.messageTimestamp * 1000),
      rawMessage: message,
    });
  }

  async sendMessage(phoneNumber: string, text: string): Promise<void> {
    try {
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

      // Send message
      await this.sock.sendMessage(jid, { text });

      this.logger.info(`📤 Message sent to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${phoneNumber}:`, error);
      throw error;
    }
  }

  async sendTyping(phoneNumber: string, isTyping = true): Promise<void> {
    try {
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

      await this.sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);

      if (isTyping) {
        this.logger.debug(`⌨️ Typing indicator sent to ${phoneNumber}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send typing indicator to ${phoneNumber}:`, error);
    }
  }

  async isConnected(): Promise<boolean> {
    return !!this.sock && this.sock.user !== undefined;
  }

  async disconnect(): Promise<void> {
    try {
      if (this.sock) {
        await this.sock.end();
        this.logger.info('✅ WhatsApp disconnected');
      }
    } catch (error) {
      this.logger.error('Error disconnecting:', error);
    }
  }
}
