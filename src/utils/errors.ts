export class LanguageIntelligenceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'LanguageIntelligenceError';
  }
}

export class DocumentProcessingError extends LanguageIntelligenceError {
  constructor(message: string) {
    super(message, 400, 'DOCUMENT_PROCESSING_ERROR');
    this.name = 'DocumentProcessingError';
  }
}

export class ValidationError extends LanguageIntelligenceError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends LanguageIntelligenceError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

