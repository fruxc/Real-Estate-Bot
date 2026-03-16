/**
 * Types & Interfaces
 */

export interface Broker {
  id: string;
  phone_number: string;
  name?: string;
  location_focus?: string[];
  total_properties_shared: number;
  avg_asking_price?: number;
  conversation_count: number;
  last_active: Date;
  msg_count_today: number;
  turn_count_today: number;
  negotiation_status?: string;
  is_spam: boolean;
  notes?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Property {
  id: string;
  broker_id: string;
  carpet_area?: number;
  built_area?: number;
  bedrooms?: number;
  bathrooms?: number;
  location: string;
  address?: string;
  asking_price: number;
  deposit_amount?: number;
  price_negotiable: boolean;
  building_age?: number;
  rera_registration?: string;
  builder_name?: string;
  society_name?: string;
  amenities?: string[];
  furnishing?: string;
  parking_type?: string;
  financial_fit_score: number;
  evaluation_notes?: string;
  status: 'asking' | 'negotiating' | 'rejected' | 'selected';
  photos?: string[];
  videos?: string[];
  youtube_links?: string[];
  first_mentioned: Date;
  last_mentioned?: Date;
  times_mentioned: number;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Conversation {
  id: string;
  broker_id: string;
  property_id?: string;
  sender: 'broker' | 'agent';
  text_content: string;
  text_summary?: string;
  message_type: 'text' | 'voice' | 'video' | 'youtube' | 'image';
  media_url?: string;
  media_processed: boolean;
  processing_time_ms?: number;
  extracted_fields?: Record<string, any>;
  tokens_used?: number;
  cost_cents?: number;
  model_used?: string;
  pii_masked: boolean;
  injection_attempt: boolean;
  safety_flags?: string[];
  created_at: Date;
  turn_number?: number;
}

export interface RateLimit {
  id: string;
  broker_id: string;
  turn_count_today: number;
  api_calls_today: number;
  cost_cents_today: number;
  max_turns_per_day: number;
  max_api_calls_per_day: number;
  max_cost_cents_per_day: number;
  last_reset_at: Date;
}

export interface AuditLog {
  id: string;
  broker_id?: string;
  conversation_id?: string;
  action: string;
  severity: 'info' | 'warning' | 'critical';
  details?: Record<string, any>;
  actor?: string;
  timestamp: Date;
}
