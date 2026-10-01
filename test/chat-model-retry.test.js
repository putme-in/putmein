const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

test("ModelSelector.tsx synchronizes activeProvider only on open transition and stops mousedown bubbling", () => {
  const code = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "components", "ModelSelector.tsx"), "utf-8");

  // Verify transition-based sync
  assert.match(
    code,
    /prevOpenRef\.current\s*=\s*open/,
    "ModelSelector must track open state transition using a ref to prevent overwriting activeProvider during interaction"
  );
  assert.match(
    code,
    /if\s*\(\s*open\s*&&\s*!prevOpenRef\.current\s*\)/,
    "ModelSelector must only sync activeProvider when transitioning from closed to open"
  );

  // Verify erratic onMouseEnter is removed from provider buttons
  assert.doesNotMatch(
    code,
    /<button[^>]*onClick=\{[^}]*setActiveProvider[^}]*\}[^>]*onMouseEnter=\{[^}]*setActiveProvider[^}]*\}/,
    "ModelSelector provider buttons must not use onMouseEnter to switch tabs, preventing hover jitter"
  );

  // Verify mousedown propagation is stopped on the popover and option buttons
  assert.match(
    code,
    /onMouseDown=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/,
    "ModelSelector must stop mousedown propagation on the popover container so document click-outside handler does not dismiss prematurely"
  );

  // Verify model option buttons stop propagation and execute onChange
  assert.match(
    code,
    /onMouseDown=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*\}\}[\s\S]*?onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*onChange\(model\.id\);\s*setOpen\(false\);/,
    "ModelSelector option buttons must stop propagation and trigger onChange and setOpen(false)"
  );
});

test("ChatInterface.tsx formats fetch failed errors into human-friendly messages", () => {
  const code = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "components", "ChatInterface.tsx"), "utf-8");

  assert.match(
    code,
    /rawErrMsg\.includes\(["']fetch failed["']\)\s*\|\|\s*rawErrMsg\.includes\(["']Failed to fetch["']\)/,
    "ChatInterface must detect fetch failed / Failed to fetch errors"
  );

  assert.match(
    code,
    /rawErrMsg\s*=\s*["']Unable to reach the PutMeIn AI service\. Please check your network connection and verify that the background AI service is running\.["']/,
    "ChatInterface must transform raw fetch failure into a clear, helpful message"
  );
});

test("ChatInterface.tsx enforces controlled retry limit and avoids multi-attempt automated spam loops", () => {
  const code = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "components", "ChatInterface.tsx"), "utf-8");

  // Must not allow 5 automatic retries in a loop
  assert.doesNotMatch(
    code,
    /autoRetryAttemptRef\.current\s*<\s*5/,
    "ChatInterface must not run an uncontrolled 5-attempt automatic retry loop"
  );

  // Must limit automatic retries to at most 1 attempt
  assert.match(
    code,
    /autoRetryAttemptRef\.current\s*<\s*1/,
    "ChatInterface must limit automatic retries to at most 1 transient attempt before stopping"
  );

  // handleRetry must resend user prompt, not hardcoded phantom message
  assert.doesNotMatch(
    code,
    /sendText\(["']Please continue where you left off and finish the task\.["']\)/,
    "handleRetry must not hardcode 'Please continue where you left off and finish the task.'"
  );

  assert.match(
    code,
    /promptToRetry\s*=\s*lastUserPromptRef\.current/,
    "handleRetry must use the user's actual prompt when retrying"
  );

  // Both Retry / Try again and Cancel buttons must be provided
  assert.match(
    code,
    /onClick=\{handleStop\}[\s\S]*?Cancel/,
    "ChatInterface must provide a Cancel button alongside retry to give user clear control"
  );
});

test("chatRunner.ts supports auth and dynamic port fallback between 4500 and 3100", () => {
  const envPath = path.join(ROOT_DIR, "ray", ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    if (envContent.includes("BRAIN_URL=")) {
      assert.match(
        envContent,
        /BRAIN_URL=["']http:\/\/localhost:(3100|4500)["']/,
        "ray/.env BRAIN_URL must target a valid Brain port (3100 or 4500)"
      );
    }
  }

  const runnerCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "lib", "chatRunner.ts"), "utf-8");
  assert.match(
    runnerCode,
    /const BRAIN_URL = process\.env\.BRAIN_URL \|\| ["']http:\/\/localhost:(4500|3100)["']/,
    "chatRunner.ts must default to a valid local Brain URL"
  );
  assert.match(
    runnerCode,
    /x-brain-secret/,
    "chatRunner.ts must pass x-brain-secret header to Brain"
  );
  assert.match(
    runnerCode,
    /alternateUrl/,
    "chatRunner.ts must handle port fallback between 4500 and 3100 on connection failure"
  );
});
