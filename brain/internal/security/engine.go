package security

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

//go:embed source-rules.json
var ruleData []byte

//go:embed engine.go
var engineSource []byte

type SourceRule struct {
	ID             string       `json:"id"`
	Title          string       `json:"title"`
	Extensions     []string     `json:"extensions"`
	Basename       string       `json:"basename"`
	Pattern        string       `json:"pattern"`
	Severity       Severity     `json:"severity"`
	Category       RuleCategory `json:"category"`
	Description    string       `json:"description"`
	Recommendation string       `json:"recommendation"`
}
type Baseline struct {
	RulesVersion string            `json:"rulesVersion"`
	Digests      map[string]string `json:"digests"`
	Findings     []FindingItem     `json:"findings"`
}

func RulesVersion() string {
	h := sha256.New()
	h.Write(ruleData)
	h.Write(engineSource)
	for _, p := range SecretPatterns {
		fmt.Fprintf(h, "%s:%s:%s", p.ID, p.Severity, p.Regex.String())
	}
	return hex.EncodeToString(h.Sum(nil))
}
func SourceRules() ([]SourceRule, error) {
	var rules []SourceRule
	if err := json.Unmarshal(ruleData, &rules); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, r := range rules {
		if r.ID == "" || seen[r.ID] || (r.Severity != SeverityDanger && r.Severity != SeverityWarning && r.Severity != SeverityInfo) {
			return nil, fmt.Errorf("invalid source rule")
		}
		seen[r.ID] = true
		if _, err := regexp.Compile(r.Pattern); err != nil {
			return nil, err
		}
	}
	return rules, nil
}
func AllRules() []SecurityRule {
	out := []SecurityRule{{ID: "TRIVY-VULNERABILITY", Title: "Dependency and image vulnerabilities", Category: CategoryDependency, Severity: SeverityDanger, Description: "Opt-in Trivy advisory checks against supported manifests or local container images.", Checklist: "Requires administrator configuration, Trivy and a fresh local advisory cache. Unsupported ecosystems are not covered.", Remediation: "Review the advisory and upgrade affected packages or rebuild the base image."}}
	for _, r := range PredefinedRules {
		if r.Category != CategoryCVE || r.ID == "CVE-NEXT-SSRF-2024" || r.ID == "CVE-NEXT-AUTH-BYPASS-2025" {
			out = append(out, r)
		}
	}
	rules, _ := SourceRules()
	for _, r := range rules {
		out = append(out, SecurityRule{ID: r.ID, Title: r.Title, Severity: r.Severity, Category: r.Category, Description: r.Description, Checklist: "Pattern-based check on applicable source files; not whole-program analysis.", Remediation: r.Recommendation})
	}
	return out
}

var ignoredDirs = map[string]bool{".git": true, "node_modules": true, ".next": true, "dist": true, "build": true, "vendor": true, ".venv": true, "venv": true, "__pycache__": true, "target": true, "bin": true, "obj": true, ".host-releases": true, ".security-releases": true}

