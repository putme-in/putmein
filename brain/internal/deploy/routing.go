package deploy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var routingMu sync.Mutex
var domainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

type managedRoute struct {
	Owner   string `json:"owner"`
	Project string `json:"project"`
	Runtime string `json:"runtime"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
}

func routeFile() string {
	root := os.Getenv("RAY_ROUTING_DIR")
	if root == "" {
		home, _ := os.UserHomeDir()
		root = filepath.Join(home, ".ray", "routing")
	}
	return filepath.Join(root, "routes.json")
}
func routingHost(req DeployRequest) (string, error) {
	if req.RoutingMode == "" || req.RoutingMode == "port" {
		return "", nil
	}
	if req.RoutingMode != "https" {
		return "", fmt.Errorf("routing must be direct port or managed HTTPS")
	}
	if req.HealthCheck.Type == "tcp" {
		return "", fmt.Errorf("managed HTTPS requires an HTTP application; use direct port access for TCP services")
	}
	u, err := url.Parse(req.ProjectURL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("managed HTTPS requires an origin like https://app.example.com without a port or path")
	}
	host := strings.ToLower(u.Hostname())
	if len(host) > 253 || !domainPattern.MatchString(host) || net.ParseIP(host) != nil || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return "", fmt.Errorf("managed HTTPS requires a public DNS hostname")
	}
	return host, nil
}
func readRoutes() ([]managedRoute, error) {
	data, err := os.ReadFile(routeFile())
	if os.IsNotExist(err) {
		return []managedRoute{}, nil
	}
	if err != nil {
		return nil, err
	}
	var routes []managedRoute
	err = json.Unmarshal(data, &routes)
	return routes, err
}
func caddyRequest(ctx context.Context, method string, body []byte) ([]byte, error) {
	endpoint := strings.TrimRight(os.Getenv("RAY_CADDY_ADMIN_URL"), "/")
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("configure a local Caddy admin endpoint in RAY_CADDY_ADMIN_URL before using HTTPS")
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint+"/id/ray-managed-server", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Caddy is unreachable; check managed HTTPS configuration")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, fmt.Errorf("Caddy rejected route configuration (HTTP %d); install the ray-managed-server bootstrap", response.StatusCode)
	}
	return data, nil
}
func preflightRouting(ctx context.Context, req DeployRequest) error {
	host, err := routingHost(req)
	if err != nil {
		return err
	}
	if host == "" {
		return nil
	}
	routingMu.Lock()
	defer routingMu.Unlock()
	routes, err := readRoutes()
	if err != nil {
		return err
	}
	for _, r := range routes {
		if r.Host == host && (r.Owner != req.UserID || r.Project != securityIdentity(req)) {
			return fmt.Errorf("domain is already assigned to another project")
		}
	}
	config, err := caddyRequest(ctx, "GET", nil)
	if err != nil {
		return err
	}
	return validateRouteRegistry(routes, config)
}
func caddyServer(routes []managedRoute) []byte {
	rules := []any{}
	sort.Slice(routes, func(i, j int) bool { return routes[i].Host < routes[j].Host })
	for _, r := range routes {
		rules = append(rules, map[string]any{"match": []any{map[string]any{"host": []string{r.Host}}}, "handle": []any{map[string]any{"handler": "reverse_proxy", "upstreams": []any{map[string]any{"dial": fmt.Sprintf("127.0.0.1:%d", r.Port)}}}}, "terminal": true})
	}
	rules = append(rules, map[string]any{"handle": []any{map[string]any{"handler": "static_response", "status_code": 404}}})
	data, _ := json.Marshal(map[string]any{"@id": "ray-managed-server", "listen": []string{":443"}, "tls_connection_policies": []any{map[string]any{}}, "routes": rules})
	return data
}
func applyRouting(ctx context.Context, req DeployRequest, port int, runtime string) (string, error) {
	host, err := routingHost(req)
	if err != nil {
		return "", err
	}
	routingMu.Lock()
	defer routingMu.Unlock()
	previous, err := readRoutes()
	if err != nil {
		return "", err
	}
	next := []managedRoute{}
	changed := false
	for _, r := range previous {
		if r.Owner == req.UserID && r.Project == securityIdentity(req) {
			changed = true
			continue
		}
		if host != "" && r.Host == host {
			return "", fmt.Errorf("domain is already assigned to another project")
		}
		next = append(next, r)
	}
	if host != "" {
		next = append(next, managedRoute{req.UserID, securityIdentity(req), runtime, host, port})
		changed = true
	}
	direct := directURL(port)
	if !changed {
		return direct, nil
	}
	oldConfig, err := caddyRequest(ctx, "GET", nil)
	if err != nil {
		return "", err
	}
	if err = validateRouteRegistry(previous, oldConfig); err != nil {
		return "", err
	}
	if _, err = caddyRequest(ctx, "PATCH", caddyServer(next)); err != nil {
		return "", err
	}
	if err = atomicSecurityJSON(routeFile(), next); err != nil {
		restoreCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, restoreErr := caddyRequest(restoreCtx, "PATCH", oldConfig)
		if restoreErr != nil {
			return "", fmt.Errorf("route persistence and rollback failed; operator must reconcile Caddy before retrying")
		}
		return "", fmt.Errorf("route could not be persisted; previous routing restored")
	}
	if host != "" {
		return "https://" + host, nil
	}
	return direct, nil
}

func removeRuntimeRoute(runtime string) error {
	routingMu.Lock()
	routes, err := readRoutes()
	routingMu.Unlock()
	if err != nil {
		return err
	}
	for _, r := range routes {
		if r.Runtime == runtime {
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			_, err := applyRouting(ctx, DeployRequest{UserID: r.Owner, ProjectID: r.Project, RoutingMode: "port"}, 0, runtime)
			cancel()
			if err != nil {
				return err
			}
		}
	}
	return nil
}
func runtimeURL(req DeployRequest, port int) string {
	if host, err := routingHost(req); err == nil && host != "" {
		return "https://" + host
	}
	return directURL(port)
}

func directURL(port int) string {
	host := strings.TrimSpace(os.Getenv("RAY_PUBLIC_HOST"))
	if net.ParseIP(host) == nil && host != "localhost" && !domainPattern.MatchString(host) {
		host = "localhost"
	}
	return "http://" + net.JoinHostPort(host, fmt.Sprint(port))
}
func validateRouteRegistry(routes []managedRoute, config []byte) error {
	var server struct {
		Routes []struct {
			Match []struct {
				Host []string `json:"host"`
			} `json:"match"`
			Handle []struct {
				Handler   string `json:"handler"`
				Upstreams []struct {
					Dial string `json:"dial"`
				} `json:"upstreams"`
			} `json:"handle"`
		} `json:"routes"`
	}
	if json.Unmarshal(config, &server) != nil {
		return fmt.Errorf("Caddy returned invalid configuration")
	}
	expected := map[string]string{}
	for _, r := range routes {
		expected[r.Host] = fmt.Sprintf("127.0.0.1:%d", r.Port)
	}
	seen := map[string]bool{}
	for _, rule := range server.Routes {
		for _, match := range rule.Match {
			for _, host := range match.Host {
				if seen[host] || expected[host] == "" || len(rule.Handle) != 1 || rule.Handle[0].Handler != "reverse_proxy" || len(rule.Handle[0].Upstreams) != 1 || rule.Handle[0].Upstreams[0].Dial != expected[host] {
					return fmt.Errorf("Caddy and route registry differ; restore or reconcile managed routing before deployment")
				}
				seen[host] = true
			}
		}
	}
	if len(seen) != len(expected) {
		return fmt.Errorf("Caddy is missing saved routes; resume its saved configuration or reconcile routing")
	}
	return nil
}

func ensureRoutePortAvailable(port int, runtime string) error {
	routingMu.Lock()
	defer routingMu.Unlock()
	routes, err := readRoutes()
	if err != nil {
		return fmt.Errorf("cannot verify managed route port ownership")
	}
	for _, r := range routes {
		if r.Port == port && r.Runtime != runtime {
			return fmt.Errorf("port %d is reserved by another managed domain", port)
		}
	}
	return nil
}

// RemoveRuntimeRoute also accepts a Docker ID from the container controls.
func RemoveRuntimeRoute(ctx context.Context, runtime string) error {
	if err := removeRuntimeRoute(runtime); err != nil {
		return err
	}
	if regexp.MustCompile(`^[a-f0-9]{12,64}$`).MatchString(runtime) {
		name, err := dockerCmd(ctx, "inspect", "--format", "{{.Name}}", "--", runtime).Output()
		if err == nil {
			return removeRuntimeRoute(strings.TrimPrefix(strings.TrimSpace(string(name)), "/"))
		}
	}
	return nil
}
