package monitor

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type alertTransport func(*http.Request) (*http.Response, error)

func (f alertTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestAlertPersistenceRetriesSameEvent(t *testing.T) {
	calls := 0
	first := ""
	client := &http.Client{Transport: alertTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		body, _ := io.ReadAll(req.Body)
		if req.Header.Get("x-brain-secret") != "secret" {
			t.Fatal("missing authentication")
		}
		if calls == 1 {
			first = string(body)
		} else if first != string(body) {
			t.Fatal("retry changed event")
		}
		status := 503
		if calls == 3 {
			status = 201
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("{}")), Header: make(http.Header)}, nil
	})}
	alert := &Alert{ProjectID: "project", Severity: SeverityError, Message: "failure"}
	if err := NewAlertPersister("http://ray", "secret", client)(alert); err != nil {
		t.Fatal(err)
	}
	if calls != 3 || alert.ID == "" {
		t.Fatal("event not persisted with stable ID")
	}
}
