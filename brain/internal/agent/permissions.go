package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"brain/server/internal/ai"
)

// autonomousMode controls whether the agent asks for permission before running tools.
// When false: each tool call emits a permission request and waits.
// When true: tools run immediately without asking.
var (
	autonomousMu          sync.RWMutex
	autonomousMode        = false
	deploymentsPath       = ""
	savedApiKeys          = make(map[string]string)
	securityChecksEnabled = true
	routingMode           = ""      // "port" | "domain" (auto-detected if empty)
	domainProvider        = "sslip" // "sslip" | "custom"
	customRootDomain      = ""      // e.g. "example.com"
	executionMode         = "plan"  // "plan" (Plan first then Action) | "action" (Direct Action)
)

// settingsPath returns the path to the persistent settings file.
// Prioritizes ~/.config/putmein/settings.json across all platforms.
func settingsPath() string {
	if custom := strings.TrimSpace(os.Getenv("PUTMEIN_CONFIG_PATH")); custom != "" {
		return custom
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		p := filepath.Join(home, ".config", "putmein", "settings.json")
		if _, err := os.Stat(p); err == nil {
			return p
		}
		// Also check user config dir if it exists
		if dir, err := os.UserConfigDir(); err == nil && dir != "" {
			alt := filepath.Join(dir, "putmein", "settings.json")
			if _, err := os.Stat(alt); err == nil {
				return alt
			}
		}
		return p
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "putmein", "settings.json")
}

type persistedSettings struct {
	AutonomousMode        bool              `json:"autonomousMode"`
	DeploymentsPath       string            `json:"deploymentsPath,omitempty"`
	ApiKeys               map[string]string `json:"apiKeys,omitempty"`
	SecurityChecksEnabled *bool             `json:"securityChecksEnabled,omitempty"`
	RoutingMode           string            `json:"routingMode,omitempty"`
	DomainProvider        string            `json:"domainProvider,omitempty"`
	CustomRootDomain      string            `json:"customRootDomain,omitempty"`
	ExecutionMode         string            `json:"executionMode,omitempty"`
}

// DefaultDeploymentsDir returns the default OS-dependent common deployment location.
// On macOS/Linux: ~/.ray/deployments
// On Windows: %USERPROFILE%\.ray\deployments
func DefaultDeploymentsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.TempDir()
	}
	return filepath.Join(home, ".ray", "deployments")
}

// loadSettings reads autonomous mode, deploymentsPath and apiKeys from disk. Called once on package init.
func loadSettings() {
	path := settingsPath()
	data, err := os.ReadFile(path)
	if err != nil {
		// File may not exist yet, that's fine, default is false
		return
	}

	autonomousMu.Lock()
	defer autonomousMu.Unlock()

	// Enforce restricted permissions on existing directory and settings file
	_ = os.Chmod(filepath.Dir(path), 0o700)
	_ = os.Chmod(path, 0o600)

	var s persistedSettings
	if json.Unmarshal(data, &s) == nil {
		autonomousMode = s.AutonomousMode
		deploymentsPath = s.DeploymentsPath
		if s.SecurityChecksEnabled != nil {
			securityChecksEnabled = *s.SecurityChecksEnabled
		}
		if s.RoutingMode != "" {
			routingMode = s.RoutingMode
		}
		if s.DomainProvider != "" {
			domainProvider = s.DomainProvider
		}
		if s.CustomRootDomain != "" {
			customRootDomain = s.CustomRootDomain
		}
		if s.ExecutionMode != "" {
			executionMode = s.ExecutionMode
		}
		needsMigration := false
		if s.ApiKeys != nil {
			savedApiKeys = make(map[string]string)
			for k, v := range s.ApiKeys {
				trimmed := strings.TrimSpace(v)
				if trimmed != "" {
					if !strings.HasPrefix(trimmed, encryptionPrefix) {
						needsMigration = true
					}
					decrypted, err := decryptSecret(trimmed)
					if err != nil {
						// Skip unreadable/corrupted key gracefully
						continue
					}
					savedApiKeys[k] = decrypted
					ai.SetRuntimeAPIKey(k, decrypted)
					if k == "ozias" {
						ai.SetRuntimeAPIKey("minimax", decrypted)
					} else if k == "minimax" {
						ai.SetRuntimeAPIKey("ozias", decrypted)
					}
				}
			}
		}
		// If any legacy plaintext keys were found, migrate them immediately to encrypted format on disk
		if needsMigration {
			saveSettings()
		}
	}
}

