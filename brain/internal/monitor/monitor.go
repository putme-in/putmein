package monitor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"brain/server/internal/ai"
)

// alertResponseRe parses "ALERT: <severity> <message>" from AI output.
var alertResponseRe = regexp.MustCompile(`(?i)^ALERT:\s*(info|warn|error|critical|vulnerable)\s+(.+)`)

// Service manages all monitored projects and their polling goroutines.
type Service struct {
	lifecycleContext context.Context
	mu               sync.RWMutex
	projects         map[string]*projectState // keyed by project ID
	broker           *Broker

	// persistAlert is called when a new alert is detected.
	// It should persist the alert to the database and return its DB id.
	persistAlert func(alert *Alert) error

	// persistProject is called when a project's status/lastChecked changes.
	persistProject func(id string, status ProjectStatus, lastChecked time.Time) error

	// loadProjects is called on startup to seed in-memory state from the DB.
	loadProjects func() ([]*Project, error)

	// addProject is called when a new project is added via the API or AI.
	// Returns the project with its DB-assigned ID filled in.
	addProject func(p *Project) (*Project, error)

	// Default AI model to use for log analysis.
	modelID string

	// classifierModelID is the model used for fast per-line severity triage.
	// Falls back to modelID if empty.
	classifierModelID string

	// updateMemory is called when AI finishes writing a project memory summary.
	// id = project DB id, content = markdown summary, status = "done"|"error".
	updateMemory func(id, content, status string) error
}

type projectState struct {
	project           *Project
	offsets           map[string]int64 // file path → current read offset
	cancel            context.CancelFunc
	lastCommandOutput string
	lastRuleAlerts    map[string]time.Time
}

// Global singleton — set by NewService().
var Global *Service

// NewService creates and starts the monitor service.
func NewService(
	modelID string,
	persistAlert func(*Alert) error,
	persistProject func(id string, status ProjectStatus, lastChecked time.Time) error,
	loadProjects func() ([]*Project, error),
	addProject func(*Project) (*Project, error),
) *Service {
	classifierModel := os.Getenv("LOG_CLASSIFIER_MODEL")
	if classifierModel == "" {
		classifierModel = modelID
	}
	svc := &Service{
		projects:          make(map[string]*projectState),
		broker:            newBroker(),
		persistAlert:      persistAlert,
		persistProject:    persistProject,
		loadProjects:      loadProjects,
		addProject:        addProject,
		modelID:           modelID,
		classifierModelID: classifierModel,
	}
	Global = svc
	return svc
}

// SetMemoryUpdater registers the callback Brain uses to push memory results back to Ray.
func (s *Service) SetMemoryUpdater(fn func(id, content, status string) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateMemory = fn
}

// Start loads projects from DB and starts polling goroutines.
func (s *Service) Start(ctx context.Context) {
	s.mu.Lock()
	s.lifecycleContext = ctx
	s.mu.Unlock()
	if s.loadProjects == nil {
		return
	}
	projects, err := s.loadProjects()
	if err != nil {
		fmt.Printf("[monitor] failed to load projects: %v\n", err)
		return
	}
	for _, p := range projects {
		if p.Enabled {
			s.startProject(ctx, p)
		}
	}
}

// Subscribe returns a new alert subscription channel.
func (s *Service) Subscribe() AlertSubscriber {
	return s.broker.Subscribe()
}

// Unsubscribe removes a subscriber.
func (s *Service) Unsubscribe(ch AlertSubscriber) {
	s.broker.Unsubscribe(ch)
}

// AddProject discovers log sources, persists the project, and starts monitoring.
func (s *Service) AddProject(ctx context.Context, p *Project) (*Project, error) {
	// Discover log sources for the project path
	logPaths, logCmd, _ := DiscoverLogSources(ctx, p.ProjectPath)
	p.LogPaths = append(p.LogPaths, logPaths...)
	if p.LogCommand == "" && len(p.LogPaths) == 0 {
		p.LogCommand = logCmd
	}
	p.Status = StatusDiscovering

	// Persist to DB
	saved, err := s.addProject(p)
	if err != nil {
		return nil, err
	}

	// Start monitoring goroutine
	if saved.Enabled {
		s.startProject(ctx, saved)
	}

	// Kick off memory analysis asynchronously using a background context (independent of the
	// HTTP request context, which is canceled as soon as the response is sent).
	projectID := saved.ID
	projectPath := saved.ProjectPath
	modelID := s.modelID
	updateFn := s.updateMemory
	if projectID != "" && projectPath != "" {
		bgCtx := context.Background() // detach from request lifecycle
		AnalyzeProjectMemory(bgCtx, modelID, projectPath, func(result MemoryResult) {
			if updateFn == nil {
				return
			}
			if result.Error != "" {
				_ = updateFn(projectID, "Analysis failed: "+result.Error, "error")
			} else {
				_ = updateFn(projectID, result.Content, "done")
			}
		})
	}

	return saved, nil
}

