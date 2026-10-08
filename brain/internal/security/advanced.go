package security

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

type AdvancedConfig struct {
	Dependencies bool `json:"dependencies"`
	Images       bool `json:"images"`
	RescanHours  int  `json:"rescanHours"`
}

func AdvancedRoot() string {
	if root := os.Getenv("RAY_ADVANCED_SECURITY_DIR"); root != "" {
		return root
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ray", "advanced-security")
}
func LoadAdvancedConfig() (AdvancedConfig, error) {
	var config AdvancedConfig
	raw, err := os.ReadFile(filepath.Join(AdvancedRoot(), "config.json"))
	if os.IsNotExist(err) {
		return config, nil
	}
	if err != nil {
		return config, err
	}
	if err = json.Unmarshal(raw, &config); err != nil {
		return config, err
	}
	return config, validateAdvanced(config)
}
func validateAdvanced(c AdvancedConfig) error {
	if c.RescanHours != 0 && (c.RescanHours < 6 || c.RescanHours > 168) {
		return fmt.Errorf("rescan interval must be 6–168 hours, or 0 to disable")
	}
	return nil
}
func SaveAdvancedConfig(c AdvancedConfig) error {
	if err := validateAdvanced(c); err != nil {
		return err
	}
	if c.Dependencies || c.Images {
		if _, err := exec.LookPath("trivy"); err != nil {
			return fmt.Errorf("install Trivy on the Brain host before enabling vulnerability scans")
		}
		if err := ValidateAdvisoryCache(); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(AdvancedRoot(), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(AdvancedRoot(), ".config-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	raw, _ := json.Marshal(c)
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), filepath.Join(AdvancedRoot(), "config.json"))
}
