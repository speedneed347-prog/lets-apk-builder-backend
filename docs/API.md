# Let-S APK Builder API

Base URL: `https://<your-render-service>`

## Platform metadata
`GET /api/platform`

Returns API/contract versions, supported modes/formats and the main endpoints.

## Create build
`POST /api/build`

Minimal body:

```json
{
  "appType": "webview",
  "appMode": "online",
  "buildFormat": "apk",
  "appName": "My App",
  "websiteUrl": "https://example.com",
  "packageName": "com.example.myapp",
  "versionName": "1.0.0",
  "versionCode": 1
}
```

Response:

```json
{ "buildId": "...", "status": "queued" }
```

## Build status
`GET /api/build/:buildId`

## Live status/logs
`GET /api/build/:buildId/stream`

The endpoint uses Server-Sent Events. Clients should reconnect using `Last-Event-ID` where supported by the client.

## History
`GET /api/build/:buildId/history?limit=100`

## Artifacts
`GET /api/build/:buildId/artifacts`

## Download
`GET /api/download/:buildId`

Redirects to the completed GitHub Release artifact.

## Common modules
`GET /api/common-modules`

## Health
- `GET /api/health` — basic liveness
- `GET /api/health/live` — process liveness
- `GET /api/health/ready` — Firestore readiness

## Internal worker endpoints
These are not public APIs. They require `X-Internal-Secret` and are used by GitHub Actions:

- `GET /api/internal/config/:buildId`
- `GET /api/internal/zip/:buildId`
- `GET /api/internal/modules/:buildId`
- `GET /api/internal/module/:buildId/:moduleId`

## Webhook
`POST /api/webhook/github`

GitHub Actions sends signed worker events. The request must include:

- `X-Hub-Signature-256: sha256=<hex hmac>`
- `buildId`
- `eventId`
- `timestamp`

Webhook events are idempotent by `eventId`.
