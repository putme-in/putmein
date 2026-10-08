//go:build linux || darwin

package deploy

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func hostSupported() bool { return true }
func hostCommand(command, marker string) *exec.Cmd {
	// Keep the shell as the group leader until the foreground command finishes.
	cmd := exec.Command("/bin/sh", "-c", command+"\nray_status=$?\nexit \"$ray_status\"", marker)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return cmd
}
func hostProcessAlive(pid int, marker string) bool {
	if pid <= 1 || marker == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-ww", "-p", strconv.Itoa(pid), "-o", "pgid=", "-o", "args=").Output()
	if err != nil {
		return false
	}
	fields := strings.Fields(string(out))
	return len(fields) > 1 && fields[0] == strconv.Itoa(pid) && strings.Contains(string(out), marker)
}
func terminateHostGroup(pid int, marker string) error {
	if !hostProcessAlive(pid, marker) {
		return nil
	} // Never signal a PID recovered without its identity.
	if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil && err != syscall.ESRCH {
		return err
	}
	// The group can outlive its shell. Do not leave children holding the port open.
	for i := 0; i < 20; i++ {
		if err := syscall.Kill(-pid, 0); err == syscall.ESRCH {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil && err != syscall.ESRCH {
		return fmt.Errorf("stop process group: %w", err)
	}
	return nil
}
func killOwnedHostGroup(pid int) {
	if pid > 1 {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}
}

func hostLogCommand(command, marker, logPath string) (*exec.Cmd, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(executable, "--internal-host-log-runner", marker, logPath, command)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return cmd, nil
}
