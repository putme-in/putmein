package security

import "regexp"

// Severity level of a security finding.
type Severity string

const (
	SeverityInfo    Severity = "info"
	SeverityWarning Severity = "warning"
	SeverityDanger  Severity = "danger"
)

// RuleCategory represents the domain of the security check.
type RuleCategory string

const (
	CategoryCVE        RuleCategory = "cve"
	CategorySecret     RuleCategory = "secret"
	CategoryContainer  RuleCategory = "container"
	CategoryOWASP      RuleCategory = "owasp"
	CategoryDependency RuleCategory = "dependency"
)

// SecurityRule defines a checklist item or known vulnerability check.
type SecurityRule struct {
	ID          string       `json:"id"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Category    RuleCategory `json:"category"`
	Severity    Severity     `json:"severity"`
	CVE         string       `json:"cve,omitempty"`
	Checklist   string       `json:"checklist"`
	Remediation string       `json:"remediation"`
}

// PredefinedRules contains the master list of security checks and known CVEs.
var PredefinedRules = []SecurityRule{
	// ── Framework CVEs ──
	{
		ID:          "CVE-NEXT-SSRF-2024",
		Title:       "Next.js Server Actions Host Header SSRF",
		CVE:         "CVE-2024-34351",
		Category:    CategoryCVE,
		Severity:    SeverityDanger,
		Description: "Next.js versions 13.4.0 through 14.1.0 are vulnerable to Server-Side Request Forgery (SSRF) when handling Server Actions requests by relying on the user-controlled Host header.",
		Checklist:   "Verify Next.js version is >= 14.1.1 or >= 14.2.0 in package.json and lockfile.",
		Remediation: "Upgrade 'next' to version 14.1.1 or higher (e.g. 14.2.15+ or 15.x).",
	},
	{
		ID:          "CVE-NEXT-AUTH-BYPASS-2025",
		Title:       "Next.js Middleware Subrequest Authorization Bypass",
		CVE:         "CVE-2025-29927",
		Category:    CategoryCVE,
		Severity:    SeverityDanger,
		Description: "Flaw allowing unauthorized clients to bypass Next.js route middleware by spoofing internal 'x-middleware-subrequest' headers.",
		Checklist:   "Ensure Next.js is upgraded to >= 12.3.5, 13.5.9, 14.2.25 or 15.2.3 in the corresponding release line, or strip x-middleware-* headers at reverse proxy.",
		Remediation: "Upgrade Next.js to a maintained release containing the 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3 fix and ensure reverse proxy strips internal headers.",
	},
	{
		ID:          "CVE-BABEL-CODE-EXEC",
		Title:       "Babel Compiler Arbitrary Code Execution",
		CVE:         "CVE-2023-45133",
		Category:    CategoryCVE,
		Severity:    SeverityDanger,
		Description: "Vulnerability in @babel/traverse letting attackers execute arbitrary code during transpilation if untrusted source files are processed.",
		Checklist:   "Verify @babel/traverse is upgraded to >= 7.23.2.",
		Remediation: "Update @babel/traverse to >= 7.23.2 in package dependencies and lockfile.",
	},
	{
		ID:          "CVE-LODASH-PROTO",
		Title:       "Lodash Prototype Pollution",
		CVE:         "CVE-2020-8203",
		Category:    CategoryCVE,
		Severity:    SeverityWarning,
		Description: "Prototype pollution in lodash versions < 4.17.21 via 'defaultsDeep', 'merge', or 'set' functions.",
		Checklist:   "Ensure lodash is >= 4.17.21 in package.json or replace with native modern JS methods.",
		Remediation: "Upgrade lodash to >= 4.17.21 or replace with Object.assign / spread syntax.",
	},

	// ── Secret & Credential Leaks ──
	{
		ID:          "SECRET-API-KEYS",
		Title:       "Hardcoded AI or Cloud Provider API Keys",
		Category:    CategorySecret,
		Severity:    SeverityDanger,
		Description: "Exposed API keys (OpenAI, Anthropic, MiniMax, Gemini, AWS, Stripe) committed directly in source code.",
		Checklist:   "Scan source files and git commits for 'sk-', 'AKIA', and cloud credential patterns.",
		Remediation: "Move credentials to environment variables (.env.local) and add them to .gitignore.",
	},
	{
		ID:          "SECRET-PRIVATE-KEYS",
		Title:       "Exposed RSA/ECDSA Private Key or Certificate",
		Category:    CategorySecret,
		Severity:    SeverityDanger,
		Description: "Cryptographic private keys or SSH keys checked into repository.",
		Checklist:   "Scan for 'BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', or 'BEGIN OPENSSH PRIVATE KEY'.",
		Remediation: "Immediately revoke exposed keys and store secrets in a secure secret manager or Ray env vars.",
	},
	{
		ID:          "SECRET-HARDCODED-JWT",
		Title:       "Hardcoded JWT Secret or Database Credentials",
		Category:    CategorySecret,
		Severity:    SeverityDanger,
		Description: "Hardcoded default JWT secret string (e.g. 'secret', 'default_secret') or database passwords in code.",
		Checklist:   "Verify JWT_SECRET and DATABASE_URL are not hardcoded with weak defaults in source code.",
		Remediation: "Require strong, randomly generated secrets injected via environment variables at runtime.",
	},

	// ── Container & Dockerfile Security ──
	{
		ID:          "CONTAINER-ROOT-USER",
		Title:       "Container Running as Root User",
		Category:    CategoryContainer,
		Severity:    SeverityWarning,
		Description: "Dockerfile does not declare a non-root USER, allowing processes to run with full root privileges inside the container.",
		Checklist:   "Verify Dockerfile contains 'USER node', 'USER nextjs', or creates and uses an unprivileged UID.",
		Remediation: "Add 'RUN adduser -S appuser && USER appuser' to Dockerfile before CMD/ENTRYPOINT.",
	},
	{
		ID:          "CONTAINER-SENSITIVE-COPY",
		Title:       "Sensitive Files Copied into Container Image",
		Category:    CategoryContainer,
		Severity:    SeverityDanger,
		Description: "Dockerfile copies entire workspace including .env, .git, or private keys without adequate .dockerignore.",
		Checklist:   "Check .dockerignore for .env, .git, node_modules, and sensitive credentials.",
		Remediation: "Create a .dockerignore file explicitly excluding '.env*', '.git', and build cache.",
	},
	{
		ID:          "CONTAINER-UNAUTHENTICATED-PORTS",
		Title:       "Unprotected System Ports Exposed",
		Category:    CategoryContainer,
		Severity:    SeverityDanger,
		Description: "Container attempts to bind or expose privileged platform ports (3000, 3100, 3306, 5432, 6379) directly to the host.",
		Checklist:   "Check EXPOSE directives and port bindings against reserved infrastructure ports.",
		Remediation: "Use allocated unprivileged ephemeral ports (10000-65535) managed by Ray proxy.",
	},

	// ── OWASP & Code Security ──
	{
		ID:          "OWASP-DANGEROUS-EVAL",
		Title:       "Dynamic Code Execution (eval / new Function)",
		Category:    CategoryOWASP,
		Severity:    SeverityDanger,
		Description: "Usage of eval() or new Function() with user-controlled input allows remote arbitrary code execution.",
		Checklist:   "Scan codebase for eval(), new Function(), and child_process.exec with untrusted arguments.",
		Remediation: "Eliminate dynamic code execution and use safe JSON parsing or deterministic logic.",
	},
	{
		ID:          "OWASP-SQL-INJECTION",
		Title:       "Raw SQL Query Concatenation",
		Category:    CategoryOWASP,
		Severity:    SeverityDanger,
		Description: "Constructing SQL queries through string interpolation or concatenation instead of parameterized queries.",
		Checklist:   "Verify ORM (Prisma/TypeORM) or parameterized queries are used consistently.",
		Remediation: "Use Prisma or parameterized placeholders ($1, ?) rather than template literals in queries.",
	},
	{
		ID:          "OWASP-MISSING-SECURITY-HEADERS",
		Title:       "Missing Recommended HTTP Security Headers",
		Category:    CategoryOWASP,
		Severity:    SeverityInfo,
		Description: "Application responses lack Content-Security-Policy (CSP), Strict-Transport-Security (HSTS), or X-Content-Type-Options headers.",
		Checklist:   "Check next.config.js or Express middleware for security headers configuration.",
		Remediation: "Add security headers in next.config.js headers() or use Helmet middleware.",
	},
	{
		ID:          "DEPENDENCY-DEPRECATED-PACKAGES",
		Title:       "Unpinned or Deprecated Core Dependencies",
		Category:    CategoryDependency,
		Severity:    SeverityInfo,
		Description: "Dependencies with major version drift or wildcard versions that could introduce breaking vulnerabilities.",
		Checklist:   "Verify package.json dependencies use exact or pinned carets with lockfile present.",
		Remediation: "Audit dependencies with 'npm audit' or 'pnpm audit' and pin dependency versions.",
	},
}

// SecretPattern contains compiled regexes for rapid deterministic credential detection.
type SecretPattern struct {
	ID          string
	Title       string
	Severity    Severity
	Regex       *regexp.Regexp
	Description string
}

var SecretPatterns = []SecretPattern{
	{
		ID:          "SECRET_OPENAI_KEY",
		Title:       "OpenAI Secret Key",
		Severity:    SeverityDanger,
		Regex:       regexp.MustCompile(`\bsk-[a-zA-Z0-9_-]{20,64}\b`),
		Description: "Detected hardcoded OpenAI API key.",
	},
	{
		ID:          "SECRET_ANTHROPIC_KEY",
		Title:       "Anthropic API Key",
		Severity:    SeverityDanger,
		Regex:       regexp.MustCompile(`\bsk-ant-[a-zA-Z0-9_-]{20,80}\b`),
		Description: "Detected hardcoded Anthropic Claude API key.",
	},
	{
		ID:          "SECRET_AWS_ACCESS_KEY",
		Title:       "AWS Access Key ID",
		Severity:    SeverityDanger,
		Regex:       regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),
		Description: "Detected hardcoded AWS Access Key ID.",
	},
	{
		ID:          "SECRET_GITHUB_TOKEN",
		Title:       "GitHub Personal Access Token",
		Severity:    SeverityDanger,
		Regex:       regexp.MustCompile(`\bghp_[a-zA-Z0-9]{36}\b`),
		Description: "Detected hardcoded GitHub personal access token.",
	},
	{
		ID:          "SECRET_PRIVATE_KEY",
		Title:       "Cryptographic Private Key",
		Severity:    SeverityDanger,
		Regex:       regexp.MustCompile(`-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----`),
		Description: "Detected plaintext cryptographic private key block.",
	},
	{
		ID:          "SECRET_JWT_HARDCODED",
		Title:       "Hardcoded JWT Secret Literal",
		Severity:    SeverityWarning,
		Regex:       regexp.MustCompile(`(?i)(?:jwt_secret|jwtSecret|secretKey)\s*[:=]\s*["'](?:secret|test|dev|123456|password|default)["']`),
		Description: "Detected weak hardcoded JWT secret literal.",
	},
}
