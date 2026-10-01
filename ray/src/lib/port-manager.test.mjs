import test from "node:test";
import assert from "node:assert/strict";
import {
  PERMANENT_RESERVED_PORTS,
  getConfiguredPlatformPorts,
  getAllReservedPorts,
} from "./port-config.ts";
import { isReservedPlatformPort } from "./port-config.ts";

test("PERMANENT_RESERVED_PORTS preserves dev ports 3000 and 3100", () => {
  assert.ok(PERMANENT_RESERVED_PORTS.includes(3000), "Port 3000 (Ray Dev) must be reserved");
  assert.ok(PERMANENT_RESERVED_PORTS.includes(3100), "Port 3100 (Brain Dev) must be reserved");
  assert.ok(PERMANENT_RESERVED_PORTS.includes(3306), "Port 3306 (MySQL/MariaDB) must be reserved");
  assert.ok(PERMANENT_RESERVED_PORTS.includes(5432), "Port 5432 (Postgres) must be reserved");
});

test("getConfiguredPlatformPorts defaults to 3000 and 3100 for local dev", () => {
  const ports = getConfiguredPlatformPorts();
  assert.equal(ports.devRayPort, 3000);
  assert.equal(ports.devBrainPort, 3100);
});

test("getAllReservedPorts includes both dev ports and live ports when configured", () => {
  const prevRay = process.env.RAY_PORT;
  const prevBrain = process.env.BRAIN_PORT;

  try {
    process.env.RAY_PORT = "4567";
    process.env.BRAIN_PORT = "4500";

    const all = getAllReservedPorts();
    assert.ok(all.includes(3000), "Dev 3000 must remain reserved even when live ports are set");
    assert.ok(all.includes(3100), "Dev 3100 must remain reserved even when live ports are set");
    assert.ok(all.includes(4567), "Live 4567 must be reserved when RAY_PORT is set");
    assert.ok(all.includes(4500), "Live 4500 must be reserved when BRAIN_PORT is set");
  } finally {
    if (prevRay !== undefined) process.env.RAY_PORT = prevRay;
    else delete process.env.RAY_PORT;

    if (prevBrain !== undefined) process.env.BRAIN_PORT = prevBrain;
    else delete process.env.BRAIN_PORT;
  }
});

test("isReservedPlatformPort detects dev and live service conflicts", () => {
  assert.equal(isReservedPlatformPort(3000).isReserved, true);
  assert.equal(isReservedPlatformPort(3000).name, "Ray Dashboard (Dev)");
  assert.equal(isReservedPlatformPort(3100).isReserved, true);
  assert.equal(isReservedPlatformPort(3100).name, "Brain AI Backend (Dev)");
  assert.equal(isReservedPlatformPort(4000).isReserved, false);
});
