# Let-S APK Builder — Final Platform

## What it is

Let-S APK Builder is a queue-based Android build platform. A client submits a validated build configuration; the backend stores the job and temporary inputs in Firestore; a single queue slot dispatches GitHub Actions; the worker generates, builds, signs and uploads an APK or AAB; signed webhook events update status, history and artifact metadata.

## Production flow

```text
Frontend
  ↓ POST /api/build
Validation + ownership/admin checks
  ↓
Firestore build record + history
  ↓
Persistent FIFO queue
  ↓
GitHub Actions worker
  ├─ fetch config / inputs
  ├─ scan modules
  ├─ generate Android project
  ├─ install modules
  ├─ Gradle build
  ├─ APK zipalign + apksigner / AAB jarsigner
  ├─ artifact SHA-256
  └─ GitHub Release upload
  ↓ signed webhook
Backend integration layer
  ↓
Build status + logs + history + artifact records
  ↓
Frontend SSE / REST
```

## Supported output

- APK
- AAB

## Supported app modes

- online WebView
- offline WebView
- hybrid WebView
- native/custom-module mode

## Core production guarantees

- one active queued build per backend queue lock
- persistent queue state across Render restarts
- webhook HMAC and freshness verification
- webhook event idempotency
- internal worker secret
- request/rate limits
- strict build input validation
- signed artifacts
- SHA-256 artifact metadata
- build history and audit records
- automatic temporary-input cleanup after terminal builds
- health and readiness endpoints
- graceful queue shutdown

## Final deployment requirement

The repository is the source of truth. Render hosts the API/queue coordinator; GitHub Actions is the ephemeral Android build worker; Firestore is the persistent database. Signing secrets must exist only in protected secret stores.
