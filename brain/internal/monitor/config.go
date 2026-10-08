package monitor

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type CustomLogRule struct {
	ID              string   `json:"id"`
	Pattern         string   `json:"pattern"`
	Message         string   `json:"message"`
	Severity        Severity `json:"severity"`
	Enabled         bool     `json:"enabled"`
	CooldownSeconds int      `json:"cooldownSeconds"`
}
type JSONLogger struct {
	Enabled      bool                `json:"enabled"`
	LevelField   string              `json:"levelField"`
	MessageField string              `json:"messageField"`
	Levels       map[string]Severity `json:"levels"`
}
type MonitoringConfig struct {
	Version         int             `json:"version"`
	BuiltinEnabled  bool            `json:"builtinEnabled"`
	AIEnabled       bool            `json:"aiEnabled"`
	CooldownSeconds int             `json:"cooldownSeconds"`
	IntervalSeconds int             `json:"intervalSeconds"`
	LogPaths        []string        `json:"logPaths"`
	Rules           []CustomLogRule `json:"rules"`
	JSON            JSONLogger      `json:"json"`
}
type RuleMatch struct {
	ID              string   `json:"id"`
	Message         string   `json:"message"`
	Severity        Severity `json:"severity"`
	CooldownSeconds int      `json:"cooldownSeconds"`
}

func DefaultMonitoringConfig() MonitoringConfig {
	return MonitoringConfig{Version: 1, BuiltinEnabled: true, AIEnabled: true, CooldownSeconds: 300, IntervalSeconds: 0, LogPaths: []string{}, Rules: []CustomLogRule{}, JSON: JSONLogger{LevelField: "level", MessageField: "message", Levels: map[string]Severity{"warn": SeverityWarn, "warning": SeverityWarn, "error": SeverityError, "fatal": SeverityCritical, "critical": SeverityCritical}}}
}
func validSeverity(v Severity) bool {
	return v == SeverityInfo || v == SeverityWarn || v == SeverityError || v == SeverityCritical
}

