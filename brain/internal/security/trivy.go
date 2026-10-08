package security

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var dependencyFiles = map[string]bool{"package-lock.json": true, "npm-shrinkwrap.json": true, "yarn.lock": true, "pnpm-lock.yaml": true, "poetry.lock": true, "uv.lock": true, "Pipfile.lock": true, "requirements.txt": true, "Gemfile.lock": true, "composer.lock": true, "go.mod": true, "go.sum": true, "Cargo.lock": true, "packages.lock.json": true, "gradle.lockfile": true}
var imageDigest = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type trivyResult struct {
	SchemaVersion int
	Results       []struct {
		Target          string
		Vulnerabilities []struct{ VulnerabilityID, PkgName, InstalledVersion, FixedVersion, Severity, Title string }
	}
}
type boundedOutput struct {
	bytes.Buffer
	overflow bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 8*1024*1024 {
		b.overflow = true
		return 0, fmt.Errorf("scanner output exceeds 8 MiB")
	}
	return b.Buffer.Write(p)
}
func scannerFindings(raw []byte) ([]FindingItem, error) {
	var result trivyResult
	if err := json.Unmarshal(raw, &result); err != nil || result.SchemaVersion != 2 || len(result.Results) == 0 {
		return nil, fmt.Errorf("unsupported or malformed Trivy report")
	}
	out := []FindingItem{}
	seen := map[string]bool{}
	for _, target := range result.Results {
		for _, v := range target.Vulnerabilities {
			if len(out) >= 2000 {
				return nil, fmt.Errorf("more than 2000 vulnerabilities; report incomplete")
			}
			severity := SeverityInfo
			switch v.Severity {
			case "HIGH", "CRITICAL":
				severity = SeverityDanger
			case "MEDIUM", "UNKNOWN":
				severity = SeverityWarning
			case "LOW":
			default:
				return nil, fmt.Errorf("unknown vulnerability severity")
			}
			if v.VulnerabilityID == "" || v.PkgName == "" {
				return nil, fmt.Errorf("invalid vulnerability identity")
			}
			sum := sha256.Sum256([]byte(target.Target + "\x00" + v.VulnerabilityID + "\x00" + v.PkgName + "\x00" + v.InstalledVersion))
			id := "trivy-" + hex.EncodeToString(sum[:12])
			if seen[id] {
				continue
			}
			seen[id] = true
			fix := "No fixed version reported; review upstream advisory."
			if v.FixedVersion != "" {
				fix = "Upgrade to a fixed version: " + v.FixedVersion
			}
			out = append(out, FindingItem{ID: id, RuleID: "TRIVY-VULNERABILITY", Title: v.VulnerabilityID + " in " + v.PkgName, Severity: severity, Category: CategoryDependency, Description: "Installed version: " + v.InstalledVersion, File: target.Target, CVE: v.VulnerabilityID, Recommendation: fix})
		}
	}
	return out, nil
}
func ValidateAdvisoryCache() error {
	cache := filepath.Join(AdvancedRoot(), "trivy-cache")
	raw, err := os.ReadFile(filepath.Join(cache, "db", "metadata.json"))
	if err != nil {
		return fmt.Errorf("Trivy advisory database is missing; refresh the configured cache")
	}
	var meta struct{ UpdatedAt time.Time }
	if json.Unmarshal(raw, &meta) != nil || meta.UpdatedAt.IsZero() || time.Since(meta.UpdatedAt) > 48*time.Hour || meta.UpdatedAt.After(time.Now().Add(5*time.Minute)) {
		return fmt.Errorf("Trivy advisory database is invalid or older than 48 hours")
	}
	return nil
}
func runTrivy(ctx context.Context, kind, target, work string) ([]FindingItem, error) {
	if err := ValidateAdvisoryCache(); err != nil {
		return nil, err
	}
	cache := filepath.Join(AdvancedRoot(), "trivy-cache")
	var err error

	empty := filepath.Join(work, "empty.yaml")
	if err = os.WriteFile(empty, []byte("{}\n"), 0600); err != nil {
		return nil, err
	}
	ignore := filepath.Join(work, "empty.ignore")
	if err = os.WriteFile(ignore, nil, 0600); err != nil {
		return nil, err
	}
	args := []string{kind, "--config", empty, "--ignorefile", ignore, "--format", "json", "--scanners", "vuln", "--quiet", "--timeout", "2m", "--exit-code", "0", "--cache-dir", cache, "--offline-scan", "--skip-db-update", "--skip-java-db-update", "--disable-telemetry", "--skip-version-check", "--list-all-pkgs=false", "--parallel", "2"}
	if kind == "image" {
		if !imageDigest.MatchString(target) {
			return nil, fmt.Errorf("image scan requires an immutable local image ID")
		}
		endpoint := os.Getenv("DOCKER_HOST")
		if endpoint == "" {
			resolveCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			command := exec.CommandContext(resolveCtx, "docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}")
			var endpointOutput boundedOutput
			command.Stdout = &endpointOutput
			command.Stderr = &boundedOutput{}
			e := command.Run()
			cancel()
			if e != nil {
				return nil, fmt.Errorf("cannot resolve local Docker endpoint")
			}
			endpoint = strings.TrimSpace(endpointOutput.String())
		}
		if !strings.HasPrefix(endpoint, "unix://") && !strings.HasPrefix(endpoint, "npipe://") {
			return nil, fmt.Errorf("image vulnerability scanning requires a local Docker socket")
		}
		args = append(args, "--image-src", "docker", "--docker-host", endpoint, "--max-image-size", "5GB")
	}
	if kind == "fs" {
		args = append(args, "--include-dev-deps")
	}
	args = append(args, target)
	scanCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(scanCtx, "trivy", args...)
	cmd.Dir = work
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + work, "TMPDIR=" + work}

	var output boundedOutput
	cmd.Stdout = &output
	cmd.Stderr = &boundedOutput{}
	if err = cmd.Run(); err != nil || output.overflow {
		return nil, fmt.Errorf("Trivy scan did not complete; check executable, local Docker access and advisory cache")
	}
	return scannerFindings(output.Bytes())
}
func appendExternal(report *SecurityReport, findings []FindingItem, label string) {
	sort.Slice(findings, func(i, j int) bool { return findings[i].ID < findings[j].ID })
	raw, _ := json.Marshal(findings)
	digest := sha256.Sum256(append([]byte(report.RulesVersion+label), raw...))
	report.RulesVersion = hex.EncodeToString(digest[:])
	report.Findings = append(report.Findings, findings...)
	for _, f := range findings {
		switch f.Severity {
		case SeverityDanger:
			report.DangerCount++
		case SeverityWarning:
			report.WarnCount++
		default:
			report.InfoCount++
		}
	}
	if report.DangerCount > 0 {
		report.Status = "danger"
	} else if report.WarnCount > 0 {
		report.Status = "warning"
	}
	report.Logs += "\n" + label + ": " + fmt.Sprint(len(findings)) + " vulnerability findings. Advisory cache required to be at most 48 hours old."
	report.Summary = fmt.Sprintf("%d danger, %d warning findings; %s completed.", report.DangerCount, report.WarnCount, label)
}
func ScanDependencies(ctx context.Context, root string, report *SecurityReport) error {
	config, err := LoadAdvancedConfig()
	if err != nil {
		return err
	}
	if !config.Dependencies {
		return nil
	}
	work, err := os.MkdirTemp("", "ray-dependency-scan-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	snapshot := filepath.Join(work, "source")
	if err = os.Mkdir(snapshot, 0700); err != nil {
		return err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	count, entries := 0, 0
	var total int64
	err = filepath.WalkDir(root, func(name string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		entries++
		if entries > 100000 {
			return fmt.Errorf("dependency traversal limit exceeded")
		}
		if d.IsDir() {
			if name != root && ignoredDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !dependencyFiles[d.Name()] {
			return nil
		}
		info, e := d.Info()
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("dependency manifest must be a regular file")
		}
		count++
		total += info.Size()
		if count > 1000 || info.Size() > 10*1024*1024 || total > 100*1024*1024 {
			return fmt.Errorf("dependency manifest limits exceeded")
		}
		relative, e := filepath.Rel(root, name)
		if e != nil {
			return e
		}
		dest := filepath.Join(snapshot, relative)
		file, e := os.Open(name)
		if e != nil {
			return e
		}
		opened, e := file.Stat()
		if e != nil || !os.SameFile(info, opened) {
			file.Close()
			return fmt.Errorf("dependency manifest changed during snapshot")
		}
		raw, e := io.ReadAll(io.LimitReader(file, 10*1024*1024+1))
		file.Close()
		if e != nil {
			return e
		}
		if len(raw) > 10*1024*1024 {
			return fmt.Errorf("dependency manifest grew beyond limit")
		}
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		return os.WriteFile(dest, raw, 0600)
	})
	if err != nil {
		return err
	}
	if count == 0 {
		report.Logs += "\nDependency scan not applicable: no supported manifest/lockfile found. No dependency coverage claimed."
		return nil
	}
	findings, err := runTrivy(ctx, "fs", snapshot, work)
	if err != nil {
		return err
	}
	appendExternal(report, findings, "Dependency manifest scan")
	return nil
}
func ScanImage(ctx context.Context, image string, report *SecurityReport) error {
	work, err := os.MkdirTemp("", "ray-image-scan-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	findings, err := runTrivy(ctx, "image", strings.TrimSpace(image), work)
	if err != nil {
		return err
	}
	appendExternal(report, findings, "Local image scan")
	return nil
}

func ScanContainer(ctx context.Context, owner, project, container string, report *SecurityReport) error {
	if !regexp.MustCompile(`^[a-f0-9]{12,64}$`).MatchString(container) {
		return fmt.Errorf("container scan requires a saved immutable container ID")
	}
	inspectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(inspectCtx, "docker", "inspect", "--type", "container", container)
	var output boundedOutput
	cmd.Stdout = &output
	cmd.Stderr = &boundedOutput{}
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("could not inspect current container")
	}
	var rows []struct {
		Image  string
		Config struct{ Labels map[string]string }
	}
	if json.Unmarshal(output.Bytes(), &rows) != nil || len(rows) != 1 || rows[0].Config.Labels["io.ray.owner"] != owner || rows[0].Config.Labels["io.ray.project"] != project {
		return fmt.Errorf("container ownership could not be verified")
	}
	return ScanImage(ctx, rows[0].Image, report)
}
