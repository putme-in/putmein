"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";

export interface ModelItem {
  id: string;
  name: string;
  label: string;
  provider: "claude" | "openai" | "deepseek" | "gemini" | "ozias" | "openrouter";
  description: string;
  badge?: string;
}

export interface ProviderGroup {
  id: "claude" | "openai" | "deepseek" | "gemini" | "ozias" | "openrouter";
  name: string;
  displayName: string;
  subtitle: string;
  badge?: string;
  models: ModelItem[];
}

export const PROVIDER_GROUPS: ProviderGroup[] = [
  {
    id: "ozias",
    name: "Ozias",
    displayName: "Ozias Agent",
    subtitle: "Autonomous DevOps & system execution agent",
    models: [
      {
        id: "MiniMax-M3",
        name: "Ozias",
        label: "Ozias",
        provider: "ozias",
        description: "Fast, capable DevOps & system management agent",
        badge: "DEFAULT",
      },
    ],
  },
  {
    id: "claude",
    name: "Claude",
    displayName: "Anthropic Claude",
    subtitle: "Frontier reasoning & deep synthesis",
    models: [
      {
        id: "claude-5-sonnet",
        name: "Sonnet 5",
        label: "Sonnet 5",
        provider: "claude",
        description: "Breakthrough balance of intelligence and speed",
        badge: "FRONTIER",
      },
      {
        id: "claude-5-opus",
        name: "Opus 5",
        label: "Opus 5",
        provider: "claude",
        description: "Maximum capability frontier intelligence",
        badge: "FLAGSHIP",
      },
      {
        id: "claude-4-6-sonnet",
        name: "Claude 4.6 Sonnet",
        label: "Claude 4.6 Sonnet",
        provider: "claude",
        description: "Next-gen reasoning & multi-step analysis",
        badge: "NEW",
      },
      {
        id: "claude-4-6-opus",
        name: "Claude 4.6 Opus",
        label: "Claude 4.6 Opus",
        provider: "claude",
        description: "Complex reasoning and deep synthesis",
        badge: "PRO",
      },
      {
        id: "claude-4-7-opus",
        name: "Claude 4.7 Opus",
        label: "Claude 4.7 Opus",
        provider: "claude",
        description: "Frontier reasoning & architecture",
        badge: "FRONTIER",
      },
      {
        id: "claude-5-1-fable",
        name: "Fable 5.1",
        label: "Fable 5.1",
        provider: "claude",
        description: "Narrative synthesis & creative reasoning",
        badge: "CREATIVE",
      },
      {
        id: "claude-4-5-haiku",
        name: "Haiku 4.5",
        label: "Haiku 4.5",
        provider: "claude",
        description: "Ultra-fast low-latency responses",
        badge: "FAST",
      },
      {
        id: "claude-3-5-sonnet-20240620",
        name: "Claude 3.5 Sonnet",
        label: "Claude 3.5 Sonnet",
        provider: "claude",
        description: "Battle-tested reasoning model",
        badge: "STABLE",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    displayName: "OpenAI ChatGPT",
    subtitle: "Advanced foundation & reasoning models",
    models: [
      {
        id: "gpt-6",
        name: "GPT-6",
        label: "GPT-6",
        provider: "openai",
        description: "Next-generation flagship foundation model",
        badge: "FRONTIER",
      },
      {
        id: "gpt-5.6",
        name: "GPT-5.6",
        label: "GPT-5.6",
        provider: "openai",
        description: "Advanced multi-step reasoning & agentics",
        badge: "NEW",
      },
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        label: "GPT-5.5",
        provider: "openai",
        description: "High capability coding and systems analysis",
        badge: "PRO",
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        label: "GPT-5.4",
        provider: "openai",
        description: "Fast, reliable reasoning & operations",
        badge: "FAST",
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        label: "GPT-4o",
        provider: "openai",
        description: "Flagship multimodal foundation model",
        badge: "POPULAR",
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        label: "GPT-4o Mini",
        provider: "openai",
        description: "Affordable, fast intelligence for everyday tasks",
        badge: "FAST",
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    displayName: "DeepSeek AI",
    subtitle: "High efficiency code, math & multimodal",
    models: [
      {
        id: "deepseek-v4-flash-vision-exp",
        name: "DeepSeek V4 Flash Vision Exp",
        label: "DeepSeek V4 Vision Exp",
        provider: "deepseek",
        description: "Experimental multimodal fast vision model",
        badge: "VISION",
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        label: "DeepSeek V4 Pro",
        provider: "deepseek",
        description: "High-parameter code & reasoning specialist",
        badge: "PRO",
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        label: "DeepSeek V4 Flash",
        provider: "deepseek",
        description: "Ultra-low latency high-throughput model",
        badge: "FAST",
      },
    ],
  },
  {
    id: "gemini",
    name: "Gemini",
    displayName: "Google Gemini",
    subtitle: "Multimodal intelligence with thinking controls",
    models: [
      {
        id: "gemini-3.8-flash-high",
        name: "Gemini 3.8 Flash (High)",
        label: "Gemini 3.8 Flash (High)",
        provider: "gemini",
        description: "3.8 Flash with maximum reasoning budget",
        badge: "THINK HIGH",
      },
      {
        id: "gemini-3.8-flash-medium",
        name: "Gemini 3.8 Flash (Medium)",
        label: "Gemini 3.8 Flash (Med)",
        provider: "gemini",
        description: "3.8 Flash with balanced reasoning budget",
        badge: "THINK MED",
      },
      {
        id: "gemini-3.8-flash-low",
        name: "Gemini 3.8 Flash (Low)",
        label: "Gemini 3.8 Flash (Low)",
        provider: "gemini",
        description: "3.8 Flash with rapid, concise response budget",
        badge: "THINK LOW",
      },
      {
        id: "gemini-3.7-flash-high",
        name: "Gemini 3.7 Flash (High)",
        label: "Gemini 3.7 Flash (High)",
        provider: "gemini",
        description: "3.7 Flash with deep thought mode enabled",
        badge: "THINK HIGH",
      },
      {
        id: "gemini-3.7-flash-medium",
        name: "Gemini 3.7 Flash (Medium)",
        label: "Gemini 3.7 Flash (Med)",
        provider: "gemini",
        description: "3.7 Flash with standard reasoning mode",
        badge: "THINK MED",
      },
      {
        id: "gemini-3.7-flash-low",
        name: "Gemini 3.7 Flash (Low)",
        label: "Gemini 3.7 Flash (Low)",
        provider: "gemini",
        description: "3.7 Flash with rapid generation budget",
        badge: "THINK LOW",
      },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        label: "Gemini 3.1 Pro Preview",
        provider: "gemini",
        description: "Frontier multimodal reasoning pro preview",
        badge: "PRO",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    displayName: "OpenRouter",
    subtitle: "Custom model routing via OpenRouter API",
    models: [
      {
        id: "openrouter/auto",
        name: "OpenRouter (Auto)",
        label: "OpenRouter Auto",
        provider: "openrouter",
        description: "Automatically route across all top models",
        badge: "AUTO",
      },
      {
        id: "anthropic/claude-3.7-sonnet",
        name: "Claude 3.7 Sonnet",
        label: "Claude 3.7 Sonnet",
        provider: "openrouter",
        description: "Hybrid reasoning model via OpenRouter",
        badge: "POPULAR",
      },
      {
        id: "deepseek/deepseek-r1",
        name: "DeepSeek R1",
        label: "DeepSeek R1",
        provider: "openrouter",
        description: "Open-weights reasoning model via OpenRouter",
        badge: "REASONING",
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        name: "Llama 3.3 70B Instruct",
        label: "Llama 3.3 70B",
        provider: "openrouter",
        description: "Meta flagship open-weights model",
        badge: "OPEN",
      },
    ],
  },
];

// Flat export for backwards compatibility
export const MODELS: ModelItem[] = PROVIDER_GROUPS.flatMap((g) => g.models);

export const PROVIDER_LOGOS: Record<string, string> = {
  ozias: "/ai/ozias.png",
  claude: "/ai/claude.svg",
  openai: "/ai/openai.svg",
  deepseek: "/ai/deepseek.svg",
  gemini: "/ai/gemini.svg",
  openrouter: "/ai/openrouter.svg",
};

// Provider Logo Component using public/ai vector SVGs
export function ProviderLogo({
  provider,
  className = "w-4 h-4",
  size = 16,
}: {
  provider: string;
  className?: string;
  size?: number;
}) {
  const logoSrc = PROVIDER_LOGOS[provider.toLowerCase()] || "/ai/ozias.png";
  return (
    <img
      src={logoSrc}
      alt={`${provider} logo`}
      width={size}
      height={size}
      className={`rounded-md object-contain shrink-0 ${className}`}
      loading="eager"
    />
  );
}

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
}

export default function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customModelText, setCustomModelText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Find currently selected model (including dynamic custom OpenRouter models)
  const selectedModel = useMemo(() => {
    if (!value) return MODELS[0];

    const found = MODELS.find((m) => m.id === value);
    if (found) return found;

    if (
      value.startsWith("openrouter:") ||
      value.startsWith("openrouter/") ||
      value.includes("/")
    ) {
      const cleanName = value.replace(/^openrouter[:/]/, "");
      return {
        id: value,
        name: cleanName,
        label: cleanName,
        provider: "openrouter" as const,
        description: `Custom model via OpenRouter: ${cleanName}`,
        badge: "CUSTOM",
      };
    }

    const inferredProvider: ModelItem["provider"] = value.startsWith("claude-")
      ? "claude"
      : value.startsWith("gpt-") || value.startsWith("o1") || value.startsWith("o3") || value.startsWith("chatgpt")
      ? "openai"
      : value.startsWith("deepseek-")
      ? "deepseek"
      : value.startsWith("gemini-")
      ? "gemini"
      : "ozias";

    return {
      id: value,
      name: value,
      label: value,
      provider: inferredProvider,
      description: `Model: ${value}`,
      badge: "CUSTOM",
    };
  }, [value]);

  // Active provider tab inside the mega menu (default to the selected model's provider)
  const [activeProvider, setActiveProvider] = useState<string>(
    selectedModel.provider
  );
  const prevOpenRef = useRef(false);

  // Sync active provider ONLY when the modal transitions from closed to open
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setActiveProvider(selectedModel.provider);
      if (selectedModel.provider === "openrouter") {
        setCustomModelText(
          selectedModel.id.replace(/^openrouter[:/]/, "")
        );
      }
    }
    prevOpenRef.current = open;
  }, [open, selectedModel.provider, selectedModel.id]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const currentProviderGroup = useMemo(
    () =>
      PROVIDER_GROUPS.find((g) => g.id === activeProvider) ||
      PROVIDER_GROUPS[0],
    [activeProvider]
  );

  const handleCustomModelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = customModelText.trim();
    if (!trimmed) return;

    // Use trimmed model directly
    onChange(trimmed);
    setOpen(false);
  };

  return (
    <div className="relative font-sans" ref={ref}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white/90 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/15 transition-all shadow-sm cursor-pointer"
        aria-haspopup="true"
        aria-expanded={open}
        title="Select AI Model"
      >
        <ProviderLogo provider={selectedModel.provider} className="w-4 h-4" />
        <span className="font-semibold tracking-tight truncate max-w-[130px]">
          {selectedModel.name}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-white/40 transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Cascading Mega-Menu Popover */}
      {open && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute bottom-full mb-2.5 left-0 w-[540px] max-w-[calc(100vw-32px)] rounded-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150 border border-card-border bg-card shadow-2xl backdrop-blur-xl text-white font-sans"
          style={{
            boxShadow:
              "0 -20px 50px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-wider uppercase">
                Select Model
              </span>
              <span className="text-[11px] text-white/40 font-mono">
                {PROVIDER_GROUPS.length} providers & OpenRouter
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Mega-Menu Body: Two Columns */}
          <div className="flex h-[340px]">
            {/* Left Column: Providers List */}
            <div className="w-[185px] border-r border-card-border p-2 flex flex-col gap-1 bg-card overflow-y-auto">
              <div className="px-2 py-1 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                Providers
              </div>
              {PROVIDER_GROUPS.map((group) => {
                const isActive = group.id === activeProvider;
                const hasSelectedModel =
                  group.id === selectedModel.provider ||
                  group.models.some((m) => m.id === value);

                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveProvider(group.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-all duration-150 group cursor-pointer ${isActive
                      ? "bg-white/10 text-white font-semibold shadow-sm"
                      : "text-white/60 hover:text-white hover:bg-white/[0.04]"
                      }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ProviderLogo provider={group.id} className="w-4 h-4 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold truncate">
                          {group.name}
                        </span>
                        <span className="text-[10px] text-white/40">
                          {group.id === "openrouter"
                            ? "Custom any model"
                            : `${group.models.length} ${group.models.length === 1 ? "model" : "models"
                            }`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasSelectedModel && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
                      )}
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform duration-150 ${isActive
                          ? "text-white translate-x-0.5"
                          : "text-white/30 group-hover:text-white/60"
                          }`}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right Column: Models Submenu or OpenRouter Custom Input */}
            <div className="flex-1 flex flex-col p-3 overflow-y-auto bg-card">
              <div className="px-1 py-1 mb-2.5 flex items-center justify-between border-b border-white/[0.05] pb-2">
                <div className="flex items-center gap-2">
                  <ProviderLogo provider={currentProviderGroup.id} className="w-4 h-4" />
                  <span className="text-xs font-bold text-white tracking-tight">
                    {currentProviderGroup.displayName}
                  </span>
                </div>
                <span className="text-[11px] text-white/40 font-mono truncate max-w-[180px]">
                  {currentProviderGroup.subtitle}
                </span>
              </div>

              {/* Special interactive view for OpenRouter */}
              {currentProviderGroup.id === "openrouter" ? (
                <div className="flex flex-col gap-3">
                  {/* Custom Model Text Field */}
                  <form onSubmit={handleCustomModelSubmit} className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-white/70">
                      Enter any model name:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customModelText}
                        onChange={(e) => setCustomModelText(e.target.value)}
                        placeholder="e.g. anthropic/claude-3.7-sonnet"
                        className="flex-1 px-3 py-2 rounded-xl text-xs font-mono bg-[#141414] border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={!customModelText.trim()}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-white/90 active:scale-95 transition-all disabled:opacity-40 shrink-0 cursor-pointer"
                      >
                        Use Model
                      </button>
                    </div>
                    <span className="text-[10px] text-white/40">
                      Supports any OpenRouter model string (e.g. <code className="text-white/60 font-mono">provider/model-id</code>).
                    </span>
                  </form>

                  {/* Quick Select Popular Suggestions */}
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-white/[0.04]">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
                      Popular OpenRouter Models
                    </span>
                    <div className="flex flex-col gap-1 overflow-y-auto max-h-[145px] pr-1">
                      {currentProviderGroup.models.map((model) => {
                        const isSelected = value === model.id;
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onChange(model.id);
                              setOpen(false);
                            }}
                            className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all duration-150 group cursor-pointer ${isSelected
                              ? "bg-white/10 border border-white/15"
                              : "hover:bg-white/[0.04] border border-transparent"
                              }`}
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="text-xs font-medium text-white/80 group-hover:text-white truncate">
                                {model.name}
                              </span>
                              <span className="text-[10px] text-white/40 font-mono truncate">
                                {model.id}
                              </span>
                            </div>
                            {isSelected && (
                              <div className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center shrink-0">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                /* Standard Provider Models List */
                <div className="flex flex-col gap-1 overflow-y-auto pr-1">
                  {currentProviderGroup.models.map((model) => {
                    const isSelected = model.id === value;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange(model.id);
                          setOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all duration-150 group cursor-pointer ${isSelected
                          ? "bg-white/10 border border-white/15 shadow-sm"
                          : "hover:bg-white/[0.04] border border-transparent"
                          }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-semibold tracking-tight truncate ${isSelected
                                ? "text-white"
                                : "text-white/80 group-hover:text-white"
                                }`}
                            >
                              {model.name}
                            </span>
                            {model.badge && (
                              <span
                                className={`text-[9.5px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded-md tracking-wider ${model.badge === "FRONTIER" || model.badge === "FLAGSHIP"
                                  ? "text-amber-300 bg-amber-500/10 border border-amber-500/20"
                                  : model.badge.startsWith("THINK")
                                    ? "text-purple-300 bg-purple-500/10 border border-purple-500/20"
                                    : model.badge === "PRO"
                                      ? "text-blue-300 bg-blue-500/10 border border-blue-500/20"
                                      : model.badge === "NEW"
                                        ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20"
                                        : "text-white/50 bg-white/[0.06] border border-white/10"
                                  }`}
                              >
                                {model.badge}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-white/45 group-hover:text-white/60 line-clamp-1">
                            {model.description}
                          </span>
                        </div>

                        {/* Selection Checkmark */}
                        <div className="shrink-0 pl-1">
                          {isSelected ? (
                            <div className="w-5 h-5 rounded-full bg-white text-black flex items-center justify-center shadow-sm">
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full border border-white/10 group-hover:border-white/20 transition-colors" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer Bar with Settings Shortcut */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/[0.06] bg-[#070707] text-[11px] text-white/40">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Single API key per provider
            </span>
            <Link
              href="/settings?tab=keys"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 text-white/60 hover:text-white transition-colors font-medium"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Manage API Keys in Settings</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
