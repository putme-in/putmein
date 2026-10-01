package deploy

import (
	"strings"
	"testing"
)

func TestResolveDockerEnv(t *testing.T) {
	tests := []struct {
		name       string
		targetOS   string
		currentEnv []string
		wantHost   string
	}{
		{
			name:       "Windows injects default pipe when DOCKER_HOST is missing",
			targetOS:   "windows",
			currentEnv: []string{"PATH=C:\\Windows", "FOO=bar"},
			wantHost:   "npipe:////./pipe/docker_engine",
		},
		{
			name:       "Windows replaces obsolete dockerDesktopLinuxEngine pipe",
			targetOS:   "windows",
			currentEnv: []string{"DOCKER_HOST=npipe:////./pipe/dockerDesktopLinuxEngine", "FOO=bar"},
			wantHost:   "npipe:////./pipe/docker_engine",
		},
		{
			name:       "Windows preserves custom valid DOCKER_HOST",
			targetOS:   "windows",
			currentEnv: []string{"DOCKER_HOST=tcp://127.0.0.1:2375", "FOO=bar"},
			wantHost:   "tcp://127.0.0.1:2375",
		},
		{
			name:       "Linux leaves environment unchanged when unset",
			targetOS:   "linux",
			currentEnv: []string{"PATH=/bin", "FOO=bar"},
			wantHost:   "",
		},
		{
			name:       "Darwin leaves environment unchanged when unset",
			targetOS:   "darwin",
			currentEnv: []string{"PATH=/bin", "FOO=bar"},
			wantHost:   "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			resolved := ResolveDockerEnv(tc.currentEnv, tc.targetOS)
			foundHost := ""
			for _, kv := range resolved {
				if strings.HasPrefix(strings.ToUpper(kv), "DOCKER_HOST=") {
					foundHost = kv[len("DOCKER_HOST="):]
					break
				}
			}

			if foundHost != tc.wantHost {
				t.Errorf("ResolveDockerEnv(%v, %q) got DOCKER_HOST=%q; want %q", tc.currentEnv, tc.targetOS, foundHost, tc.wantHost)
			}
		})
	}
}
