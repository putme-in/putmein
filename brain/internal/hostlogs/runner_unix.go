//go:build linux || darwin

package hostlogs

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

// Run is only invoked in a dedicated process group. The collector and application
// share that group, so existing verified group stop/kill operations cover both.
func Run(dir, command string) int {
	if syscall.Getpgrp() != os.Getpid() {
		fmt.Fprintln(os.Stderr, "host log runner requires its own process group")
		return 1
	}
	writer, err := OpenWriter(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	// Let the application receive group termination while the collector drains its
	// output. Brain still enforces its existing stop deadline for the whole group.
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	defer signal.Stop(signals)
	cmd := exec.Command("/bin/sh", "-c", command)
	failures := make(chan error, 1)
	output := &reportingWriter{writer: writer, failures: failures}
	cmd.Stdout = output
	cmd.Stderr = output
	cmd.WaitDelay = time.Second
	err = cmd.Start()
	if err == nil {
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		var timeout <-chan time.Time
		var timer *time.Timer
		shuttingDown := false
		stopGroup := func(sig syscall.Signal, forward bool) {
			if shuttingDown {
				return
			}
			shuttingDown = true
			if forward {
				_ = syscall.Kill(-os.Getpid(), sig)
			}
			timer = time.NewTimer(1500 * time.Millisecond)
			timeout = timer.C
		}
	wait:
		for {
			select {
			case err = <-done:
				break wait
			case failure := <-failures:
				fmt.Fprintf(os.Stderr, "[RAY] Log collector failed; stopping application: %v\n", failure)
				stopGroup(syscall.SIGTERM, true)
			case received := <-signals:
				if sig, ok := received.(syscall.Signal); ok {
					stopGroup(sig, false)
				}
			case <-timeout:
				_ = syscall.Kill(-os.Getpid(), syscall.SIGKILL)
			}
		}
		if timer != nil {
			timer.Stop()
		}
	}
	code := 0
	if err != nil {
		code = 1
		if exit, ok := err.(*exec.ExitError); ok {
			code = exit.ExitCode()
		}
		_, _ = fmt.Fprintf(writer, "\n[RAY] Managed process exited: %v\n", err)
	} else {
		_, _ = fmt.Fprintln(writer, "\n[RAY] Managed process exited.")
	}
	_ = writer.Close()
	// Also clean up background descendants if Brain itself has exited. The final
	// application exit status is already in the logs before the group is reaped.
	_ = syscall.Kill(-os.Getpid(), syscall.SIGKILL)
	return code
}

type reportingWriter struct {
	writer   *Writer
	failures chan error
}

func (w *reportingWriter) Write(data []byte) (int, error) {
	n, err := w.writer.Write(data)
	if err != nil {
		select {
		case w.failures <- err:
		default:
		}
	}
	return n, err
}
