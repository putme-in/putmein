package ai

import (
	"os"
	"strings"
	"sync"
)

// ModelConfig holds all configuration for a single AI model.
type ModelConfig struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	SystemName    string `json:"systemName"`
	Provider      string `json:"provider"`      // "anthropic", "openai", "gemini"
	BaseURL       string `json:"baseURL"`
	APIKey        string `json:"-"`             // never serialise the key
	ActualModelID string `json:"actualModelId"` // actual model id sent to API
	ThinkingLevel string `json:"thinkingLevel,omitempty"`
	Badge         string `json:"badge,omitempty"`
	Description   string `json:"description,omitempty"`
}

var (
	keysMu      sync.RWMutex
	runtimeKeys = make(map[string]string)
)

// SetRuntimeAPIKey sets an in-memory override for a provider key
// provider: "minimax", "claude" (or "anthropic"), "openai", "deepseek", "gemini"
func SetRuntimeAPIKey(provider, key string) {
	keysMu.Lock()
	defer keysMu.Unlock()
	runtimeKeys[provider] = key
}

// GetProviderKey returns the resolved key for a provider (runtime override > env var).
func GetProviderKey(provider string) string {
	keysMu.RLock()
	if val, ok := runtimeKeys[provider]; ok && val != "" {
		keysMu.RUnlock()
		return val
	}
	keysMu.RUnlock()

	switch provider {
	case "ozias", "minimax":
		k := os.Getenv("OZIAS_API_KEY")
		if k == "" {
			k = os.Getenv("MINIMAX_API_KEY")
		}
		return k
	case "claude", "anthropic":
		k := os.Getenv("CLAUDE_API_KEY")
		if k == "" {
			k = os.Getenv("ANTHROPIC_API_KEY")
		}
		return k
	case "openai":
		return os.Getenv("OPENAI_API_KEY")
	case "deepseek":
		return os.Getenv("DEEPSEEK_API_KEY")
	case "gemini":
		k := os.Getenv("GEMINI_API_KEY")
		if k == "" {
			k = os.Getenv("GOOGLE_API_KEY")
		}
		return k
	case "openrouter":
		return os.Getenv("OPENROUTER_API_KEY")
	default:
		return ""
	}
}