// saveSettings writes the current state to disk. Called after every change.
func saveSettings() {
	path := settingsPath()
	dir := filepath.Dir(path)
	// Ensure directory exists with strict 0700 permissions
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	_ = os.Chmod(dir, 0o700)

	// Encrypt all API keys for storage at rest
	encryptedKeys := make(map[string]string, len(savedApiKeys))
	for k, v := range savedApiKeys {
		trimmed := strings.TrimSpace(v)
		if trimmed != "" {
			enc, err := encryptSecret(trimmed)
			if err != nil {
				// Fallback to storing raw if encryption encounters an unexpected error
				encryptedKeys[k] = trimmed
			} else {
				encryptedKeys[k] = enc
			}
		}
	}

	s := persistedSettings{
		AutonomousMode:        autonomousMode,
		DeploymentsPath:       deploymentsPath,
		ApiKeys:               encryptedKeys,
		SecurityChecksEnabled: &securityChecksEnabled,
		RoutingMode:           routingMode,
		DomainProvider:        domainProvider,
		CustomRootDomain:      customRootDomain,
		ExecutionMode:         executionMode,
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0o600)
	_ = os.Chmod(path, 0o600)
}

func init() {
	if len(os.Args) > 1 && os.Args[1] == "--internal-host-log-runner" {
		return
	}
	loadSettings()
}

// SetAPIKeys updates multiple provider API keys in memory and persists them.
func SetAPIKeys(keys map[string]string) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()

	if savedApiKeys == nil {
		savedApiKeys = make(map[string]string)
	}

	for provider, key := range keys {
		trimmed := strings.TrimSpace(key)
		if trimmed != "" {
			savedApiKeys[provider] = trimmed
			ai.SetRuntimeAPIKey(provider, trimmed)
			if provider == "ozias" {
				savedApiKeys["minimax"] = trimmed
				ai.SetRuntimeAPIKey("minimax", trimmed)
			} else if provider == "minimax" {
				savedApiKeys["ozias"] = trimmed
				ai.SetRuntimeAPIKey("ozias", trimmed)
			}
		}
	}
	saveSettings()
}

// RemoveAPIKey deletes a provider key from memory and persists the change to disk.
func RemoveAPIKey(provider string) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()

	if savedApiKeys != nil {
		delete(savedApiKeys, provider)
		ai.SetRuntimeAPIKey(provider, "")
		if provider == "ozias" {
			delete(savedApiKeys, "minimax")
			ai.SetRuntimeAPIKey("minimax", "")
		} else if provider == "minimax" {
			delete(savedApiKeys, "ozias")
			ai.SetRuntimeAPIKey("ozias", "")
		}
	}
	saveSettings()
}

// GetSavedAPIKeys returns a copy of the saved API keys map.
func GetSavedAPIKeys() map[string]string {
	autonomousMu.RLock()
	defer autonomousMu.RUnlock()

	res := make(map[string]string, len(savedApiKeys))
	for k, v := range savedApiKeys {
		res[k] = v
	}
	return res
}

// SetAutonomousMode enables or disables autonomous mode globally and persists the change.
func SetAutonomousMode(enabled bool) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()
	autonomousMode = enabled
	saveSettings()
}

// IsAutonomousMode returns the current autonomous mode state.
func IsAutonomousMode() bool {
	autonomousMu.RLock()
	defer autonomousMu.RUnlock()
	return autonomousMode
}

// GetDeploymentsDir returns the configured deployments directory or default, creating it if needed.
func GetDeploymentsDir() string {
	autonomousMu.RLock()
	target := deploymentsPath
	autonomousMu.RUnlock()

	if target == "" {
		target = DefaultDeploymentsDir()
	}

	// Expand ~ if present
	if len(target) > 0 && target[0] == '~' {
		if home, err := os.UserHomeDir(); err == nil {
			target = filepath.Join(home, target[1:])
		}
	}

	_ = os.MkdirAll(target, 0o755)
	return target
}

// SetDeploymentsDir updates the custom deployments directory and persists it.
func SetDeploymentsDir(path string) {
	autonomousMu.Lock()
	deploymentsPath = path
	saveSettings()
	autonomousMu.Unlock()

	_ = os.MkdirAll(GetDeploymentsDir(), 0o755)
}

// IsSecurityChecksEnabled returns whether automated security audits are active.
func IsSecurityChecksEnabled() bool {
	autonomousMu.RLock()
	defer autonomousMu.RUnlock()
	return securityChecksEnabled
}

// SetSecurityChecksEnabled toggles automated security checks.
func SetSecurityChecksEnabled(enabled bool) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()
	securityChecksEnabled = enabled
	saveSettings()
}

// PermissionRequest describes a tool call that needs user approval.
type PermissionRequest struct {
	ToolName    string `json:"toolName"`
	Description string `json:"description"`
	// Args is the human-readable summary of what will be executed.
	Args string `json:"args"`
}

