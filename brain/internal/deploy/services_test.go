package deploy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureFile(t *testing.T, root, name, value string) {
	t.Helper()
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(value), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestProductionTemplates(t *testing.T) {
	cases := []struct {
		name, manifest, content, start, want string
		port                                 int
	}{
		{"nextjs", "package.json", `{"dependencies":{"next":"15.2.3"},"scripts":{"build":"next build","start":"next start"}}`, "", "node_modules/next/dist/bin/next start", 3000},
		{"react", "package.json", `{"dependencies":{"vite":"6"},"scripts":{"build":"vite build"}}`, "", "nginx-unprivileged", 8080},
		{"nuxt", "package.json", `{"dependencies":{"nuxt":"3"},"scripts":{"build":"nuxt build"}}`, "", ".output/server/index.mjs", 3000},
		{"sveltekit", "package.json", `{"devDependencies":{"@sveltejs/adapter-node":"5"},"scripts":{"build":"vite build"}}`, "", "node build", 3000},
		{"express", "package.json", `{"scripts":{"start":"node app.js"}}`, "", "npm start", 3000},
		{"fastapi", "requirements.txt", "fastapi\nuvicorn\n", "", "uvicorn main:app", 8000},
		{"flask", "requirements.txt", "flask\ngunicorn\n", "", "gunicorn app:app", 8000},
		{"python", "pyproject.toml", "[project]\nname='app'", "python app.py", "pip install --no-cache-dir .", 8000},
		{"go", "go.mod", "module example.com/app\ngo 1.26\n", "", "/out/server", 8080},
		{"rust", "Cargo.toml", "[package]\nname='app'", "./target/release/app", "cargo build --release --locked", 8080},
		{"java", "mvnw", "echo build", "java -jar target/app.jar", "sh ./mvnw", 8080},
		{"ruby", "bin/rails", "rails", "", "bundle exec rails server", 3000},
		{"php", "index.php", "<?php echo 'ok';", "", "apache2-foreground", 80},
		{"laravel", "artisan", "php", "", "/app/public", 80},
		{"static", "index.html", "<p>ok</p>", "", "nginx-unprivileged", 8080},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			fixtureFile(t, root, tc.manifest, tc.content)
			out, port, err := DetectAndGenerateDockerfile(root, DeployRequest{Framework: tc.name, StartCommand: tc.start})
			if err != nil || port != tc.port || !strings.Contains(out, tc.want) || strings.Contains(out, "|| true") {
				t.Fatalf("template: port=%d err=%v\n%s", port, err, out)
			}
		})
	}
	t.Run("django", func(t *testing.T) {
		root := t.TempDir()
		fixtureFile(t, root, "requirements.txt", "django\ngunicorn")
		fixtureFile(t, root, "app/wsgi.py", "application = None")
		out, _, err := DetectAndGenerateDockerfile(root, DeployRequest{Framework: "django"})
		if err != nil || !strings.Contains(out, "app.wsgi:application") {
			t.Fatalf("%v %s", err, out)
		}
	})
}
func TestCustomDockerfilePreserved(t *testing.T) {
	root := t.TempDir()
	original := "FROM alpine\nEXPOSE 9876/tcp\nRUN echo '|| true'\n"
	fixtureFile(t, root, "Dockerfile", original)
	content, port, err := DetectAndGenerateDockerfile(root)
	if err != nil || content != original || port != 9876 {
		t.Fatal("custom Dockerfile changed")
	}
	if _, _, err := DetectAndGenerateDockerfile(root, DeployRequest{BuildCommand: "echo altered"}); err == nil {
		t.Fatal("custom build override accepted")
	}
}
func TestTemplatePortsAndRequiredCommands(t *testing.T) {
	root := t.TempDir()
	fixtureFile(t, root, "index.html", "ok")
	out, port, err := DetectAndGenerateDockerfile(root, DeployRequest{Framework: "static", ContainerPort: 4321})
	if err != nil || port != 4321 || !strings.Contains(out, "listen 4321") || !strings.Contains(out, "EXPOSE 4321") {
		t.Fatalf("port mismatch: %v %s", err, out)
	}
	for _, framework := range []string{"rust", "java", "python", "unknown"} {
		if _, _, err := generateTemplate(t.TempDir(), DeployRequest{Framework: framework}); err == nil {
			t.Fatalf("%s unexpectedly inferred missing start command", framework)
		}
	}
}
func TestHealthValidation(t *testing.T) {
	h, err := normalizeHealth(HealthCheck{})
	if err != nil || h.Type != "http" || h.TimeoutSeconds != 60 {
		t.Fatal("bad default")
	}
	for _, h := range []HealthCheck{{Type: "exec"}, {Path: "http://evil.test"}, {Path: "//evil.test"}, {Path: "/\r\n"}, {TimeoutSeconds: 301}, {IntervalSeconds: 31}, {SuccessStatus: 500}} {
		if _, err := normalizeHealth(h); err == nil {
			t.Fatalf("invalid health accepted: %+v", h)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitForHealth(ctx, 4123, HealthCheck{Type: "tcp"}, nil); err == nil {
		t.Fatal("cancellation ignored")
	}
}
func TestRoutingValidationAndRegistry(t *testing.T) {
	req := DeployRequest{RoutingMode: "https", ProjectURL: "https://app.example.com"}
	if host, err := routingHost(req); err != nil || host != "app.example.com" {
		t.Fatalf("valid route: %s %v", host, err)
	}
	for _, address := range []string{"http://app.example.com", "https://127.0.0.1", "https://app.local", "https://u:p@app.example.com", "https://app.example.com:8443", "https://app.example.com/path", "https://*.example.com"} {
		req.ProjectURL = address
		if _, err := routingHost(req); err == nil {
			t.Fatalf("invalid route %s accepted", address)
		}
	}
	routes := []managedRoute{{Owner: "owner", Project: "project", Runtime: "app", Host: "app.example.com", Port: 4123}}
	config := caddyServer(routes)
	if err := validateRouteRegistry(routes, config); err != nil {
		t.Fatal(err)
	}
	if err := validateRouteRegistry(nil, config); err == nil {
		t.Fatal("lost registry accepted")
	}
	if err := validateRouteRegistry(routes, caddyServer(nil)); err == nil {
		t.Fatal("lost Caddy config accepted")
	}
	if !strings.Contains(string(config), "127.0.0.1:4123") || !strings.Contains(string(config), "ray-managed-server") {
		t.Fatal("invalid proxy target")
	}
	t.Setenv("RAY_PUBLIC_HOST", "2001:db8::1")
	if directURL(4123) != "http://[2001:db8::1]:4123" {
		t.Fatal("IPv6 link malformed")
	}
}

func TestManagedRouteReservesStoppedUpstreamPort(t *testing.T) {
	t.Setenv("RAY_ROUTING_DIR", t.TempDir())
	routes := []managedRoute{{Owner: "owner", Project: "project", Runtime: "original", Host: "app.example.com", Port: 4321}}
	if err := atomicSecurityJSON(routeFile(), routes); err != nil {
		t.Fatal(err)
	}
	if err := ensureRoutePortAvailable(4321, "other"); err == nil {
		t.Fatal("another app could inherit a stale domain route")
	}
	if err := ensureRoutePortAvailable(4321, "original"); err != nil {
		t.Fatal(err)
	}
}
