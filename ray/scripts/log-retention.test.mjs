import test from "node:test";
import assert from "node:assert/strict";
import { withoutStageLogs, validLogSelections, logFingerprint } from "../src/lib/log-retention.ts";

test("clears only known stage log text and retains result metadata", () => {
  const original = [{ name: "Build", status: "failed", durationMs: 45, logs: "error: café", extension: { exitCode: 1 } }];
  const result = withoutStageLogs(JSON.stringify(original));
  assert.deepEqual(JSON.parse(result.value), [{ name: "Build", status: "failed", durationMs: 45, extension: { exitCode: 1 } }]);
  assert.equal(result.bytes, Buffer.byteLength(original[0].logs));
});

test("unknown stage formats are preserved for manual review", () => {
  for (const value of ["{", '{"custom":"format"}', '[null]', '[{"logs":{"nested":"output"}}]']) {
    assert.equal(withoutStageLogs(value), null);
  }
  assert.deepEqual(withoutStageLogs(null), { value: null, bytes: 0 });
});

test("preview fingerprints detect log, status and record changes", () => {
  const row = { id: "a", status: "failed", logs: "ERROR" };
  const fingerprint = logFingerprint("deployment", row);
  for (const changed of [{ ...row, logs: "error" }, { ...row, status: "building" }, { ...row, id: "b" }]) {
    assert.notEqual(logFingerprint("deployment", changed), fingerprint);
  }
  assert.notEqual(logFingerprint("pipeline", row), fingerprint);
});

test("cleanup selection rejects invalid kinds, duplicates and excessive batches", () => {
  const item = { kind: "deployment", id: "a", fingerprint: "a".repeat(64) };
  assert.equal(validLogSelections([item]), true);
  for (const items of [null, [], [item, item], [{ ...item, kind: "security" }], [{ ...item, fingerprint: "x" }], [{ ...item, id: "" }]]) {
    assert.equal(validLogSelections(items), false);
  }
  assert.equal(validLogSelections(Array.from({ length: 101 }, (_, i) => ({ ...item, id: String(i) }))), false);
});
