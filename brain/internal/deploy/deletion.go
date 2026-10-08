package deploy

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type deletionLease struct {
	Token   string `json:"token"`
	Owner   string `json:"owner"`
	Project string `json:"project"`
}

// Ray's project deletion spans local filesystem and database work. A durable
// reservation keeps all managed mutations out until Ray explicitly finishes.
func readDeletionLease() (*deletionLease, error) {
	raw, err := os.ReadFile(filepath.Join(lifecycleRoot(), "deletion.json"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var lease deletionLease
	if json.Unmarshal(raw, &lease) != nil || lease.Token == "" {
		return nil, fmt.Errorf("invalid project deletion reservation; operator recovery required")
	}
	return &lease, nil
}
func checkDeletionLease(token string) error {
	lease, err := readDeletionLease()
	if err != nil {
		return err
	}
	if lease != nil && lease.Token != token {
		return fmt.Errorf("project deletion is in progress or interrupted; finish that deletion before another lifecycle operation")
	}
	return nil
}
func BeginProjectDeletion(owner, project string) (string, error) {
	if owner == "" || project == "" {
		return "", fmt.Errorf("owner and project required")
	}
	release, err := acquireOperationFile()
	if err != nil {
		return "", err
	}
	defer release()
	existing, err := readDeletionLease()
	if err != nil {
		return "", err
	}
	if existing != nil {
		if existing.Owner != owner || existing.Project != project {
			return "", fmt.Errorf("another project deletion must finish first")
		}
		return existing.Token, nil
	}
	var raw [32]byte
	if _, err = rand.Read(raw[:]); err != nil {
		return "", err
	}
	lease := deletionLease{Token: hex.EncodeToString(raw[:]), Owner: owner, Project: project}
	if err := atomicSecurityJSON(filepath.Join(lifecycleRoot(), "deletion.json"), lease); err != nil {
		return "", err
	}
	return lease.Token, nil
}
func FinishProjectDeletion(token string, completed bool) error {
	release, err := AcquireOperation(token)
	if err != nil {
		return err
	}
	defer release()
	lease, err := readDeletionLease()
	if err != nil {
		return err
	}
	if lease == nil || lease.Token != token {
		return fmt.Errorf("deletion reservation does not match")
	}
	if completed {
		req := DeployRequest{UserID: lease.Owner, ProjectID: lease.Project}
		if err := atomicSecurityJSON(filepath.Join(artifactDir(req), "deleted.json"), map[string]bool{"deleted": true}); err != nil {
			return err
		}
	}
	return os.Remove(filepath.Join(lifecycleRoot(), "deletion.json"))
}
func checkProjectNotDeleted(req DeployRequest) error {
	_, err := os.Stat(filepath.Join(artifactDir(req), "deleted.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("this project has been deleted; create a new project before deploying")
}
