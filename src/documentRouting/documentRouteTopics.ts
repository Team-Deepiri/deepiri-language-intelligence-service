export const DOCUMENT_ROUTE_TOPICS = {
  VECTORIZE: 'document.vectorize',
  TRAINING: 'document.training',
  STRUCTURED: 'document.structured',
  /** Artifact materialization requests for Cyrex / downstream workers. */
  ARTIFACTS: 'document.artifacts',
} as const;

export type DocumentRouteTopic =
  (typeof DOCUMENT_ROUTE_TOPICS)[keyof typeof DOCUMENT_ROUTE_TOPICS];
