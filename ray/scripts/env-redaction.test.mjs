import assert from "node:assert/strict";
import test from "node:test";

import { toPublicEnvResponse } from "../src/lib/env.ts";

test("public environment responses contain names but never plaintext values", () => {
  const secret = "db-password-should-not-leak";
  const content = "DATABASE_URL=postgres://user:" + secret + "@db/app\nAPI_KEY=" + secret;
  const response = toPublicEnvResponse(true, content);

  assert.deepEqual(response, {
    exists: true,
    vars: [
      { key: "DATABASE_URL", value: "********" },
      { key: "API_KEY", value: "********" },
    ],
  });
  assert.equal(JSON.stringify(response).includes(secret), false);
  assert.equal(Object.hasOwn(response, "rawContent"), false);
});

test("empty environment files remain safe and accurately report absence of variables", () => {
  assert.deepEqual(toPublicEnvResponse(false, ""), {
    exists: false,
    vars: [],
  });
});

test("create, update, and delete response shapes never reveal changed values", () => {
  const secretValues = [
    { content: "API_KEY=created-secret", expectedKeys: ["API_KEY"] },
    { content: "API_KEY=updated-secret", expectedKeys: ["API_KEY"] },
    { content: "", expectedKeys: [] },
  ];

  for (const { content, expectedKeys } of secretValues) {
    const response = toPublicEnvResponse(true, content);

    assert.deepEqual(response.vars.map(({ key }) => key), expectedKeys);
    assert.deepEqual(response.vars.map(({ value }) => value), expectedKeys.map(() => "********"));
    assert.equal(JSON.stringify(response).includes("secret"), false);
  }
});

test("masked response keeps raw editor data out of the default payload", () => {
  const response = toPublicEnvResponse(true, "COMMENT=keep this line\nTOKEN=editor-secret");

  assert.deepEqual(Object.keys(response).sort(), ["exists", "vars"]);
  assert.equal("rawContent" in response, false);
  assert.equal(JSON.stringify(response).includes("keep this line"), false);
  assert.equal(JSON.stringify(response).includes("editor-secret"), false);
});
