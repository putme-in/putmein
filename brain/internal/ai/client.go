package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Response holds a complete (non-streaming) AI response.
type Response struct {
	Thinking string
	Text     string
	Err      error
}

// HistoryEntry is a single conversation turn for the AI's context window.
type HistoryEntry struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamChunk is a single piece of a streaming response.
type StreamChunk struct {
	Type    string // "text", "thinking", "done", "error"
	Content string
	Err     error
}

const defaultRequestTimeout = 120 * time.Second

// Client sends messages to an AI API (Anthropic, OpenAI, or Gemini).
type Client struct {
	httpClient *http.Client
	Model      ModelConfig
}

// New creates an AI client using the first available configured model.
func New() *Client {
	return &Client{
		httpClient: &http.Client{},
		Model:      GetFirstConfiguredModel(),
	}
}

// NewWithModel creates an AI client for a specific model ID.
func NewWithModel(modelID string) *Client {
	return &Client{
		httpClient: &http.Client{},
		Model:      GetModelByID(modelID),
	}
}

// SetModel switches the active model by ID.
func (c *Client) SetModel(id string) {
	c.Model = GetModelByID(id)
}

// Ask sends a message and waits for the full response by draining AskStream.
func (c *Client) Ask(ctx context.Context, mode PromptMode, userInput string, history []HistoryEntry) Response {
	stream := c.AskStream(ctx, mode, userInput, history)
	var fullText, thinking strings.Builder

	for chunk := range stream {
		switch chunk.Type {
		case "text":
			fullText.WriteString(chunk.Content)
		case "thinking":
			thinking.WriteString(chunk.Content)
		case "error":
			return Response{Err: chunk.Err}
		}
	}

	return Response{
		Thinking: thinking.String(),
		Text:     fullText.String(),
	}
}

// formatAPIError formats HTTP error responses into user-friendly messages.
func formatAPIError(provider, modelName string, statusCode int, rawBody []byte) error {
	bodyStr := strings.TrimSpace(string(rawBody))
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return fmt.Errorf("Invalid API key for %s. Please verify your API key in Settings > AI Model Keys.", modelName)
	}
	if statusCode == http.StatusTooManyRequests {
		return fmt.Errorf("Rate limit or quota exceeded for %s. Please check your account quota or try again later.", modelName)
	}
	if statusCode >= 500 {
		return fmt.Errorf("Server error (%d) from %s: Upstream AI service is temporarily unavailable. Something went wrong.", statusCode, modelName)
	}
	if bodyStr != "" {
		var parsed struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
			Message string `json:"message"`
		}
		if json.Unmarshal(rawBody, &parsed) == nil {
			if parsed.Error.Message != "" {
				return fmt.Errorf("%s error (%d): %s", modelName, statusCode, parsed.Error.Message)
			}
			if parsed.Message != "" {
				return fmt.Errorf("%s error (%d): %s", modelName, statusCode, parsed.Message)
			}
		}
		return fmt.Errorf("%s error (%d): %s", modelName, statusCode, bodyStr)
	}
	return fmt.Errorf("%s error (%d): Something went wrong with the AI provider request.", modelName, statusCode)
}

func formatStreamRequestError(modelName string, err error) error {
	if errors.Is(err, context.Canceled) {
		return nil
	}
	if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
		return fmt.Errorf("Request timed out while contacting %s. Please try again later.", modelName)
	}
	return fmt.Errorf("Connection failed: Unable to connect to %s. Please check your network connection or server status. Something went wrong.", modelName)
}

