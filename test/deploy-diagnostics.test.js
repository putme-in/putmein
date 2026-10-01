const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("deployments diagnose route resolves active model and fallback diagnosis for Docker failures", () => {
  const routePath = path.join(__dirname, "..", "ray", "app", "api", "deployments", "[id]", "diagnose", "route.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  // Verify modelId resolution checks cookie
  assert.ok(
    content.includes('cookieStore.get("ray_selected_model")?.value'),
    "Expected route to check cookieStore for ray_selected_model"
  );

  // Verify fallback diagnosis for Docker errors is implemented
  assert.ok(
    content.includes("fallbackDiagnosisFromLogs"),
    "Expected route to define fallbackDiagnosisFromLogs"
  );
  assert.ok(
    content.includes("pipe/docker_engine"),
    "Expected fallback diagnosis to detect Windows named pipe errors"
  );
  assert.ok(
    content.includes("ejsonparse"),
    "Expected fallback diagnosis to detect EJSONPARSE errors"
  );
  assert.ok(
    content.includes("Package Manifest Syntax Error"),
    "Expected fallback diagnosis to flag package.json syntax errors"
  );

  // Verify detailed AI error extraction instead of unconditional swallow
  assert.ok(
    content.includes("res.text()"),
    "Expected route to read res.text() for non-JSON error responses from Brain"
  );
  assert.ok(
    content.includes("AI request failed:"),
    "Expected route to prefix and surface actual AI error"
  );
});

test("brain prompt and monitor prioritize EJSONPARSE build errors over missing node_modules", () => {
  const promptPath = path.join(__dirname, "..", "brain", "internal", "ai", "prompt.go");
  const promptContent = fs.readFileSync(promptPath, "utf-8");

  assert.ok(
    promptContent.includes("EJSONPARSE"),
    "Expected prompt.go to explicitly instruct the model on EJSONPARSE / manifest errors"
  );
  assert.ok(
    promptContent.includes("NEVER guess missing node_modules or recommend 'npm install' when package.json contains a JSON syntax error"),
    "Expected prompt.go to forbid false missing node_modules diagnoses on invalid package.json"
  );

  const diagnosePath = path.join(__dirname, "..", "brain", "internal", "monitor", "diagnose.go");
  const diagnoseContent = fs.readFileSync(diagnosePath, "utf-8");

  assert.ok(
    diagnoseContent.includes("CRITICAL MANIFEST SYNTAX ERROR in package.json"),
    "Expected diagnose.go to validate package.json syntax and add critical manifest warning"
  );
  assert.ok(
    diagnoseContent.includes("strings.Contains(lowerLogs, \"ejsonparse\")"),
    "Expected diagnose.go fallback to handle EJSONPARSE"
  );
});

test("DeployDiagnosisModal retrieves active model from localStorage", () => {
  const modalPath = path.join(__dirname, "..", "ray", "src", "components", "DeployDiagnosisModal.tsx");
  const content = fs.readFileSync(modalPath, "utf-8");

  assert.ok(
    content.includes('localStorage.getItem("ray_selected_model")'),
    "Expected DeployDiagnosisModal to read ray_selected_model from localStorage"
  );
  assert.ok(
    content.includes("modelId: selectedModel || undefined"),
    "Expected DeployDiagnosisModal to pass modelId in request payload"
  );
});

test("brain monitor API accepts diagnosis requests with logs when projectPath is empty", () => {
  const monitorApiPath = path.join(__dirname, "..", "brain", "internal", "api", "monitor.go");
  const content = fs.readFileSync(monitorApiPath, "utf-8");

  assert.ok(
    content.includes('strings.TrimSpace(req.ProjectPath) == "" && strings.TrimSpace(req.Logs) == ""'),
    "Expected monitorDiagnoseHandler to allow empty projectPath when logs are present"
  );
  assert.ok(
    content.includes("writeJSONError"),
    "Expected monitorDiagnoseHandler to return structured JSON errors"
  );
});

test("brain AI models selector falls back to first configured model with API key", () => {
  const modelsPath = path.join(__dirname, "..", "brain", "internal", "ai", "models.go");
  const content = fs.readFileSync(modelsPath, "utf-8");

  assert.ok(
    content.includes("func GetFirstConfiguredModel() ModelConfig"),
    "Expected GetFirstConfiguredModel function in models.go"
  );
  assert.ok(
    content.includes("return GetFirstConfiguredModel()"),
    "Expected GetModelByID to return GetFirstConfiguredModel() when id is empty"
  );
});