// UpdateProject updates a project's config.
func (s *Service) UpdateProject(id string, enabled *bool, intervalSec *int, status *ProjectStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ps, ok := s.projects[id]
	if !ok {
		return
	}

	if enabled != nil {
		ps.project.Enabled = *enabled
	}
	if intervalSec != nil {
		ps.project.IntervalSec = *intervalSec
	}
	if status != nil {
		ps.project.Status = *status
	}
}

// PauseProject stops polling for a project.
func (s *Service) PauseProject(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ps, ok := s.projects[id]
	if !ok || ps.cancel == nil {
		return
	}
	ps.cancel()
	ps.cancel = nil
	ps.project.Status = StatusPaused
}

// ResumeProject restarts polling for a paused project.
func (s *Service) ResumeProject(ctx context.Context, id string) {
	s.mu.Lock()
	ps, ok := s.projects[id]
	s.mu.Unlock()
	if !ok {
		return
	}
	if ps.cancel != nil {
		return // already running
	}
	ps.project.Enabled = true
	s.startProject(ctx, ps.project)
}

// RemoveProject stops polling and removes the project from memory.
func (s *Service) RemoveProject(id string) {
	s.mu.Lock()
	ps, ok := s.projects[id]
	if ok {
		if ps.cancel != nil {
			ps.cancel()
		}
		delete(s.projects, id)
	}
	s.mu.Unlock()
}

// GetProject returns a project state by ID.
func (s *Service) GetProject(id string) (*Project, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ps, ok := s.projects[id]
	if !ok {
		return nil, false
	}
	return ps.project, true
}

// ListProjects returns all projects in memory.
func (s *Service) ListProjects() []*Project {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Project, 0, len(s.projects))
	for _, ps := range s.projects {
		out = append(out, ps.project)
	}
	return out
}

// AddLogPath adds a new log file path to a monitored project's tracking list.
// Used when a managed process is spawned and its log file needs to be tailed.
func (s *Service) AddLogPath(projectID, logPath string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ps, ok := s.projects[projectID]
	if !ok {
		return
	}
	for _, p := range ps.project.LogPaths {
		if p == logPath {
			return // already tracked
		}
	}
	ps.project.LogPaths = append(ps.project.LogPaths, logPath)
}

// KillPID sends SIGKILL to the given PID (package-level helper).
func KillPID(ctx context.Context, pid int) {
	killProcessTree(ctx, pid)
}

// startProject creates a polling goroutine for a project.
func (s *Service) startProject(ctx context.Context, p *Project) {
	s.mu.RLock()
	if s.lifecycleContext != nil {
		ctx = s.lifecycleContext
	}
	s.mu.RUnlock()
	pCtx, cancel := context.WithCancel(ctx)

	ps := &projectState{
		project: p,
		offsets: make(map[string]int64),
		cancel:  cancel,
	}

	s.mu.Lock()
	// Stop existing goroutine if restarting
	if existing, ok := s.projects[p.ID]; ok && existing.cancel != nil {
		existing.cancel()
	}
	s.projects[p.ID] = ps
	s.mu.Unlock()

	go func() {
		// Run first poll immediately
		s.poll(pCtx, ps)

		lastPoll := time.Now()
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pCtx.Done():
				return
			case <-ticker.C:
				s.mu.RLock()
				desired := time.Duration(ps.project.IntervalSec) * time.Second
				s.mu.RUnlock()
				if desired < 10*time.Second {
					desired = 10 * time.Second
				}
				if config, err := LoadMonitoringConfig(p.UserID, p.ID); err == nil && config.IntervalSeconds > 0 {
					desired = time.Duration(config.IntervalSeconds) * time.Second
				}
				if time.Since(lastPoll) < desired {
					continue
				}
				s.poll(pCtx, ps)
				lastPoll = time.Now()
			}
		}
	}()
}

// logPathsSnapshot returns a copy of the paths while holding the service lock.
// AddLogPath may append to the project's slice concurrently with polling.
func (s *Service) logPathsSnapshot(ps *projectState) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), ps.project.LogPaths...)
}