// GetModels returns the canonical list of available models.
// This is the single source of truth for both cohen and ray.
func GetModels() []ModelConfig {
	minimaxBaseURL := os.Getenv("MINIMAX_BASE_URL")
	if minimaxBaseURL == "" {
		minimaxBaseURL = "https://api.minimax.io/anthropic"
	}

	claudeBaseURL := os.Getenv("CLAUDE_BASE_URL")
	if claudeBaseURL == "" {
		claudeBaseURL = "https://api.anthropic.com"
	}

	openaiBaseURL := os.Getenv("OPENAI_BASE_URL")
	if openaiBaseURL == "" {
		openaiBaseURL = "https://api.openai.com/v1"
	}

	deepseekBaseURL := os.Getenv("DEEPSEEK_BASE_URL")
	if deepseekBaseURL == "" {
		deepseekBaseURL = "https://api.deepseek.com"
	}

	geminiBaseURL := os.Getenv("GEMINI_BASE_URL")
	if geminiBaseURL == "" {
		geminiBaseURL = "https://generativelanguage.googleapis.com"
	}

	openrouterBaseURL := os.Getenv("OPENROUTER_BASE_URL")
	if openrouterBaseURL == "" {
		openrouterBaseURL = "https://openrouter.ai/api/v1"
	}

	minimaxKey := GetProviderKey("ozias")
	claudeKey := GetProviderKey("claude")
	openaiKey := GetProviderKey("openai")
	deepseekKey := GetProviderKey("deepseek")
	geminiKey := GetProviderKey("gemini")
	openrouterKey := GetProviderKey("openrouter")

	return []ModelConfig{
		// ── Ozias (Default) ───────────────────────────────────
		{
			ID:            "MiniMax-M2.5",
			Name:          "Ozias",
			SystemName:    "Ozias",
			Provider:      "anthropic",
			BaseURL:       minimaxBaseURL,
			APIKey:        minimaxKey,
			ActualModelID: "MiniMax-M2.5",
			Badge:         "DEFAULT",
			Description:   "Fast & capable DevOps agent",
		},

		// ── Claude (Anthropic) ────────────────────────────────
		{
			ID:            "claude-4-6-sonnet",
			Name:          "Claude 4.6 Sonnet",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-4-6-sonnet",
			Badge:         "NEW",
			Description:   "Next-generation reasoning & analysis",
		},
		{
			ID:            "claude-4-6-opus",
			Name:          "Claude 4.6 Opus",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-4-6-opus",
			Badge:         "PRO",
			Description:   "Complex reasoning and deep synthesis",
		},
		{
			ID:            "claude-4-7-opus",
			Name:          "Claude 4.7 Opus",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-4-7-opus",
			Badge:         "FRONTIER",
			Description:   "Frontier reasoning & architecture",
		},
		{
			ID:            "claude-5-sonnet",
			Name:          "Sonnet 5",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-5-sonnet",
			Badge:         "FRONTIER",
			Description:   "Breakthrough speed and intelligence",
		},
		{
			ID:            "claude-5-opus",
			Name:          "Opus 5",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-5-opus",
			Badge:         "FLAGSHIP",
			Description:   "Maximum capability frontier model",
		},
		{
			ID:            "claude-5-1-fable",
			Name:          "Fable 5.1",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-5-1-fable",
			Badge:         "CREATIVE",
			Description:   "Narrative synthesis & creative reasoning",
		},
		{
			ID:            "claude-4-5-haiku",
			Name:          "Haiku 4.5",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-4-5-haiku",
			Badge:         "FAST",
			Description:   "Ultra-fast low-latency responses",
		},
		{
			ID:            "claude-3-5-sonnet-20240620",
			Name:          "Claude 3.5 Sonnet",
			SystemName:    "Claude",
			Provider:      "anthropic",
			BaseURL:       claudeBaseURL,
			APIKey:        claudeKey,
			ActualModelID: "claude-3-5-sonnet-20240620",
			Badge:         "STABLE",
			Description:   "Battle-tested reasoning model",
		},

		// ── OpenAI (ChatGPT) ──────────────────────────────────
		{
			ID:            "gpt-6",
			Name:          "GPT-6",
			SystemName:    "GPT-6",
			Provider:      "openai",
			BaseURL:       openaiBaseURL,
			APIKey:        openaiKey,
			ActualModelID: "gpt-6",
			Badge:         "FRONTIER",
			Description:   "Next-generation flagship foundation model",
		},
		{
			ID:            "gpt-5.6",
			Name:          "GPT-5.6",
			SystemName:    "GPT-5.6",
			Provider:      "openai",
			BaseURL:       openaiBaseURL,
			APIKey:        openaiKey,
			ActualModelID: "gpt-5.6",
			Badge:         "NEW",
			Description:   "Advanced multi-step reasoning & agentics",
		},
		{
			ID:            "gpt-5.5",
			Name:          "GPT-5.5",
			SystemName:    "GPT-5.5",
			Provider:      "openai",
			BaseURL:       openaiBaseURL,
			APIKey:        openaiKey,
			ActualModelID: "gpt-5.5",
			Badge:         "PRO",
			Description:   "High capability coding and systems analysis",
		},
		{
			ID:            "gpt-5.4",
			Name:          "GPT-5.4",
			SystemName:    "GPT-5.4",
			Provider:      "openai",
			BaseURL:       openaiBaseURL,
			APIKey:        openaiKey,
			ActualModelID: "gpt-5.4",
			Badge:         "FAST",
			Description:   "Fast, reliable reasoning & operations",
		},

		// ── DeepSeek ──────────────────────────────────────────
		{
			ID:            "deepseek-v4-flash-vision-exp",
			Name:          "DeepSeek V4 Flash Vision Exp",
			SystemName:    "DeepSeek",
			Provider:      "openai",
			BaseURL:       deepseekBaseURL,
			APIKey:        deepseekKey,
			ActualModelID: "deepseek-v4-flash-vision-exp",
			Badge:         "VISION",
			Description:   "Experimental multimodal fast vision model",
		},
		{
			ID:            "deepseek-v4-pro",
			Name:          "DeepSeek V4 Pro",
			SystemName:    "DeepSeek",
			Provider:      "openai",
			BaseURL:       deepseekBaseURL,
			APIKey:        deepseekKey,
			ActualModelID: "deepseek-v4-pro",
			Badge:         "PRO",
			Description:   "High-parameter code & reasoning specialist",
		},
		{
			ID:            "deepseek-v4-flash",
			Name:          "DeepSeek V4 Flash",
			SystemName:    "DeepSeek",
			Provider:      "openai",
			BaseURL:       deepseekBaseURL,
			APIKey:        deepseekKey,
			ActualModelID: "deepseek-v4-flash",
			Badge:         "FAST",
			Description:   "Ultra-low latency high-throughput model",
		},

		// ── Google Gemini ─────────────────────────────────────
		{
			ID:            "gemini-3.8-flash-high",
			Name:          "Gemini 3.8 Flash (High)",
			SystemName:    "Gemini",
			Provider:      "gemini",
			BaseURL:       geminiBaseURL,
			APIKey:        geminiKey,
			ActualModelID: "gemini-3.8-flash",
			ThinkingLevel: "HIGH",
			Badge:         "THINK HIGH",
			Description:   "3.8 Flash with maximum reasoning budget",
		},
		{
			ID:            "gemini-3.8-flash-medium",
			Name:          "Gemini 3.8 Flash (Medium)",
			SystemName:    "Gemini",
			Provider:      "gemini",
			BaseURL:       geminiBaseURL,
			APIKey:        geminiKey,
			ActualModelID: "gemini-3.8-flash",
			ThinkingLevel: "MEDIUM",
			Badge:         "THINK MED",
			Description:   "3.8 Flash with balanced reasoning budget",
		},
		{
			ID:            "gemini-3.8-flash-low",
			Name:          "Gemini 3.8 Flash (Low)",
			SystemName:    "Gemini",
			Provider:      "gemini",
			BaseURL:       geminiBaseURL,
			APIKey:        geminiKey,
			ActualModelID: "gemini-3.8-flash",
			ThinkingLevel: "LOW",
			Badge:         "THINK LOW",
			Description:   "3.8 Flash with fast, concise response budget",
		},
		{
			ID:            "gemini-3.7-flash-high",
			Name:          "Gemini 3.7 Flash (High)",
			SystemName:    "Gemini",
			Provider:      "gemini",
			BaseURL:       geminiBaseURL,
			APIKey:        geminiKey,
			ActualModelID: "gemini-3.7-flash",
			ThinkingLevel: "HIGH",
			Badge:         "THINK HIGH",
			Description:   "3.7 Flash with deep thought mode enabled",
		},
		{
			ID:            "gemini-3.7-flash-medium",
			Name:          "Gemini 3.7 Flash (Medium)",
			SystemName:    "Gemini",
			Provider:      "gemini",
			BaseURL:       geminiBaseURL,
			APIKey:        geminiKey,
			ActualModelID: "gemini-3.7-flash",
			ThinkingLevel: "MEDIUM",
			Badge:         "THINK MED",
			Description:   "3.7 Flash with standard reasoning mode",
		},
		{
			ID:            "gemini-3.7-flash-low",
			Name:          "Gemini 3.7 Flash (Low)",
			SystemName:    "Gemini",
			Provider:      "gemini",
			BaseURL:       geminiBaseURL,
			APIKey:        geminiKey,
			ActualModelID: "gemini-3.7-flash",
			ThinkingLevel: "LOW",
			Badge:         "THINK LOW",
			Description:   "3.7 Flash with rapid generation budget",
		},
		{
			ID:            "gemini-3.1-pro-preview",
			Name:          "Gemini 3.1 Pro Preview",
			SystemName:    "Gemini",
			Provider:      "gemini",
			BaseURL:       geminiBaseURL,
			APIKey:        geminiKey,
			ActualModelID: "gemini-3.1-pro-preview",
			ThinkingLevel: "HIGH",
			Badge:         "PRO",
			Description:   "Frontier multimodal reasoning pro preview",
		},

		// ── OpenRouter ────────────────────────────────────────
		{
			ID:            "openrouter/auto",
			Name:          "OpenRouter (Auto)",
			SystemName:    "Assistant",
			Provider:      "openrouter",
			BaseURL:       openrouterBaseURL,
			APIKey:        openrouterKey,
			ActualModelID: "openrouter/auto",
			Badge:         "ROUTER",
			Description:   "Intelligent routing to best model via OpenRouter",
		},
	}
}

