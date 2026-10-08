import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readLocalLogTail } from "../src/lib/local-log-tail.ts";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ray-log-tail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("offline reader joins retained segments in order", async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "format.json"), JSON.stringify({ format: "ray-host-logs-v1" }));
  await fs.writeFile(path.join(root, "00000000000000000000.log"), "one\ntw");
  await fs.writeFile(path.join(root, "00000000000000000006.log"), "o\nthree\n");
  assert.equal(await readLocalLogTail(root, 2), "two\nthree");
});
test("legacy file fallback stays bounded and supports CRLF", async t => {
  const root = await fixture(t);
  const file = path.join(root, "legacy.log");
  await fs.writeFile(file, "x".repeat(3 * 1024 * 1024) + "\r\nlatest\r\n");
  assert.equal(await readLocalLogTail(file, 1), "latest");
  assert.ok((await readLocalLogTail(file, 100)).length <= 2 * 1024 * 1024);
});
test("unknown directories and symlink segments are refused", async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "format.json"), JSON.stringify({ format: "unknown" }));
  await assert.rejects(readLocalLogTail(root, 2));
  await fs.writeFile(path.join(root, "format.json"), JSON.stringify({ format: "ray-host-logs-v1" }));
  await fs.writeFile(path.join(root, "outside"), "private");
  await fs.symlink(path.join(root, "outside"), path.join(root, "00000000000000000000.log"));
  await assert.rejects(readLocalLogTail(root, 2), /regular file/);
});
