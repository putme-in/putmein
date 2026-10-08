package deploy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"brain/server/internal/agent"
)

type LegacyEvidence struct {
	Path        string `json:"path"`
	Owner       string `json:"owner"`
	Project     string `json:"project"`
	ContainerID string `json:"containerId"`
}
type LegacyOwner struct {
	Owner   string `json:"owner"`
	Project string `json:"project"`
}
type LegacyRequest struct {
	Action            string                 `json:"action"`
	ProtectedPaths    []string               `json:"protectedPaths"`
	ProtectedRuntimes []string               `json:"protectedRuntimes"`
	Evidence          []LegacyEvidence       `json:"evidence"`
	Pipelines         map[string]LegacyOwner `json:"pipelines"`
	Projects          []LegacyOwner          `json:"projects"`
	Items             []LegacySelection      `json:"items"`
}
type LegacySelection struct {
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
}
type LegacyItem struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Path        string    `json:"path"`
	Owner       string    `json:"owner"`
	Project     string    `json:"project"`
	Bytes       int64     `json:"bytes"`
	Modified    time.Time `json:"modified"`
	Fingerprint string    `json:"fingerprint"`
	Eligible    bool      `json:"eligible"`
	Reason      string    `json:"reason"`
	State       string    `json:"state"`
}
type legacyRecord struct {
	Original      string    `json:"original"`
	Owner         string    `json:"owner"`
	Project       string    `json:"project"`
	QuarantinedAt time.Time `json:"quarantinedAt"`
	State         string    `json:"state"`
}
type legacyContainer struct {
	ID      string `json:"Id"`
	Name    string
	Image   string
	Created time.Time
	State   struct {
		Running    bool
		Paused     bool
		Restarting bool
		StartedAt  time.Time
		FinishedAt time.Time
		ExitCode   int
	}
	Config struct {
		Image  string
		Labels map[string]string
	}
	Mounts []struct{ Source string }
}
type legacyImage struct {
	ID       string `json:"Id"`
	Created  time.Time
	RepoTags []string
	Config   struct{ Labels map[string]string }
}

