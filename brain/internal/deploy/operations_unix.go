//go:build linux || darwin

package deploy

import (
	"os"
	"syscall"
)

func lockOperationFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}
func unlockOperationFile(file *os.File) { _ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN) }
