//go:build !linux && !darwin

package deploy

import (
	"fmt"
	"os/exec"
)

func hostSupported() bool                          { return false }
func hostCommand(command, marker string) *exec.Cmd { return exec.Command("unsupported-host-runtime") }
func hostProcessAlive(pid int, marker string) bool { return false }
func terminateHostGroup(pid int, marker string) error {
	return fmt.Errorf("host deployment requires Linux or macOS")
}
func killOwnedHostGroup(pid int) {}

func hostLogCommand(command, marker, logPath string) (*exec.Cmd, error) {
	return nil, fmt.Errorf("host deployment requires Linux or macOS")
}
