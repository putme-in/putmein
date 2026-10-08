package deploy

import (
	"fmt"
	"os"
	"path/filepath"
)

func lifecycleRoot() string {
	if root := os.Getenv("RAY_LIFECYCLE_DIR"); root != "" {
		return root
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ray", "lifecycle")
}

// A server-wide lock deliberately serializes managed lifecycle operations, including
// port allocation and routing. Kernel locks are released on process termination.
func AcquireOperation(deletionToken ...string) (func(), error) {
	release, err := acquireOperationFile()
	if err != nil {
		return nil, err
	}
	token := ""
	if len(deletionToken) > 0 {
		token = deletionToken[0]
	}
	if err := checkDeletionLease(token); err != nil {
		release()
		return nil, err
	}
	return release, nil
}
func acquireOperationFile() (func(), error) {
	root := lifecycleRoot()
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(root, "operation.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = lockOperationFile(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("another deployment, lifecycle action or cleanup is in progress; retry after it finishes: %w", err)
	}
	return func() { unlockOperationFile(file); file.Close() }, nil
}