var ruleID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var jsonField = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,128}$`)

func ValidateMonitoringConfig(c MonitoringConfig) error {
	if c.Version != 1 {
		return fmt.Errorf("unsupported monitoring settings version")
	}
	if c.CooldownSeconds < 10 || c.CooldownSeconds > 86400 {
		return fmt.Errorf("alert cooldown must be 10–86400 seconds")
	}
	if c.IntervalSeconds != 0 && (c.IntervalSeconds < 10 || c.IntervalSeconds > 3600) {
		return fmt.Errorf("poll interval must be 10–3600 seconds, or 0 to use the project interval")
	}
	if len(c.LogPaths) > 10 || len(c.Rules) > 32 {
		return fmt.Errorf("at most 10 extra log paths and 32 custom rules are supported")
	}
	for _, path := range c.LogPaths {
		clean := filepath.Clean(filepath.FromSlash(path))
		if path == "" || len(path) > 512 || strings.ContainsRune(path, 0) || filepath.IsAbs(clean) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.Contains(path, ":") {
			return fmt.Errorf("extra log paths must be relative files inside the project")
		}
	}
	seen := map[string]bool{}
	for _, r := range c.Rules {
		if !ruleID.MatchString(r.ID) || seen[r.ID] {
			return fmt.Errorf("rule IDs must be unique letters, numbers, hyphens or underscores")
		}
		seen[r.ID] = true
		if len(r.Pattern) == 0 || len(r.Pattern) > 512 || len(strings.TrimSpace(r.Message)) == 0 || len(r.Message) > 240 || !validSeverity(r.Severity) {
			return fmt.Errorf("each rule needs a pattern (up to 512 bytes), message (up to 240 bytes) and valid severity")
		}
		if _, err := regexp.Compile(r.Pattern); err != nil {
			return fmt.Errorf("rule %s: invalid RE2 pattern: %w", r.ID, err)
		}
		if r.CooldownSeconds != 0 && (r.CooldownSeconds < 10 || r.CooldownSeconds > 86400) {
			return fmt.Errorf("rule cooldown must be 0 (project default) or 10–86400 seconds")
		}
	}
	if !jsonField.MatchString(c.JSON.LevelField) || !jsonField.MatchString(c.JSON.MessageField) || len(c.JSON.Levels) > 32 {
		return fmt.Errorf("JSON logger requires valid field names and at most 32 level mappings")
	}
	for key, value := range c.JSON.Levels {
		if key == "" || len(key) > 64 || !validSeverity(value) {
			return fmt.Errorf("invalid JSON logger level mapping")
		}
	}
	return nil
}
func monitoringConfigPath(owner, project string) string {
	root := os.Getenv("RAY_MONITOR_CONFIG_DIR")
	if root == "" {
		home, _ := os.UserHomeDir()
		root = filepath.Join(home, ".ray", "monitor-configs")
	}
	sum := sha256.Sum256([]byte(owner + "\x00" + project))
	return filepath.Join(root, hex.EncodeToString(sum[:])+".json")
}
func LoadMonitoringConfig(owner, project string) (MonitoringConfig, error) {
	c := DefaultMonitoringConfig()
	if owner == "" || project == "" {
		return c, nil
	}
	raw, err := os.ReadFile(monitoringConfigPath(owner, project))
	if os.IsNotExist(err) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	if len(raw) > 128*1024 {
		return c, fmt.Errorf("monitor configuration is too large")
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return DefaultMonitoringConfig(), err
	}
	if err := ValidateMonitoringConfig(c); err != nil {
		return DefaultMonitoringConfig(), err
	}
	return c, nil
}
func SaveMonitoringConfig(owner, project string, c MonitoringConfig) error {
	if owner == "" || project == "" {
		return fmt.Errorf("owner and project required")
	}
	if err := ValidateMonitoringConfig(c); err != nil {
		return err
	}
	filename := monitoringConfigPath(owner, project)
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(filename), ".config-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	raw, _ := json.Marshal(c)
	if _, err = file.Write(raw); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filename)
}

// Resolve custom file loggers under the current release, including after redeploy.
func configuredLogPaths(root string, c MonitoringConfig) []string {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil
	}
	paths := []string{}
	for _, relative := range c.LogPaths {
		path, err := filepath.EvalSymlinks(filepath.Join(resolved, filepath.FromSlash(relative)))
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(resolved, path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		info, err := os.Stat(path)
		if err == nil && info.Mode().IsRegular() {
			paths = append(paths, path)
		}
	}
	return paths
}
func loggerField(row map[string]any, path string) any {
	var value any = row
	for _, key := range strings.Split(path, ".") {
		obj, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = obj[key]
	}
	return value
}
func MatchConfiguredLogs(c MonitoringConfig, text string) []RuleMatch {
	matches := []RuleMatch{}
	if c.BuiltinEnabled {
		for _, rule := range LogRules {
			if rule.Pattern.MatchString(text) {
				matches = append(matches, RuleMatch{"builtin:" + rule.ID, rule.Message, rule.Severity, c.CooldownSeconds})
			}
		}
	}
	for _, rule := range c.Rules {
		if !rule.Enabled {
			continue
		}
		re, err := regexp.Compile(rule.Pattern)
		if err != nil || !re.MatchString(text) {
			continue
		}
		cooldown := rule.CooldownSeconds
		if cooldown == 0 {
			cooldown = c.CooldownSeconds
		}
		// A changed rule should not inherit suppression from a different pattern.
		sum := sha256.Sum256([]byte(rule.Pattern + "\x00" + rule.Message + "\x00" + string(rule.Severity)))
		matches = append(matches, RuleMatch{"custom:" + rule.ID + ":" + hex.EncodeToString(sum[:8]), rule.Message, rule.Severity, cooldown})
	}
	if c.JSON.Enabled {
		seen := map[Severity]bool{}
		for _, line := range strings.Split(text, "\n") {
			// Docker timestamps precede the original structured log record.
			if stamp, rest, ok := strings.Cut(strings.TrimSpace(line), " "); ok {
				if _, err := time.Parse(time.RFC3339Nano, stamp); err == nil {
					line = strings.TrimSpace(rest)
				}
			}
			var row map[string]any
			if json.Unmarshal([]byte(line), &row) != nil {
				continue
			}
			level := fmt.Sprint(loggerField(row, c.JSON.LevelField))
			severity, ok := c.JSON.Levels[level]
			if !ok || seen[severity] {
				continue
			}
			message, ok := loggerField(row, c.JSON.MessageField).(string)
			if !ok || strings.TrimSpace(message) == "" {
				continue
			}
			if len(message) > 240 {
				message = message[:240]
			}
			matches = append(matches, RuleMatch{"json:" + string(severity), message, severity, c.CooldownSeconds})
			seen[severity] = true
		}
	}
	return matches
}
