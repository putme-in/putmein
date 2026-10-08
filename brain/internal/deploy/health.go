package deploy

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// HealthCheck probes only the local application port, never a supplied remote URL.
type HealthCheck struct {
	Type            string `json:"type"`
	Path            string `json:"path"`
	TimeoutSeconds  int    `json:"timeoutSeconds"`
	IntervalSeconds int    `json:"intervalSeconds"`
	SuccessStatus   int    `json:"successStatus"`
}

func normalizeHealth(h HealthCheck) (HealthCheck, error) {
	if h.Type == "" {
		h.Type = "http"
	}
	if h.Path == "" {
		h.Path = "/"
	}
	if h.TimeoutSeconds == 0 {
		h.TimeoutSeconds = 60
	}
	if h.IntervalSeconds == 0 {
		h.IntervalSeconds = 2
	}
	if h.Type != "http" && h.Type != "tcp" {
		return h, fmt.Errorf("health check must be HTTP or TCP")
	}
	u, err := url.ParseRequestURI(h.Path)
	if err != nil || !strings.HasPrefix(h.Path, "/") || strings.HasPrefix(h.Path, "//") || u.Host != "" || u.Fragment != "" || strings.ContainsAny(h.Path, "\r\n\\") || len(h.Path) > 2048 {
		return h, fmt.Errorf("health check path must be a local path, e.g. /health")
	}
	if h.TimeoutSeconds < 5 || h.TimeoutSeconds > 300 || h.IntervalSeconds < 1 || h.IntervalSeconds > 30 {
		return h, fmt.Errorf("health timeout must be 5–300 seconds and interval 1–30 seconds")
	}
	if h.SuccessStatus != 0 && (h.SuccessStatus < 200 || h.SuccessStatus > 499) {
		return h, fmt.Errorf("expected HTTP status must be 200–499, or zero for 200–399")
	}
	return h, nil
}
func waitForHealth(ctx context.Context, port int, settings HealthCheck, alive func() bool, hostHeader ...string) error {
	h, err := normalizeHealth(settings)
	if err != nil {
		return err
	}
	if port < 1 || port > 65535 {
		return fmt.Errorf("invalid health port")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(h.TimeoutSeconds)*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	address := net.JoinHostPort("127.0.0.1", fmt.Sprint(port))
	for {
		if ctx.Err() != nil {
			return fmt.Errorf("%s health check failed on port %d: %w", h.Type, port, ctx.Err())
		}
		if alive != nil && !alive() {
			return fmt.Errorf("application exited before becoming healthy")
		}
		if h.Type == "tcp" {
			conn, e := (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "tcp", address)
			if e == nil {
				conn.Close()
				return nil
			}
		} else {
			req, e := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+address+h.Path, nil)
			if e != nil {
				return e
			}
			if len(hostHeader) > 0 && hostHeader[0] != "" {
				req.Host = hostHeader[0]
			}
			res, e := client.Do(req)
			if e == nil {
				res.Body.Close()
				if (h.SuccessStatus == 0 && res.StatusCode >= 200 && res.StatusCode < 400) || res.StatusCode == h.SuccessStatus {
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Duration(h.IntervalSeconds) * time.Second):
		}
	}
}
