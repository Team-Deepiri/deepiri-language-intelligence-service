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

function leaseFixture(overrides = {}) {
  return {
    id: 'lease-1',
    leaseNumber: 'L-100',
    tenantName: 'Acme Tenant',
    landlordName: 'Deepiri Landlord',
    propertyAddress: '100 Main Street',
    propertyType: 'office',
    documentUrl: 's3://language-intelligence-documents/leases/lease-1.pdf',
    documentStorageKey: 'leases/lease-1.pdf',
    documentType: 'application/pdf',
    fileSize: 4096,
    userId: 'user-1',
    organizationId: 'org-1',
    extractionConfidence: 0.92,
    ...overrides,
  };
}

function contractFixture(overrides = {}) {
  return {
    id: 'contract-1',
    contractNumber: 'C-100',
    contractName: 'Vendor Master Services Agreement',
    partyA: 'Deepiri',
    partyB: 'Vendor Co',
    contractType: 'msa',
    jurisdiction: 'NY',
    documentUrl: 's3://language-intelligence-documents/contracts/contract-1.pdf',
    documentStorageKey: 'contracts/contract-1.pdf',
    documentType: 'application/pdf',
    fileSize: 8192,
    userId: 'user-1',
    organizationId: 'org-1',
    extractionConfidence: 0.88,
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

test('publishes lease vectorize, structured, and training routes when quality is high enough', async () => {
  const { published, service } = createServiceHarness();
  const rawText = 'rent due monthly '.repeat(3000);

  const result = await service.publishLeaseRoutes({
    lease: leaseFixture(),
    rawText,
    abstractedTerms: { rent: { amount: 1000, currency: 'USD' } },
    qualityScore: 0.92,
    versionNumber: 1,
    processingTimeMs: 42,
  });

  assert.equal(result.status, 'published');
  assert.deepEqual(
    published.map((item) => item.streamName),
    ['document.vectorize', 'document.structured', 'document.training']
  );

  const vectorizeEvent = published[0].event;
  assert.equal(vectorizeEvent.schemaVersion, '1.0');
  assert.equal(vectorizeEvent.correlation_id, 'lease:lease-1:lease:1');
  assert.equal(vectorizeEvent.data.routeId, 'document-route:lease-1:vectorize:manifest:lease:1');
  assert.equal(vectorizeEvent.data.chunks[0].text.length, DOCUMENT_ROUTE_TEXT_CHAR_LIMIT);
  assert.equal(vectorizeEvent.data.chunks[0].metadata.truncated, true);

  const trainingEvent = published[2].event;
  assert.equal(trainingEvent.data.trainingPayload.category, 'lease_abstraction');
  assert.equal(trainingEvent.data.trainingPayload.quality_score, 0.92);
  assert.equal(trainingEvent.data.trainingPayload.input.length, DOCUMENT_ROUTE_TEXT_CHAR_LIMIT);
});

test('rejects lease route publication when the lease ID is missing', async () => {
  const { published, service } = createServiceHarness();

  await assert.rejects(
    service.publishLeaseRoutes({
      lease: leaseFixture({ id: undefined }),
      rawText: 'lease text',
      abstractedTerms: { rent: { amount: 1000 } },
      qualityScore: 0.92,
      versionNumber: 1,
      processingTimeMs: 42,
    }),
    /Missing primary document ID for lease/
  );

  assert.equal(published.length, 0);
});

test('skips document.training when the quality score is below the Helox threshold', async () => {
  const { published, service } = createServiceHarness();

  const result = await service.publishLeaseRoutes({
    lease: leaseFixture({ extractionConfidence: 0.39 }),
    rawText: 'short lease text',
    abstractedTerms: { rent: { amount: 1000 } },
    qualityScore: 0.39,
    versionNumber: 1,
    processingTimeMs: 12,
  });

  assert.deepEqual(
    published.map((item) => item.streamName),
    ['document.vectorize', 'document.structured']
  );
  assert.equal(result.skipped[0].destination, 'training');
  assert.equal(result.skipped[0].reason, 'training_quality_below_threshold');
});

test('drops circular references while publishing structured and training payloads', async () => {
  const { published, service } = createServiceHarness();
  const abstractedTerms = {
    rent: { amount: 1000, currency: 'USD' },
  };
  abstractedTerms.self = abstractedTerms;

  const result = await service.publishLeaseRoutes({
    lease: leaseFixture(),
    rawText: 'rent due monthly',
    abstractedTerms,
    qualityScore: 0.92,
    versionNumber: 1,
    processingTimeMs: 42,
  });

  assert.equal(result.status, 'published');

  const structuredEvent = published.find((item) => item.streamName === 'document.structured');
  assert.ok(structuredEvent);
  assert.deepEqual(
    structuredEvent.event.data.structuredOutput.rent,
    { amount: 1000, currency: 'USD' }
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(structuredEvent.event.data.structuredOutput, 'self'),
    false
  );

  const trainingEvent = published.find((item) => item.streamName === 'document.training');
  assert.ok(trainingEvent);
  const trainingOutput = JSON.parse(trainingEvent.event.data.trainingPayload.output);
  assert.deepEqual(trainingOutput.rent, { amount: 1000, currency: 'USD' });
  assert.equal(Object.prototype.hasOwnProperty.call(trainingOutput, 'self'), false);
});

test('publishes contract routes with contract-specific routing metadata', async () => {
  const { published, service } = createServiceHarness();

  const result = await service.publishContractRoutes({
    contract: contractFixture(),
    rawText: 'contract terms and obligations',
    abstractedTerms: { obligations: [{ description: 'Maintain insurance' }] },
    qualityScore: 0.88,
    versionNumber: 2,
    processingTimeMs: 80,
  });

  assert.equal(result.manifestVersion, 'contract:2');
  assert.deepEqual(
    published.map((item) => item.streamName),
    ['document.vectorize', 'document.structured', 'document.training']
  );
  assert.equal(published[0].event.correlation_id, 'contract:contract-1:contract:2');
  assert.equal(
    published[0].event.data.routeId,
    'document-route:contract-1:vectorize:manifest:contract:2'
  );
  assert.equal(
    published[2].event.data.trainingPayload.category,
    'contract_intelligence'
  );
});

test('rejects contract route publication when the contract ID is blank', async () => {
  const { published, service } = createServiceHarness();

  await assert.rejects(
    service.publishContractRoutes({
      contract: contractFixture({ id: '   ' }),
      rawText: 'contract text',
      abstractedTerms: { obligations: [{ description: 'Maintain insurance' }] },
      qualityScore: 0.88,
      versionNumber: 2,
      processingTimeMs: 80,
    }),
    /Missing primary document ID for contract/
  );

  assert.equal(published.length, 0);
});

test('drops circular references from existing document routing metadata', () => {
  const existingMetadata = { requestId: 'request-1' };
  existingMetadata.self = existingMetadata;

  const metadata = buildDocumentRoutingMetadata(existingMetadata, {
    status: 'published',
    documentId: 'lease-1',
    manifestVersion: 'lease:1',
    publishedAt: '2026-05-30T00:00:00.000Z',
    planned: [
      {
        destination: 'vectorize',
        streamName: 'document.vectorize',
        routeId: 'document-route:lease-1:vectorize:manifest:lease:1',
      },
    ],
    skipped: [],
  });

  assert.equal(metadata.requestId, 'request-1');
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'self'), false);
  assert.equal(metadata.documentRouting.documentId, 'lease-1');
});
