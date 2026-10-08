//go:build !linux && !darwin && !windows

package deploy

import (
	"fmt"
	"os"
)

func lockOperationFile(file *os.File) error {
	return fmt.Errorf("managed lifecycle locking is unsupported on this platform")
}
func unlockOperationFile(file *os.File) {}
