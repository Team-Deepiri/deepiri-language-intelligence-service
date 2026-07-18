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

## Bedd (LIS-only)

Bedd is an optional **skill filter** on the LIS document publish path — not a platform data-plane hop and not embedded into Cyrex/Helox/Sugar Glider/other workers.

Before `document.*` routes go out via Sugar Glider, LIS may run:

```text
bedd eval <skill> '<json>'
```

Defaults in the LIS image:

| Var | Default |
|-----|---------|
| `BEDD_ENABLED` | `true` in Docker; unset locally = auto if binary present |
| `BEDD_BIN` | `/usr/local/bin/bedd` |
| `BEDD_SKILL` | `drop_fields` |
| `BEDD_DROP_FIELDS` | common PII keys (`ssn`, `email`, …) |
| `BEDD_SKILLS_DIR` | `/opt/bedd/skills` |

Fail-open: if Bedd is missing or errors, routes still publish. Set `BEDD_ENABLED=false` to skip entirely.

Transport remains Sugar Glider / Synapse. Bedd does not replace document routing.
