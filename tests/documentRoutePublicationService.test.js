const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DOCUMENT_ROUTE_TEXT_CHAR_LIMIT,
  DocumentRoutePublicationService,
  buildDocumentRoutingMetadata,
} = require('../dist/services/documentRoutePublicationService');
const {
  buildRoutingIdempotencyKey,
} = require('../dist/documentRouting/routingMetadata');

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
    ...overrides,
  };
}

test('uses manifest version, not fingerprint, for route idempotency keys', () => {
  const key = buildRoutingIdempotencyKey({
    documentId: 'doc 1',
    destination: 'training',
    manifestVersion: 'manifest 2',
    fingerprint: 'fingerprint-that-should-not-win',
  });

  assert.equal(key, 'document-route:doc-1:training:manifest:manifest-2');
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
  assert.equal(vectorizeEvent.data.routeId, 'document-route:document-1:vectorize:manifest:document:3');
  assert.equal(vectorizeEvent.data.documentType, 'policy');
  assert.equal(vectorizeEvent.data.schemaId, 'generic.document');
  assert.equal(vectorizeEvent.data.schemaVersion, '1.0');
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
  assert.equal(payload.metadata.legacy.leaseNumber, 'L-100');
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
    'document-route:document-1:vectorize:manifest:schema-run:2026-06-05'
  );
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
        routeId: 'document-route:document-1:vectorize:manifest:document:3',
      },
    ],
    skipped: [],
  });

  assert.equal(metadata.requestId, 'request-1');
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'self'), false);
  assert.equal(metadata.documentRouting.documentId, 'document-1');
});
