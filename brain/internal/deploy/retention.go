package deploy

import (
	"brain/server/internal/hostlogs"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Only paths explicitly recorded when Brain creates a release are cleanup candidates.
type releaseArtifact struct {
	Path      string        `json:"path"`
	CreatedAt time.Time     `json:"createdAt"`
	Request   DeployRequest `json:"request"`
	Result    *DeployResult `json:"result,omitempty"`
	Status    string        `json:"status"`
}
type CleanupItem struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Bytes   int64  `json:"bytes"`
	Removed bool   `json:"removed"`
	Error   string `json:"error,omitempty"`
}

func artifactDir(req DeployRequest) string {
	hash := sha256.Sum256([]byte(req.UserID + "\x00" + securityIdentity(req)))
	return filepath.Join(lifecycleRoot(), "artifacts", hex.EncodeToString(hash[:]))
}
func artifactFile(req DeployRequest, source string) string {
	hash := sha256.Sum256([]byte(source))
	return filepath.Join(artifactDir(req), hex.EncodeToString(hash[:])+".json")
}
func recordArtifact(req DeployRequest, result *DeployResult, status string) error {
	clean := req
	clean.EnvVars = nil
	clean.GitHubToken = ""
	clean.SecurityOverride = ""
	item := releaseArtifact{Path: req.ProjectPath, CreatedAt: time.Now(), Request: clean, Result: result, Status: status}
	filename := artifactFile(req, req.ProjectPath)
	if raw, err := os.ReadFile(filename); err == nil {
		var old releaseArtifact
		if json.Unmarshal(raw, &old) != nil {
			return fmt.Errorf("invalid release tracking record")
		}
		item.CreatedAt = old.CreatedAt
		if result == nil {
			item.Result = old.Result
		}
	}
	return atomicSecurityJSON(filename, item)
}
func ListReleaseArtifacts(req DeployRequest) ([]releaseArtifact, error) {
	entries, err := os.ReadDir(artifactDir(req))
	if os.IsNotExist(err) {
		return []releaseArtifact{}, nil
	}
	if err != nil {
		return nil, err
	}
	items := []releaseArtifact{}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == "deleted.json" || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(artifactDir(req), entry.Name()))
		if err != nil {
			return nil, err
		}
		var item releaseArtifact
		if json.Unmarshal(raw, &item) != nil || item.Request.UserID != req.UserID || securityIdentity(item.Request) != securityIdentity(req) {
			return nil, fmt.Errorf("invalid release tracking record; cleanup blocked")
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}
func protectedReleasePaths() (map[string]bool, error) {
	protected := map[string]bool{}
	// Fail closed if state cannot be read. This covers active, previous, and interrupted replacements.
	for _, root := range []string{filepath.Join(lifecycleRoot(), "runtimes"), hostRoot()} {
		err := filepath.WalkDir(root, func(name string, entry os.DirEntry, walkErr error) error {
			if os.IsNotExist(walkErr) && name == root {
				return nil
			}
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			base := entry.Name()
			if base != "active.json" && base != "previous.json" && base != "pending.json" && base != "state.json" {
				return nil
			}
			raw, err := os.ReadFile(name)
			if err != nil {
				return err
			}
			var value any
			if json.Unmarshal(raw, &value) != nil {
				return fmt.Errorf("invalid runtime state; cleanup blocked")
			}
			var visit func(any)
			visit = func(v any) {
				switch obj := v.(type) {
				case map[string]any:
					for key, value := range obj {
						if key == "projectPath" || key == "logFile" || key == "sourceReference" {
							if text, ok := value.(string); ok && text != "" {
								protected[filepath.Clean(text)] = true
							}
						}
						visit(value)
					}
				case []any:
					for _, item := range obj {
						visit(item)
					}
				}
			}
			visit(value)
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return protected, nil
}
func trackedSourceSafe(item releaseArtifact) bool {
	source := filepath.Clean(item.Path)
	parent := filepath.Dir(source)
	identity := item.Request
	identity.ProjectID = securityIdentity(identity)
	if filepath.Base(filepath.Dir(parent)) != ".security-releases" || filepath.Base(parent) != strings.TrimPrefix(hostHandle(identity), hostPrefix) || !strings.HasPrefix(filepath.Base(source), "release-") {
		return false
	}
	resolved, err := filepath.EvalSymlinks(source)
	return err == nil && resolved == source
}

// CleanupProject keeps at least three newest records and anything newer than seven
// days. Active/previous/journal sources are always protected, regardless of age.
func CleanupProject(req DeployRequest, apply bool, approved []string) ([]CleanupItem, error) {
	items, err := ListReleaseArtifacts(req)
	if err != nil {
		return nil, err
	}
	protected, err := protectedReleasePaths()
	if err != nil {
		return nil, err
	}
	if req.ProjectPath != "" {
		protected[filepath.Clean(req.ProjectPath)] = true
	}
	out := []CleanupItem{}
	for index, item := range items {
		if index < 3 || time.Since(item.CreatedAt) < 7*24*time.Hour || protected[filepath.Clean(item.Path)] || item.Status == "building" {
			continue
		}
		if !trackedSourceSafe(item) {
			continue
		}
		// Other saved artifacts may refer to a parent or child of this source.
		overlaps := false
		for path := range protected {
			relative, e := filepath.Rel(item.Path, path)
			if e == nil && (relative == "." || (!strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != "..")) {
				overlaps = true
			}
			reverse, e := filepath.Rel(path, item.Path)
			if e == nil && (reverse == "." || (reverse != ".." && !strings.HasPrefix(reverse, ".."+string(filepath.Separator)))) {
				overlaps = true
			}
		}
		if overlaps {
			continue
		}
		entry := CleanupItem{Path: item.Path, Kind: "source"}
		walkErr := filepath.WalkDir(item.Path, func(name string, d os.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if !d.IsDir() {
				info, e := d.Info()
				if e != nil {
					return e
				}
				entry.Bytes += info.Size()
			}
			return nil
		})
		if walkErr != nil {
			entry.Error = "Could not inspect tracked source"
			out = append(out, entry)
			continue
		}
		if apply {
			allowed := false
			for _, path := range approved {
				if path == item.Path {
					allowed = true
				}
			}
			if !allowed {
				continue
			}
		}
		if apply {
			if err := cleanupDockerArtifact(item); err != nil {
				entry.Error = err.Error()
				out = append(out, entry)
				continue
			}
			if err := os.RemoveAll(item.Path); err != nil {
				entry.Error = err.Error()
			} else {
				entry.Removed = true
				_ = os.Remove(artifactFile(req, item.Path))
			}
		}
		out = append(out, entry)
	}
	return out, nil
}

// Retired host logs only: active and previous runtime logs are never deleted.
func maintainHostLogs() error {
	protected, err := protectedReleasePaths()
	if err != nil {
		return err
	}
	dirs, err := os.ReadDir(hostRoot())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, dir := range dirs {
		if !dir.IsDir() || !hostKeyPattern.MatchString(dir.Name()) {
			continue
		}
		root := filepath.Join(hostRoot(), dir.Name())
		entries, err := os.ReadDir(root)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if !strings.HasPrefix(entry.Name(), "application-") || !strings.HasSuffix(entry.Name(), ".log") {
				continue
			}
			file := filepath.Join(root, entry.Name())
			info, err := os.Lstat(file)
			if err != nil {
				return err
			}
			if info.IsDir() {
				if !protected[file] && hostlogs.Expired(file, time.Now().Add(-7*24*time.Hour).Unix()) {
					if err := os.RemoveAll(file); err != nil {
						return err
					}
				}
				continue
			}
			if !info.Mode().IsRegular() {
				continue
			}
			if !protected[file] && time.Since(info.ModTime()) > 7*24*time.Hour {
				if err := os.Remove(file); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func StartReleaseMaintenance(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				release, err := AcquireOperation()
				if err != nil {
					continue
				}
				err = maintainHostLogs()
				release()
				if err != nil {
					fmt.Printf("[deploy] retention deferred: %v\n", err)
				}
			}
		}
	}()
}

func cleanupDockerArtifact(item releaseArtifact) error {
	if item.Result == nil || strings.HasPrefix(item.Result.ContainerName, hostPrefix) {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if item.Result.ContainerID != "" {
		container, err := dockerInspect(ctx, item.Result.ContainerID)
		if err == nil {
			if container.State.Running {
				return fmt.Errorf("container still running; preserved")
			}
			if container.Config.Labels["io.ray.owner"] != item.Request.UserID || container.Config.Labels["io.ray.project"] != securityIdentity(item.Request) {
				return fmt.Errorf("container ownership could not be verified; preserved")
			}
			if _, err := dockerCmd(ctx, "rm", container.ID).CombinedOutput(); err != nil {
				return fmt.Errorf("container could not be removed; source preserved")
			}
		} else {
			raw, e := dockerCmd(ctx, "ps", "-aq", "--filter", "id="+item.Result.ContainerID).Output()
			if e != nil || strings.TrimSpace(string(raw)) != "" {
				return fmt.Errorf("could not verify retired container; source preserved")
			}
		}
	}
	// No force: Docker protects images still referenced by another container.
	if item.Result.ImageName != "" {
		raw, err := dockerCmd(ctx, "image", "inspect", "--format", "{{json .Config.Labels}}", item.Result.ImageName).Output()
		if err != nil {
			images, listErr := dockerCmd(ctx, "image", "ls", "-q", "--filter", "reference="+item.Result.ImageName).Output()
			if listErr != nil || strings.TrimSpace(string(images)) != "" {
				return fmt.Errorf("could not verify retired image; source preserved")
			}
		}
		if err == nil {
			var labels map[string]string
			if json.Unmarshal(raw, &labels) != nil || labels["io.ray.owner"] != item.Request.UserID || labels["io.ray.project"] != securityIdentity(item.Request) {
				return fmt.Errorf("image ownership could not be verified; preserved")
			}
			if _, err := dockerCmd(ctx, "image", "rm", item.Result.ImageName).CombinedOutput(); err != nil {
				return fmt.Errorf("image remains referenced; preserved")
			}
		}
	}
	return nil
}
