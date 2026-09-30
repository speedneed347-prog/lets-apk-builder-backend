# Let-S APK Builder

Production-ready mini Android build platform backend.

## Platform

- Node.js + Express API
- Firestore persistence
- Persistent FIFO build queue
- GitHub Actions Android build worker
- APK and AAB output
- APK zipalign + apksigner signing
- AAB jarsigner signing
- Native/custom module system
- Build history + artifact records
- Live SSE build logs
- HMAC-signed worker webhooks with event idempotency
- Internal worker secret
- Rate limits, request limits and production validation
- Automatic temporary build-input cleanup
- Health/readiness endpoints
- Render deployment configuration

## Build lifecycle

```text
queued → building → signing → uploading → completed
                                      ↘ failed
```

## Main endpoints

```text
POST /api/build
GET  /api/build/:id
GET  /api/build/:id/stream
GET  /api/build/:id/history
GET  /api/build/:id/artifacts
GET  /api/download/:id
GET  /api/common-modules
GET  /api/platform
GET  /api/health
GET  /api/health/live
GET  /api/health/ready
```

See `docs/API.md` for the API contract and `docs/DEPLOYMENT.md` for Render/GitHub/Firebase deployment.

## Local preflight

```bash
npm install
node scripts/preflight.js
```

## Example

Start with `examples/build-config.json` and send the configuration through `POST /api/build`.

## Important

Never commit real secrets. Production secrets belong in Render/GitHub secret storage.