// poll collects log data for one project and asks the AI to analyze it.
func (s *Service) poll(ctx context.Context, ps *projectState) {
	p := ps.project
	var logChunks []string
	config, configErr := LoadMonitoringConfig(p.UserID, p.ID)
	if configErr != nil {
		config = DefaultMonitoringConfig()
		config.AIEnabled = false
	}

	// 1. Tail all tracked log files
	paths := append(s.logPathsSnapshot(ps), configuredLogPaths(p.ProjectPath, config)...)
	seenPaths := map[string]bool{}
	for _, path := range paths {
		if seenPaths[path] {
			continue
		}
		seenPaths[path] = true
		chunk, newOffset, err := TailFile(path, ps.offsets[path])
		if err != nil {
			continue
		}
		ps.offsets[path] = newOffset
		if strings.TrimSpace(chunk) != "" {
			logChunks = append(logChunks, fmt.Sprintf("=== %s ===\n%s", path, chunk))
		}
	}

	// 2. Run the log command if configured
	if p.LogCommand != "" {
		out, err := RunLogCommand(ctx, p.LogCommand)
		if err == nil && strings.TrimSpace(out) != "" && out != ps.lastCommandOutput {
			ps.lastCommandOutput = out
			logChunks = append(logChunks, fmt.Sprintf("=== command: %s ===\n%s", p.LogCommand, out))
		}
	}

	// No new logs — nothing to analyze
	if len(logChunks) == 0 && configErr == nil {
		now := time.Now()
		p.LastChecked = &now
		if p.Status == StatusDiscovering || p.Status == StatusError {
			p.Status = StatusActive
		}
		return
	}

	logData := strings.Join(logChunks, "\n\n")

	// Bound deterministic matching; alerts and AI receive a smaller tail below.
	const maxLogBytes = 256 * 1024
	if len(logData) > maxLogBytes {
		logData = logData[len(logData)-maxLogBytes:]
	}

	// Recognized failures remain actionable when no AI model is available.
	if ps.lastRuleAlerts == nil {
		ps.lastRuleAlerts = make(map[string]time.Time)
	}
	// Bound retained cooldown keys when users repeatedly revise custom patterns.
	for key, at := range ps.lastRuleAlerts {
		if time.Since(at) > 24*time.Hour {
			delete(ps.lastRuleAlerts, key)
		}
	}
	if len(ps.lastRuleAlerts) > 256 {
		ps.lastRuleAlerts = make(map[string]time.Time)
	}
	matches := MatchConfiguredLogs(config, logData)
	if configErr != nil {
		matches = append(matches, RuleMatch{"monitor-config-error", "Custom monitoring settings could not be loaded; built-in rules remain active and AI analysis is disabled", SeverityWarn, 300})
	}
	matched := len(matches) > 0
	rawLog := logData
	if len(rawLog) > 8192 {
		rawLog = rawLog[len(rawLog)-8192:]
	}
	for _, rule := range matches {
		now := time.Now()
		if now.Sub(ps.lastRuleAlerts[rule.ID]) < time.Duration(rule.CooldownSeconds)*time.Second {
			continue
		}
		alert := &Alert{ProjectID: p.ID, ProjectName: p.Name, Severity: rule.Severity,
			Message: rule.Message, RawLog: rawLog, CreatedAt: now}
		if s.persistAlert != nil {
			if err := s.persistAlert(alert); err != nil {
				fmt.Printf("[monitor] failed to persist alert for %s: %v\n", p.ID, err)
				continue
			}
		}
		ps.lastRuleAlerts[rule.ID] = now
		s.broker.Broadcast(alert)
	}
	if matched || !config.AIEnabled {
		now := time.Now()
		p.LastChecked = &now
		p.Status = StatusActive
		if s.persistProject != nil {
			_ = s.persistProject(p.ID, p.Status, now)
		}
		return
	}

	// Ask the AI
	logData = rawLog
	client := ai.NewWithModel(s.modelID)
	stream := client.AskStream(ctx, ai.PromptModeMonitor, logData, nil)

	var sb strings.Builder
	for chunk := range stream {
		if chunk.Type == "text" {
			sb.WriteString(chunk.Content)
		}
	}

	response := strings.TrimSpace(sb.String())
	now := time.Now()
	p.LastChecked = &now
	p.Status = StatusActive

	// Persist status update
	if s.persistProject != nil {
		_ = s.persistProject(p.ID, p.Status, now)
	}

	if strings.EqualFold(response, "OK") || response == "" {
		return
	}

	// Parse ALERT: <severity> <message>
	lines := strings.SplitN(response, "\n", 3)
	firstLine := strings.TrimSpace(lines[0])
	m := alertResponseRe.FindStringSubmatch(firstLine)
	if m == nil {
		// AI didn't follow the format — treat as info
		m = []string{"", "info", firstLine}
	}

	severity := Severity(strings.ToLower(m[1]))
	message := strings.TrimSpace(m[2])
	detail := ""
	if len(lines) > 1 {
		detail = strings.Join(lines[1:], "\n")
	}

	alert := &Alert{
		ProjectID:   p.ID,
		ProjectName: p.Name,
		Severity:    severity,
		Message:     message,
		RawLog:      detail,
		CreatedAt:   now,
	}

	// Persist
	if s.persistAlert != nil {
		if err := s.persistAlert(alert); err != nil {
			fmt.Printf("[monitor] failed to persist alert for %s: %v\n", p.Name, err)
			return
		}
	}

	// Broadcast to SSE subscribers
	s.broker.Broadcast(alert)

	fmt.Printf("[monitor] %s: %s %s\n", p.Name, severity, message)
}

