const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  DOCUMENT_ROUTE_TEXT_CHAR_LIMIT,
  DocumentRoutePublicationService,
  buildDocumentRoutingMetadata,
} = require('../dist/services/documentRoutePublicationService');
const {
  buildRoutingIdempotencyKey,
} = require('../dist/documentRouting/routingMetadata');
const {
  assertDocumentVersionAccess,
  DocumentVersionAccessError,
} = require('../dist/services/documentVersionAccess');

function createServiceHarness() {
  const published = [];
  const service = new DocumentRoutePublicationService(async (streamName, event) => {
    published.push({ streamName, event });
  });

  return { published, service };
}

function documentFixture(overrides = {}) {
  return {
    id: 'document-1',
    title: 'Operating Policy',
    documentUrl: 's3://language-intelligence-documents/documents/document-1.pdf',
    documentStorageKey: 'documents/document-1.pdf',
    contentType: 'application/pdf',
    fileSize: 4096,
    userId: 'user-1',
    organizationId: 'org-1',
    ...overrides,
  };
}

function routeInput(overrides = {}) {
  return {
    document: documentFixture(),
    documentType: 'policy',
    schemaId: 'generic.document',
    schemaVersion: '1.0',
    rawText: 'policy language '.repeat(3000),
    structuredOutput: {
      summary: 'A dynamic policy extraction.',
      entities: [{ type: 'party', value: 'Deepiri' }],
    },
    qualityScore: 0.92,
    versionNumber: 3,
    processingTimeMs: 42,
    classification: {
      businessDomain: 'operations',
    },
    metadata: {
      legacy: {
        sourceModel: 'lease',
        leaseNumber: 'L-100',
      },
    },
    artifactRequests: [
      {
        artifactType: 'document.extraction',
        capability: 'cyrex.artifact_store',
        schemaId: 'generic.document',
        schemaVersion: '1.0',
        templateId: 'generic.document.extraction.v1',
      },
    ],
    provenance: {
      extractionRunId: 'extraction-run-1',
      sourcePipeline: 'document-route-publication-test',
    },
    ...overrides,
  };
}

function hashKeyPart(value) {
  return createHash('sha256').update(String(value).trim()).digest('hex');
}

function expectedRouteId(documentId, destination, manifestVersion, fingerprint) {
  const parts = [
    'document-route',
    `document:${hashKeyPart(documentId)}`,
    destination,
    `manifest:${hashKeyPart(manifestVersion)}`,
  ];

  if (fingerprint) {
    parts.push(`fingerprint:${hashKeyPart(fingerprint)}`);
  }

  return parts.join(':');
}

test('uses manifest version and fingerprint for route idempotency keys', () => {
  const key = buildRoutingIdempotencyKey({
    documentId: 'doc 1',
    destination: 'training',
    manifestVersion: 'manifest 2',
    fingerprint: 'fingerprint-that-should-not-win',
  });

  assert.equal(
    key,
    expectedRouteId('doc 1', 'training', 'manifest 2', 'fingerprint-that-should-not-win')
  );

  const hyphenatedDocumentKey = buildRoutingIdempotencyKey({
    documentId: 'doc-1',
    destination: 'training',
    manifestVersion: 'manifest 2',
  });

  assert.notEqual(key, hyphenatedDocumentKey);
  assert.match(
    key,
    /^document-route:document:[a-f0-9]{64}:training:manifest:[a-f0-9]{64}:fingerprint:[a-f0-9]{64}$/
  );
});

test('requires the authenticated tenant to own a document version', () => {
  const owner = {
    userId: 'user-1',
    organizationId: 'org-1',
  };

  assert.doesNotThrow(() => assertDocumentVersionAccess(owner, owner));
  assert.throws(
    () => assertDocumentVersionAccess({ userId: 'user-2', organizationId: 'org-1' }, owner),
    (error) => error instanceof DocumentVersionAccessError && error.statusCode === 403
  );
  assert.throws(
    () => assertDocumentVersionAccess({ userId: 'user-1', organizationId: 'org-2' }, owner),
    (error) => error instanceof DocumentVersionAccessError && error.statusCode === 403
  );
  assert.throws(
    () => assertDocumentVersionAccess(undefined, owner),
    (error) => error instanceof DocumentVersionAccessError && error.statusCode === 401
  );
});

