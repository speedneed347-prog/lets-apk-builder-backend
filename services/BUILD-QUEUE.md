# Step 7 — Build Queue

The backend now serializes GitHub Actions Android builds through a Firestore-backed queue.

## Flow

```text
POST /api/build
   ↓
Firestore build = queued
   ↓
Queue pump claims oldest build
   ↓
GitHub Actions workflow_dispatch
   ↓
Worker sends progress webhooks
   ↓
completed / failed
   ↓
Queue slot released
   ↓
Next queued build is dispatched
```

## Queue state

Firestore document:

```text
system/buildQueue
```

It contains the active build ID and a lease timestamp. The lease is slightly longer than the GitHub Actions job timeout so a crashed worker does not permanently block the queue.

## Environment variables

```env
BUILD_QUEUE_LEASE_MS=2100000
BUILD_QUEUE_POLL_MS=15000
```

`BUILD_QUEUE_LEASE_MS` defaults to 35 minutes. `BUILD_QUEUE_POLL_MS` defaults to 15 seconds and is never allowed below 5 seconds.

## Important behavior

- Oldest queued build is selected first.
- Firestore transactions prevent two backend instances from claiming the same slot.
- A completed/failed webhook releases the slot immediately.
- Render restarts resume queue processing automatically.
- If the active lease expires, that build is marked failed and the next build can proceed.
- GitHub Actions also has `concurrency` with `cancel-in-progress: false` as a second safety layer.