// GetFirstConfiguredModel returns the first model with an active API key, or the default model.
func GetFirstConfiguredModel() ModelConfig {
	for _, m := range GetModels() {
		if strings.TrimSpace(m.APIKey) != "" {
			return m
		}
	}
	return GetModels()[0]
}

// GetModelByID returns the model config for the given ID, or the first configured model if id is empty.
func GetModelByID(id string) ModelConfig {
	if strings.TrimSpace(id) == "" {
		return GetFirstConfiguredModel()
	}

	for _, m := range GetModels() {
		if m.ID == id {
			return m
		}
	}

	// Handle dynamic OpenRouter model IDs (e.g. "openrouter:anthropic/claude-3.7-sonnet", "openrouter/meta-llama/llama-3.3-70b-instruct", or any custom model containing a "/")
	if strings.HasPrefix(id, "openrouter:") || strings.HasPrefix(id, "openrouter/") || strings.Contains(id, "/") {
		customModel := id
		if strings.HasPrefix(customModel, "openrouter:") {
			customModel = strings.TrimPrefix(customModel, "openrouter:")
		} else if strings.HasPrefix(customModel, "openrouter/") {
			customModel = strings.TrimPrefix(customModel, "openrouter/")
		}

		openrouterBaseURL := os.Getenv("OPENROUTER_BASE_URL")
		if openrouterBaseURL == "" {
			openrouterBaseURL = "https://openrouter.ai/api/v1"
		}

		return ModelConfig{
			ID:            id,
			Name:          customModel,
			SystemName:    "Assistant",
			Provider:      "openrouter",
			BaseURL:       openrouterBaseURL,
			APIKey:        GetProviderKey("openrouter"),
			ActualModelID: customModel,
			Badge:         "CUSTOM",
			Description:   "Custom model via OpenRouter: " + customModel,
		}
	}

	return GetFirstConfiguredModel()
}
