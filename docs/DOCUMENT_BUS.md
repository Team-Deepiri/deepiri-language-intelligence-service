# LIS document bus cohesion

LIS owns **business routing** onto the document streams. Sugar Glider owns **transport**.

## Streams (ModelKit / shared-utils aligned)

| Stream | Typical consumer |
|--------|------------------|
| `document.vectorize` | Cyrex / indexer (embed → vector store) |
| `document.structured` | Helox or LIS structured sink |
| `document.training` | Helox (doc-derived fine-tune rows) |
| `document.artifacts` | Artifact store / Cyrex workers |

Envelope: `schemaVersion: document.route.v1` via `DocumentProducerRouter`.

## Transport

- Default `SYNAPSE_TRANSPORT=sidecar`
- `SYNAPSE_SUGAR_GLIDER_URL` / `SYNAPSE_SIDECAR_URL` → `POST /v1/publish`
- Health probe: `/healthz` (fallback `/health`)
- Redis XADD fallback only if sidecar unavailable

## Separation from platform bus

`platform-events` / `ingestion-events` remain for LIS lifecycle UX (`document-created`, `document-processed`, …).

`document.*` is the **docs bus** for Cyrex/Helox closed loop — do not mix them.

## Bedd

Bedd is **not** required for this cohesion path. Optional Bedd workers on `document.*` belong in a separate integration/perf experiment.