func within(parent, child string) bool {
	relative, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(child))
	return err == nil && (relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))))
}
func overlapProtected(path string, protected map[string]bool) bool {
	for other := range protected {
		if within(path, other) || within(other, path) {
			return true
		}
	}
	return false
}
func legacyRoot() (string, error)         { return filepath.EvalSymlinks(agent.GetDeploymentsDir()) }
func legacyQuarantine(root string) string { return filepath.Join(root, ".legacy-quarantine") }
func legacyTree(path string) (int64, string, time.Time, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != filepath.Clean(path) {
		return 0, "", time.Time{}, fmt.Errorf("symlinked or unavailable root")
	}
	hash := sha256.New()
	var size int64
	var newest time.Time
	entries := 0
	err = filepath.WalkDir(path, func(name string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		entries++
		if entries > 100000 {
			return fmt.Errorf("more than 100000 entries; manual review required")
		}
		info, e := d.Info()
		if e != nil {
			return e
		}
		if !info.IsDir() && !info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0 {
			return fmt.Errorf("special file requires manual review")
		}
		rel, _ := filepath.Rel(path, name)
		fmt.Fprintf(hash, "%s\x00%d\x00%d\x00%d\n", rel, info.Size(), info.Mode(), info.ModTime().UnixNano())
		if !info.IsDir() {
			size += info.Size()
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		if info.Mode()&os.ModeSymlink != 0 {
			target, e := os.Readlink(name)
			if e != nil {
				return e
			}
			fmt.Fprintln(hash, target)
		}
		return nil
	})
	return size, hex.EncodeToString(hash.Sum(nil)), newest, err
}
func legacyRuntimeReferences(req LegacyRequest) (map[string]bool, map[string]bool, error) {
	paths, err := protectedReleasePaths()
	if err != nil {
		return nil, nil, err
	}
	refs := map[string]bool{}
	for _, path := range req.ProtectedPaths {
		if path != "" {
			paths[filepath.Clean(path)] = true
		}
	}
	for _, ref := range req.ProtectedRuntimes {
		if ref != "" {
			refs[ref] = true
		}
	}
	for _, root := range []string{filepath.Join(lifecycleRoot(), "runtimes"), filepath.Join(lifecycleRoot(), "artifacts")} {
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
			if os.IsNotExist(e) && path == root {
				return nil
			}
			if e != nil {
				return e
			}
			if d.IsDir() || !strings.HasSuffix(path, ".json") {
				return nil
			}
			raw, e := os.ReadFile(path)
			if e != nil {
				return e
			}
			var value any
			if json.Unmarshal(raw, &value) != nil {
				return fmt.Errorf("invalid lifecycle record; cleanup blocked")
			}
			var walk func(any)
			walk = func(v any) {
				switch object := v.(type) {
				case map[string]any:
					for key, child := range object {
						if text, ok := child.(string); ok && text != "" {
							switch key {
							case "containerId", "previousId", "containerName", "imageName":
								refs[text] = true
							case "path":
								if strings.Contains(path, string(filepath.Separator)+"artifacts"+string(filepath.Separator)) {
									paths[filepath.Clean(text)] = true
								}
							}
						}
						walk(child)
					}
				case []any:
					for _, child := range object {
						walk(child)
					}
				}
			}
			walk(value)
			return nil
		})
		if err != nil {
			return nil, nil, err
		}
	}
	return paths, refs, nil
}
func runtimeProtected(refs map[string]bool, id, name string) bool {
	if refs[id] || refs[name] {
		return true
	}
	for ref := range refs {
		if len(ref) >= 12 && strings.HasPrefix(id, ref) {
			return true
		}
	}
	return false
}
func inspectLegacyDocker(ctx context.Context) ([]legacyContainer, []legacyImage, error) {
	raw, err := dockerCmd(ctx, "ps", "-aq", "--no-trunc").Output()
	if err != nil {
		return nil, nil, fmt.Errorf("Docker inventory unavailable; filesystem usage cannot be verified")
	}
	ids := strings.Fields(string(raw))
	if len(ids) > 500 {
		return nil, nil, fmt.Errorf("more than 500 containers; manual inventory required")
	}
	containers := []legacyContainer{}
	if len(ids) > 0 {
		args := append([]string{"inspect", "--type", "container"}, ids...)
		raw, err = dockerCmd(ctx, args...).Output()
		if err != nil || json.Unmarshal(raw, &containers) != nil {
			return nil, nil, fmt.Errorf("cannot inspect Docker mounts")
		}
	}
	raw, err = dockerCmd(ctx, "image", "ls", "--no-trunc", "-q", "--filter", "reference=ray-*").Output()
	if err != nil {
		return nil, nil, fmt.Errorf("cannot inspect legacy Docker images")
	}
	seen := map[string]bool{}
	ids = nil
	for _, id := range strings.Fields(string(raw)) {
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	if len(ids) > 500 {
		return nil, nil, fmt.Errorf("more than 500 images; manual inventory required")
	}
	images := []legacyImage{}
	if len(ids) > 0 {
		raw, err = dockerCmd(ctx, append([]string{"image", "inspect"}, ids...)...).Output()
		if err != nil || json.Unmarshal(raw, &images) != nil {
			return nil, nil, fmt.Errorf("cannot inspect legacy Docker image ownership")
		}
	}
	return containers, images, nil
}
func legacyOwnerFor(path string, req LegacyRequest) LegacyOwner {
	owner := LegacyOwner{}
	for _, e := range req.Evidence {
		if e.Path == "" || e.Owner == "" || e.Project == "" {
			continue
		}
		if within(path, e.Path) {
			if owner.Owner != "" && (owner.Owner != e.Owner || owner.Project != e.Project) {
				return LegacyOwner{}
			}
			owner = LegacyOwner{e.Owner, e.Project}
		}
	}
	return owner
}
func LegacyReview(ctx context.Context, req LegacyRequest) ([]LegacyItem, error) {
	root, err := legacyRoot()
	if err != nil {
		return nil, err
	}
	protected, refs, err := legacyRuntimeReferences(req)
	if err != nil {
		return nil, err
	}
	containers, images, dockerErr := inspectLegacyDocker(ctx)
	for _, container := range containers {
		for _, mount := range container.Mounts {
			if mount.Source != "" {
				protected[filepath.Clean(mount.Source)] = true
			}
		}
	}
	for path := range protected {
		if resolved, e := filepath.EvalSymlinks(path); e == nil {
			protected[resolved] = true
		}
	}
	candidates := map[string]LegacyOwner{}
	addChildren := func(parent, prefix string, owner LegacyOwner) error {
		entries, e := os.ReadDir(parent)
		if os.IsNotExist(e) {
			return nil
		}
		if e != nil {
			return e
		}
		if len(entries) > 1000 {
			return fmt.Errorf("staging inventory exceeds 1000 entries; manual review required")
		}
		for _, entry := range entries {
			if entry.IsDir() && strings.HasPrefix(entry.Name(), prefix) {
				path := filepath.Join(parent, entry.Name())
				candidates[path] = owner
			}
		}
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	if len(entries) > 1000 {
		return nil, fmt.Errorf("deployment root exceeds 1000 entries; manual review required")
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), ".upload-") {
			candidates[filepath.Join(root, entry.Name())] = LegacyOwner{}
		}
	}
	for _, name := range []string{".git-setup", ".github-setup"} {
		if err := addChildren(filepath.Join(root, name), "", LegacyOwner{}); err != nil {
			return nil, err
		}
	}
	for id, owner := range req.Pipelines {
		if filepath.Base(id) != id || id == "." || id == ".." {
			continue
		}
		if err := addChildren(filepath.Join(root, ".releases", id), "run-", owner); err != nil {
			return nil, err
		}
	}
	for _, owner := range req.Projects {
		hash := strings.TrimPrefix(hostHandle(DeployRequest{UserID: owner.Owner, ProjectID: owner.Project}), hostPrefix)
		if err := addChildren(filepath.Join(root, ".security-releases", hash), "release-", owner); err != nil {
			return nil, err
		}
	}

	// Include staging for deleted pipelines/projects; absent ownership remains review-only.
	for _, group := range []struct{ name, prefix string }{{".releases", "run-"}, {".security-releases", "release-"}} {
		parents, e := os.ReadDir(filepath.Join(root, group.name))
		if e != nil && !os.IsNotExist(e) {
			return nil, e
		}
		if len(parents) > 1000 {
			return nil, fmt.Errorf("too many staging owners; manual review required")
		}
		for _, parent := range parents {
			if !parent.IsDir() {
				continue
			}
			children, e := os.ReadDir(filepath.Join(root, group.name, parent.Name()))
			if e != nil {
				return nil, e
			}
			if len(children) > 1000 {
				return nil, fmt.Errorf("too many staging folders; manual review required")
			}
			for _, child := range children {
				if child.IsDir() && strings.HasPrefix(child.Name(), group.prefix) {
					path := filepath.Join(root, group.name, parent.Name(), child.Name())
					if _, exists := candidates[path]; !exists {
						candidates[path] = LegacyOwner{}
					}
				}
			}
		}
	}
	if len(candidates) > 500 {
		return nil, fmt.Errorf("more than 500 staging folders; manual review required")
	}
	out := []LegacyItem{}
	for path, owner := range candidates {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if owner.Owner == "" {
			owner = legacyOwnerFor(path, req)
		}
		item := LegacyItem{ID: path, Kind: "source", Path: path, Owner: owner.Owner, Project: owner.Project, State: "original"}
		item.Bytes, item.Fingerprint, item.Modified, err = legacyTree(path)
		switch {
		case err != nil:
			item.Reason = "Could not safely inspect the folder: " + err.Error()
		case overlapProtected(path, protected):
			item.Reason = "Referenced by a project, setup, runtime, mount or tracked release"
		case owner.Owner == "" || owner.Project == "":
			item.Reason = "Ownership is unknown; manual review only"
		case time.Since(item.Modified) < 30*24*time.Hour:
			item.Reason = "Contains changes newer than 30 days"
		case dockerErr != nil:
			item.Reason = dockerErr.Error()
		default:
			item.Eligible = true
			item.Reason = "Eligible for quarantine after a live open-file check"
		}
		out = append(out, item)
	}
	// Keep three newest legacy sources per known owner/project as an extra recovery margin.
	sort.Slice(out, func(i, j int) bool { return out[i].Modified.After(out[j].Modified) })
	counts := map[string]int{}
	for i := range out {
		item := &out[i]
		if item.Owner == "" {
			continue
		}
		key := item.Owner + "\x00" + item.Project
		counts[key]++
		if counts[key] <= 3 && item.Eligible {
			item.Eligible = false
			item.Reason = "One of the three newest legacy source folders for this project"
		}
	}
	if dockerErr == nil {
		usedImages := map[string]bool{}
		for _, c := range containers {
			usedImages[c.Image] = true
			if !strings.HasPrefix(strings.TrimPrefix(c.Name, "/"), "ray-") && c.Config.Labels["io.ray.owner"] == "" {
				continue
			}
			owner, project := c.Config.Labels["io.ray.owner"], c.Config.Labels["io.ray.project"]
			// An exact recorded container ID is acceptable evidence for pre-label containers.
			if owner == "" {
				for _, e := range req.Evidence {
					if e.ContainerID != "" && sameContainerID(e.ContainerID, c.ID) {
						if owner != "" && (owner != e.Owner || project != e.Project) {
							owner = ""
							project = ""
							break
						}
						owner = e.Owner
						project = e.Project
					}
				}
			}
			raw, _ := json.Marshal(c)
			sum := sha256.Sum256(raw)
			item := LegacyItem{ID: c.ID, Kind: "container", Path: strings.TrimPrefix(c.Name, "/"), Owner: owner, Project: project, Modified: c.Created, Fingerprint: hex.EncodeToString(sum[:]), State: "docker"}
			switch {
			case c.State.Running || c.State.Paused || c.State.Restarting:
				item.Reason = "Container is active"
			case runtimeProtected(refs, c.ID, item.Path):
				item.Reason = "Referenced by a deployment or release manifest"
			case owner == "" || project == "":
				item.Reason = "Ownership is unknown; manual review only"
			case time.Since(c.Created) < 30*24*time.Hour:
				item.Reason = "Container is newer than 30 days"
			default:
				item.Eligible = true
				item.Reason = "Stopped and unreferenced; explicit removal will preserve volumes"
			}
			out = append(out, item)
		}
		for _, im := range images {
			raw, _ := json.Marshal(im)
			sum := sha256.Sum256(raw)
			item := LegacyItem{ID: im.ID, Kind: "image", Path: strings.Join(im.RepoTags, ", "), Owner: im.Config.Labels["io.ray.owner"], Project: im.Config.Labels["io.ray.project"], Modified: im.Created, Fingerprint: hex.EncodeToString(sum[:]), State: "docker"}
			referenced := runtimeProtected(refs, im.ID, "")
			for _, tag := range im.RepoTags {
				if refs[tag] {
					referenced = true
				}
			}
			switch {
			case usedImages[im.ID] || referenced:
				item.Reason = "Referenced by a container or release"
			case item.Owner == "" || item.Project == "":
				item.Reason = "No ownership labels; manual review only"
			case time.Since(im.Created) < 30*24*time.Hour:
				item.Reason = "Image is newer than 30 days"
			default:
				item.Eligible = true
				item.Reason = "Owned and unreferenced; Docker removal is non-forced"
			}
			out = append(out, item)
		}
	} else {
		out = append(out, LegacyItem{ID: "docker-unavailable", Kind: "notice", Reason: dockerErr.Error()})
	}
	quarantine := legacyQuarantine(root)
	if resolved, e := filepath.EvalSymlinks(quarantine); e == nil && resolved != quarantine {
		return nil, fmt.Errorf("quarantine root must not be a symlink")
	} else if e != nil && !os.IsNotExist(e) {
		return nil, e
	}
	records, readErr := os.ReadDir(quarantine)
	if readErr != nil && !os.IsNotExist(readErr) {
		return nil, readErr
	}
	for _, entry := range records {
		if !entry.IsDir() {
			continue
		}
		folder := filepath.Join(legacyQuarantine(root), entry.Name())
		var record legacyRecord
		raw, e := os.ReadFile(filepath.Join(folder, "record.json"))
		if e != nil || json.Unmarshal(raw, &record) != nil {
			out = append(out, LegacyItem{ID: entry.Name(), Kind: "notice", Path: folder, Reason: "Quarantine record needs operator repair"})
			continue
		}
		source := filepath.Join(folder, "source")
		bytes, fingerprint, _, e := legacyTree(source)
		item := LegacyItem{ID: entry.Name(), Kind: "quarantine", State: record.State, Path: record.Original, Owner: record.Owner, Project: record.Project, Bytes: bytes, Fingerprint: fingerprint, Modified: record.QuarantinedAt}
		switch {
		case e != nil:
			item.Reason = "Quarantine journal needs repair; source missing or changed"
		case overlapProtected(source, protected) || overlapProtected(record.Original, protected):
			item.Reason = "Now referenced; restore or review before removal"
		case dockerErr != nil:
			item.Reason = dockerErr.Error()
		case record.State != "quarantined":
			item.Reason = "Interrupted quarantine; restore before cleanup"
		case time.Since(record.QuarantinedAt) < 7*24*time.Hour:
			item.Reason = "Restore available; permanent removal waits seven days"
		default:
			item.Eligible = true
			item.Reason = "Quarantined for at least seven days; eligible for permanent removal"
		}
		out = append(out, item)
	}
	return out, nil
}
func verifyNoOpenLegacyFiles(ctx context.Context, path string) error {
	command := exec.CommandContext(ctx, "lsof", "-n", "-P", "+D", path, "-F", "n")
	var stderr strings.Builder
	command.Stderr = &stderr
	output, err := command.Output()
	if len(output) > 0 {
		return fmt.Errorf("files are open in a process; artifact preserved")
	}
	if stderr.Len() > 0 {
		return fmt.Errorf("open-file inspection was incomplete; artifact preserved")
	}
	if err != nil {
		if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 1 {
			return fmt.Errorf("lsof is unavailable or failed; artifact preserved")
		}
	}
	return nil
}
func LegacyApply(ctx context.Context, req LegacyRequest) ([]map[string]string, error) {
	if len(req.Items) == 0 || len(req.Items) > 20 {
		return nil, fmt.Errorf("select 1–20 reviewed items")
	}
	seen := map[string]bool{}
	for _, item := range req.Items {
		if seen[item.ID] {
			return nil, fmt.Errorf("duplicate selection")
		}
		seen[item.ID] = true
	}
	review, err := LegacyReview(ctx, req)
	if err != nil {
		return nil, err
	}
	root, _ := legacyRoot()
	results := []map[string]string{}
	for _, selected := range req.Items {
		result := map[string]string{"id": selected.ID}
		var item *LegacyItem
		for i := range review {
			if review[i].ID == selected.ID {
				item = &review[i]
				break
			}
		}
		if item == nil || item.Fingerprint == "" || item.Fingerprint != selected.Fingerprint {
			result["error"] = "Artifact changed or is no longer available; preview again"
			results = append(results, result)
			continue
		}
		err = func() error {
			switch req.Action {
			case "quarantine":
				if item.Kind != "source" || !item.Eligible {
					return fmt.Errorf("source is not eligible")
				}
				checkCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
				defer cancel()
				if e := verifyNoOpenLegacyFiles(checkCtx, item.Path); e != nil {
					return e
				}
				_, fingerprint, _, e := legacyTree(item.Path)
				if e != nil || fingerprint != selected.Fingerprint {
					return fmt.Errorf("source changed; preview again")
				}
				qRoot := legacyQuarantine(root)
				if e := os.MkdirAll(qRoot, 0700); e != nil {
					return e
				}
				real, e := filepath.EvalSymlinks(qRoot)
				if e != nil || real != qRoot {
					return fmt.Errorf("unsafe quarantine root")
				}
				folder, e := os.MkdirTemp(qRoot, "artifact-")
				if e != nil {
					return e
				}
				record := legacyRecord{Original: item.Path, Owner: item.Owner, Project: item.Project, QuarantinedAt: time.Now(), State: "prepared"}
				if e := atomicSecurityJSON(filepath.Join(folder, "record.json"), record); e != nil {
					return e
				}
				if e := os.Rename(item.Path, filepath.Join(folder, "source")); e != nil {
					return e
				}
				record.State = "quarantined"
				return atomicSecurityJSON(filepath.Join(folder, "record.json"), record)
			case "restore", "delete-quarantine":
				if item.Kind != "quarantine" || filepath.Base(item.ID) != item.ID {
					return fmt.Errorf("invalid quarantine selection")
				}
				folder := filepath.Join(legacyQuarantine(root), item.ID)
				var record legacyRecord
				raw, e := os.ReadFile(filepath.Join(folder, "record.json"))
				if e != nil || json.Unmarshal(raw, &record) != nil {
					return fmt.Errorf("invalid quarantine record")
				}
				source := filepath.Join(folder, "source")
				real, e := filepath.EvalSymlinks(folder)
				if e != nil || real != folder {
					return fmt.Errorf("unsafe quarantine location")
				}
				if !within(root, record.Original) || within(legacyQuarantine(root), record.Original) || record.Original == root {
					return fmt.Errorf("unsafe original location")
				}
				if req.Action == "restore" {
					parent, e := filepath.EvalSymlinks(filepath.Dir(record.Original))
					if e != nil || parent != filepath.Dir(record.Original) {
						return fmt.Errorf("original parent changed")
					}
					if _, e := os.Lstat(record.Original); !os.IsNotExist(e) {
						return fmt.Errorf("original location is occupied; nothing overwritten")
					}
					if e := os.Rename(source, record.Original); e != nil {
						return e
					}
				} else {
					if !item.Eligible {
						return fmt.Errorf("quarantine is not eligible for deletion")
					}
					checkCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
					defer cancel()
					if e := verifyNoOpenLegacyFiles(checkCtx, source); e != nil {
						return e
					}
					_, fingerprint, _, e := legacyTree(source)
					if e != nil || fingerprint != selected.Fingerprint {
						return fmt.Errorf("source changed; preview again")
					}
					if e := os.RemoveAll(source); e != nil {
						return e
					}
				}
				if e := os.Remove(filepath.Join(folder, "record.json")); e != nil {
					return e
				}
				return os.Remove(folder)
			case "remove-docker":
				if !item.Eligible {
					return fmt.Errorf("Docker artifact is not eligible")
				}
				if item.Kind == "container" {
					_, e := dockerCmd(ctx, "rm", item.ID).CombinedOutput()
					return e
				}
				if item.Kind == "image" {
					_, e := dockerCmd(ctx, "image", "rm", item.ID).CombinedOutput()
					return e
				}
				return fmt.Errorf("invalid Docker artifact")
			default:
				return fmt.Errorf("invalid legacy action")
			}
		}()
		if err != nil {
			result["error"] = err.Error()
		} else {
			result["status"] = "done"
		}
		results = append(results, result)
	}
	return results, nil
}
