const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync(require.resolve("./buildQueueService.js"), "utf8");

for (const name of [
  "enqueueBuild",
  "pumpQueue",
  "onBuildFinished",
  "releaseBuild",
  "getQueueState",
  "startQueuePump",
]) {
  assert(new RegExp(`\\b${name}\\b`).test(source), `${name} must be exported`);
}

assert(source.includes("runTransaction"), "queue must use Firestore transaction locking");
assert(source.includes('orderBy("createdAt", "asc")'), "queue must select oldest build first");
assert(source.includes("LEASE_MS"), "queue must have a lease");
assert(source.includes('status: "failed"'), "expired active builds must be failed");
assert(source.includes("triggerBuildWorkflow"), "queue must dispatch GitHub workflow");

console.log("build queue service tests: OK");
