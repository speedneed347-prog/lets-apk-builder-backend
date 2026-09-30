# Production Deployment

## 1. Render backend

Create a Render Web Service using this repository.

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health/ready`

Set all variables from `.env.example` in Render. Never commit real Firebase keys, GitHub tokens, signing keys or webhook secrets.

## 2. Firebase

Enable Firestore and create a service account. Put the service account values in:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

The backend uses Firestore for builds, queue state, history, artifact records and temporary build inputs.

## 3. GitHub repository

The workflow is `.github/workflows/build-apk.yml`.

Required repository secrets:

- `BACKEND_URL`
- `WEBHOOK_SECRET`
- `INTERNAL_API_SECRET`
- `KEYSTORE_BASE64`
- `KEYSTORE_PASSWORD`
- `KEY_PASSWORD`
- `KEY_ALIAS`

`GITHUB_TOKEN` is provided to Actions automatically. The backend needs a GitHub token with permission to dispatch the workflow and the workflow needs `contents: write` for releases.

## 4. CORS

Set `CORS_ORIGINS` to the exact frontend origins, comma-separated. Do not use `*` in production.

## 5. Secrets

Generate a 64-byte hex secret with:

```bash
openssl rand -hex 64
```

Use separate values for `WEBHOOK_SECRET`, `INTERNAL_API_SECRET`, and `JWT_SECRET`.

## 6. Readiness

After deployment check:

```text
GET /api/health/live
GET /api/health/ready
GET /api/platform
```

The ready endpoint should return HTTP 200 only when Firestore can be reached.
