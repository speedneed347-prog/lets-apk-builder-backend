# Step 8 — Build Status + Live Logs

The backend now exposes both a normal build-status endpoint and a Server-Sent Events (SSE) stream.

## Current status

```http
GET /api/build/:buildId
```

The response contains fields such as:

- `status`
- `currentStep`
- `stepIndex`
- `logs`
- `apkUrl`
- `error`
- `createdAt`
- `completedAt`

## Live stream

```http
GET /api/build/:buildId/stream
```

The endpoint uses SSE and emits:

```text
event: build
data: { ...build status... }

```

When the build finishes it emits:

```text
event: done
data: {"buildId":"...","status":"completed"}

```

Errors are sent as:

```text
event: error
data: {"error":"..."}

```

A heartbeat comment is sent periodically to keep long-running connections alive through proxies.

## Frontend example

```js
const stream = new EventSource(`${API_BASE}/api/build/${buildId}/stream`);

stream.addEventListener("build", (event) => {
  const build = JSON.parse(event.data);
  renderBuildStatus(build.status, build.currentStep, build.stepIndex);
  renderLogs(build.logs || []);
});

stream.addEventListener("done", (event) => {
  const data = JSON.parse(event.data);
  renderBuildFinished(data.status);
  stream.close();
});

stream.addEventListener("error", () => {
  // EventSource may reconnect automatically.
});
```

## Webhook log updates

GitHub Actions `notify-step.js` now sends `logLine`. The backend appends it to the build's `logs` array instead of replacing the existing log history.

The same mechanism is available to `notify-webhook.js` through the optional `LOG_LINE` environment variable.


### Artifact fields
Completed builds may include `artifactUrl` and `artifactType` (`apk` or `aab`). `apkUrl` remains available for backward compatibility.
