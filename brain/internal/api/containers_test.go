package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func parseContainerLines(out string, statsMap map[string][2]string) []ContainerSummary {
	var containers []ContainerSummary
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 4 {
			continue
		}
		cID := parts[0]
		cName := parts[1]
		cImage := parts[2]
		cStatus := parts[3]
		cPorts := ""
		if len(parts) > 4 {
			cPorts = parts[4]
		}
		cCreated := ""
		if len(parts) > 5 {
			cCreated = parts[5]
		}

		state := "running"
		if strings.HasPrefix(strings.ToLower(cStatus), "exited") {
			state = "exited"
		} else if strings.HasPrefix(strings.ToLower(cStatus), "paused") {
			state = "paused"
		} else if strings.HasPrefix(strings.ToLower(cStatus), "restart") {
			state = "restarting"
		}

		port := 0
		url := ""
		portRe := regexp.MustCompile(`(?:(?:\d{1,3}\.){3}\d{1,3}|\[?::\]?|0\.0\.0\.0)?:?(\d+)->`)
		if m := portRe.FindStringSubmatch(cPorts); len(m) > 1 {
			port, _ = strconv.Atoi(m[1])
			if port > 0 {
				url = "http://localhost:" + strconv.Itoa(port)
			}
		}

		cpu := ""
		mem := ""
		if st, ok := statsMap[cName]; ok {
			cpu = st[0]
			mem = st[1]
		}

		containers = append(containers, ContainerSummary{
			ID:        cID,
			Name:      cName,
			Image:     cImage,
			Status:    cStatus,
			State:     state,
			Ports:     cPorts,
			Port:      port,
			URL:       url,
			CreatedAt: cCreated,
			CPU:       cpu,
			Memory:    mem,
			IsRay:     strings.HasPrefix(cName, "ray-"),
		})
	}
	return containers
}

func TestParseContainerLines(t *testing.T) {
	sampleOutput := "a1b2c3d4e5f6\tray-frontend\tnginx:alpine\tUp 2 hours\t0.0.0.0:8080->80/tcp\t2026-09-30 10:00:00\n" +
		"b2c3d4e5f6a1\tmy-db\tpostgres:15\tExited (0) 10 minutes ago\t5432/tcp\t2026-09-30 08:00:00"

	stats := map[string][2]string{
		"ray-frontend": {"0.5%", "15MiB / 500MiB"},
	}

	containers := parseContainerLines(sampleOutput, stats)
	if len(containers) != 2 {
		t.Fatalf("expected 2 containers, got %d", len(containers))
	}

	c1 := containers[0]
	if c1.ID != "a1b2c3d4e5f6" || c1.Name != "ray-frontend" || !c1.IsRay {
		t.Errorf("unexpected container 1: %+v", c1)
	}
	if c1.State != "running" || c1.Port != 8080 || c1.URL != "http://localhost:8080" {
		t.Errorf("unexpected container 1 state/port: state=%s, port=%d, url=%s", c1.State, c1.Port, c1.URL)
	}
	if c1.CPU != "0.5%" || c1.Memory != "15MiB / 500MiB" {
		t.Errorf("unexpected stats: cpu=%s, mem=%s", c1.CPU, c1.Memory)
	}

	c2 := containers[1]
	if c2.ID != "b2c3d4e5f6a1" || c2.Name != "my-db" || c2.IsRay {
		t.Errorf("unexpected container 2: %+v", c2)
	}
	if c2.State != "exited" || c2.Port != 0 {
		t.Errorf("unexpected container 2 state/port: state=%s, port=%d", c2.State, c2.Port)
	}
}

func TestContainersListHandlerMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/containers", nil)
	w := httptest.NewRecorder()

	containersListHandler(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", w.Code)
	}
}

func TestContainersListHandlerResponseFormat(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/containers", nil)
	w := httptest.NewRecorder()

	containersListHandler(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode JSON response: %v", err)
	}

	if _, ok := resp["containers"]; !ok {
		t.Errorf("response missing 'containers' key: %s", w.Body.String())
	}
}