test('publishes dynamic document vectorize, structured, and training routes', async () => {
  const { published, service } = createServiceHarness();

  const result = await service.publishDocumentRoutes(routeInput());

  assert.equal(result.status, 'published');
  assert.equal(result.manifestVersion, 'document:3');
  assert.deepEqual(
    published.map((item) => item.streamName),
    ['document.vectorize', 'document.structured', 'document.training']
  );

  const vectorizeEvent = published[0].event;
  assert.equal(vectorizeEvent.schemaVersion, 'document.route.v1');
  assert.equal(vectorizeEvent.correlation_id, 'document:document-1:document:3');
  assert.equal(vectorizeEvent.payload, undefined);
  assert.equal(vectorizeEvent.data.sourceRoute.streamName, 'document.vectorize');
  assert.equal(vectorizeEvent.data.sourceRoute.schemaVersion, 'document.route.v1');
  assert.equal(vectorizeEvent.data.routeId, expectedRouteId('document-1', 'vectorize', 'document:3'));
  assert.equal(vectorizeEvent.data.documentType, 'policy');
  assert.equal(vectorizeEvent.data.schemaId, 'generic.document');
  assert.equal(vectorizeEvent.data.schemaVersion, '1.0');
  assert.equal(vectorizeEvent.data.artifactRequests[0].artifactType, 'document.extraction');
  assert.equal(vectorizeEvent.data.artifactRequests[0].capability, 'cyrex.artifact_store');
  assert.equal(vectorizeEvent.data.provenance.sourceService, 'language-intelligence-service');
  assert.equal(vectorizeEvent.data.provenance.sourceDocumentId, 'document-1');
  assert.equal(vectorizeEvent.data.provenance.extractionRunId, 'extraction-run-1');
  assert.equal(vectorizeEvent.data.document.documentType, 'policy');
  assert.equal(vectorizeEvent.data.document.schemaId, 'generic.document');
  assert.equal(vectorizeEvent.data.document.schemaVersion, '1.0');
  assert.equal(vectorizeEvent.data.document.mimeType, 'application/pdf');
  assert.equal(vectorizeEvent.data.chunks[0].text.length, DOCUMENT_ROUTE_TEXT_CHAR_LIMIT);
  assert.equal(vectorizeEvent.data.chunks[0].metadata.truncated, true);
  assert.equal(vectorizeEvent.data.metadata.legacy.sourceModel, 'lease');
  assert.equal(vectorizeEvent.data.metadata.legacy.leaseNumber, 'L-100');
});

test('keeps legacy identifiers under metadata instead of the route contract', async () => {
  const { published, service } = createServiceHarness();

  await service.publishDocumentRoutes(routeInput());

  const payload = published[0].event.data;
  assert.equal(payload.leaseId, undefined);
  assert.equal(payload.contractId, undefined);
  assert.equal(payload.leaseNumber, undefined);
  assert.equal(payload.contractNumber, undefined);
  assert.equal(payload.clauseId, undefined);
  assert.equal(payload.obligationId, undefined);
  assert.equal(payload.metadata.legacy.leaseNumber, 'L-100');
});

test('omits legacy document labels that are not MIME types', async () => {
  const { published, service } = createServiceHarness();

  await service.publishDocumentRoutes(routeInput({
    document: documentFixture({ contentType: 'PDF' }),
  }));

  assert.equal(published[0].event.data.document.mimeType, undefined);
});

test('rejects document route publication when required dynamic fields are missing', async () => {
  const { published, service } = createServiceHarness();

  await assert.rejects(
    service.publishDocumentRoutes(routeInput({ document: documentFixture({ id: undefined }) })),
    /Missing primary document ID/
  );

  await assert.rejects(
    service.publishDocumentRoutes(routeInput({ schemaId: '   ' })),
    /Missing document schema ID/
  );

  assert.equal(published.length, 0);
});

test('skips document.training when the quality score is below the Helox threshold', async () => {
  const { published, service } = createServiceHarness();

  const result = await service.publishDocumentRoutes(routeInput({ qualityScore: 0.39 }));

  assert.deepEqual(
    published.map((item) => item.streamName),
    ['document.vectorize', 'document.structured']
  );
  assert.equal(result.skipped[0].destination, 'training');
  assert.equal(result.skipped[0].reason, 'training_quality_below_threshold');
});

test('skips document.structured when no structured output is available', async () => {
  const { published, service } = createServiceHarness();

  const result = await service.publishDocumentRoutes(routeInput({
    destinations: ['structured'],
    structuredOutput: undefined,
  }));

  assert.equal(result.status, 'skipped');
  assert.equal(published.length, 0);
  assert.deepEqual(result.skipped, [
    {
      destination: 'vectorize',
      reason: 'destination_not_requested',
    },
    {
      destination: 'structured',
      reason: 'missing_structured_output',
      message: 'Structured route requires structuredOutput.',
    },
    {
      destination: 'training',
      reason: 'destination_not_requested',
    },
  ]);
});