// PermissionResponse is the user's answer to a permission request.
type PermissionResponse struct {
	// Approved is true if the user clicked Allow / typed yes.
	Approved bool `json:"approved"`
	// AlwaysAllow permanently enables autonomous mode for this session.
	AlwaysAllow bool `json:"alwaysAllow"`
}

// GetRoutingMode returns the configured routing mode ("port" | "domain"),
// or defaults to "port" if not yet configured.
func GetRoutingMode() string {
	autonomousMu.RLock()
	defer autonomousMu.RUnlock()
	if routingMode == "" {
		return "port"
	}
	return routingMode
}

// SetRoutingMode updates the routing mode ("port" | "domain") and persists the change.
func SetRoutingMode(mode string) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()
	routingMode = strings.ToLower(strings.TrimSpace(mode))
	saveSettings()
}

// GetDomainProvider returns the configured domain provider ("sslip" | "custom"),
// default is "sslip".
func GetDomainProvider() string {
	autonomousMu.RLock()
	defer autonomousMu.RUnlock()
	if domainProvider == "" {
		return "sslip"
	}
	return domainProvider
}

// SetDomainProvider updates the domain provider and persists the change.
func SetDomainProvider(provider string) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()
	domainProvider = strings.ToLower(strings.TrimSpace(provider))
	saveSettings()
}

// GetCustomRootDomain returns the user-configured custom root domain (e.g. "example.com").
func GetCustomRootDomain() string {
	autonomousMu.RLock()
	defer autonomousMu.RUnlock()
	return customRootDomain
}

// SetCustomRootDomain updates the custom root domain and persists the change.
func SetCustomRootDomain(rootDomain string) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()
	customRootDomain = strings.ToLower(strings.TrimSpace(rootDomain))
	saveSettings()
}

// GetExecutionMode returns the configured execution mode ("plan" | "action"), default is "plan".
func GetExecutionMode() string {
	autonomousMu.RLock()
	defer autonomousMu.RUnlock()
	if executionMode == "" {
		return "plan"
	}
	return executionMode
}

// SetExecutionMode updates the execution mode ("plan" | "action") and persists the change.
func SetExecutionMode(mode string) {
	autonomousMu.Lock()
	defer autonomousMu.Unlock()
	m := strings.ToLower(strings.TrimSpace(mode))
	if m == "action" {
		executionMode = "action"
	} else {
		executionMode = "plan"
	}
	saveSettings()
}

var dangerousExecPatterns = []*regexp.Regexp{
	// File / directory deletion (rm, rmdir, unlink, shred, wipe)
	regexp.MustCompile(`(?i)(^|[\s;&|])(rm(\s+-[a-zA-Z0-9_-]*|\s+)|rmdir\b|unlink\b|shred\b|wipe\b)`),
	// Raw disk / format
	regexp.MustCompile(`(?i)\b(mkfs(\.[a-z0-9]+)?|fdisk|parted|dd\s+if=)\b`),
	// Sensitive system directory writes/destructive access
	regexp.MustCompile(`(?i)(^|[\s;&|])(/etc|/sys|/proc|/boot|/dev|/usr/bin|/usr/sbin|/var/run|/root|~?/\.ssh)(\b|/)`),
	// Database destructive queries
	regexp.MustCompile(`(?i)\b(drop\s+(database|schema|table|user)|truncate\s+table|alter\s+table\s+.*\bdrop\b|dropdb|prisma\s+migrate\s+reset)\b`),
	// Dangerous power / system commands
	regexp.MustCompile(`(?i)\b(shutdown|reboot|poweroff|init\s+0|kill\s+-9\s+1)\b`),
	// Destructive git
	regexp.MustCompile(`(?i)\b(git\s+reset\s+--hard|git\s+clean\s+-[a-zA-Z]*f|git\s+push\s+.*--force)\b`),
	// Destructive docker
	regexp.MustCompile(`(?i)\b(docker\s+rm\s+-[a-zA-Z]*f|docker\s+system\s+prune|docker\s+volume\s+rm)\b`),
	// Remote script pipe to shell
	regexp.MustCompile(`(?i)\b(curl|wget)\s+.*\|\s*(ba)?sh\b`),
	// Bulk permission destruction
	regexp.MustCompile(`(?i)\b(chmod|chown)\s+-R\s+.*\s+(/|/\*|~)\b`),
}

// RequiresApproval checks whether a tool invocation needs user confirmation
// when Autonomous Mode is disabled. Only dangerous / destructive operations
// require confirmation; ordinary development, inspection, and build tasks proceed immediately.
func RequiresApproval(toolName, arg string) bool {
	if toolName == "delete_file" {
		return true
	}
	if toolName != "exec" {
		return false
	}
	trimmed := strings.TrimSpace(arg)
	for _, re := range dangerousExecPatterns {
		if re.MatchString(trimmed) {
			return true
		}
	}
	return false
}
