export const DOCUMENT_ROUTE_TOPICS = {
  VECTORIZE: 'document.vectorize',
  TRAINING: 'document.training',
  STRUCTURED: 'document.structured',
} as const;

export type DocumentRouteTopic =
  (typeof DOCUMENT_ROUTE_TOPICS)[keyof typeof DOCUMENT_ROUTE_TOPICS];
