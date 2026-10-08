package monitor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// NewAlertPersister records events independently of browser subscriptions.
// Retries reuse the event ID so an ambiguous response cannot create duplicates.
func NewAlertPersister(base, secret string, client *http.Client) func(*Alert) error {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return func(alert *Alert) error {
		if alert.ID == "" {
			alert.ID = uuid.NewString()
		}
		body, err := json.Marshal(alert)
		if err != nil {
			return err
		}
		var last error
		for attempt := 0; attempt < 3; attempt++ {
			req, err := http.NewRequest(http.MethodPost, strings.TrimRight(base, "/")+"/api/monitor/alerts/"+url.PathEscape(alert.ProjectID), bytes.NewReader(body))
			if err != nil {
				return err
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("x-brain-secret", secret)
			response, err := client.Do(req)
			if err != nil {
				last = err
				continue
			}
			response.Body.Close()
			if response.StatusCode == http.StatusCreated {
				return nil
			}
			last = fmt.Errorf("alert persistence returned %d", response.StatusCode)
			if response.StatusCode < 500 {
				return last
			}
		}
		return last
	}
}
