/**
 * Input Validation for RealEstateBot
 * Validates all incoming messages and negotiation parameters
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate phone number format
 */
export function validatePhoneNumber(phone: string): boolean {
  // WhatsApp format validation (can be various formats)
  const cleaned = phone.replaceAll(/\D/g, '');
  return cleaned.length >= 7 && cleaned.length <= 15;
}

/**
 * Validate message content length
 */
export function validateMessageLength(content: string, maxLength: number = 4096): boolean {
  return !!(content && content.trim().length > 0 && content.length <= maxLength);
}

/**
 * Validate price (must be positive number)
 */
export function validatePrice(price: any): boolean {
  const num = Number.parseFloat(price);
  return !Number.isNaN(num) && num > 0 && num < 1000000000; // Up to 1 billion
}

/**
 * Validate property address
 */
export function validateAddress(address: string, minLength: number = 5): boolean {
  return !!(address && address.trim().length >= minLength);
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new (globalThis as any).URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize text input (remove suspicious characters)
 */
export function sanitizeText(text: string): string {
  return text
    .replaceAll(/[<>]/g, '') // Remove < >
    .replaceAll(/javascript:/gi, '') // Remove javascript:
    .replaceAll(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Main validator class
 */
export class MessageValidator {
  /**
   * Validate incoming message
   */
  static validateMessage(
    senderId: string,
    content: string,
    mediaType: string
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate sender ID (phone number)
    if (!validatePhoneNumber(senderId)) {
      errors.push('Invalid phone number format');
    }

    // Validate message content
    if (!validateMessageLength(content)) {
      errors.push('Message is empty or exceeds maximum length');
    }

    // Validate media type
    const validMediaTypes = ['text', 'audio', 'video', 'image', 'youtube', 'instagram'];
    if (!validMediaTypes.includes(mediaType)) {
      warnings.push(`Unknown media type: ${mediaType}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate negotiation parameters
   */
  static validateNegotiation(data: {
    propertyPrice?: any;
    offerPrice?: any;
    address?: string;
    bedrooms?: any;
    bathrooms?: any;
  }): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (data.propertyPrice && !validatePrice(data.propertyPrice)) {
      errors.push('Invalid property price');
    }

    if (data.offerPrice && !validatePrice(data.offerPrice)) {
      errors.push('Invalid offer price');
    }

    if (data.address && !validateAddress(data.address)) {
      errors.push('Address too short (minimum 5 characters)');
    }

    if (data.bedrooms && (Number.isNaN(data.bedrooms) || data.bedrooms < 0 || data.bedrooms > 20)) {
      errors.push('Invalid number of bedrooms');
    }

    if (data.bathrooms && (Number.isNaN(data.bathrooms) || data.bathrooms < 0 || data.bathrooms > 10)) {
      errors.push('Invalid number of bathrooms');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate contact information
   */
  static validateContact(data: {
    email?: string;
    phone?: string;
    website?: string;
  }): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (data.email && !validateEmail(data.email)) {
      errors.push('Invalid email format');
    }

    if (data.phone && !validatePhoneNumber(data.phone)) {
      errors.push('Invalid phone number format');
    }

    if (data.website && !validateUrl(data.website)) {
      errors.push('Invalid website URL');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Sanitize and validate message content
   */
  static sanitizeAndValidate(content: string): ValidationResult {
    const sanitized = sanitizeText(content);

    if (!validateMessageLength(sanitized)) {
      return {
        isValid: false,
        errors: ['Message content is invalid'],
        warnings: [],
      };
    }

    return {
      isValid: true,
      errors: [],
      warnings: sanitized === content ? [] : ['Message was sanitized for safety'],
    };
  }
}

export default MessageValidator;
