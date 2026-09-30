const assert = require("assert");
const { sanitizeBuild, formatEvent } = require("./buildStreamProtocol");

const build = sanitizeBuild({
  id: "b1",
  status: "building",
  userId: "u1",
  config: { appName: "Demo", iconBase64: "SECRET-LIKE-DATA" },
  logs: ["hello"],
});

assert.equal(build.id, "b1");
assert.equal(build.status, "building");
assert.equal(build.config.appName, "Demo");
assert.equal(build.config.iconBase64, undefined);
assert.deepEqual(build.logs, ["hello"]);

const event = formatEvent("build", { buildId: "b1", status: "building" });
assert(event.startsWith("event: build\n"));
assert(event.includes('"buildId":"b1"'));
assert(event.endsWith("\n\n"));

console.log("build stream service tests: OK");