test('records a partial result when one requested route cannot be published', async () => {
  const published = [];
  const service = new DocumentRoutePublicationService(async (streamName, event) => {
    if (streamName === 'document.training') {
      throw new Error('training stream unavailable');
    }

    published.push({ streamName, event });
  });

  const result = await service.publishDocumentRoutes(routeInput());

  assert.equal(result.status, 'partial');
  assert.deepEqual(
    published.map((item) => item.streamName),
    ['document.vectorize', 'document.structured']
  );
  assert.deepEqual(result.planned.map((route) => route.destination), ['vectorize', 'structured']);
  assert.deepEqual(result.failed, [
    {
      destination: 'training',
      streamName: 'document.training',
      routeId: expectedRouteId('document-1', 'training', 'document:3'),
      error: 'training stream unavailable',
    },
  ]);
});

test('drops circular references while publishing structured and training payloads', async () => {
  const { published, service } = createServiceHarness();
  const structuredOutput = {
    summary: 'A dynamic extraction.',
  };
  structuredOutput.self = structuredOutput;

  const result = await service.publishDocumentRoutes(routeInput({ structuredOutput }));

  assert.equal(result.status, 'published');

  const structuredEvent = published.find((item) => item.streamName === 'document.structured');
  assert.ok(structuredEvent);
  assert.equal(structuredEvent.event.data.structuredOutput.summary, 'A dynamic extraction.');
  assert.equal(
    Object.prototype.hasOwnProperty.call(structuredEvent.event.data.structuredOutput, 'self'),
    false
  );

  const trainingEvent = published.find((item) => item.streamName === 'document.training');
  assert.ok(trainingEvent);
  const trainingOutput = JSON.parse(trainingEvent.event.data.trainingPayload.output);
  assert.equal(trainingOutput.summary, 'A dynamic extraction.');
  assert.equal(Object.prototype.hasOwnProperty.call(trainingOutput, 'self'), false);
});

test('uses caller-provided manifestVersion when present', async () => {
  const { published, service } = createServiceHarness();

  const result = await service.publishDocumentRoutes(routeInput({
    manifestVersion: 'schema-run:2026-06-05',
    versionNumber: 99,
  }));

  assert.equal(result.manifestVersion, 'schema-run:2026-06-05');
  assert.equal(
    published[0].event.data.routeId,
    expectedRouteId('document-1', 'vectorize', 'schema-run:2026-06-05')
  );
});

test('preserves Map and Set values in structured and training route payloads', async () => {
  const { published, service } = createServiceHarness();
  const structuredOutput = new Map([
    ['summary', 'A dynamic extraction from a Map.'],
    ['entities', new Set(['Deepiri', 'Cyrex'])],
    ['metrics', new Map([['quality', 0.95]])],
  ]);
  structuredOutput.set('self', structuredOutput);

  const result = await service.publishDocumentRoutes(routeInput({ structuredOutput }));

  assert.equal(result.status, 'published');

  const structuredEvent = published.find((item) => item.streamName === 'document.structured');
  assert.ok(structuredEvent);
  assert.deepEqual(structuredEvent.event.data.structuredOutput, {
    summary: 'A dynamic extraction from a Map.',
    entities: ['Deepiri', 'Cyrex'],
    metrics: {
      quality: 0.95,
    },
  });

  const trainingEvent = published.find((item) => item.streamName === 'document.training');
  assert.ok(trainingEvent);
  const trainingOutput = JSON.parse(trainingEvent.event.data.trainingPayload.output);
  assert.deepEqual(trainingOutput, {
    summary: 'A dynamic extraction from a Map.',
    entities: ['Deepiri', 'Cyrex'],
    metrics: {
      quality: 0.95,
    },
  });
});

test('drops circular references from existing document routing metadata', () => {
  const existingMetadata = { requestId: 'request-1' };
  existingMetadata.self = existingMetadata;

  const metadata = buildDocumentRoutingMetadata(existingMetadata, {
    status: 'published',
    documentId: 'document-1',
    manifestVersion: 'document:3',
    publishedAt: '2026-06-05T00:00:00.000Z',
    planned: [
      {
        destination: 'vectorize',
        streamName: 'document.vectorize',
        routeId: expectedRouteId('document-1', 'vectorize', 'document:3'),
      },
    ],
    failed: [],
    skipped: [],
  });

  assert.equal(metadata.requestId, 'request-1');
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'self'), false);
  assert.equal(metadata.documentRouting.documentId, 'document-1');
});
