package security

import "time"

type ScanRequest struct {
	UserID      string `json:"userId"`
	ContainerID string `json:"containerId,omitempty"`
	ProjectID   string `json:"projectId"`
	ProjectName string `json:"projectName"`
	ProjectPath string `json:"projectPath"`
	GitDiff     string `json:"gitDiff,omitempty"`
	Trigger     string `json:"trigger"` // "deploy_first_time" | "cicd_pipeline" | "manual"
	ModelID     string `json:"modelId,omitempty"`
}

type FindingItem struct {
	ID             string       `json:"id"`
	RuleID         string       `json:"ruleId"`
	Title          string       `json:"title"`
	Severity       Severity     `json:"severity"`
	Category       RuleCategory `json:"category"`
	Description    string       `json:"description"`
	File           string       `json:"file,omitempty"`
	Line           int          `json:"line,omitempty"`
	CVE            string       `json:"cve,omitempty"`
	Recommendation string       `json:"recommendation"`
}

type ChecklistEvaluation struct {
	RuleID string `json:"ruleId"`
	Status string `json:"status"` // "pass" | "warn" | "fail"
	Note   string `json:"note"`
}

type SecurityReport struct {
	TreeDigest    string                `json:"treeDigest,omitempty"`
	RulesVersion  string                `json:"rulesVersion,omitempty"`
	Mode          string                `json:"mode,omitempty"`
	FilesScanned  int                   `json:"filesScanned"`
	FilesReused   int                   `json:"filesReused"`
	ExcludedFiles int                   `json:"excludedFiles"`
	Overridden    bool                  `json:"overridden"`
	DeploymentID  string                `json:"deploymentId,omitempty"`
	ID            string                `json:"id"`
	ProjectID     string                `json:"projectId"`
	ProjectName   string                `json:"projectName"`
	Trigger       string                `json:"trigger"`
	Status        string                `json:"status"` // "passed" | "warning" | "danger"
	Summary       string                `json:"summary"`
	DangerCount   int                   `json:"dangerCount"`
	WarnCount     int                   `json:"warnCount"`
	InfoCount     int                   `json:"infoCount"`
	Findings      []FindingItem         `json:"findings"`
	Checklist     []ChecklistEvaluation `json:"checklist"`
	Logs          string                `json:"logs"`
	CreatedAt     time.Time             `json:"createdAt"`
}
