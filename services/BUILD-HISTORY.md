# Build History + Artifact Records

Step 11 stores durable build history and artifact metadata in Firestore subcollections.

## Firestore layout

```text
builds/{buildId}
  ├── history/{eventId}
  └── artifacts/{artifactId}
```

### History event

Each event records status, previous status, current step, step index, message, source and timestamp.

### Artifact record

Each artifact records type (`apk`/`aab`), filename, URL, SHA-256, size and creation time.

## API

```text
GET /api/build/:buildId/history?limit=100
GET /api/build/:buildId/artifacts
```

Both endpoints apply the same ownership check used by the normal build endpoint when `JWT_ENABLED=true`.

## Build summary fields

Build documents now also keep `durationMs`, queue timestamps, dispatch state, current step and step index. Large logs remain in the existing `logs` field for backward compatibility; the durable history is stored as individual Firestore documents so the build document does not grow indefinitely.
