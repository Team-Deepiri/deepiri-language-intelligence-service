/**
 * LIS document bus topics — must match ModelKit StreamTopics + shared-utils
 * (document.vectorize / training / structured / artifacts).
 * LIS owns business routing onto these streams; Sugar Glider owns transport.
 */
export const DOCUMENT_ROUTE_TOPICS = {
  VECTORIZE: 'document.vectorize',
  TRAINING: 'document.training',
  STRUCTURED: 'document.structured',
  /** Artifact materialization for Cyrex / downstream workers. */
  ARTIFACTS: 'document.artifacts',
} as const;

export type DocumentRouteTopic =
  (typeof DOCUMENT_ROUTE_TOPICS)[keyof typeof DOCUMENT_ROUTE_TOPICS];

export const DOCUMENT_ROUTE_SCHEMA_VERSION = 'document.route.v1';
