package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"brain/server/internal/agent"
	"brain/server/internal/ai"
	"brain/server/internal/api"
	"brain/server/internal/monitor"

	"github.com/joho/godotenv"
)

func main() {
	// Load .env from multiple paths (current dir, brain/.env, parent)
	_ = godotenv.Load(".env", "brain/.env", "../brain/.env")

	// Ensure cross-platform Docker host on Windows
	if runtime.GOOS == "windows" {
		dockerHost := os.Getenv("DOCKER_HOST")
		if dockerHost == "" || strings.Contains(dockerHost, "dockerDesktopLinuxEngine") {
			_ = os.Setenv("DOCKER_HOST", "npipe:////./pipe/docker_engine")
		}
	}

	port := os.Getenv("BRAIN_PORT")
	if port == "" {
		port = "3100"
	}

	// Initialise autonomous mode from env
	if os.Getenv("AGENT_AUTONOMOUS") == "true" {
		agent.SetAutonomousMode(true)
	}

	// Default AI model for monitoring (can be overridden per-project)
	monitorModel := os.Getenv("MONITOR_MODEL")
	if monitorModel == "" {
		// Use first available model
		models := ai.GetModels()
		if len(models) > 0 {
			monitorModel = models[0].ID
		}
	}

	rayURL := os.Getenv("RAY_URL")
	if rayURL == "" {
		rayURL = "http://localhost:3000"
	}

	internalSecret := os.Getenv("BRAIN_INTERNAL_SECRET")
	if internalSecret == "" {
		log.Fatal("[FATAL] BRAIN_INTERNAL_SECRET is not set. Please define BRAIN_INTERNAL_SECRET in your .env file.")
	}

	// Start the monitor service (in-memory; Ray Next.js owns DB persistence)
	svc := monitor.NewService(
		monitorModel,
		nil, // persistAlert: handled by Ray API
		// persistProject: called by Brain after each poll cycle to sync status/lastChecked
		func(id string, status monitor.ProjectStatus, lastChecked time.Time) error {
			url := rayURL + "/api/monitor/internal/update-project"
			body, _ := jsonMarshal(map[string]string{
				"id":          id,
				"status":      string(status),
				"lastChecked": lastChecked.UTC().Format(time.RFC3339),
			})
			req, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(body))
			if err != nil {
				return err
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("x-brain-secret", internalSecret)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return err
			}
			resp.Body.Close()
			return nil
		},
		nil, // loadProjects: Ray re-registers on startup
		func(p *monitor.Project) (*monitor.Project, error) {
			return monitor.AddProjectViaRayAPI(rayURL, p)
		},
	)

	// Register memory updater, Brain calls Ray PATCH /api/monitor/projects/{id}/memory when analysis completes
	svc.SetMemoryUpdater(func(id, content, status string) error {
		url := rayURL + "/api/monitor/projects/" + id + "/memory"
		body, _ := jsonMarshal(map[string]string{"memory": content, "memoryStatus": status})
		req, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-internal-secret", internalSecret)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		return nil
	})

	ctx, cancelCtx := context.WithCancel(context.Background())
	defer cancelCtx()
	svc.Start(ctx)

	// Build the HTTP router
	router := api.NewRouter()

	host := os.Getenv("BRAIN_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	bindAddr := host + ":" + port

	srv := &http.Server{
		Addr:              bindAddr,
		Handler:           router,
		ReadHeaderTimeout: 30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Start server in background
	go func() {
		fmt.Printf("\n  ⬡  brain  running on http://%s\n\n", bindAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("brain: server error: %v", err)
		}
	}()

	// Wait for interrupt signal, then graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	fmt.Println("\n  brain: shutting down…")
	cancelCtx()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Printf("brain: forced shutdown: %v", err)
	}
	fmt.Println("  brain: stopped.")
}

// jsonMarshal is a convenience wrapper used in callbacks.
func jsonMarshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}
