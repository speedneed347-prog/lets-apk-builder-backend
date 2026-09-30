# Backend ↔ Build Engine Integration

Step 10 defines the build contract between the Render backend and GitHub Actions.

## Request lifecycle

1. `POST /api/build` creates a Firestore build document.
2. The queue claims the oldest job and dispatches `build-apk.yml` with only `buildId` and `webhookUrl`.
3. GitHub Actions fetches the full configuration through the authenticated internal endpoints.
4. The build engine generates, compiles, signs and packages the requested APK/AAB.
5. GitHub Actions uploads the artifact and sends signed worker events to `/api/webhook/github`.
6. The backend validates status transitions, stores artifact metadata, releases the queue slot and starts the next job.

## Contract

Worker events include `buildId`, `status`, `timestamp`, and optionally `eventId`, `currentStep`, `stepIndex`, `logLine`, `artifactUrl`, `artifactType`, `artifactFileName`, `artifactSha256`, and `artifactSizeBytes`.

The backend never accepts a worker event without the HMAC signature and a fresh timestamp. Terminal builds cannot be resurrected by a late callback.

## Internal endpoints

- `GET /api/internal/config/:buildId`
- `GET /api/internal/zip/:buildId`
- `GET /api/internal/modules/:buildId`
- `GET /api/internal/module/:buildId/:moduleId`

All require `X-Internal-Secret: WEBHOOK_SECRET`.
