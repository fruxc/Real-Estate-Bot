/**
 * LLM Engine
 * Handles Claude and GPT-4o API calls with cost tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import pino from 'pino';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateOptions {
  messages: LLMMessage[];
  systemPrompt?: string;
  model?: 'sonnet' | 'haiku' | 'gpt4o';
  maxTokens?: number;
  temperature?: number;
}

export class LLMEngine {
  private anthropic: Anthropic;
  private openai: OpenAI;
  private logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger;
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async initialize(): Promise<void> {
    // Test API connections
    try {
      // Test Anthropic
      await this.anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });
      this.logger.info('✅ Anthropic API connected');

      // Test OpenAI
      await this.openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });
      this.logger.info('✅ OpenAI API connected');
    } catch (error) {
      this.logger.error('API initialization failed:', error);
      throw error;
    }
  }

  async generate(options: GenerateOptions): Promise<{
    text: string;
    tokens: number;
    costCents: number;
    model: string;
    stopReason: string;
  }> {
    const model = options.model || 'sonnet';
    const maxTokens = options.maxTokens || 500;
    const temperature = options.temperature ?? 0.7;

    try {
      if (model === 'gpt4o') {
        return await this.generateWithOpenAI(options, maxTokens, temperature);
      } else {
        return await this.generateWithAnthropic(options, model, maxTokens, temperature);
      }
    } catch (error) {
      this.logger.error('LLM generation failed:', error);
      throw error;
    }
  }

  private async generateWithAnthropic(
    options: GenerateOptions,
    model: 'sonnet' | 'haiku',
    maxTokens: number,
    temperature: number
  ): Promise<{ text: string; tokens: number; costCents: number; model: string; stopReason: string }> {
    const modelId =
      model === 'haiku' ? 'claude-3-5-haiku-20241022' : 'claude-3-5-sonnet-20241022';

    const response = await this.anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      system: options.systemPrompt,
      messages: options.messages.filter((m) => m.role !== 'system'),
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    // Cost calculation (as of March 2026)
    const inputCost = model === 'haiku' ? inputTokens * 0.00008 : inputTokens * 0.003 / 1000;
    const outputCost = model === 'haiku' ? outputTokens * 0.0004 : outputTokens * 0.015 / 1000;
    const costCents = Math.ceil((inputCost + outputCost) * 100);

    return {
      text,
      tokens: inputTokens + outputTokens,
      costCents,
      model: modelId,
      stopReason: response.stop_reason || 'unknown',
    };
  }

  private async generateWithOpenAI(
    options: GenerateOptions,
    maxTokens: number,
    temperature: number
  ): Promise<{ text: string; tokens: number; costCents: number; model: string; stopReason: string }> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      temperature,
      messages: options.messages,
    });

    const text = response.choices[0].message.content || '';
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;

    // Cost for GPT-4o (as of March 2026)
    const inputCost = (inputTokens * 0.005) / 1000;
    const outputCost = (outputTokens * 0.015) / 1000;
    const costCents = Math.ceil((inputCost + outputCost) * 100);

    return {
      text,
      tokens: inputTokens + outputTokens,
      costCents,
      model: 'gpt-4o',
      stopReason: response.choices[0].finish_reason || 'unknown',
    };
  }
}
