package monitor

import (
	"testing"
)

func TestNormalizeCommandForOS(t *testing.T) {
	tests := []struct {
		name     string
		cmd      string
		targetOS string
		expected string
	}{
		{
			name:     "Windows converts 2>/dev/null to 2>nul",
			cmd:      `docker ps -a --format "{{.ID}}\t{{.Names}}" 2>/dev/null`,
			targetOS: "windows",
			expected: `docker ps -a --format "{{.ID}}\t{{.Names}}" 2>nul`,
		},
		{
			name:     "Windows converts >/dev/null and > /dev/null",
			cmd:      `echo test >/dev/null 2>/dev/null && command > /dev/null`,
			targetOS: "windows",
			expected: `echo test >nul 2>nul && command > nul`,
		},
		{
			name:     "Linux preserves 2>/dev/null",
			cmd:      `docker ps -a 2>/dev/null`,
			targetOS: "linux",
			expected: `docker ps -a 2>/dev/null`,
		},
		{
			name:     "Darwin preserves 2>/dev/null",
			cmd:      `docker ps -a 2>/dev/null`,
			targetOS: "darwin",
			expected: `docker ps -a 2>/dev/null`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizeCommandForOS(tc.cmd, tc.targetOS)
			if got != tc.expected {
				t.Errorf("NormalizeCommandForOS(%q, %q) = %q; want %q", tc.cmd, tc.targetOS, got, tc.expected)
			}
		})
	}
}
