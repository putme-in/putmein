package monitor

import "regexp"

// LogRules is the deterministic baseline. Extend this registry for other runtimes.
// Expressions use Go's bounded-time RE2 engine and do not require an AI provider.
var LogRules = []struct {
	ID       string
	Pattern  *regexp.Regexp
	Severity Severity
	Message  string
}{
	{"host-process-exit", regexp.MustCompile(`(?i)\[RAY\] Managed process exited unexpectedly`), SeverityError, "Managed application process stopped unexpectedly"},
	{"out-of-memory", regexp.MustCompile(`(?i)(out of memory|oomkilled|heap out of memory)`), SeverityCritical, "Application ran out of memory"},
	{"node-unhandled", regexp.MustCompile(`(?i)(uncaughtexception|unhandledpromiserejection|unhandled rejection)`), SeverityError, "Unhandled application exception"},
	{"python-traceback", regexp.MustCompile(`Traceback \(most recent call last\)`), SeverityError, "Python exception detected"},
	{"go-panic", regexp.MustCompile(`(?m)^panic:`), SeverityCritical, "Go process panicked"},
	{"rust-panic", regexp.MustCompile(`thread .+ panicked at`), SeverityCritical, "Rust process panicked"},
	{"php-fatal", regexp.MustCompile(`(?i)PHP (Fatal|Parse) error`), SeverityError, "PHP fatal error detected"},
	{"java-exception", regexp.MustCompile(`Exception in thread`), SeverityError, "Java exception detected"},
	{"port-conflict", regexp.MustCompile(`(?i)(EADDRINUSE|address already in use)`), SeverityError, "Application port is already in use"},
	{"connection-refused", regexp.MustCompile(`(?i)(ECONNREFUSED|connection refused)`), SeverityWarn, "Application could not connect to a dependency"},
	{"next-server", regexp.MustCompile(`(?i)(failed to start server|next.*build error)`), SeverityError, "Application server failed to start or build"},
}