// AddProjectFromChat is the MonitorAddCallback for the agent — creates a project
// from a chat-initiated monitor_add tool call. Uses the global service.
func AddProjectFromChat(userID, name, path string, intervalSec int) error {
	if Global == nil {
		return fmt.Errorf("monitor service not started")
	}
	if intervalSec <= 0 {
		intervalSec = 30
	}
	p := &Project{
		UserID:      userID,
		Name:        name,
		ProjectPath: path,
		IntervalSec: intervalSec,
		Enabled:     true,
	}
	_, err := Global.AddProject(context.Background(), p)
	return err
}

// AddContainerProject explicitly binds application stdout/stderr to the monitor.
func AddContainerProject(userID, name, path, container string, intervalSec int, projectIDs ...string) error {
	if Global == nil {
		return fmt.Errorf("monitor service not started")
	}
	projectID := ""
	if len(projectIDs) > 0 {
		projectID = projectIDs[0]
	}
	_, err := Global.AddProject(context.Background(), &Project{
		ID: projectID, UserID: userID, Name: name, ProjectPath: path,
		LogPaths: []string{"docker:" + container}, IntervalSec: intervalSec, Enabled: true,
	})
	return err
}

// MarshalProject serializes a project's log paths to/from JSON for DB storage.
func MarshalLogPaths(paths []string) string {
	b, _ := json.Marshal(paths)
	return string(b)
}

// UnmarshalLogPaths deserializes log paths from JSON DB storage.
func UnmarshalLogPaths(s string) []string {
	var paths []string
	if err := json.Unmarshal([]byte(s), &paths); err != nil {
		return nil
	}
	return paths
}

// AddProjectViaRayAPI persists a project to Ray's Prisma DB via the internal API.
// Called by the addProject callback in main.go.
func AddProjectViaRayAPI(rayURL string, p *Project) (*Project, error) {
	secret := os.Getenv("BRAIN_INTERNAL_SECRET")
	if secret == "" {
		// No secret configured — fall back to in-memory only
		fmt.Printf("[monitor] BRAIN_INTERNAL_SECRET not set, project %q stored in-memory only\n", p.Name)
		return p, nil
	}

	payload, err := json.Marshal(map[string]any{
		"id":             p.ID,
		"runCommand":     p.RunCommand,
		"managedPid":     p.ManagedPid,
		"managedLogFile": p.ManagedLogFile,
		"userId":         p.UserID,
		"name":           p.Name,
		"projectPath":    p.ProjectPath,
		"logPaths":       p.LogPaths,
		"logCommand":     p.LogCommand,
		"intervalSec":    p.IntervalSec,
		"status":         string(p.Status),
	})
	if err != nil {
		return p, err
	}

	req, err := http.NewRequest("POST", rayURL+"/api/monitor/internal/add-project", bytes.NewReader(payload))
	if err != nil {
		return p, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Brain-Secret", secret)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("[monitor] Ray API unavailable, project %q in-memory only: %v\n", p.Name, err)
		return p, nil // non-fatal — brain monitors in-memory
	}
	defer resp.Body.Close()

	var result struct {
		Project struct {
			ID string `json:"id"`
		} `json:"project"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil && result.Project.ID != "" {
		p.ID = result.Project.ID
		fmt.Printf("[monitor] persisted project %q (id=%s) to Ray DB\n", p.Name, p.ID)
	}

	return p, nil
}
