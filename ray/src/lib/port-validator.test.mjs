import test from "node:test";
import assert from "node:assert/strict";
import { validateTcpPort, isValidTcpPort, MIN_TCP_PORT, MAX_TCP_PORT } from "./port-validator.ts";

test("rejects empty, null, and non-numeric values", () => {
  assert.equal(validateTcpPort(null).valid, false);
  assert.equal(validateTcpPort(undefined).valid, false);
  assert.equal(validateTcpPort("").valid, false);
  assert.equal(validateTcpPort("   ").valid, false);
  assert.equal(validateTcpPort("abc").valid, false);
  assert.equal(isValidTcpPort("invalid"), false);
});

test("rejects out of range numbers (including 99999)", () => {
  const res99999 = validateTcpPort(99999);
  assert.equal(res99999.valid, false);
  assert.match(res99999.error, /out of valid range/i);

  assert.equal(validateTcpPort("99999").valid, false);
  assert.equal(validateTcpPort(0).valid, false);
  assert.equal(validateTcpPort(-1).valid, false);
  assert.equal(validateTcpPort(-3000).valid, false);
  assert.equal(validateTcpPort(65536).valid, false);
  assert.equal(validateTcpPort(70000).valid, false);
  assert.equal(isValidTcpPort(99999), false);
});

test("rejects non-integer float ports", () => {
  assert.equal(validateTcpPort(3000.5).valid, false);
  assert.equal(validateTcpPort("80.1").valid, false);
});

test("accepts valid boundary and common TCP ports", () => {
  const minRes = validateTcpPort(1);
  assert.equal(minRes.valid, true);
  assert.equal(minRes.port, MIN_TCP_PORT);

  const maxRes = validateTcpPort(65535);
  assert.equal(maxRes.valid, true);
  assert.equal(maxRes.port, MAX_TCP_PORT);

  const webRes = validateTcpPort(80);
  assert.equal(webRes.valid, true);
  assert.equal(webRes.port, 80);

  const devRes = validateTcpPort("3000");
  assert.equal(devRes.valid, true);
  assert.equal(devRes.port, 3000);

  assert.equal(isValidTcpPort(3000), true);
  assert.equal(isValidTcpPort(8080), true);
});