func within(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
func ExecuteScan(ctx context.Context, req ScanRequest) (*SecurityReport, error) {
	report, _, err := Analyze(ctx, req, nil)
	if err != nil {
		return report, err
	}
	if err = ScanDependencies(ctx, req.ProjectPath, report); err == nil {
		config, configErr := LoadAdvancedConfig()
		err = configErr
		if err == nil && config.Images {
			if req.ContainerID != "" && !strings.HasPrefix(req.ContainerID, "process:") {
				err = ScanContainer(ctx, req.UserID, req.ProjectID, req.ContainerID, report)
			} else {
				report.Logs += "\nImage scan not applicable: no linked Docker container supplied. No image coverage claimed."
			}
		}
	}
	if err != nil {
		report.Status = "error"
		report.Summary = "Advanced security scan incomplete"
		report.Logs += "\n" + err.Error()
	}
	return report, nil
}

// Analyze hashes the scoped tree, but runs content rules only on changed files.
// Unchanged findings survive; deleted/renamed files never retain stale findings.
func Analyze(ctx context.Context, req ScanRequest, baseline *Baseline) (*SecurityReport, *Baseline, error) {
	root, err := filepath.EvalSymlinks(req.ProjectPath)
	if err != nil {
		return nil, nil, fmt.Errorf("source directory unavailable")
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return nil, nil, err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, nil, fmt.Errorf("source must be a directory")
	}
	rules, err := SourceRules()
	if err != nil {
		return nil, nil, fmt.Errorf("security rule registry is invalid")
	}
	version := RulesVersion()
	incremental := baseline != nil && baseline.RulesVersion == version
	report := &SecurityReport{ID: fmt.Sprintf("scan_%d", time.Now().UnixNano()), ProjectID: req.ProjectID, ProjectName: req.ProjectName, Trigger: req.Trigger, RulesVersion: version, Mode: "full", CreatedAt: time.Now(), Findings: []FindingItem{}, Checklist: []ChecklistEvaluation{}}
	if incremental {
		report.Mode = "incremental"
	}
	next := &Baseline{RulesVersion: version, Digests: map[string]string{}}
	unchanged := map[string]bool{}
	evaluated := map[string]bool{}
	var total int64
	entries := 0
	err = filepath.WalkDir(root, func(filename string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("could not read a source entry")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(report.Findings) > 10000 {
			return fmt.Errorf("security finding limit exceeded; scan incomplete")
		}
		entries++
		if entries > 100000 {
			return fmt.Errorf("security file limit exceeded (100000 entries)")
		}
		if entry.IsDir() {
			if filename != root && ignoredDirs[entry.Name()] {
				report.ExcludedFiles++
				return filepath.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(root, filename)
		rel = filepath.ToSlash(rel)
		resolved, err := filepath.EvalSymlinks(filename)
		if err != nil || !within(root, resolved) {
			return fmt.Errorf("source contains a broken or escaping symlink: %s", rel)
		}
		stat, err := os.Stat(resolved)
		if err != nil {
			return fmt.Errorf("cannot read %s", rel)
		}
		if stat.IsDir() {
			return nil
		}
		if !stat.Mode().IsRegular() {
			return fmt.Errorf("unsupported special source file: %s", rel)
		}
		// Inspect content before imposing source-text limits. Media assets remain
		// part of the deployment fingerprint, but are not source-rule input.
		probe, err := os.Open(resolved)
		if err != nil {
			return fmt.Errorf("cannot open %s", rel)
		}
		header := make([]byte, 512)
		n, probeErr := io.ReadFull(probe, header)
		probe.Close()
		if probeErr != nil && probeErr != io.EOF && probeErr != io.ErrUnexpectedEOF {
			return fmt.Errorf("cannot read %s", rel)
		}
		header = header[:n]
		mime := http.DetectContentType(header)
		if bytes.IndexByte(header, 0) >= 0 || strings.HasPrefix(mime, "audio/") || strings.HasPrefix(mime, "video/") || strings.HasPrefix(mime, "image/") || strings.HasPrefix(mime, "font/") || mime == "application/pdf" {
			report.ExcludedFiles++
			return nil
		}
		if stat.Size() > 8*1024*1024 {
			return fmt.Errorf("security file size limit exceeded (8 MiB): %s", rel)
		}
		total += stat.Size()
		if total > 128*1024*1024 {
			return fmt.Errorf("security source size limit exceeded (128 MiB); exclude generated artifacts from source")
		}
		file, err := os.Open(resolved)
		if err != nil {
			return fmt.Errorf("cannot open %s", rel)
		}
		data, readErr := io.ReadAll(io.LimitReader(file, 8*1024*1024+1))
		file.Close()
		if readErr != nil || len(data) > 8*1024*1024 {
			return fmt.Errorf("cannot completely read %s", rel)
		}
		digest := sha256.Sum256(data)
		next.Digests[rel] = hex.EncodeToString(digest[:])
		if incremental && baseline.Digests[rel] == next.Digests[rel] {
			unchanged[rel] = true
			report.FilesReused++
			return nil
		}
		if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
			report.ExcludedFiles++
			return nil
		}
		report.FilesScanned++
		evaluated["SECRET-API-KEYS"] = true
		add := func(id, title string, severity Severity, category RuleCategory, recommendation string, index int) {
			report.Findings = append(report.Findings, FindingItem{ID: fmt.Sprintf("%s_%d", report.ID, len(report.Findings)), RuleID: id, Title: title, Severity: severity, Category: category, File: rel, Line: 1 + bytes.Count(data[:index], []byte("\n")), Description: "Detected by a deterministic source rule. Matched content is omitted.", Recommendation: recommendation})
		}
		for _, p := range SecretPatterns {
			for _, match := range p.Regex.FindAllIndex(data, -1) {
				value := string(data[match[0]:match[1]])
				// Anthropic's prefix also matches the broad OpenAI signature.
				if p.ID == "SECRET_OPENAI_KEY" && strings.HasPrefix(value, "sk-ant-") && len(value) >= len("sk-ant-")+20 {
					continue
				}
				if obviousSecretPlaceholder(data, match[0], match[1]) {
					continue
				}
				add("SECRET-API-KEYS", p.Title, p.Severity, CategorySecret, "Remove and revoke exposed credentials; use runtime secrets.", match[0])
				break
			}
		}
		for _, r := range rules {
			extension := strings.ToLower(filepath.Ext(rel))
			if strings.HasPrefix(filepath.Base(rel), ".env") {
				extension = ".env"
			}
			applicable := false
			for _, ext := range r.Extensions {
				if ext == extension {
					applicable = true
				}
			}
			if !applicable || (r.Basename != "" && filepath.Base(rel) != r.Basename) {
				continue
			}
			evaluated[r.ID] = true
			if match := regexp.MustCompile(r.Pattern).FindIndex(data); match != nil {
				add(r.ID, r.Title, r.Severity, r.Category, r.Recommendation, match[0])
			}
		}
		if filepath.Base(rel) == "Dockerfile" {
			evaluated["CONTAINER-ROOT-USER"] = true
			evaluated["CONTAINER-SENSITIVE-COPY"] = true
			// Only the final image stage determines runtime USER.
			stages := regexp.MustCompile(`(?im)^\s*FROM\s+`).Split(string(data), -1)
			last := stages[len(stages)-1]
			users := regexp.MustCompile(`(?im)^\s*USER\s+([^\s#]+)`).FindAllStringSubmatch(last, -1)
			if len(users) == 0 || users[len(users)-1][1] == "root" || users[len(users)-1][1] == "0" {
				add("CONTAINER-ROOT-USER", "Container may run as root", SeverityWarning, CategoryContainer, "Set a non-root USER in the final image stage.", 0)
			}
			if regexp.MustCompile(`(?im)^\s*(?:COPY|ADD)\s+[^\n]*\.env`).Match(data) {
				add("CONTAINER-SENSITIVE-COPY", "Environment file copied into image", SeverityDanger, CategoryContainer, "Exclude secrets from image layers; inject them at runtime.", 0)
			}
		}
		if filepath.Base(rel) == "package.json" || filepath.Base(rel) == "package-lock.json" {
			scanNextVersions(data, rel, report, evaluated)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	if incremental {
		for _, f := range baseline.Findings {
			if unchanged[f.File] {
				report.Findings = append(report.Findings, f)
			}
		}
	}
	if len(report.Findings) > 10000 {
		return nil, nil, fmt.Errorf("security finding limit exceeded; scan incomplete")
	}
	names := make([]string, 0, len(next.Digests))
	for name := range next.Digests {
		names = append(names, name)
	}
	sort.Strings(names)
	tree := sha256.New()
	for _, name := range names {
		fmt.Fprintf(tree, "%s\x00%s\n", name, next.Digests[name])
	}
	report.TreeDigest = hex.EncodeToString(tree.Sum(nil))
	failures := map[string]string{}
	for _, f := range report.Findings {
		switch f.Severity {
		case SeverityDanger:
			report.DangerCount++
			failures[f.RuleID] = "fail"
		case SeverityWarning:
			report.WarnCount++
			if failures[f.RuleID] != "fail" {
				failures[f.RuleID] = "warn"
			}
		default:
			report.InfoCount++
		}
	}
	for _, rule := range AllRules() {
		status, note := "not_evaluated", "Not evaluated by the implemented checks in this scan scope."
		if evaluated[rule.ID] {
			status = "pass"
			note = "No pattern match in evaluated files; not a guarantee of application security."
		}
		if incremental && !evaluated[rule.ID] {
			status = "not_evaluated"
			note = "Unchanged file findings are retained from the baseline; see scan scope."
		}
		if failures[rule.ID] != "" {
			status = failures[rule.ID]
			note = "See findings."
		}
		report.Checklist = append(report.Checklist, ChecklistEvaluation{RuleID: rule.ID, Status: status, Note: note})
	}
	report.Status = "passed"
	if report.WarnCount > 0 {
		report.Status = "warning"
	}
	if report.DangerCount > 0 {
		report.Status = "danger"
	}
	report.Summary = fmt.Sprintf("%s scan: %d files evaluated, %d unchanged, %d excluded entries. %d danger, %d warnings. Pattern checks are not a complete vulnerability audit.", report.Mode, report.FilesScanned, report.FilesReused, report.ExcludedFiles, report.DangerCount, report.WarnCount)
	report.Logs = report.Summary + "\nExcluded generated/dependency directories and binary content are outside rule coverage. AI and external advisory services were not used."
	next.Findings = report.Findings
	return report, next, nil
}
func exactVersion(value string) ([3]int, bool) {
	var v [3]int
	parts := strings.Split(strings.TrimPrefix(value, "v"), ".")
	if len(parts) != 3 {
		return v, false
	}
	for i, p := range parts {
		if p == "" || strings.Trim(p, "0123456789") != "" {
			return v, false
		}
		n, e := strconv.Atoi(p)
		if e != nil {
			return v, false
		}
		v[i] = n
	}
	return v, true
}
func less(a, b [3]int) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}
func scanNextVersions(data []byte, file string, report *SecurityReport, evaluated map[string]bool) {
	var manifest struct {
		Dependencies    map[string]json.RawMessage `json:"dependencies"`
		DevDependencies map[string]string          `json:"devDependencies"`
		Packages        map[string]struct {
			Version string `json:"version"`
		} `json:"packages"`
	}
	if json.Unmarshal(data, &manifest) != nil {
		report.Findings = append(report.Findings, FindingItem{ID: fmt.Sprintf("%s_%d", report.ID, len(report.Findings)), RuleID: "DEP-PARSE", Title: "Dependency manifest could not be parsed", Severity: SeverityWarning, Category: CategoryDependency, File: file, Recommendation: "Repair the manifest and use an ecosystem dependency audit."})
		return
	}
	values := []string{}
	if raw, ok := manifest.Dependencies["next"]; ok {
		var value string
		if json.Unmarshal(raw, &value) == nil {
			values = append(values, value)
		} else {
			var locked struct {
				Version string `json:"version"`
			}
			if json.Unmarshal(raw, &locked) == nil {
				values = append(values, locked.Version)
			}
		}
	}
	if value := manifest.DevDependencies["next"]; value != "" {
		values = append(values, value)
	}
	for name, p := range manifest.Packages {
		if name == "node_modules/next" || strings.HasSuffix(name, "/node_modules/next") {
			values = append(values, p.Version)
		}
	}
	for _, value := range values {
		v, exact := exactVersion(value)
		if !exact {
			report.Findings = append(report.Findings, FindingItem{ID: fmt.Sprintf("%s_%d", report.ID, len(report.Findings)), RuleID: "DEP-UNRESOLVED", Title: "Next.js version is a range or unsupported version expression", Severity: SeverityWarning, Category: CategoryDependency, File: file, Recommendation: "Inspect the resolved lockfile version and run the package manager's advisory audit."})
			continue
		}
		evaluated["CVE-NEXT-SSRF-2024"] = true
		evaluated["CVE-NEXT-AUTH-BYPASS-2025"] = true
		checks := []struct {
			id, cve  string
			affected bool
		}{{"CVE-NEXT-SSRF-2024", "CVE-2024-34351", !less(v, [3]int{13, 4, 0}) && less(v, [3]int{14, 1, 1})}, {"CVE-NEXT-AUTH-BYPASS-2025", "CVE-2025-29927", (!less(v, [3]int{11, 1, 4}) && less(v, [3]int{12, 3, 5})) || (v[0] == 13 && less(v, [3]int{13, 5, 9})) || (v[0] == 14 && less(v, [3]int{14, 2, 25})) || (v[0] == 15 && less(v, [3]int{15, 2, 3}))}}
		for _, c := range checks {
			if c.affected {
				report.Findings = append(report.Findings, FindingItem{ID: fmt.Sprintf("%s_%d", report.ID, len(report.Findings)), RuleID: c.id, Title: "Next.js version falls in a published advisory range", Severity: SeverityDanger, Category: CategoryCVE, File: file, CVE: c.cve, Description: "Version-based detection; runtime exploitability depends on application behavior.", Recommendation: "Upgrade to a maintained release containing the advisory fix; review the official Next.js advisory."})
			}
		}
	}
}

// SourceFingerprint also covers excluded dependency/build files so a risk
// approval cannot silently be reused after changes outside content-rule scope.
func SourceFingerprint(ctx context.Context, root string) (string, error) {
	h := sha256.New()
	entries := 0
	var total int64
	err := filepath.WalkDir(root, func(filename string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		entries++
		if entries > 100000 {
			return fmt.Errorf("snapshot file limit exceeded")
		}
		rel, _ := filepath.Rel(root, filename)
		if rel == "." {
			return nil
		}
		if entry.Name() == ".git" && entry.IsDir() {
			return filepath.SkipDir
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		fmt.Fprintf(h, "%s\x00%s\x00", filepath.ToSlash(rel), info.Mode().String())
		if entry.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(filename)
			if err != nil {
				return err
			}
			fmt.Fprint(h, target)
		} else if info.Mode().IsRegular() {
			total += info.Size()
			if total > 2*1024*1024*1024 {
				return fmt.Errorf("snapshot size limit exceeded")
			}
			file, err := os.Open(filename)
			if err != nil {
				return err
			}
			digest := sha256.New()
			count, err := io.Copy(digest, io.LimitReader(file, info.Size()+1))
			file.Close()
			if err != nil || count != info.Size() {
				return fmt.Errorf("snapshot changed during hashing")
			}
			h.Write(digest.Sum(nil))
		} else if !entry.IsDir() {
			return fmt.Errorf("snapshot contains a special file")
		}
		h.Write([]byte{0})
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Only all-x API-key placeholders are ignored. A matching prefix of a longer
// token is never exempt, and real-looking values in documentation remain findings.
func obviousSecretPlaceholder(data []byte, start, end int) bool {
	if end < len(data) {
		c := data[end]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-' {
			return false
		}
	}
	value := string(data[start:end])
	for _, prefix := range []string{"sk-ant-", "sk-"} {
		if strings.HasPrefix(value, prefix) {
			payload := strings.TrimPrefix(value, prefix)
			return payload != "" && strings.Trim(payload, "xX") == ""
		}
	}
	return false
}