// AskStream sends a message and returns a channel of streaming chunks.
// Dispatches to the appropriate protocol handler based on c.Model.Provider.
func (c *Client) AskStream(ctx context.Context, mode PromptMode, userInput string, history []HistoryEntry) <-chan StreamChunk {
	ch := make(chan StreamChunk, 64)

	// Validate API Key upfront with a helpful diagnostic error
	if strings.TrimSpace(c.Model.APIKey) == "" {
		go func() {
			defer close(ch)
			ch <- StreamChunk{
				Type: "error",
				Err:  fmt.Errorf("API key not configured: %s does not have an API key configured. Please add your API key in Settings > AI Model Keys.", c.Model.Name),
			}
		}()
		return ch
	}

	go func() {
		defer close(ch)

		requestCtx, cancel := context.WithTimeout(ctx, defaultRequestTimeout)
		defer cancel()

		switch c.Model.Provider {
		case "openai", "openrouter":
			c.askStreamOpenAI(requestCtx, mode, userInput, history, ch)
		case "gemini":
			c.askStreamGemini(requestCtx, mode, userInput, history, ch)
		default: // "anthropic" / "ozias" / "minimax"
			c.askStreamAnthropic(requestCtx, mode, userInput, history, ch)
		}
	}()

	return ch
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic / MiniMax Protocol
// ─────────────────────────────────────────────────────────────────────────────

func buildMessages(history []HistoryEntry, userInput string) []map[string]string {
	var raw []HistoryEntry
	for _, h := range history {
		trimmed := strings.TrimSpace(h.Content)
		if trimmed != "" {
			role := h.Role
			if role != "assistant" && role != "user" {
				role = "user"
			}
			raw = append(raw, HistoryEntry{Role: role, Content: trimmed})
		}
	}

	trimmedInput := strings.TrimSpace(userInput)
	if trimmedInput != "" {
		raw = append(raw, HistoryEntry{Role: "user", Content: trimmedInput})
	}

	if len(raw) == 0 {
		return []map[string]string{{"role": "user", "content": "Hello"}}
	}

	// Collapse consecutive messages with the same role
	var merged []map[string]string
	for _, entry := range raw {
		if len(merged) > 0 && merged[len(merged)-1]["role"] == entry.Role {
			merged[len(merged)-1]["content"] += "\n\n" + entry.Content
		} else {
			merged = append(merged, map[string]string{"role": entry.Role, "content": entry.Content})
		}
	}

	// Anthropic API requires first message to be user role
	if len(merged) > 0 && merged[0]["role"] != "user" {
		merged = append([]map[string]string{{"role": "user", "content": "Context:"}}, merged...)
	}

	return merged
}

func (c *Client) askStreamAnthropic(ctx context.Context, mode PromptMode, userInput string, history []HistoryEntry, ch chan<- StreamChunk) {
	modelID := c.Model.ActualModelID
	if modelID == "" {
		modelID = c.Model.ID
	}

	body := map[string]any{
		"model":      modelID,
		"max_tokens": 8192,
		"stream":     true,
		"system":     SystemPrompt(mode, c.Model.SystemName),
		"messages":   buildMessages(history, userInput),
	}

	data, err := json.Marshal(body)
	if err != nil {
		ch <- StreamChunk{Type: "error", Err: err}
		return
	}

	reqURL := c.Model.BaseURL + "/v1/messages"
	req, err := http.NewRequestWithContext(ctx, "POST", reqURL, bytes.NewReader(data))
	if err != nil {
		ch <- StreamChunk{Type: "error", Err: err}
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.Model.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if requestErr := formatStreamRequestError(c.Model.Name, err); requestErr != nil {
			ch <- StreamChunk{Type: "error", Err: requestErr}
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		ch <- StreamChunk{Type: "error", Err: formatAPIError("anthropic", c.Model.Name, resp.StatusCode, raw)}
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 || line[0] == ':' {
			continue
		}
		if len(line) < 6 || line[:6] != "data: " {
			continue
		}
		payload := line[6:]
		if payload == "[DONE]" {
			ch <- StreamChunk{Type: "done"}
			return
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}

		eventType, _ := event["type"].(string)
		switch eventType {
		case "content_block_delta":
			delta, _ := event["delta"].(map[string]any)
			deltaType, _ := delta["type"].(string)
			switch deltaType {
			case "text_delta":
				text, _ := delta["text"].(string)
				if text != "" {
					ch <- StreamChunk{Type: "text", Content: text}
				}
			case "thinking_delta":
				thinking, _ := delta["thinking"].(string)
				if thinking != "" {
					ch <- StreamChunk{Type: "thinking", Content: thinking}
				}
			}
		case "message_stop":
			ch <- StreamChunk{Type: "done"}
			return
		case "error":
			errObj, _ := event["error"].(map[string]any)
			msg, _ := errObj["message"].(string)
			ch <- StreamChunk{Type: "error", Err: fmt.Errorf("stream error: %s", msg)}
			return
		}
	}

	if err := scanner.Err(); err != nil {
		if requestErr := formatStreamRequestError(c.Model.Name, err); requestErr != nil {
			ch <- StreamChunk{Type: "error", Err: requestErr}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI / DeepSeek Protocol
// ─────────────────────────────────────────────────────────────────────────────

func (c *Client) askStreamOpenAI(ctx context.Context, mode PromptMode, userInput string, history []HistoryEntry, ch chan<- StreamChunk) {
	modelID := c.Model.ActualModelID
	if modelID == "" {
		modelID = c.Model.ID
	}

	// Build OpenAI format messages
	messages := make([]map[string]any, 0, len(history)+2)
	systemPrompt := SystemPrompt(mode, c.Model.SystemName)
	if systemPrompt != "" {
		messages = append(messages, map[string]any{
			"role":    "system",
			"content": systemPrompt,
		})
	}

	for _, h := range history {
		if strings.TrimSpace(h.Content) != "" {
			messages = append(messages, map[string]any{
				"role":    h.Role,
				"content": h.Content,
			})
		}
	}

	if strings.TrimSpace(userInput) != "" {
		messages = append(messages, map[string]any{
			"role":    "user",
			"content": userInput,
		})
	}

	body := map[string]any{
		"model":    modelID,
		"stream":   true,
		"messages": messages,
	}

	data, err := json.Marshal(body)
	if err != nil {
		ch <- StreamChunk{Type: "error", Err: err}
		return
	}

	endpoint := c.Model.BaseURL
	if strings.HasSuffix(endpoint, "/v1") {
		endpoint += "/chat/completions"
	} else if !strings.HasSuffix(endpoint, "/chat/completions") {
		endpoint += "/chat/completions"
	}

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(data))
	if err != nil {
		ch <- StreamChunk{Type: "error", Err: err}
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Model.APIKey)
	req.Header.Set("Accept", "text/event-stream")

	if c.Model.Provider == "openrouter" {
		req.Header.Set("HTTP-Referer", "http://localhost:3000")
		req.Header.Set("X-Title", "Ray Dashboard")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if requestErr := formatStreamRequestError(c.Model.Name, err); requestErr != nil {
			ch <- StreamChunk{Type: "error", Err: requestErr}
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		ch <- StreamChunk{Type: "error", Err: formatAPIError(c.Model.Provider, c.Model.Name, resp.StatusCode, raw)}
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 || line[0] == ':' {
			continue
		}
		if len(line) < 6 || line[:6] != "data: " {
			continue
		}
		payload := strings.TrimSpace(line[6:])
		if payload == "[DONE]" {
			ch <- StreamChunk{Type: "done"}
			return
		}

		var event struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}

		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}

		if event.Error != nil {
			ch <- StreamChunk{Type: "error", Err: fmt.Errorf("OpenAI stream error: %s", event.Error.Message)}
			return
		}

		if len(event.Choices) > 0 {
			choice := event.Choices[0]
			if choice.Delta.ReasoningContent != "" {
				ch <- StreamChunk{Type: "thinking", Content: choice.Delta.ReasoningContent}
			}
			if choice.Delta.Content != "" {
				ch <- StreamChunk{Type: "text", Content: choice.Delta.Content}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		if requestErr := formatStreamRequestError(c.Model.Name, err); requestErr != nil {
			ch <- StreamChunk{Type: "error", Err: requestErr}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Gemini Native Protocol
// ─────────────────────────────────────────────────────────────────────────────

func (c *Client) askStreamGemini(ctx context.Context, mode PromptMode, userInput string, history []HistoryEntry, ch chan<- StreamChunk) {
	modelID := c.Model.ActualModelID
	if modelID == "" {
		modelID = c.Model.ID
	}

	// Build Gemini contents
	type geminiPart struct {
		Text string `json:"text"`
	}
	type geminiContent struct {
		Role  string       `json:"role"`
		Parts []geminiPart `json:"parts"`
	}

	contents := make([]geminiContent, 0, len(history)+1)
	for _, h := range history {
		role := h.Role
		if role == "assistant" {
			role = "model"
		} else {
			role = "user"
		}
		if strings.TrimSpace(h.Content) != "" {
			contents = append(contents, geminiContent{
				Role:  role,
				Parts: []geminiPart{{Text: h.Content}},
			})
		}
	}

	if strings.TrimSpace(userInput) != "" {
		contents = append(contents, geminiContent{
			Role:  "user",
			Parts: []geminiPart{{Text: userInput}},
		})
	}

	body := map[string]any{
		"contents": contents,
		"systemInstruction": map[string]any{
			"parts": []geminiPart{{Text: SystemPrompt(mode, c.Model.SystemName)}},
		},
	}

	if c.Model.ThinkingLevel != "" {
		body["generationConfig"] = map[string]any{
			"thinkingConfig": map[string]any{
				"thinking_level": c.Model.ThinkingLevel,
			},
		}
	}

	data, err := json.Marshal(body)
	if err != nil {
		ch <- StreamChunk{Type: "error", Err: err}
		return
	}

	reqURL := fmt.Sprintf("%s/v1beta/models/%s:streamGenerateContent?alt=sse&key=%s",
		strings.TrimRight(c.Model.BaseURL, "/"),
		modelID,
		c.Model.APIKey,
	)

	req, err := http.NewRequestWithContext(ctx, "POST", reqURL, bytes.NewReader(data))
	if err != nil {
		ch <- StreamChunk{Type: "error", Err: err}
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if requestErr := formatStreamRequestError(c.Model.Name, err); requestErr != nil {
			ch <- StreamChunk{Type: "error", Err: requestErr}
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		ch <- StreamChunk{Type: "error", Err: formatAPIError("gemini", c.Model.Name, resp.StatusCode, raw)}
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 || line[0] == ':' {
			continue
		}
		if len(line) < 6 || line[:6] != "data: " {
			continue
		}
		payload := strings.TrimSpace(line[6:])

		var event struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text    string `json:"text"`
						Thought bool   `json:"thought"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}

		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}

		if event.Error != nil {
			ch <- StreamChunk{Type: "error", Err: fmt.Errorf("Gemini stream error: %s", event.Error.Message)}
			return
		}

		for _, cand := range event.Candidates {
			for _, part := range cand.Content.Parts {
				if part.Thought {
					ch <- StreamChunk{Type: "thinking", Content: part.Text}
				} else if part.Text != "" {
					ch <- StreamChunk{Type: "text", Content: part.Text}
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		if requestErr := formatStreamRequestError(c.Model.Name, err); requestErr != nil {
			ch <- StreamChunk{Type: "error", Err: requestErr}
		}
		return
	}
	ch <- StreamChunk{Type: "done"}
}
