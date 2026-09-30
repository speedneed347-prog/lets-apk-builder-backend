# Step 12 — Production Hardening

## Required Render configuration

Keep these secrets in Render Environment Variables / GitHub Actions Secrets; never commit them:

- `WEBHOOK_SECRET` — at least 32 random characters; 128 hex characters is recommended.
- `INTERNAL_API_SECRET` — recommended separate 128-hex worker secret. If omitted, `WEBHOOK_SECRET` remains supported.
- `GITHUB_TOKEN`
- Firebase credentials
- `CORS_ORIGINS` — explicit frontend origins in production; do not use `*`.

## Generate secrets in Termux

```bash
openssl rand -hex 64
```

Run twice: once for `WEBHOOK_SECRET`, once for `INTERNAL_API_SECRET`.

## Security layers added

- request IDs via `X-Request-Id`
- Helmet/HSTS in production
- `X-Powered-By` disabled
- JSON body and parameter limits
- request timeout protection (SSE excluded)
- HMAC webhook verification against the exact raw request body
- webhook timestamp freshness window
- required webhook `eventId`
- webhook rate limiting
- worker-only internal endpoint authentication with constant-time comparison
- internal endpoint rate limiting
- production configuration validation
- liveness and readiness health endpoints
- existing build/module validation and queue lease protection remain active

## Health endpoints

- `GET /api/health`
- `GET /api/health/live`
- `GET /api/health/ready`

`/api/health/ready` performs a Firestore read and returns HTTP 503 if the backend cannot reach its database.

## Firestore input cleanup

After a build reaches `completed` or `failed`, the backend removes the stored offline ZIP chunks and custom-module chunks. Build history, logs, build metadata and artifact records are retained. Set `CLEANUP_BUILD_INPUTS=false` only when debugging/recovery requires keeping the inputs.
