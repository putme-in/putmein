"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { parsePlanChecklist } from "@/lib/plan-checklist";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import ChatDeploymentSetup from "./ChatDeploymentSetup";
import ModelSelector, { MODELS } from "./ModelSelector";
import { Icon } from "@iconify/react";
import { StateSpinner } from "./StateSpinner";
import { parseChatErrorLine } from "@/lib/chat-stream.mjs";

/* ── Tool Block & Thinking Accordion ────────────── */
export interface ToolBlock {
  id: string;
  tool?: string;
  cmd?: string;
  status: "running" | "completed" | "error";
  output: string;
  startTime: number;
  durationSec?: number;
  exit?: number;
}

function isErrorContent(content?: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return (
    content.startsWith("Error:") ||
    content.startsWith("API Key Error:") ||
    content.startsWith("Server error") ||
    content.startsWith("Connection error") ||
    content.startsWith("Connection failed") ||
    lower.includes("api key not configured") ||
    lower.includes("invalid api key") ||
    lower.includes("no response received from the model")
  );
}

function isApiKeyError(content?: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return (
    lower.includes("api key") ||
    lower.includes("not configured") ||
    lower.includes("authentication failed")
  );
}

function getProviderFromModelId(id: string): string {
  const model = MODELS.find((m) => m.id === id);
  if (model?.provider) return model.provider;
  if (id.startsWith("claude-")) return "claude";
  if (id.startsWith("gpt-") || id.startsWith("o3") || id.startsWith("chatgpt")) return "openai";
  if (id.startsWith("deepseek-")) return "deepseek";
  if (id.startsWith("gemini-")) return "gemini";
  if (id.startsWith("openrouter/")) return "openrouter";
  return "ozias";
}

function isProviderKeyConfigured(provider: string, apiKeys: Record<string, boolean> | null): boolean {
  if (!apiKeys) return true; // not loaded yet, avoid false alerts
  if (provider === "ozias" || provider === "minimax") {
    return Boolean(apiKeys.ozias || apiKeys.minimax);
  }
  return Boolean(apiKeys[provider]);
}

function getProviderDisplayName(provider: string): string {
  switch (provider) {
    case "ozias":
    case "minimax":
      return "Ozias";
    case "claude":
      return "Anthropic Claude";
    case "openai":
      return "OpenAI";
    case "deepseek":
      return "DeepSeek";
    case "gemini":
      return "Google Gemini";
    case "openrouter":
      return "OpenRouter";
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool"; block: ToolBlock };

export type RenderSegment =
  | { type: "text"; text: string }
  | { type: "tool_group"; blocks: ToolBlock[] };

export function groupConsecutiveParts(parts: MessagePart[]): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let currentGroup: ToolBlock[] = [];

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      segments.push({ type: "tool_group", blocks: [...currentGroup] });
      currentGroup = [];
    }
  };

  for (const part of parts) {
    if (part.type === "tool") {
      currentGroup.push(part.block);
    } else if (part.type === "text") {
      flushGroup();
      if (part.text) {
        segments.push({ type: "text", text: part.text });
      }
    }
  }
  flushGroup();
  return segments;
}

export function TopProcessAccordion({
  blocks,
  thinking,
  isStreaming,
}: {
  blocks: ToolBlock[];
  thinking?: string;
  isStreaming?: boolean;
}) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [copiedThinking, setCopiedThinking] = useState(false);
  const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);

  // If any block is running or stream is actively producing thinking
  const isAnyRunning =
    blocks.some((b) => b.status === "running") ||
    (isStreaming && !blocks.length && !!thinking);
  const isAnyError = blocks.some(
    (b) => b.status === "error" || (b.exit !== undefined && b.exit !== 0)
  );

  // Auto-expand during streaming or tool execution so thoughts and terminal progress are visible live
  const isOpen = userToggled !== null ? userToggled : Boolean(isStreaming || isAnyRunning);

  // Calculate live total elapsed
  const [totalElapsed, setTotalElapsed] = useState<number>(0);

  useEffect(() => {
    const calc = () => {
      let sum = 0;
      for (const b of blocks) {
        if (b.durationSec !== undefined) {
          sum += Math.max(0.1, b.durationSec);
        } else if (b.status === "running") {
          sum += Math.max(0.1, (Date.now() - b.startTime) / 1000);
        } else {
          sum += 0.1;
        }
      }
      return Number(sum.toFixed(1));
    };

    setTotalElapsed(calc());
    if (!isAnyRunning) return;
    const timer = setInterval(() => {
      setTotalElapsed(calc());
    }, 100);
    return () => clearInterval(timer);
  }, [blocks, isAnyRunning]);

  const hasBlocks = blocks.length > 0;
  const hasThinking = Boolean(thinking && thinking.trim().length > 0);

  if (!hasBlocks && !hasThinking) return null;

  const count = blocks.length;
  const firstCmd = blocks[0]?.cmd || blocks[0]?.tool || "exec";

  // Summary title
  let titleText = "";
  if (isAnyRunning) {
    if (hasBlocks) {
      titleText = count === 1 ? `Executing $ ${firstCmd}` : `Executing ${count} commands…`;
    } else {
      titleText = "Thinking & Reasoning…";
    }
  } else {
    if (hasBlocks && hasThinking) {
      titleText = `Thought Process & ${count} ${count === 1 ? "Command" : "Commands"}`;
    } else if (hasBlocks) {
      titleText = count === 1 ? `Executed $ ${firstCmd}` : `Executed ${count} Commands`;
    } else {
      titleText = "Thought Process";
    }
  }

  const handleCopyThinking = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!thinking) return;
    navigator.clipboard.writeText(thinking);
    setCopiedThinking(true);
    setTimeout(() => setCopiedThinking(false), 2000);
  };

  const handleCopyBlockOutput = (e: React.MouseEvent, block: ToolBlock) => {
    e.stopPropagation();
    const contentToCopy = block.output || block.cmd || "";
    if (!contentToCopy) return;
    navigator.clipboard.writeText(contentToCopy);
    setCopiedBlockId(block.id);
    setTimeout(() => setCopiedBlockId(null), 2000);
  };

  return (
    <div className="mb-3.5 rounded-xl border border-white/[0.08] bg-[#0c0c0c] overflow-hidden transition-all duration-200 shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
      <button
        type="button"
        onClick={() => setUserToggled(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] cursor-pointer group"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-3">
          {/* Main Process Icon */}
          <div className="w-6 h-6 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center flex-shrink-0 text-white/80 shadow-xs group-hover:border-white/20 transition-colors">
            {hasThinking && !hasBlocks ? (
              <Icon
                icon="lucide:brain-circuit"
                className="w-3.5 h-3.5 text-white/90"
              />
            ) : hasBlocks && !hasThinking ? (
              <Icon
                icon="lucide:terminal"
                className="w-3.5 h-3.5 text-white/90"
              />
            ) : (
              <Icon
                icon="lucide:sparkles"
                className="w-3.5 h-3.5 text-white/90"
              />
            )}
          </div>

          <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap sm:flex-nowrap">
            <span className="font-sans text-xs font-semibold text-white/90 truncate flex-1 tracking-tight">
              {titleText}
            </span>

            <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
              {totalElapsed > 0 && (
                <span className="text-[10.5px] font-mono text-white/50 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] flex-shrink-0">
                  {totalElapsed.toFixed(1)}s
                </span>
              )}
              {isAnyRunning && (
                <StateSpinner
                  color={hasBlocks ? "emerald" : hasThinking ? "purple" : "white"}
                  size="xs"
                />
              )}
              {isAnyError && !isAnyRunning && (
                <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-white/40 text-xs flex-shrink-0">
          <span className="text-[11px] text-white/40 group-hover:text-white/70 hidden sm:inline font-sans font-medium transition-colors">
            {isOpen
              ? hasThinking && !hasBlocks
                ? "Hide thoughts"
                : "Hide process"
              : hasThinking && !hasBlocks
              ? "View thoughts"
              : "View process"}
          </span>
          <Icon
            icon="lucide:chevron-down"
            className={`w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {isOpen && (
        <div className="px-3.5 pb-3.5 pt-2 border-t border-white/[0.06] bg-[#070707] select-text flex flex-col gap-3">
          {/* Thinking process section */}
          {hasThinking && (
            <div className="rounded-xl bg-[#0e0e0e] border border-white/[0.06] p-3.5 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-white/[0.04]">
                <div className="flex items-center gap-2 font-mono text-[10.5px] text-white/60">
                  <Icon icon="lucide:sparkles" className="w-3.5 h-3.5 text-white/70" />
                  <span className="font-semibold tracking-wider text-white/70 uppercase">
                    Reasoning Process
                  </span>
                  {thinking && (
                    <>
                      <span className="text-white/20">•</span>
                      <span className="text-white/40">
                        {thinking.trim().split(/\s+/).length} words
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleCopyThinking}
                  className="ray-btn-ghost text-[10.5px] px-2.5 py-0.5 h-6 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Icon
                    icon={copiedThinking ? "lucide:check" : "lucide:copy"}
                    className={`w-3 h-3 ${copiedThinking ? "text-emerald-400" : "text-white/60"}`}
                  />
                  <span>{copiedThinking ? "Copied" : "Copy Thoughts"}</span>
                </button>
              </div>

              <div className="pl-3.5 border-l-2 border-white/20 bg-white/[0.015] rounded-r-lg py-1.5 pr-2">
                <div className="text-xs text-white/75 leading-relaxed font-sans whitespace-pre-wrap select-text">
                  {thinking}
                </div>
              </div>
            </div>
          )}

          {/* Executed command blocks */}
          {blocks.map((block, bIdx) => {
            const isBlockRunning = block.status === "running";
            const isBlockError =
              block.status === "error" || (block.exit !== undefined && block.exit !== 0);
            const cmdText = block.cmd || block.tool || "exec";
            const dur =
              block.durationSec !== undefined
                ? `${block.durationSec.toFixed(1)}s`
                : isBlockRunning
                ? "running..."
                : "";
            const isCopied = copiedBlockId === block.id;

            return (
              <div
                key={block.id || `block-${bIdx}`}
                className="rounded-xl bg-[#090909] border border-white/[0.08] overflow-hidden shadow-xs"
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#0d0d0d] border-b border-white/[0.04]">
                  <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                    <Icon icon="lucide:terminal" className="w-3.5 h-3.5 text-white/50 shrink-0" />
                    <span className="text-white/30 select-none font-mono text-xs">$</span>
                    <span className="font-mono text-xs font-semibold text-white/90 truncate">
                      {cmdText}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {dur && (
                      <span className="text-white/40 font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.05]">
                        {dur}
                      </span>
                    )}

                    {isBlockRunning && (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                        <StateSpinner color="emerald" size="xs" />
                        Running
                      </span>
                    )}

                    {isBlockError && !isBlockRunning && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        Exit {block.exit ?? 1}
                      </span>
                    )}

                    {!isBlockRunning && !isBlockError && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/15 px-1.5 py-0.5 rounded">
                        Exit 0
                      </span>
                    )}

                    {block.output && (
                      <button
                        type="button"
                        onClick={(e) => handleCopyBlockOutput(e, block)}
                        className="ray-btn-ghost text-[10px] px-2 py-0.5 h-5 rounded inline-flex items-center gap-1 cursor-pointer"
                        title="Copy command output"
                      >
                        <Icon
                          icon={isCopied ? "lucide:check" : "lucide:copy"}
                          className={`w-2.5 h-2.5 ${isCopied ? "text-emerald-400" : "text-white/50"}`}
                        />
                        <span>{isCopied ? "Copied" : "Copy"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {block.output ? (
                  <pre className="font-mono text-[11px] text-white/80 bg-[#040404] p-3 overflow-x-auto max-h-56 leading-relaxed m-0 whitespace-pre-wrap select-text">
                    {block.output}
                  </pre>
                ) : isBlockRunning ? (
                  <div className="p-3 bg-[#040404] flex items-center gap-2 text-[11px] text-emerald-400/90 font-mono">
                    <StateSpinner color="emerald" size="xs" />
                    <span>Running command in terminal…</span>
                  </div>
                ) : (
                  <div className="p-2.5 bg-[#040404] text-[11px] text-white/30 italic font-mono">
                    (No output)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// GroupedToolAccordion compatibility alias
export const GroupedToolAccordion = ({ blocks }: { blocks: ToolBlock[] }) => (
  <TopProcessAccordion blocks={blocks} />
);

export interface PlanChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface ExtractedPlan {
  title: string;
  items: PlanChecklistItem[];
  rawText: string;
}

export function extractCleanAssistantContent(content: string): {
  cleanText: string;
  extractedThinking?: string;
  parsedBlocks: ToolBlock[];
  extractedPlan?: ExtractedPlan;
} {
  if (!content) return { cleanText: "", parsedBlocks: [] };

  let text = content;
  let extractedThinking = "";
  const parsedBlocks: ToolBlock[] = [];

  // 0. Extract rayAssistantMeta header if present
  const metaMatch = text.match(/^<!-- rayAssistantMeta:(.*?) -->\n?/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      if (meta.thinking && typeof meta.thinking === "string") {
        extractedThinking = meta.thinking;
      }
      if (Array.isArray(meta.toolBlocks)) {
        parsedBlocks.push(...meta.toolBlocks);
      }
      text = text.replace(/^<!-- rayAssistantMeta:(.*?) -->\n?/, "");
    } catch { /* ignore invalid json */ }
  }

  // 1. Extract <think>...</think>
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  let thinkMatch: RegExpExecArray | null;
  while ((thinkMatch = thinkRegex.exec(content)) !== null) {
    if (thinkMatch[1]) {
      extractedThinking += (extractedThinking ? "\n\n" : "") + thinkMatch[1].trim();
    }
  }
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Handle unclosed <think> during streaming
  text = text.replace(/<think>[\s\S]*$/gi, "");

  text = text.replace(/<deployment_settings>[\s\S]*?<\/deployment_settings>/gi, "");
  text = text.replace(/<deployment_settings>[\s\S]*$/gi, "");

  // 1.5. Extract <plan...>...</plan>
  let extractedPlan: ExtractedPlan | undefined = undefined;
  const planMatch = text.match(/<plan(?:\s+title=["']([^"']*)["'])?>([\s\S]*?)<\/plan>/i) || text.match(/<plan(?:\s+title=["']([^"']*)["'])?>([\s\S]*)$/i);
  if (planMatch) {
    const title = planMatch[1] || "Execution Plan";
    const body = (planMatch[2] || "").trim();
    const items: PlanChecklistItem[] = parsePlanChecklist(body);
    extractedPlan = {
      title,
      items,
      rawText: body,
    };
    // Strip <plan> from text so it doesn't render raw XML
    text = text.replace(/<plan(?:\s+title=["']([^"']*)["'])?>[\s\S]*?<\/plan>/gi, "");
    text = text.replace(/<plan(?:\s+title=["']([^"']*)["'])?>[\s\S]*$/gi, "");
  }

  // 2. Extract tool blocks if any exist in text
  const tagRegex = /<(exec|deploy|monitor_add|write_file|read_file|delete_file|create_dir)([^>]*)>([\s\S]*?)<\/\1>|<(deploy|monitor_add)([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const tagName = match[1] || match[4];
    const tagAttrs = match[2] || match[5] || "";
    const tagBody = match[3] || "";

    let cmd = tagName;
    if (tagName === "exec") {
      cmd = tagBody.trim() || tagAttrs.trim() || "exec";
    } else {
      const nameMatch = tagAttrs.match(/name=["']([^"']+)["']/i);
      const pathMatch = tagAttrs.match(/path=["']([^"']+)["']/i);
      if (nameMatch && pathMatch) {
        cmd = `${tagName} ${nameMatch[1]} ${pathMatch[1]}`;
      } else if (nameMatch) {
        cmd = `${tagName} ${nameMatch[1]}`;
      } else {
        cmd = `${tagName} ${tagAttrs.trim()}`;
      }
    }

    parsedBlocks.push({
      id: `parsed-${parsedBlocks.length}-${Math.random()}`,
      tool: tagName,
      cmd,
      status: "completed",
      output: tagBody.trim(),
      startTime: Date.now(),
      durationSec: 0.2,
      exit: 0,
    });
  }

  // Remove complete tool tags from text
  text = text.replace(/<(exec|deploy|monitor_add|write_file|read_file|delete_file|create_dir)([^>]*)>([\s\S]*?)<\/\1>/gi, "");
  text = text.replace(/<(deploy|monitor_add)([^>]*)\/?>/gi, "");

  // 3. Remove unclosed tags or stray leaked XML tags
  text = text.replace(/<\/(write_file|read_file|delete_file|create_dir|exec|deploy|monitor_add|think|plan)>/gi, "");
  text = text.replace(/<(write_file|read_file|delete_file|create_dir|exec|deploy|monitor_add|plan)[^>]*>/gi, "");

  return {
    cleanText: text.trim(),
    extractedThinking: extractedThinking || undefined,
    parsedBlocks,
    extractedPlan,
  };
}

export function PlanCard({
  plan,
  isStreaming,
  onProceed,
  hasProceeded = false,
}: {
  plan: ExtractedPlan;
  isStreaming?: boolean;
  onProceed: () => void;
  hasProceeded?: boolean;
}) {
  const [checklist, setChecklist] = useState<PlanChecklistItem[]>(plan.items);
  const [proceeded, setProceeded] = useState(hasProceeded);

  useEffect(() => {
    setChecklist(parsePlanChecklist(plan.rawText));
  }, [plan.rawText]);

  useEffect(() => {
    if (hasProceeded) {
      setProceeded(true);
    }
  }, [hasProceeded]);

  const toggleItem = (idx: number) => {
    setChecklist((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, completed: !it.completed } : it))
    );
  };

  const isDone = Boolean(proceeded || hasProceeded);

  const handleProceedClick = () => {
    if (isDone) return;
    setProceeded(true);
    onProceed();
    window.dispatchEvent(
      new CustomEvent("ray:proceed-plan", {
        detail: { title: plan.title },
      })
    );
  };

  return (
    <div className="w-full my-3.5 rounded-2xl overflow-hidden animate-fade-in border border-white/[0.08] bg-[#0c0c0c] shadow-2xl">
      {/* Header */}
      <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center text-white flex-shrink-0">
            <Icon icon="lucide:clipboard-check" width={14} height={14} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate font-sans flex items-center gap-2">
              <span>{plan.title || "Execution Plan"}</span>
              {isDone && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Approved
                </span>
              )}
            </div>
            <div className="text-[10.5px] text-white/40 font-mono mt-0.5">
              {isDone ? "Plan approved • Executing commands in Tool Window" : "Plan Mode • Review checklist before execution"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("ray:plan-updated", {
                  detail: {
                    title: plan.title,
                    content: plan.rawText,
                    checklist: checklist.map((c) => c.text),
                    status: isDone ? "in_progress" : "pending",
                  },
                })
              );
              window.dispatchEvent(new Event("ray:open-terminal"));
            }}
            title="Open in Tool Window tab"
            className="ray-btn-ghost text-[11px] font-mono px-2.5 py-1 flex items-center gap-1.5 cursor-pointer"
          >
            <span>Plan Tab</span>
            <Icon icon="lucide:external-link" width={11} height={11} />
          </button>
        </div>
      </div>

      {/* Checklist items */}
      <div className="p-4 space-y-2">
        {checklist.length > 0 ? (
          checklist.map((item, idx) => (
            <div
              key={item.id || idx}
              onClick={() => toggleItem(idx)}
              className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#080808] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer group select-none"
            >
              <div
                className={`w-4 h-4 mt-0.5 rounded flex items-center justify-center flex-shrink-0 transition-all border ${
                  item.completed
                    ? "bg-white border-white text-black"
                    : "border-white/30 bg-white/[0.02] group-hover:border-white/50"
                }`}
              >
                {item.completed && (
                  <Icon icon="lucide:check" width={11} height={11} className="stroke-[3]" />
                )}
              </div>
              <span
                className={`text-xs leading-relaxed transition-colors ${
                  item.completed ? "text-white/40 line-through" : "text-white/90"
                }`}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
              </span>
            </div>
          ))
        ) : (
          <MarkdownContent content={plan.rawText} />
        )}
      </div>

      {checklist.length > 0 && <details className="px-4 pb-4"><summary className="text-xs text-white/50 cursor-pointer">Plan details</summary><div className="pt-3"><MarkdownContent content={plan.rawText} /></div></details>}

      {/* Action Footer */}
      <div className="px-4 py-3 bg-[#080808] border-t border-white/[0.06] flex items-center justify-between gap-3">
        {isDone ? (
          <>
            <span className="text-[11px] text-white/40 font-mono flex items-center gap-1.5">
              <span>Execution in progress</span>
              <span className="w-1 h-1 rounded-full bg-emerald-400" />
              <span>Active in Tool Window</span>
            </span>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono select-none shrink-0">
              <Icon icon="lucide:check" width={12} height={12} className="stroke-[2.5]" />
              <span>Plan Approved</span>
            </div>
          </>
        ) : (
          <>
            <span className="text-[11px] text-white/40">
              Click proceed to start execution or reply to adjust
            </span>
            <button
              type="button"
              disabled={isStreaming}
              onClick={handleProceedClick}
              className="ray-btn-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon icon="lucide:play" width={12} height={12} className="fill-current" />
              <span>Proceed with Plan ↗</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function parseMessageContentToParts(content: string): MessagePart[] {
  if (!content) return [];
  const { parsedBlocks, cleanText } = extractCleanAssistantContent(content);
  const parts: MessagePart[] = [];
  for (const block of parsedBlocks) {
    parts.push({ type: "tool", block });
  }
  if (cleanText) {
    parts.push({ type: "text", text: cleanText });
  }
  return parts;
}

/* ── Types ─────────────────────────────────────── */
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  parts?: MessagePart[];
  preToolContent?: string;
  postToolContent?: string;
  toolBlocks?: ToolBlock[];
  timestamp: Date;
  streaming?: boolean;
  errorMessage?: string;
  isRetryable?: boolean;
  attachedContext?: {
    type: "project" | "container" | "monitor" | "github" | "deploy" | "deep-deploy";
    id: string;
    name: string;
    detail?: string;
    deployMode?: "deploy" | "deep-deploy";
  };
  deployMode?: "deploy" | "deep-deploy";
  // Approval card fields (role=assistant, kind="approval")
  kind?: "approval" | "monitor-add-approval";
  approvalId?: string;
  approvalTool?: string;
  approvalCmd?: string;
  approvalState?: "pending" | "approved" | "denied";
  // For monitor-add-approval
  monitorProjectName?: string;
  monitorProjectPath?: string;
  monitorInterval?: number;
}

interface MonitorProject {
  id: string;
  name: string;
  projectPath: string;
  projectUrl?: string | null;
  logPaths?: string; // JSON string of discovered log file paths
  status: string;
  memory?: string | null; // AI-written project summary
  memoryStatus?: string | null;
}

/* ── Markdown renderer ──────────────────────────── */
function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="chat-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a(props) {
            const { href, children, ...rest } = props;
            const isExternal = href ? (/^https?:\/\//i.test(href) || href.startsWith("//")) : false;
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors inline-flex items-center gap-1 font-medium cursor-pointer"
                {...rest}
              >
                {children}
                {isExternal && (
                  <Icon icon="lucide:external-link" className="w-3 h-3 inline-block opacity-70 shrink-0" />
                )}
              </a>
            );
          },
          code(props) {
            const { children, className, node, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            const isBlock = match || (String(children).includes("\n"));

            if (!isBlock) {
              return (
                <code {...rest} className={className}>
                  {children}
                </code>
              );
            }

            return (
              <div className="relative group mb-4 rounded-xl overflow-hidden border border-[rgba(255,255,255,0.1)]">
                <div className="flex items-center justify-between px-4 py-2 bg-[rgba(255,255,255,0.03)] border-b border-[rgba(255,255,255,0.05)]">
                  <span className="text-xs font-mono text-[rgba(255,255,255,0.5)]">
                    {language || "text"}
                  </span>
                  <CopyButton text={String(children).replace(/\n$/, "")} />
                </div>
                <SyntaxHighlighter
                  {...(rest as any)}
                  PreTag="div"
                  language={language}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    background: "transparent",
                    padding: "1rem",
                    fontSize: "0.85rem",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center justify-center p-1.5 rounded-md transition-colors"
      style={{ color: copied ? "#10b981" : "rgba(255,255,255,0.4)" }}
      onMouseEnter={(e) => {
        if (!copied) (e.currentTarget.style.color = "rgba(255,255,255,0.8)");
        (e.currentTarget.style.background = "rgba(255,255,255,0.1)");
      }}
      onMouseLeave={(e) => {
        if (!copied) (e.currentTarget.style.color = "rgba(255,255,255,0.4)");
        (e.currentTarget.style.background = "transparent");
      }}
      title="Copy"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || "http://localhost:4500";

/* ── Approval card ───────────────────────────────── */
function ApprovalCard({
  msg,
  onResolve,
}: {
  msg: Message;
  onResolve: (id: string, approved: boolean) => void;
}) {
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);

  const respond = async (approved: boolean) => {
    setLoading(approved ? "approve" : "deny");
    try {
      await fetch(`${BRAIN_URL}/v1/chat/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.approvalId, approved }),
      });
    } catch {/* brain offline — optimistic */ }
    onResolve(msg.approvalId!, approved);
    setLoading(null);
  };

  const isDone = msg.approvalState !== "pending";

  return (
    <div
      style={{
        width: "100%",
        background: "#111",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          Permission required
        </span>
      </div>

      {/* Command */}
      <div style={{
        fontFamily: "'Menlo','Monaco','Courier New',monospace",
        fontSize: 12.5,
        color: "rgba(255,255,255,0.75)",
        background: "#1a1a1a",
        borderRadius: 5,
        padding: "6px 10px",
        marginBottom: 10,
        wordBreak: "break-all",
      }}>
        <span style={{ color: "rgba(255,255,255,0.25)", marginRight: 6 }}>$</span>
        {msg.approvalCmd || msg.approvalTool}
      </div>

      {/* Buttons or resolved state */}
      {isDone ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
          {msg.approvalState === "approved"
            ? "✓  Approved — executing in terminal"
            : "✕  Denied — waiting for agent response"}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => respond(true)}
              disabled={!!loading}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.15)",
                background: loading === "approve" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                color: loading === "approve" ? "#fff" : "rgba(255,255,255,0.7)",
                fontSize: 12,
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 120ms, color 120ms",
              }}
            >
              {loading === "approve" ? "Running…" : "Allow"}
            </button>
            <button
              onClick={() => respond(false)}
              disabled={!!loading}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "transparent",
                color: "rgba(255,255,255,0.3)",
                fontSize: 12,
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 120ms, color 120ms",
              }}
            >
              {loading === "deny" ? "Denying…" : "Deny"}
            </button>
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Link
              href="/settings"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                color: "rgba(255,255,255,0.45)",
                textDecoration: "none",
                transition: "color 120ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.45)")}
            >
              <span>Want full access? Enable Autonomous Mode in Settings</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
              </svg>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Attached Project Type ──────────────────────── */
interface AttachedProject {
  name: string;
  type: "folder" | "zip";
  fileCount: number;
  totalSize: number;
  files?: File[];
  zipFile?: File;
}

function formatFileSize(bytes: number): string {
  if (!bytes || isNaN(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Recursive helper to traverse dropped directory trees
async function getFilesFromDataTransfer(
  items: DataTransferItemList
): Promise<{ files: File[]; name: string; isFolder: boolean }> {
  const files: File[] = [];
  let rootName = "";
  let isFolder = false;

  const traverseFileTree = async (entry: any, path = ""): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file: File) => {
          // Attach relative path simulation
          Object.defineProperty(file, "webkitRelativePath", {
            value: path + file.name,
            writable: false,
          });
          files.push(file);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      isFolder = true;
      if (!rootName && !path) {
        rootName = entry.name;
      }
      const dirReader = entry.createReader();
      const readEntries = async (): Promise<any[]> => {
        return new Promise((resolve) => {
          dirReader.readEntries((entries: any[]) => resolve(entries || []));
        });
      };

      let entries = await readEntries();
      while (entries.length > 0) {
        for (const child of entries) {
          await traverseFileTree(child, path + entry.name + "/");
        }
        entries = await readEntries();
      }
    }
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      await traverseFileTree(entry);
    }
  }

  return { files, name: rootName || files[0]?.name || "project", isFolder };
}

/* ── Props ──────────────────────────────────────── */
interface ChatInterfaceProps {
  initialSessionId?: string;
  initialMessages?: Message[];
  initialModel?: string;
}

/* ── Suggestions ────────────────────────────────── */
const SUGGESTIONS = [
  "Check nginx error logs for the past 24h",
  "Explain zero-downtime deployment with Docker",
  "Help me write a bash script to monitor disk usage",
  "What are best practices for SSH key management?",
];

/* ── Main component ─────────────────────────────── */
export default function ChatInterface({
  initialSessionId,
  initialMessages = [],
  initialModel = "MiniMax-M3",
}: ChatInterfaceProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [modelId, setModelId] = useState(initialModel);

  useEffect(() => {
    if (!initialSessionId) {
      const saved = localStorage.getItem("ray_selected_model");
      if (saved && saved !== initialModel) {
        setModelId(saved);
        try {
          document.cookie = `ray_selected_model=${encodeURIComponent(saved)}; path=/; max-age=31536000; SameSite=Lax`;
        } catch {}
      }
    }
  }, [initialSessionId, initialModel]);

  const handleModelChange = (newModel: string) => {
    setModelId(newModel);
    try {
      document.cookie = `ray_selected_model=${encodeURIComponent(newModel)}; path=/; max-age=31536000; SameSite=Lax`;
      localStorage.setItem("ray_selected_model", newModel);
    } catch {
      // ignore storage error
    }

    if (sessionId) {
      fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModel }),
      }).catch(() => { });
    }
  };
  const [isLoading, setIsLoading] = useState(false);
  const [deploymentInvestigation, setDeploymentInvestigation] = useState<string | null>(null);
  const investigatingDeployment = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const investigationSessionRef = useRef<string | null>(sessionId);
  const chatStatusRef = useRef({ sessionId, isLoading });
  chatStatusRef.current = { sessionId, isLoading };
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Attached project for Docker deployment
  const [attachedProject, setAttachedProject] = useState<AttachedProject | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  // File upload input refs
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Context Picker state (Project / Container / Monitor / GitHub / Deploy / Execution)
  type ContextCategory = "project" | "container" | "monitor" | "github" | "deploy" | "deep-deploy";
  type DeployMode = "deploy" | "deep-deploy" | null;
  type ExecutionMode = "plan" | "action" | null;
  interface SelectedContextItem {
    type: ContextCategory;
    id: string;
    name: string;
    detail?: string;
    deployMode?: "deploy" | "deep-deploy";
  }
  const [selectedContext, setSelectedContext] = useState<SelectedContextItem | null>(null);
  const [deployMode, setDeployMode] = useState<DeployMode>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(null);
  const [defaultExecutionMode, setDefaultExecutionMode] = useState<"plan" | "action">("plan");
  const [proceededPlanKeys, setProceededPlanKeys] = useState<Set<string>>(new Set());
  const [chipOrder, setChipOrder] = useState<("deploy" | "context" | "project" | "execution")[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [allContainers, setAllContainers] = useState<any[]>([]);
  const [githubRepos, setGithubRepos] = useState<any[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);

  // Slash commands pop-up state
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashStart, setSlashStart] = useState<number>(-1);
  const [slashIndex, setSlashIndex] = useState<number>(0);

  // Monitor @ mention state
  const [monitorProjects, setMonitorProjects] = useState<MonitorProject[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const [mentionedProjects, setMentionedProjects] = useState<MonitorProject[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Fetch monitor projects, projects, containers, and github repos
  useEffect(() => {
    fetch("/api/monitor/projects")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.projects) setMonitorProjects(d.projects); })
      .catch(() => { });

    fetch("/api/projects")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.projects) setAllProjects(d.projects); })
      .catch(() => { });

    fetch("/api/containers")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.containers) setAllContainers(d.containers); })
      .catch(() => { });

    fetch("/api/github/repos")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.repos) setGithubRepos(d.repos);
        if (d?.connected !== undefined) setGithubConnected(d.connected);
      })
      .catch(() => { });
  }, []);

  // Resolve an approval card (Approve/Deny button clicked)
  const handleApprovalResolve = useCallback((id: string, approved: boolean) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.approvalId === id
          ? { ...m, approvalState: approved ? "approved" : "denied" }
          : m
      )
    );
  }, []);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mentionItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [showChatScrollBottom, setShowChatScrollBottom] = useState(false);
  const isUserScrolledUpRef = useRef(false);

  // Auto-retry state for network/connection errors
  const [autoRetryCountdown, setAutoRetryCountdown] = useState<number | null>(null);
  const [autoRetryAttempt, setAutoRetryAttempt] = useState<number>(0);
  const autoRetryAttemptRef = useRef<number>(0);
  const autoRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastUserPromptRef = useRef<string>("");

  // Auto-scroll slash command popover when navigating with arrow keys
  useEffect(() => {
    if (slashQuery !== null && slashItemRefs.current[slashIndex]) {
      slashItemRefs.current[slashIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [slashIndex, slashQuery]);

  // Auto-scroll mention popover when navigating with arrow keys
  useEffect(() => {
    if (mentionQuery !== null && mentionItemRefs.current[mentionIndex]) {
      mentionItemRefs.current[mentionIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [mentionIndex, mentionQuery]);

  const handleChatScroll = useCallback(() => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
    setShowChatScrollBottom(isScrolledUp);
    isUserScrolledUpRef.current = isScrolledUp;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior,
      });
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
    setShowChatScrollBottom(false);
    isUserScrolledUpRef.current = false;
  }, []);

  const allSessionBlocksRef = useRef<ToolBlock[]>([]);

  useEffect(() => {
    const handleRequestSync = () => {
      if (allSessionBlocksRef.current && allSessionBlocksRef.current.length > 0) {
        window.dispatchEvent(
          new CustomEvent("ray:sync-terminal-history", {
            detail: { toolBlocks: allSessionBlocksRef.current },
          })
        );
      }
    };
    window.addEventListener("ray:request-terminal-sync", handleRequestSync);
    return () => window.removeEventListener("ray:request-terminal-sync", handleRequestSync);
  }, []);

  const [deploymentsDir, setDeploymentsDir] = useState<string>("~/.ray/deployments");
  const [apiKeysStatus, setApiKeysStatus] = useState<Record<string, boolean> | null>(null);

  const fetchSettings = useCallback(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.deploymentsPath) setDeploymentsDir(data.deploymentsPath);
        if (data.executionMode === "plan" || data.executionMode === "action") {
          setDefaultExecutionMode(data.executionMode);
        }
        if (data.apiKeys && typeof data.apiKeys === "object") {
          setApiKeysStatus(data.apiKeys);
        }
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    fetchSettings();
    window.addEventListener("focus", fetchSettings);
    return () => window.removeEventListener("focus", fetchSettings);
  }, [fetchSettings]);

  const activeProvider = useMemo(() => getProviderFromModelId(modelId), [modelId]);
  const isKeyConfigured = useMemo(() => isProviderKeyConfigured(activeProvider, apiKeysStatus), [activeProvider, apiKeysStatus]);
  const activeProviderLabel = useMemo(() => getProviderDisplayName(activeProvider), [activeProvider]);

  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      scrollToBottom("smooth");
    }
  }, [messages, scrollToBottom]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Re-attach to active background chat run if in progress
  const checkAndAttachActiveStream = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/chat/status?sessionId=${sid}`);
      if (!res.ok) {
        setIsLoading(false);
        return;
      }
      const data = await res.json();
      if (data?.run?.status === "running") {
        setIsLoading(true);
        abortRef.current = new AbortController();

        const assistantMsgId = `stream-${Date.now()}`;
        setMessages((prev) => {
          const hasStreaming = prev.some((m) => m.streaming);
          if (hasStreaming) return prev;
          return [
            ...prev,
            {
              id: assistantMsgId,
              role: "assistant" as const,
              content: "",
              timestamp: new Date(),
              streaming: true,
            },
          ];
        });

        const streamRes = await fetch(`/api/chat?sessionId=${sid}`, {
          signal: abortRef.current.signal,
        });
        if (!streamRes.ok || !streamRes.body) {
          setIsLoading(false);
          setMessages((prev) => prev.map((m) => m.streaming ? { ...m, streaming: false } : m));
          return;
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let rawBuffer = "";
        let fullAssistantText = "";
        let thinkingText = "";
        const toolBlocks: ToolBlock[] = [];
        const parts: MessagePart[] = [];
        let activeToolBlock: ToolBlock | null = null;
        let isDone = false;

        const processLine = (line: string): boolean => {
          if (!line.trim()) return false;

          // ── Finish marker (AI SDK / SSE): d:{"finishReason":"stop",...} or data: [DONE] ──
          if (line.startsWith("d:") || line.includes('"finishReason"') || line.trim() === "data: [DONE]") {
            return true;
          }

          // ── Vercel AI SDK error stream line: 3:"error message" ──
          const streamError = parseChatErrorLine(line);
          if (streamError) throw new Error(streamError);

          // ── Structured SSE event: data: {...} ──
          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.slice(6));

              if (json.type === "finish" || json.type === "done" || json.finishReason) {
                return true;
              }

              if (json.type === "thinking-delta" && typeof json.delta === "string") {
                thinkingText += json.delta;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.streaming
                      ? {
                          ...m,
                          content: fullAssistantText,
                          thinking: thinkingText,
                          parts: [...parts],
                          toolBlocks: [...toolBlocks],
                          streaming: true,
                        }
                      : m
                  )
                );
                return false;
              }

              if (json.type === "plan-created") {
                window.dispatchEvent(new CustomEvent("ray:plan-updated", { detail: json }));
                window.dispatchEvent(new Event("ray:open-terminal"));
                return false;
              }

              if (json.type === "tool-start" || json.type === "tool-output" || json.type === "tool-end") {
                const toolEvent = { ...json, id: `${json.type}-${Date.now()}-${Math.random()}` };

                if (json.type === "tool-start") {
                  const newBlock: ToolBlock = {
                    id: `tool-${Date.now()}-${Math.random()}`,
                    tool: json.tool,
                    cmd: json.cmd || json.tool,
                    status: "running",
                    output: "",
                    startTime: Date.now(),
                  };
                  activeToolBlock = newBlock;
                  toolBlocks.push(newBlock);
                  parts.push({ type: "tool", block: newBlock });

                  if (json.tool === "deploy") {
                    const nameMatch = (json.cmd || "").match(/name="([^"]+)"/) || (json.cmd || "").match(/deploy\s+([^\s|>]+)/);
                    const pathMatch = (json.cmd || "").match(/path="([^"]+)"/);
                    const name = nameMatch ? nameMatch[1] : "Application";
                    const projectPath = pathMatch ? pathMatch[1] : "";
                    window.dispatchEvent(
                      new CustomEvent("ray:tool-deploy-start", {
                        detail: { name, projectPath },
                      })
                    );
                  } else if (json.tool === "deployment_setup") {
                    // Setup is rendered inline; no deployment or terminal has started.
                  } else if (json.tool === "monitor_add") {
                    window.dispatchEvent(new Event("ray:open-monitor-project"));
                  } else {
                    window.dispatchEvent(new Event("ray:open-terminal"));
                  }
                } else if (json.type === "tool-output" && activeToolBlock && json.delta) {
                  activeToolBlock.output += json.delta;
                  if (json.tool === "deploy" || activeToolBlock.tool === "deploy") {
                    window.dispatchEvent(
                      new CustomEvent("ray:tool-deploy-output", {
                        detail: { delta: json.delta },
                      })
                    );
                  }
                } else if (json.type === "tool-end" && activeToolBlock) {
                  activeToolBlock.status = (json.exit ?? 0) === 0 ? "completed" : "error";
                  activeToolBlock.durationSec = Math.max(0.1, (Date.now() - activeToolBlock.startTime) / 1000);
                  activeToolBlock.exit = json.exit ?? 0;
                  if (json.tool === "deploy" || activeToolBlock.tool === "deploy") {
                    window.dispatchEvent(
                      new CustomEvent("ray:tool-deploy-end", {
                        detail: { exit: json.exit },
                      })
                    );
                  }
                  activeToolBlock = null;
                }

                setMessages((prev) =>
                  prev.map((m) =>
                    m.streaming
                      ? {
                          ...m,
                          content: fullAssistantText,
                          thinking: thinkingText || m.thinking,
                          parts: [...parts],
                          toolBlocks: [...toolBlocks],
                          streaming: true,
                        }
                      : m
                  )
                );

                window.dispatchEvent(new CustomEvent("ray:tool-event", { detail: toolEvent }));
                return false;
              }

              if (json.type === "text-delta" && typeof json.delta === "string") {
                fullAssistantText += json.delta;
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.type === "text") {
                  lastPart.text += json.delta;
                } else {
                  parts.push({ type: "text", text: json.delta });
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.streaming
                      ? {
                          ...m,
                          content: fullAssistantText,
                          thinking: thinkingText || m.thinking,
                          parts: [...parts],
                          toolBlocks: [...toolBlocks],
                          streaming: true,
                        }
                      : m
                  )
                );
              }
            } catch {}
            return false;
          }

          // ── Vercel AI SDK text delta: 0:"text" ──
          if (line.startsWith("0:")) {
            try {
              const parsed = JSON.parse(line.slice(2));
              if (typeof parsed === "string") {
                fullAssistantText += parsed;
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.type === "text") {
                  lastPart.text += parsed;
                } else {
                  parts.push({ type: "text", text: parsed });
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.streaming
                      ? {
                          ...m,
                          content: fullAssistantText,
                          thinking: thinkingText || m.thinking,
                          parts: [...parts],
                          toolBlocks: [...toolBlocks],
                          streaming: true,
                        }
                      : m
                  )
                );
              }
            } catch {}
          }
          return false;
        };

        while (!isDone) {
          const { done, value } = await reader.read();
          if (done) break;
          rawBuffer += decoder.decode(value, { stream: true });
          const lines = rawBuffer.split("\n");
          rawBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (processLine(line)) {
              isDone = true;
              break;
            }
          }
        }
        if (!isDone && rawBuffer.trim()) {
          processLine(rawBuffer);
        }

        const finalFullContent = fullAssistantText.trim();
        setMessages((prev) =>
          prev.map((m) =>
            m.streaming
              ? {
                  ...m,
                  content: finalFullContent || m.content,
                  thinking: thinkingText || m.thinking,
                  parts: [...parts],
                  toolBlocks: [...toolBlocks],
                  streaming: false,
                }
              : m
          )
        );

        setIsLoading(false);
        window.dispatchEvent(new CustomEvent("ray:chat-status-change"));
      } else {
        setIsLoading(false);
        setMessages((prev) => prev.map((m) => m.streaming ? { ...m, streaming: false } : m));
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const errorMessage = err instanceof Error ? err.message : "Error generating response";
      setIsLoading(false);
      setMessages((prev) => prev.map((m) => m.streaming
        ? {
            ...m,
            errorMessage: isAbort ? undefined : errorMessage,
            isRetryable: !isAbort,
            streaming: false,
          }
        : m));
    }
  }, []);

  useEffect(() => {
    if (initialSessionId) {
      window.dispatchEvent(new CustomEvent("ray:session-switched", { detail: { sessionId: initialSessionId } }));
      checkAndAttachActiveStream(initialSessionId);
    }
  }, [initialSessionId, checkAndAttachActiveStream]);

  // Extract and broadcast session tool blocks on initial mount
  useEffect(() => {
    const blocks: ToolBlock[] = [];
    (initialMessages || []).forEach((m) => {
      let content = m.content;
      let toolBlocks = m.toolBlocks;

      const metaMatch = content.match(/^<!-- rayAssistantMeta:(.*?) -->\n?/);
      if (metaMatch) {
        try {
          const meta = JSON.parse(metaMatch[1]);
          if (Array.isArray(meta.toolBlocks) && (!toolBlocks || toolBlocks.length === 0)) {
            toolBlocks = meta.toolBlocks;
          }
        } catch { /* ignore */ }
      }

      if (m.role === "assistant") {
        const extracted = extractCleanAssistantContent(content);
        if ((!toolBlocks || toolBlocks.length === 0) && extracted.parsedBlocks.length > 0) {
          toolBlocks = extracted.parsedBlocks;
        }
      }

      if (toolBlocks && toolBlocks.length > 0) {
        blocks.push(...toolBlocks);
      }
    });

    if (blocks.length > 0) {
      allSessionBlocksRef.current = blocks;
      window.dispatchEvent(new CustomEvent("ray:sync-terminal-history", { detail: { toolBlocks: blocks } }));
    }
  }, [initialSessionId, initialMessages]);

  const prevSessionIdRef = useRef<string | null | undefined>(initialSessionId);

  // Sync state with props on client-side route changes (/chat -> /chat/[sessionId] or between sessions)
  useEffect(() => {
    // Only synchronize when initialSessionId actually changes between routes
    if (prevSessionIdRef.current === initialSessionId) {
      return;
    }
    prevSessionIdRef.current = initialSessionId;

    setSessionId(initialSessionId || null);
    if (!initialSessionId) {
      const saved = typeof window !== "undefined" ? localStorage.getItem("ray_selected_model") : null;
      setModelId(saved || initialModel || "MiniMax-M3");
    } else if (initialModel) {
      setModelId(initialModel);
    }

    if (initialMessages && initialMessages.length > 0) {
      const allSessionBlocks: ToolBlock[] = [];
      const mapped = initialMessages.map((m) => {
        let content = m.content;
        let thinking = m.thinking;
        let toolBlocks = m.toolBlocks;

        const metaMatch = content.match(/^<!-- rayAssistantMeta:(.*?) -->\n?/);
        if (metaMatch) {
          try {
            const meta = JSON.parse(metaMatch[1]);
            if (meta.thinking && !thinking) thinking = meta.thinking;
            if (Array.isArray(meta.toolBlocks) && (!toolBlocks || toolBlocks.length === 0)) {
              toolBlocks = meta.toolBlocks;
            }
            content = content.replace(/^<!-- rayAssistantMeta:(.*?) -->\n?/, "");
          } catch { /* ignore */ }
        }

        if (m.role === "assistant") {
          const extracted = extractCleanAssistantContent(content);
          if (!thinking && extracted.extractedThinking) thinking = extracted.extractedThinking;
          if ((!toolBlocks || toolBlocks.length === 0) && extracted.parsedBlocks.length > 0) {
            toolBlocks = extracted.parsedBlocks;
          }
        }

        if (toolBlocks && toolBlocks.length > 0) {
          allSessionBlocks.push(...toolBlocks);
        }

        return {
          ...m,
          content,
          thinking,
          toolBlocks,
          parts: m.parts || (m.role === "assistant" ? parseMessageContentToParts(content) : undefined),
          streaming: false,
        };
      });
      setMessages(mapped);

      allSessionBlocksRef.current = allSessionBlocks;
      if (allSessionBlocks.length > 0) {
        window.dispatchEvent(new CustomEvent("ray:sync-terminal-history", { detail: { toolBlocks: allSessionBlocks } }));
      }
    } else if (initialSessionId) {
      // Fetch session messages to ensure robust loading on client-side navigation
      fetch(`/api/sessions/${initialSessionId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.session?.messages) {
            const allSessionBlocks: ToolBlock[] = [];
            const mapped = data.session.messages.map((m: any) => {
              let content = m.content;
              let attachedContext = undefined;
              let msgDeployMode: DeployMode | undefined = undefined;
              let thinking: string | undefined = undefined;
              let toolBlocks: ToolBlock[] | undefined = undefined;

              const match = content.match(/^<!-- attachedContext:(.*?) -->\n?/);
              if (match) {
                try {
                  attachedContext = JSON.parse(match[1]);
                  if (attachedContext) {
                    if (attachedContext.deployMode) {
                      msgDeployMode = attachedContext.deployMode;
                    } else if (attachedContext.type === "deploy" || attachedContext.type === "deep-deploy") {
                      msgDeployMode = attachedContext.type;
                    }
                  }
                  content = content.replace(/^<!-- attachedContext:(.*?) -->\n?/, "");
                } catch { /* ignore */ }
              }

              const metaMatch = content.match(/^<!-- rayAssistantMeta:(.*?) -->\n?/);
              if (metaMatch) {
                try {
                  const meta = JSON.parse(metaMatch[1]);
                  if (meta.thinking) thinking = meta.thinking;
                  if (Array.isArray(meta.toolBlocks)) toolBlocks = meta.toolBlocks;
                  content = content.replace(/^<!-- rayAssistantMeta:(.*?) -->\n?/, "");
                } catch { /* ignore */ }
              }

              if (m.role === "assistant") {
                const extracted = extractCleanAssistantContent(content);
                if (!thinking && extracted.extractedThinking) thinking = extracted.extractedThinking;
                if ((!toolBlocks || toolBlocks.length === 0) && extracted.parsedBlocks.length > 0) {
                  toolBlocks = extracted.parsedBlocks;
                }
              }

              if (toolBlocks && toolBlocks.length > 0) {
                allSessionBlocks.push(...toolBlocks);
              }

              const parts = m.role === "assistant" ? parseMessageContentToParts(content) : undefined;
              return {
                id: m.id,
                role: m.role as "user" | "assistant",
                content,
                thinking,
                toolBlocks,
                parts,
                attachedContext,
                deployMode: msgDeployMode,
                timestamp: new Date(m.createdAt),
                streaming: false,
              };
            });
            setMessages(mapped);

            allSessionBlocksRef.current = allSessionBlocks;
            if (allSessionBlocks.length > 0) {
              window.dispatchEvent(new CustomEvent("ray:sync-terminal-history", { detail: { toolBlocks: allSessionBlocks } }));
            }
            if (initialSessionId) {
              checkAndAttachActiveStream(initialSessionId);
            }
          }
        })
        .catch(() => { });
    } else {
      setMessages([]);
    }
  }, [initialSessionId, initialModel, checkAndAttachActiveStream]);

  // Keep terminal button state in sync with ClientLayout's terminalOpen
  useEffect(() => {
    const handler = (e: Event) => {
      setTerminalOpen((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener("ray:terminal-state", handler);
    return () => window.removeEventListener("ray:terminal-state", handler);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 180)}px`;

    const cursorPos = target.selectionStart;
    const textBefore = val.slice(0, cursorPos);

    // Check @ mention
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx !== -1 && (atIdx === 0 || /\s/.test(textBefore[atIdx - 1]))) {
      const q = textBefore.slice(atIdx + 1);
      if (!/\s/.test(q)) {
        setMentionQuery(q);
        setMentionStart(atIdx);
        setMentionIndex(0);
        setSlashQuery(null);
        return;
      }
    }
    setMentionQuery(null);
    setMentionStart(-1);

    // Check for "/" slash command trigger
    const slashIdx = textBefore.lastIndexOf("/");
    if (slashIdx !== -1 && (slashIdx === 0 || /\s/.test(textBefore[slashIdx - 1]))) {
      const sq = textBefore.slice(slashIdx + 1);
      if (!/\s/.test(sq)) {
        setSlashQuery(sq);
        setSlashStart(slashIdx);
        setSlashIndex(0);
        return;
      }
    }
    setSlashQuery(null);
    setSlashStart(-1);
  };

  interface SlashCommand {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
    category?: "command" | "project" | "container" | "monitor" | "github";
    detail?: string;
    onSelect: () => void;
  }

  // All slash commands (core actions + entities)
  const filteredSlashCommands = useMemo<SlashCommand[]>(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();

    const baseCommands: SlashCommand[] = [
      {
        id: "cmd-deploy",
        name: "deploy",
        description: "Fast immediate deploy: package application & launch container immediately",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        ),
        onSelect: () => {
          setDeployMode("deploy");
          setChipOrder((prev) => (prev.includes("deploy") ? prev : [...prev, "deploy"]));
        },
      },
      {
        id: "cmd-deep-deploy",
        name: "deep deploy",
        description: "Deep deploy: thoroughly test, inspect monorepo workspaces, migrations & build configs before deploying",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        ),
        onSelect: () => {
          setDeployMode("deep-deploy");
          setChipOrder((prev) => (prev.includes("deploy") ? prev : [...prev, "deploy"]));
        },
      },
      {
        id: "cmd-plan",
        name: "plan",
        description: "Plan mode: formulate a step-by-step checklist plan before executing any actions",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            <path d="m9 14 2 2 4-4" />
          </svg>
        ),
        onSelect: () => {
          setExecutionMode("plan");
          setChipOrder((prev) => (prev.includes("execution") ? prev : [...prev, "execution"]));
          setInput((prev) => prev.replace(/^\/plan\b/i, "").trim());
        },
      },
      {
        id: "cmd-action",
        name: "action",
        description: "Action mode: execute tasks directly without preliminary checklist approval phase",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        ),
        onSelect: () => {
          setExecutionMode("action");
          setChipOrder((prev) => (prev.includes("execution") ? prev : [...prev, "execution"]));
          setInput((prev) => prev.replace(/^\/action\b/i, "").trim());
        },
      },
      {
        id: "cmd-github",
        name: "github",
        description: githubConnected
          ? `Browse & link repositories from your GitHub (${githubRepos.length} repos)`
          : "Connect your GitHub account to link repositories",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
        ),
        onSelect: () => {
          if (!githubConnected) {
            window.location.href = "/github";
          } else {
            setInput("/github:");
            setSlashQuery("github:");
            setSlashStart(0);
          }
        },
      },
      {
        id: "cmd-project",
        name: "project",
        description: "Link a workspace project codebase and architecture",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ),
        onSelect: () => {
          if (allProjects.length > 0) {
            setSelectedContext({
              type: "project",
              id: allProjects[0].id,
              name: allProjects[0].name,
              detail: allProjects[0].container?.port ? `Port :${allProjects[0].container.port}` : allProjects[0].projectPath,
            });
            setChipOrder((prev) => (prev.includes("context") ? prev : [...prev, "context"]));
          }
        },
      },
      {
        id: "cmd-container",
        name: "container",
        description: "Link a live Docker container runtime and logs",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        ),
        onSelect: () => {
          if (allContainers.length > 0) {
            setSelectedContext({
              type: "container",
              id: allContainers[0].id,
              name: allContainers[0].name,
              detail: allContainers[0].port ? `Port :${allContainers[0].port}` : allContainers[0].status,
            });
            setChipOrder((prev) => (prev.includes("context") ? prev : [...prev, "context"]));
          }
        },
      },
      {
        id: "cmd-monitor",
        name: "monitor",
        description: "Link a monitor service with live logs & alerts",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        ),
        onSelect: () => {
          if (monitorProjects.length > 0) {
            setSelectedContext({
              type: "monitor",
              id: monitorProjects[0].id,
              name: monitorProjects[0].name,
              detail: `${monitorProjects[0].status} · ${monitorProjects[0].logPaths?.length || 0} logs`,
            });
            setChipOrder((prev) => (prev.includes("context") ? prev : [...prev, "context"]));
          }
        },
      },
      {
        id: "cmd-clear",
        name: "clear",
        description: "Clear conversation messages and reset context",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        ),
        onSelect: () => {
          setMessages([]);
          setInput("");
          setDeployMode(null);
          setSelectedContext(null);
          setAttachedProject(null);
          setChipOrder([]);
        },
      },
    ];

    // Dynamic GitHub repo items
    const githubItems: SlashCommand[] = githubRepos.map((r) => ({
      id: `gh-${r.id}`,
      name: `github:${r.name}`,
      description: `Link GitHub Repo · ${r.fullName} (${r.defaultBranch || "main"})`,
      category: "github",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
      ),
      onSelect: () => {
        setSelectedContext({
          type: "github",
          id: String(r.id),
          name: r.fullName,
          detail: `${r.defaultBranch || "main"} · ${r.cloneUrl || r.htmlUrl}`,
        });
        setChipOrder((prev) => (prev.includes("context") ? prev : [...prev, "context"]));
      },
    }));

    // Dynamic project items
    const projectItems: SlashCommand[] = allProjects.map((p) => ({
      id: `proj-${p.id}`,
      name: `project:${p.name}`,
      description: `Link Project · ${p.projectPath}`,
      category: "project",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ),
      onSelect: () => {
        setSelectedContext({
          type: "project",
          id: p.id,
          name: p.name,
          detail: p.container?.port ? `Port :${p.container.port}` : p.projectPath,
        });
        setChipOrder((prev) => (prev.includes("context") ? prev : [...prev, "context"]));
      },
    }));

    // Dynamic container items
    const containerItems: SlashCommand[] = allContainers.map((c) => ({
      id: `cont-${c.id}`,
      name: `container:${c.name}`,
      description: `Link Container · ${c.image} (${c.status})`,
      category: "container",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      ),
      onSelect: () => {
        setSelectedContext({
          type: "container",
          id: c.id,
          name: c.name,
          detail: c.port ? `Port :${c.port}` : c.status,
        });
        setChipOrder((prev) => (prev.includes("context") ? prev : [...prev, "context"]));
      },
    }));

    // Dynamic monitor items
    const monitorItems: SlashCommand[] = monitorProjects.map((m) => ({
      id: `mon-${m.id}`,
      name: `monitor:${m.name}`,
      description: `Link Monitor · ${m.status} (${m.logPaths?.length || 0} logs)`,
      category: "monitor",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
      onSelect: () => {
        setSelectedContext({
          type: "monitor",
          id: m.id,
          name: m.name,
          detail: `${m.status} · ${m.logPaths?.length || 0} logs`,
        });
        setChipOrder((prev) => (prev.includes("context") ? prev : [...prev, "context"]));
      },
    }));

    const all = [...baseCommands, ...githubItems, ...projectItems, ...containerItems, ...monitorItems];
    if (!q) return all;

    return all.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
  }, [slashQuery, allProjects, allContainers, monitorProjects, githubRepos, githubConnected]);

  const selectSlashCommand = (cmd: SlashCommand) => {
    if (slashStart !== -1) {
      const before = input.slice(0, slashStart);
      const after = input.slice(slashStart + (slashQuery?.length ?? 0) + 1);
      setInput((before + after).trimStart());
    } else {
      setInput("");
    }
    setSlashQuery(null);
    setSlashStart(-1);
    cmd.onSelect();

    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return monitorProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [mentionQuery, monitorProjects]);

  const selectMention = (project: MonitorProject) => {
    if (mentionStart === -1) return;
    const before = input.slice(0, mentionStart);
    const after = input.slice(mentionStart + (mentionQuery?.length ?? 0) + 1);
    const insert = `@${project.name} `;
    const next = before + insert + after;
    setInput(next);
    setMentionQuery(null);
    setMentionStart(-1);
    setMentionedProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));

    window.dispatchEvent(
      new CustomEvent("ray:open-monitor-project", {
        detail: { projectId: project.id, projectName: project.name, subTab: "logs" },
      })
    );

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = before.length + insert.length;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  /* ── Session management ─────────────────────── */
  const ensureSession = useCallback(async (firstMsg?: string): Promise<string> => {
    if (sessionId) return sessionId;
    try {
      const title = firstMsg
        ? firstMsg.slice(0, 40).replace(/\n/g, " ")
        : "New conversation";
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, modelId }),
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.session.id);
        window.history.replaceState(null, "", `/chat/${data.session.id}`);
        window.dispatchEvent(new CustomEvent("ray:session-switched", { detail: { sessionId: data.session.id } }));
        return data.session.id;
      }
    } catch {
      // Fallback: continue without saving session
    }
    return "";
  }, [sessionId, modelId]);

  const saveMessages = useCallback(async (
    sid: string,
    msgs: { role: "user" | "assistant"; content: string }[]
  ) => {
    try {
      await fetch(`/api/sessions/${sid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
    } catch {
      // Don't break the chat
    }
  }, []);

  /* ── Send message ────────────────────────────── */
  // sendTextRef allows the terminal comment handler (registered once) to call
  // the latest version of sendText without stale closure issues.
  const sendTextRef = useRef<((text: string) => void) | null>(null);

  /* ── Handle ZIP selection ── */
  const handleZipSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedProject({
      name: file.name.replace(/\.(zip|tar\.gz|tar)$/i, ""),
      type: "zip",
      fileCount: 1,
      totalSize: file.size,
      zipFile: file,
    });
    setChipOrder((prev) => (prev.includes("project") ? prev : [...prev, "project"]));
    if (zipInputRef.current) zipInputRef.current.value = "";
    inputRef.current?.focus();
  };

  /* ── Handle Folder selection ── */
  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;
    const rel = (fileList[0] as unknown as { webkitRelativePath?: string }).webkitRelativePath;
    const folderName = rel ? rel.split("/")[0] : fileList[0].name;
    const totalSize = fileList.reduce((acc, f) => acc + f.size, 0);
    setAttachedProject({
      name: folderName || "app",
      type: "folder",
      fileCount: fileList.length,
      totalSize,
      files: fileList,
    });
    setChipOrder((prev) => (prev.includes("project") ? prev : [...prev, "project"]));
    if (folderInputRef.current) folderInputRef.current.value = "";
    inputRef.current?.focus();
  };

  /* ── Drag & Drop Handlers ── */
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDraggingOver(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounterRef.current = 0;

    if (!e.dataTransfer) return;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      // Check if dropped item is a zip file
      if (items[0].kind === "file") {
        const file = items[0].getAsFile();
        if (file && (file.name.endsWith(".zip") || file.name.endsWith(".tar.gz") || file.name.endsWith(".tar"))) {
          setAttachedProject({
            name: file.name.replace(/\.(zip|tar\.gz|tar)$/i, ""),
            type: "zip",
            fileCount: 1,
            totalSize: file.size,
            zipFile: file,
          });
          setChipOrder((prev) => (prev.includes("project") ? prev : [...prev, "project"]));
          inputRef.current?.focus();
          return;
        }
      }

      // Directory or multiple files
      const parsed = await getFilesFromDataTransfer(items);
      if (parsed.files.length > 0) {
        const totalSize = parsed.files.reduce((acc, f) => acc + f.size, 0);
        setAttachedProject({
          name: parsed.name,
          type: parsed.isFolder || parsed.files.length > 1 ? "folder" : "zip",
          fileCount: parsed.files.length,
          totalSize,
          files: parsed.files,
        });
        setChipOrder((prev) => (prev.includes("project") ? prev : [...prev, "project"]));
        inputRef.current?.focus();
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const fileList = Array.from(e.dataTransfer.files);
      if (fileList[0].name.endsWith(".zip") || fileList[0].name.endsWith(".tar.gz")) {
        setAttachedProject({
          name: fileList[0].name.replace(/\.(zip|tar\.gz|tar)$/i, ""),
          type: "zip",
          fileCount: 1,
          totalSize: fileList[0].size,
          zipFile: fileList[0],
        });
      } else {
        const totalSize = fileList.reduce((acc, f) => acc + f.size, 0);
        setAttachedProject({
          name: fileList[0].name,
          type: "folder",
          fileCount: fileList.length,
          totalSize,
          files: fileList,
        });
      }
      setChipOrder((prev) => (prev.includes("project") ? prev : [...prev, "project"]));
      inputRef.current?.focus();
    }
  };

  /* ── Handle project upload (folder or zip) ── */
  const handleProjectUpload = async (e: React.ChangeEvent<HTMLInputElement>, isZip: boolean) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);

    try {
      const formData = new FormData();
      if (isZip) {
        formData.append("zip", files[0]);
      } else {
        for (let i = 0; i < files.length; i++) {
          formData.append("files", files[i]);
        }
      }

      const res = await fetch("/api/deploy/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Upload error: ${err.error || "Failed to upload"}`);
        return;
      }

      const data = await res.json();

      // Open Deploy visual tab in right sidebar
      window.dispatchEvent(
        new CustomEvent("ray:open-deploy", {
          detail: {
            name: data.name,
            projectPath: data.projectPath,
            sourceType: "upload",
          },
        })
      );

      // Send chat message prompting the AI to process and explain deployment
      const prompt = `I uploaded the project "${data.name}" located at "${data.projectPath}". Please inspect the codebase, package it into a Docker container, deploy it, and add it to 24/7 monitoring.`;
      if (sendTextRef.current) {
        sendTextRef.current(prompt);
      }
    } catch (err: unknown) {
      alert(`Upload error: ${(err as Error).message}`);
    } finally {
      setIsUploading(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const sendText = useCallback(async (
    text: string,
    contextOverride?: SelectedContextItem | null,
    deployModeOverride?: DeployMode,
    executionModeOverride?: ExecutionMode
  ) => {
    let cleanText = text;
    let activeExecutionMode = executionModeOverride !== undefined ? executionModeOverride : executionMode;
    if (cleanText.startsWith("/plan ") || cleanText === "/plan") {
      activeExecutionMode = "plan";
      cleanText = cleanText.replace(/^\/plan\s*/, "").trim();
    } else if (cleanText.startsWith("/action ") || cleanText === "/action") {
      activeExecutionMode = "action";
      cleanText = cleanText.replace(/^\/action\s*/, "").trim();
    }
    const activeAttached = contextOverride !== undefined ? contextOverride : selectedContext;
    const activeDeployMode = deployModeOverride !== undefined ? deployModeOverride : deployMode;
    if ((!cleanText && !activeAttached && !activeDeployMode) || isLoading) return;

    // Detect if user typed any project name (e.g. @Website or Website)
    const detectedProj = monitorProjects.find(
      (p) =>
        text.toLowerCase().includes(`@${p.name.toLowerCase()}`) ||
        text.toLowerCase().includes(p.name.toLowerCase()) ||
        text.toLowerCase().includes(p.projectPath.toLowerCase())
    );

    // If a project is referenced, automatically pop open the right sidebar tool window on that project
    if (detectedProj) {
      window.dispatchEvent(
        new CustomEvent("ray:open-monitor-project", {
          detail: { projectId: detectedProj.id, projectName: detectedProj.name, subTab: "logs" },
        })
      );
    }

    const projectsToContext = [
      ...mentionedProjects,
      ...(detectedProj && !mentionedProjects.some((p) => p.id === detectedProj.id) ? [detectedProj] : []),
    ];

    setInput("");
    setMentionQuery(null);
    setMentionedProjects([]);
    if (inputRef.current) inputRef.current.style.height = "auto";

    // Append monitor context for referenced projects — live logs, running PID/port, memory summary, alerts
    let enrichedText = text;
    if (projectsToContext.length > 0) {
      const ctxParts = await Promise.all(projectsToContext.map(async (p) => {
        let logContent = "";
        let runInfo: { pid?: number; port?: number; url?: string } = {};
        let alertsList: string[] = [];

        try {
          const [logsRes, runRes, alertsRes] = await Promise.allSettled([
            fetch(`/api/monitor/projects/${p.id}/logs?lines=100`),
            fetch(`/api/monitor/projects/${p.id}/run`),
            fetch(`/api/monitor/alerts?projectId=${p.id}`),
          ]);

          if (logsRes.status === "fulfilled" && logsRes.value.ok) {
            const data = await logsRes.value.json();
            if (data.logs && Array.isArray(data.logs)) {
              logContent = data.logs
                .filter((f: { path: string; content?: string; error?: string }) => f.content && !f.error)
                .map((f: { path: string; content: string }) => `=== ${f.path} ===\n${f.content}`)
                .join("\n\n");
            }
          }

          if (runRes.status === "fulfilled" && runRes.value.ok) {
            runInfo = await runRes.value.json();
          }

          if (alertsRes.status === "fulfilled" && alertsRes.value.ok) {
            const aData = await alertsRes.value.json();
            if (aData.alerts && Array.isArray(aData.alerts)) {
              alertsList = aData.alerts.slice(0, 4).map((a: { severity: string; message: string }) => `[${a.severity.toUpperCase()}] ${a.message}`);
            }
          }
        } catch { /* Brain offline — fall back gracefully */ }

        // Build rich context: live terminal output, run process info, AI memory, alerts
        const runSection = runInfo.pid
          ? `\n  Process: Running (PID ${runInfo.pid}${runInfo.port ? `, Port :${runInfo.port}` : ""}${runInfo.url ? `, URL ${runInfo.url}` : ""})`
          : "";

        const logSection = logContent
          ? `\n\nRecent Output & Logs:\n${logContent.slice(-4000)}`
          : "";

        const memSection = p.memory
          ? `\n\nProject Architecture Memory:\n${p.memory.slice(0, 2500)}`
          : "";

        const alertSection = alertsList.length > 0
          ? `\n\nRecent Alerts:\n- ${alertsList.join("\n- ")}`
          : "";

        return `[Monitor context for @${p.name}:\n  Path: ${p.projectPath}\n  Status: ${p.status}${runSection}\n  URL: ${runInfo.url || p.projectUrl || "not set"}${logSection}${memSection}${alertSection}]`;
      }));
      enrichedText = `${text}\n\n${ctxParts.join("\n\n")}`;
    }

    const attachedContextItem = activeAttached ? { ...activeAttached } : null;
    if (activeDeployMode === "deep-deploy") {
      if (attachedContextItem?.type === "github") {
        const repoFullName = attachedContextItem.name;
        const detailParts = (attachedContextItem.detail || "").split("·");
        const branch = detailParts[0]?.trim() || "main";
        const cloneUrl = detailParts[1]?.trim() || `https://github.com/${repoFullName}.git`;
        const cleanName = attachedContextItem.name.split("/").pop() || "app";
        const targetPath = `${deploymentsDir.replace(/\/+$/, "")}/${cleanName}`;
        enrichedText = `[ATTACHED GITHUB REPOSITORY - DEEP DEPLOY]
Repository: ${repoFullName}
Branch: ${branch}
Clone URL: ${cloneUrl}

User Instruction: ${text || `Run a deep deploy on repository ${repoFullName}: thoroughly inspect monorepo workspaces, database migrations, dependencies, and test the build before deploying to Docker.`}

Deep Deployment Instructions:
1. Clone this repository directly via <exec>git clone ${cloneUrl} ${targetPath}</exec> (authentication is automatically handled).
2. Inspect the project files with <read_file> or <list_dir>. Thoroughly check for monorepo workspaces, package.json scripts, database migrations, and environment variables.
3. Test the build, run lint/tests if available, and verify or generate a production Dockerfile.
4. Package and deploy it using <deploy name="${cleanName}" path="${targetPath}">.`;
      } else if (attachedContextItem?.type === "project") {
        enrichedText = `[ATTACHED WORKSPACE PROJECT - DEEP DEPLOY]
Name: ${attachedContextItem.name}
Details: ${attachedContextItem.detail || ""}

User Instruction: ${text || `Run a deep deploy on project ${attachedContextItem.name}: inspect monorepo workspaces, database migrations, dependencies, and thoroughly test the build before deploying to Docker.`}

Deep Deployment Instructions:
1. Inspect the codebase, monorepo workspaces, package scripts, and database migrations.
2. Test the build, run tests/checks, and verify the container configuration.
3. Package and deploy it using <deploy name="${attachedContextItem.name}">.`;
      } else if (attachedContextItem?.type === "container") {
        enrichedText = `[TARGET CONTAINER - DEEP DEPLOY: ${attachedContextItem.name}]
Container Name: ${attachedContextItem.name}
Details: ${attachedContextItem.detail || ""}

User Request: "${text || `Run a deep inspection and redeploy container ${attachedContextItem.name}.`}"

CRITICAL INSTRUCTIONS FOR AI:
1. Thoroughly inspect container "${attachedContextItem.name}" health, logs, and configuration.
2. Run deep diagnostics on dependencies, environment, and runtime.
3. Rebuild and redeploy with verified Docker parameters.`;
      } else {
        enrichedText = `Run a deep deploy: inspect monorepo workspaces, database migrations, dependencies, and thoroughly test the build before deploying to Docker.${text ? `\n\nUser Instruction: ${text}` : ""}`;
      }
    } else if (activeDeployMode === "deploy") {
      if (attachedContextItem?.type === "github") {
        const repoFullName = attachedContextItem.name;
        const detailParts = (attachedContextItem.detail || "").split("·");
        const branch = detailParts[0]?.trim() || "main";
        const cloneUrl = detailParts[1]?.trim() || `https://github.com/${repoFullName}.git`;
        const cleanName = attachedContextItem.name.split("/").pop() || "app";
        const targetPath = `${deploymentsDir.replace(/\/+$/, "")}/${cleanName}`;
        enrichedText = `[ATTACHED GITHUB REPOSITORY]
Repository: ${repoFullName}
Branch: ${branch}
Clone URL: ${cloneUrl}

User Instruction: ${text || `Deploy and run repository ${repoFullName} in Docker immediately.`}

Deployment Instructions:
1. Clone this repository directly via <exec>git clone ${cloneUrl} ${targetPath}</exec> (authentication is automatically handled).
2. Inspect the project files with <read_file> or <list_dir>.
3. Package and deploy it using <deploy name="${cleanName}" path="${targetPath}">.`;
      } else if (attachedContextItem?.type === "project") {
        enrichedText = `[ATTACHED WORKSPACE PROJECT]
Name: ${attachedContextItem.name}
Details: ${attachedContextItem.detail || ""}

User Instruction: ${text || `Deploy and run project ${attachedContextItem.name} in Docker immediately.`}

Deployment Instructions:
1. Inspect the project files with <read_file> or <list_dir>.
2. Package and deploy it using <deploy name="${attachedContextItem.name}">.`;
      } else if (attachedContextItem?.type === "container") {
        enrichedText = `[TARGET CONTAINER: ${attachedContextItem.name}]
Container Name: ${attachedContextItem.name}
Details: ${attachedContextItem.detail || ""}

User Request: "${text || `Deploy and run container ${attachedContextItem.name} immediately.`}"`;
      } else {
        enrichedText = `Deploy and run this project in Docker immediately.${text ? `\n\nUser Instruction: ${text}` : ""}`;
      }
    } else if (attachedContextItem) {
      if (attachedContextItem.type === "github") {
        const repoFullName = attachedContextItem.name;
        const detailParts = (attachedContextItem.detail || "").split("·");
        const branch = detailParts[0]?.trim() || "main";
        const cloneUrl = detailParts[1]?.trim() || `https://github.com/${repoFullName}.git`;
        const cleanName = attachedContextItem.name.split("/").pop() || "app";
        const targetPath = `${deploymentsDir.replace(/\/+$/, "")}/${cleanName}`;
        enrichedText = `[ATTACHED GITHUB REPOSITORY]
Repository: ${repoFullName}
Branch: ${branch}
Clone URL: ${cloneUrl}

User Instruction: ${text || `Please clone and deploy repository ${repoFullName} into a Docker container.`}

Deployment Instructions:
1. Clone this repository directly via <exec>git clone ${cloneUrl} ${targetPath}</exec> (authentication is automatically handled).
2. Inspect the project files with <read_file> or <list_dir>.
3. Package and deploy it using <deploy name="${cleanName}" path="${targetPath}">.`;
      } else if (attachedContextItem.type === "project") {
        enrichedText = `[ATTACHED WORKSPACE PROJECT]
Name: ${attachedContextItem.name}
Details: ${attachedContextItem.detail || ""}

User Instruction: ${text || `Inspect and manage project ${attachedContextItem.name}.`}`;
      } else if (attachedContextItem.type === "container") {
        enrichedText = `[TARGET CONTAINER: ${attachedContextItem.name}]
Container Name: ${attachedContextItem.name}
Details: ${attachedContextItem.detail || ""}

User Request: "${text || "Check container status, health, and logs"}"

CRITICAL INSTRUCTIONS FOR AI:
1. The user explicitly attached container "${attachedContextItem.name}". Focus 100% of your answer and actions on this container.
2. Do NOT inspect unrelated host node/npm processes or dashboard projects.
3. Immediately inspect this container by running <exec>docker logs --tail 100 ${attachedContextItem.name}</exec> and <exec>docker inspect ${attachedContextItem.name}</exec>.
4. Explain why the container is restarting/failing and provide clear fixes.`;
      } else if (attachedContextItem.type === "monitor") {
        enrichedText = `[TARGET MONITORED SERVICE: ${attachedContextItem.name}]
Service Name: ${attachedContextItem.name}
Details: ${attachedContextItem.detail || ""}

User Request: "${text || "Check 24/7 monitor status, recent logs, and active alerts"}"

CRITICAL INSTRUCTIONS FOR AI:
1. Focus specifically on service "${attachedContextItem.name}". Inspect its recent logs and health.`;
      }
    }

    const effectiveContext = attachedContextItem
      ? { ...attachedContextItem, deployMode: activeDeployMode || undefined }
      : activeDeployMode
        ? {
            type: activeDeployMode as ContextCategory,
            id: `cmd-${activeDeployMode}`,
            name: activeDeployMode === "deep-deploy" ? "deep deploy" : "deploy",
            deployMode: activeDeployMode,
          }
        : null;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: cleanText || (
        activeDeployMode === "deep-deploy"
          ? (attachedContextItem ? `Deep Deploy ${attachedContextItem.name}` : "Run deep deploy")
          : activeDeployMode === "deploy"
            ? (attachedContextItem ? `Deploy ${attachedContextItem.name}` : "Deploy immediately")
            : (attachedContextItem ? `Deploy / Inspect ${attachedContextItem.name}` : "")
      ),
      attachedContext: effectiveContext || undefined,
      deployMode: activeDeployMode || undefined,
      timestamp: new Date(),
    };
    lastUserPromptRef.current = cleanText || userMsg.content;
    setSelectedContext(null);
    setDeployMode(null);
    setExecutionMode(null);
    setChipOrder([]);
    // Instant pre-flight check: if active model's API key is missing, show error card in 0ms
    const provider = getProviderFromModelId(modelId);
    const hasKey = isProviderKeyConfigured(provider, apiKeysStatus);
    if (apiKeysStatus !== null && !hasKey) {
      const providerLabel = getProviderDisplayName(provider);
      const selectedModelObj = MODELS.find((m) => m.id === modelId);
      const modelLabel = selectedModelObj?.label || modelId;
      const keyErrMsg = `API key not configured: ${modelLabel} requires an API key for ${providerLabel}. Please add your key in Settings → Keys to start using this model.`;

      const instantAssistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
        errorMessage: keyErrMsg,
        timestamp: new Date(),
        streaming: false,
      };

      const newMessages = [...messages, userMsg, instantAssistantMsg];
      setMessages(newMessages);
      setIsLoading(false);

      // Persist user query and error to session in background
      ensureSession(cleanText).then((sid) => {
        saveMessages(sid, newMessages).catch(() => {});
      }).catch(() => {});

      return;
    }

    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      streaming: true,
    };
    const currentMsgIdRef = { current: assistantMsg.id };

    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, assistantMsg]);
    setIsLoading(true);
    abortRef.current = new AbortController();

    const sid = await ensureSession(cleanText);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          messages: [
            ...newMessages.slice(0, -1).map((m) => ({
              role: m.role,
              content: m.role === "assistant" ? extractCleanAssistantContent(m.content).cleanText : m.content,
            })),
            { role: "user", content: enrichedText },
          ],
          modelId,
          userMessageToSave: userMsg.content,
          attachedContextItem: effectiveContext,
          executionMode: activeExecutionMode || defaultExecutionMode || undefined,
        }),
        signal: abortRef.current.signal,
      });

      // Promptly inform sidebar that run has started
      window.dispatchEvent(new CustomEvent("ray:chat-status-change"));

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to get response");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = "";
      let fullAssistantText = "";
      let thinkingText = "";
      const toolBlocks: ToolBlock[] = [];
      const parts: MessagePart[] = [];
      let activeToolBlock: ToolBlock | null = null;
      let isDone = false;

      const processLine = (line: string): boolean => {
        if (!line.trim()) return false;

        // ── Finish marker (AI SDK / SSE): d:{"finishReason":"stop",...} or data: [DONE] ──
        if (line.startsWith("d:") || line.includes('"finishReason"') || line.trim() === "data: [DONE]") {
          return true;
        }

        // ── Structured SSE event: data: {...} ──
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.slice(6));

            if (json.type === "finish" || json.type === "done" || json.finishReason) {
              return true;
            }

            if (json.type === "plan-created") {
              window.dispatchEvent(new CustomEvent("ray:plan-updated", { detail: json }));
              window.dispatchEvent(new Event("ray:open-terminal"));
              return false;
            }

            // Thinking delta
            if (json.type === "thinking-delta" && typeof json.delta === "string") {
              thinkingText += json.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentMsgIdRef.current
                    ? {
                      ...m,
                      content: fullAssistantText,
                      thinking: thinkingText,
                      parts: [...parts],
                      toolBlocks: [...toolBlocks],
                      streaming: true,
                    }
                    : m
                )
              );
              return false;
            }

            if (json.type === "tool-start" || json.type === "tool-output" || json.type === "tool-end") {
              const toolEvent = { ...json, id: `${json.type}-${Date.now()}-${Math.random()}` };

              if (json.type === "tool-start") {
                const newBlock: ToolBlock = {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  tool: json.tool,
                  cmd: json.cmd || json.tool,
                  status: "running",
                  output: "",
                  startTime: Date.now(),
                };
                activeToolBlock = newBlock;
                toolBlocks.push(newBlock);
                parts.push({ type: "tool", block: newBlock });

                if (json.tool === "deploy") {
                  const nameMatch = (json.cmd || "").match(/name="([^"]+)"/) || (json.cmd || "").match(/deploy\s+([^\s|>]+)/);
                  const pathMatch = (json.cmd || "").match(/path="([^"]+)"/);
                  const name = nameMatch ? nameMatch[1] : "Application";
                  const projectPath = pathMatch ? pathMatch[1] : "";
                  window.dispatchEvent(
                    new CustomEvent("ray:tool-deploy-start", {
                      detail: { name, projectPath },
                    })
                  );
                } else if (json.tool === "deployment_setup") {
                    // Setup is rendered inline; no deployment or terminal has started.
                  } else if (json.tool === "monitor_add") {
                  window.dispatchEvent(new Event("ray:open-monitor-project"));
                } else {
                  // Open terminal for command execution
                  window.dispatchEvent(new Event("ray:open-terminal"));
                }

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === currentMsgIdRef.current
                      ? {
                        ...m,
                        content: fullAssistantText,
                        thinking: thinkingText || m.thinking,
                        parts: [...parts],
                        toolBlocks: [...toolBlocks],
                        streaming: true,
                      }
                      : m
                  )
                );
              } else if (json.type === "tool-output" && activeToolBlock && json.delta) {
                activeToolBlock.output += json.delta;

                if (json.tool === "deploy" || activeToolBlock.tool === "deploy") {
                  window.dispatchEvent(
                    new CustomEvent("ray:tool-deploy-output", {
                      detail: { delta: json.delta },
                    })
                  );
                }

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === currentMsgIdRef.current
                      ? {
                        ...m,
                        content: fullAssistantText,
                        thinking: thinkingText || m.thinking,
                        parts: [...parts],
                        toolBlocks: [...toolBlocks],
                      }
                      : m
                  )
                );
              } else if (json.type === "tool-end" && activeToolBlock) {
                activeToolBlock.status = (json.exit ?? 0) === 0 ? "completed" : "error";
                activeToolBlock.durationSec = Math.max(0.1, (Date.now() - activeToolBlock.startTime) / 1000);
                activeToolBlock.exit = json.exit ?? 0;

                if (json.tool === "deploy" || activeToolBlock.tool === "deploy") {
                  window.dispatchEvent(
                    new CustomEvent("ray:tool-deploy-end", {
                      detail: { exit: json.exit },
                    })
                  );
                }

                activeToolBlock = null;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === currentMsgIdRef.current
                      ? {
                        ...m,
                        content: fullAssistantText,
                        thinking: thinkingText || m.thinking,
                        parts: [...parts],
                        toolBlocks: [...toolBlocks],
                      }
                      : m
                  )
                );
              }

              // Always dispatch the tool event for the right sidebar terminal
              window.dispatchEvent(new CustomEvent("ray:tool-event", { detail: toolEvent }));
              return false;
            }

            // approval-request — inject an approval card into the chat
            if (json.type === "approval-request") {
              const isMonitorAdd = json.tool === "monitor_add" || (json.cmd || "").startsWith("monitor_add");
              setMessages((prev) => {
                const withoutAssistant = prev.filter((m) => m.id !== assistantMsg.id);
                return [
                  ...withoutAssistant,
                  {
                    id: `approval-${json.id}`,
                    role: "assistant" as const,
                    content: "",
                    timestamp: new Date(),
                    kind: isMonitorAdd ? ("monitor-add-approval" as const) : ("approval" as const),
                    approvalId: json.id,
                    approvalTool: json.tool,
                    approvalCmd: json.cmd,
                    approvalState: "pending" as const,
                    monitorProjectName: json.projectName,
                    monitorProjectPath: json.projectPath,
                    monitorInterval: json.intervalSec,
                  },
                ];
              });
              return false;
            }

            // json-encoded text-delta inside data: wrapper
            if (json.type === "text-delta" && typeof json.delta === "string") {
              fullAssistantText += json.delta;
              const lastPart = parts[parts.length - 1];
              if (lastPart && lastPart.type === "text") {
                lastPart.text += json.delta;
              } else {
                parts.push({ type: "text", text: json.delta });
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentMsgIdRef.current
                    ? {
                      ...m,
                      content: fullAssistantText,
                      thinking: thinkingText || m.thinking,
                      parts: [...parts],
                      toolBlocks: [...toolBlocks],
                      streaming: true,
                    }
                    : m
                )
              );
            }
          } catch { /* partial/malformed */ }
          return false;
        }

        // ── Vercel AI SDK text delta: 0:"text" ──
        if (line.startsWith("0:")) {
          try {
            const parsed = JSON.parse(line.slice(2));
            if (typeof parsed === "string") {
              fullAssistantText += parsed;
              const lastPart = parts[parts.length - 1];
              if (lastPart && lastPart.type === "text") {
                lastPart.text += parsed;
              } else {
                parts.push({ type: "text", text: parsed });
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentMsgIdRef.current
                    ? {
                      ...m,
                      content: fullAssistantText,
                      thinking: thinkingText || m.thinking,
                      parts: [...parts],
                      toolBlocks: [...toolBlocks],
                      streaming: true,
                    }
                    : m
                )
              );
            }
          } catch { /* partial */ }
          return false;
        }

        // ── Vercel AI SDK error stream line: 3:"error message" ──
        const streamError = parseChatErrorLine(line);
        if (streamError) throw new Error(streamError);
        return false;
      };

      while (!isDone) {
        const { done, value } = await reader.read();
        if (done) break;
        rawBuffer += decoder.decode(value, { stream: true });
        // Process all complete lines (split on \n, keep remainder in buffer)
        const lines = rawBuffer.split("\n");
        rawBuffer = lines.pop() ?? ""; // last element may be incomplete
        for (const line of lines) {
          if (processLine(line)) {
            isDone = true;
            break;
          }
        }
      }
      // Process any remaining buffered content
      if (!isDone && rawBuffer.trim()) {
        processLine(rawBuffer);
      }

      const finalFullContent = fullAssistantText.trim();

      // Ensure that if no content and no tool executions took place, we surface a clear error
      if (!finalFullContent && toolBlocks.length === 0 && !thinkingText) {
        throw new Error("No response received from the model. Something went wrong.");
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentMsgIdRef.current
            ? {
              ...m,
              content: finalFullContent,
              thinking: thinkingText || m.thinking,
              parts: [...parts],
              toolBlocks: [...toolBlocks],
              streaming: false,
            }
            : m
        )
      );

      // Update message in state to final completed state
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentMsgIdRef.current
            ? {
              ...m,
              content: finalFullContent,
              thinking: thinkingText || m.thinking,
              parts: [...parts],
              toolBlocks: [...toolBlocks],
              streaming: false,
            }
            : m
        )
      );

      // Note: User & assistant messages are already safely saved to MySQL by the background chatRunner
      window.dispatchEvent(new CustomEvent("ray:chat-status-change"));
      if (messages.length === 0) {
        window.dispatchEvent(new Event("ray:session-created"));
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      let rawErrMsg = err instanceof Error ? err.message : "network error";

      // Translate technical connection / fetch errors into a clear, actionable user message
      if (
        !isAbort &&
        (rawErrMsg.includes("fetch failed") ||
          rawErrMsg.includes("Failed to fetch") ||
          rawErrMsg.includes("ECONNREFUSED") ||
          rawErrMsg.toLowerCase() === "network error")
      ) {
        rawErrMsg = "Unable to reach the PutMeIn AI service. Please check your network connection and verify that the background AI service is running.";
      }

      const isNetworkErr =
        !isAbort &&
        !isApiKeyError(rawErrMsg) &&
        (rawErrMsg.includes("network") ||
          rawErrMsg.includes("Socket") ||
          rawErrMsg.includes("fetch") ||
          rawErrMsg.includes("terminated") ||
          rawErrMsg.includes("connection") ||
          rawErrMsg.includes("AI service") ||
          rawErrMsg.includes("500") ||
          rawErrMsg.includes("502") ||
          rawErrMsg.includes("504") ||
          rawErrMsg.includes("503"));

      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentMsgIdRef.current
            ? {
              ...m,
              errorMessage: isAbort ? undefined : rawErrMsg,
              isRetryable: !isAbort,
              streaming: false,
            }
            : m
        )
      );

      // Controlled retry limit: at most 1 automatic retry attempt for transient network disconnects.
      // Automatically stops after 1 attempt, giving user clear manual Retry and Cancel buttons.
      if (isNetworkErr && autoRetryAttemptRef.current < 1) {
        const nextAttempt = autoRetryAttemptRef.current + 1;
        autoRetryAttemptRef.current = nextAttempt;
        setAutoRetryAttempt(nextAttempt);
        setAutoRetryCountdown(5);

        if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
        let count = 5;
        autoRetryTimerRef.current = setInterval(() => {
          count -= 1;
          if (count > 0) {
            setAutoRetryCountdown(count);
          } else {
            if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
            autoRetryTimerRef.current = null;
            setAutoRetryCountdown(null);

            // Retry the user's actual prompt rather than a generic phantom message
            const promptToRetry =
              lastUserPromptRef.current ||
              [...messages].reverse().find((m) => m.role === "user")?.content ||
              "";

            if (promptToRetry) {
              setMessages((prev) =>
                prev.filter((m) => m.id !== currentMsgIdRef.current)
              );
              sendTextRef.current?.(promptToRetry);
            }
          }
        }, 1000);
      } else {
        // Stop automatically retrying; keep error displayed and ready for manual retry or cancel
        if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
        setAutoRetryCountdown(null);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [messages, modelId, isLoading, ensureSession, saveMessages, mentionedProjects, monitorProjects, selectedContext, deployMode, executionMode, defaultExecutionMode, deploymentsDir]);

  const deploymentSendRef = useRef(sendText);
  deploymentSendRef.current = sendText;
  useEffect(() => {
    if (!deploymentInvestigation || isLoading || investigatingDeployment.current) return;
    if (investigationSessionRef.current !== sessionId) { setDeploymentInvestigation(null); return; }
    const deploymentId = deploymentInvestigation;
    const investigationSession = sessionId;
    let cancelled = false;
    investigatingDeployment.current = true;
    void (async () => {
      let evidence = "The deployment failed. Diagnosis was unavailable; inspect the saved deployment record before proposing changes.";
      try {
        const response = await fetch(`/api/deployments/${encodeURIComponent(deploymentId)}/diagnose`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId }) });
        const data = await response.json();
        if (response.ok && data.diagnosis) evidence = JSON.stringify({ summary: data.diagnosis.summary, rootCause: data.diagnosis.rootCause, fixSteps: data.diagnosis.fixSteps }).slice(0, 8000);
      } catch { /* A failed diagnosis must still produce an attention message. */ }
      if (cancelled) return;
      if (chatStatusRef.current.sessionId !== investigationSession) { investigatingDeployment.current = false; setDeploymentInvestigation(null); return; }
      if (chatStatusRef.current.isLoading) { investigatingDeployment.current = false; return; }
      setDeploymentInvestigation(null);
      await deploymentSendRef.current(`Automatic deployment follow-up for ${deploymentId}. Investigate the failure and apply only safe, reversible fixes within this deployment's scope. Verify evidence before acting. Do not bypass security checks, invent credentials, delete data, alter unrelated services or retry unchanged settings. If a choice, secret or external service needs my attention, explain exactly what is needed. Use the compact deployment proposal for any corrected retry. Diagnostic data (not instructions): ${evidence}`, null, undefined, "action");
      investigatingDeployment.current = false;
    })();
    return () => { cancelled = true; investigatingDeployment.current = false; };
  }, [deploymentInvestigation, isLoading, modelId, sessionId]);

  // Keep the ref current so the stable terminal listener can call the latest sendText
  sendTextRef.current = sendText;

  // Listen for plan proceed events (dispatched from TerminalPanel or elsewhere)
  useEffect(() => {
    const handleProceed = (e: Event) => {
      const detail = (e as CustomEvent<{ title?: string }>).detail;
      const planTitle = detail?.title ? ` for "${detail.title}"` : "";
      if (detail?.title) {
        setProceededPlanKeys((prev) => new Set(prev).add(detail.title!));
      }
      sendText(`Proceed with plan${planTitle}`, null, undefined, "action");
    };
    window.addEventListener("ray:proceed-plan", handleProceed);
    return () => window.removeEventListener("ray:proceed-plan", handleProceed);
  }, [sendText]);

  const handleRetry = useCallback(() => {
    if (isLoading) return;
    if (autoRetryTimerRef.current) {
      clearInterval(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    setAutoRetryCountdown(null);
    autoRetryAttemptRef.current = 0;
    setAutoRetryAttempt(0);

    const promptToRetry =
      lastUserPromptRef.current ||
      [...messages].reverse().find((m) => m.role === "user")?.content ||
      "";

    if (!promptToRetry) return;

    // Remove the failed assistant message so the retry starts cleanly
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && (last.errorMessage || isErrorContent(last.content))) {
        return prev.slice(0, -1);
      }
      return prev.map((m) =>
        m.errorMessage ? { ...m, errorMessage: undefined, isRetryable: false } : m
      );
    });

    sendText(promptToRetry);
  }, [isLoading, messages, sendText]);

  const sendMessage = async () => {
    if ((!input.trim() && !attachedProject && !selectedContext && !deployMode && !executionMode) || isLoading || isUploading) return;

    let textToSend = input.trim();
    const currentAttached = attachedProject;
    const currentCtx = selectedContext ? { ...selectedContext } : null;
    const currentDeployMode = deployMode;
    const currentExecutionMode = executionMode;

    setSelectedContext(null);
    setDeployMode(null);
    setExecutionMode(null);
    setChipOrder([]);

    if (currentAttached) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        if (currentAttached.type === "zip" && currentAttached.zipFile) {
          formData.append("zip", currentAttached.zipFile);
          formData.append("name", currentAttached.name.replace(/\.(zip|tar\.gz|tar)$/i, ""));
        } else if (currentAttached.files) {
          formData.append("name", currentAttached.name);
          for (const f of currentAttached.files) {
            formData.append("files", f);
          }
        }

        const res = await fetch("/api/deploy/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          alert(`Upload error: ${err.error || "Failed to upload"}`);
          setIsUploading(false);
          return;
        }

        const data = await res.json();

        // Open Deploy visual tab in right sidebar
        window.dispatchEvent(
          new CustomEvent("ray:open-deploy", {
            detail: {
              name: data.name,
              projectPath: data.projectPath,
              sourceType: "upload",
            },
          })
        );

        if (!textToSend) {
          if (currentDeployMode === "deep-deploy") {
            textToSend = `I uploaded the project "${data.name}" located at "${data.projectPath}". Please run a deep deploy: inspect monorepo workspaces, database migrations, dependencies, and test the build before packaging and deploying to Docker.`;
          } else {
            textToSend = `I uploaded the project "${data.name}" located at "${data.projectPath}". Please inspect the codebase, package it into a Docker container, deploy it, and add it to 24/7 monitoring.`;
          }
        } else {
          textToSend = `${textToSend}\n\n[Attached project "${data.name}" uploaded to ${data.projectPath}]`;
        }

        setAttachedProject(null);
      } catch (err: unknown) {
        alert(`Upload error: ${(err as Error).message}`);
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    sendText(textToSend, currentCtx, currentDeployMode, currentExecutionMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Arrow key & Enter navigation within the "/" slash commands popover
    if (slashQuery !== null && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashQuery(null);
        setSlashStart(-1);
        return;
      }
    }

    // Arrow key navigation within the @ mention dropdown
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectMention(filteredMentions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        setMentionStart(-1);
        return;
      }
    }

    // Backspace on empty input removes the most recent attached chip
    if (e.key === "Backspace" && input === "") {
      if (chipOrder.length > 0) {
        const last = chipOrder[chipOrder.length - 1];
        if (last === "deploy") {
          setDeployMode(null);
          setChipOrder((prev) => prev.slice(0, -1));
        } else if (last === "context") {
          setSelectedContext(null);
          setChipOrder((prev) => prev.slice(0, -1));
        } else if (last === "project") {
          setAttachedProject(null);
          setChipOrder((prev) => prev.slice(0, -1));
        } else if (last === "execution") {
          setExecutionMode(null);
          setChipOrder((prev) => prev.slice(0, -1));
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleStop = () => {
    if (autoRetryTimerRef.current) {
      clearInterval(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    setAutoRetryCountdown(null);
    autoRetryAttemptRef.current = 0;
    setAutoRetryAttempt(0);
    abortRef.current?.abort();

    if (sessionId) {
      fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
  };

  const modelName = MODELS.find((m) => m.id === modelId)?.label || "Ozias";

  /* ── Render ─────────────────────────────────── */
  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{ background: "transparent" }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 pointer-events-none"
          style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }}
        >
          <div className="p-8 rounded-2xl border-2 border-dashed border-white/40 bg-[#0c0c0c]/95 flex flex-col items-center gap-3 text-center max-w-sm shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-white">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                <polyline points="12 11 12 17" />
                <polyline points="9 14 12 11 15 14" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Drop Project Folder or ZIP</h4>
              <p className="text-xs text-white/50 mt-1">Files will be attached for containerized Docker deployment</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header
        className="flex items-center justify-between px-4 sm:px-6 py-3.5 flex-shrink-0"
        style={{
          background: "rgba(255,255,255,0.02)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.02)",
        }}
      >
        <div>
          <h1 className="font-jersey text-2xl text-white tracking-wide leading-none">
            Chat
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-mono)" }}>
            {messages.length === 0
              ? "New conversation"
              : `${messages.filter((m) => m.role === "user").length} message${messages.filter((m) => m.role === "user").length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {/* Right side: terminal toggle + new chat */}
        <div className="flex items-center gap-2">
          {/* Tool Window Toggle (Terminal & Monitor Logs) — always visible in header */}
          <button
            onClick={() => window.dispatchEvent(new Event("ray:toggle-terminal"))}
            title={terminalOpen ? "Close Tool Window (Terminal & Monitor Logs)" : "Open Tool Window (Terminal & Monitor Logs)"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-150 text-xs font-medium"
            style={{
              color: terminalOpen ? "#fff" : "rgba(255,255,255,0.45)",
              background: terminalOpen ? "rgba(255,255,255,0.08)" : "transparent",
              border: terminalOpen ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(255,255,255,0.06)",
            }}
            onMouseEnter={(e) => {
              if (!terminalOpen) {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.8)";
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
              }
            }}
            onMouseLeave={(e) => {
              if (!terminalOpen) {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)";
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }
            }}
            aria-label="Toggle Tool Window"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span className="hidden sm:inline">Tool Window</span>
          </button>

          {/* New chat — only when there are messages */}
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setSessionId(null); router.push("/chat"); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all duration-150"
              style={{
                color: "rgba(255,255,255,0.3)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.7)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
              New chat
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={chatScrollRef}
        onScroll={handleChatScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6"
      >
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
            <div className="mb-6 flex items-center justify-center">
              <Image
                src="/logo.svg"
                alt="Ray"
                width={72}
                height={72}
                className="w-16 h-16 sm:w-[72px] sm:h-[72px] object-contain"
                priority
              />
            </div>

            <h2 className="font-jersey text-4xl text-white mb-2 tracking-wide">
              Hi, I&apos;m {modelName}
            </h2>
            <p className="text-sm mb-6 max-w-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
              Your AI assistant for servers, deployments, and DevOps.
            </p>

            {apiKeysStatus !== null && !isKeyConfigured && (
              <div className="mb-8 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center gap-2.5 text-xs text-amber-200 animate-fade-in">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-400 shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{activeProviderLabel} API key required for {modelName}.</span>
                <Link href="/settings?tab=keys" className="underline font-semibold hover:text-white transition-colors cursor-pointer ml-1">
                  Configure Key →
                </Link>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(s);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  className="text-left px-4 py-3 rounded-xl text-sm transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.55)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
                    (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "0 0 16px rgba(255,255,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
                    (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-6">
            {messages.map((msg, idx) => (
              <div
                key={msg.id}
                className={`flex gap-3 animate-fade-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.kind === "approval" ? (
                  /* Approval card — no bubble wrapper */
                  <ApprovalCard msg={msg} onResolve={handleApprovalResolve} />
                ) : msg.kind === "monitor-add-approval" ? (
                  /* Monitor Add approval card */
                  <div
                    style={{
                      width: "100%",
                      background: "#0e0e0e",
                      border: "1px solid rgba(34,197,94,0.2)",
                      borderLeft: "3px solid #22c55e",
                      borderRadius: 10,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      <span style={{ fontSize: 11, color: "rgba(34,197,94,0.9)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                        Add to Monitor
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 8 }}>
                      The AI wants to start monitoring <strong style={{ color: "#fff" }}>{msg.monitorProjectName || "this project"}</strong>.
                    </p>
                    {msg.monitorProjectPath && (
                      <div style={{ fontFamily: "'Menlo','Monaco','Courier New',monospace", fontSize: 11.5, color: "rgba(255,255,255,0.4)", background: "#1a1a1a", borderRadius: 5, padding: "5px 9px", marginBottom: 10 }}>
                        {msg.monitorProjectPath}
                      </div>
                    )}
                    {msg.approvalState !== "pending" ? (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                        {msg.approvalState === "approved" ? "✓  Added to monitor" : "✕  Cancelled"}
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={async () => {
                            try {
                              await fetch(`${BRAIN_URL}/v1/chat/approve`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: msg.approvalId, approved: true }),
                              });
                            } catch { /* optimistic */ }
                            handleApprovalResolve(msg.approvalId!, true);
                          }}
                          style={{
                            flex: 1, padding: "6px 0", borderRadius: 6,
                            border: "1px solid rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.1)",
                            color: "#22c55e", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          Start Monitoring
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await fetch(`${BRAIN_URL}/v1/chat/approve`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: msg.approvalId, approved: false }),
                              });
                            } catch { /* optimistic */ }
                            handleApprovalResolve(msg.approvalId!, false);
                          }}
                          style={{
                            flex: 1, padding: "6px 0", borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.08)", background: "transparent",
                            color: "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 500, cursor: "pointer",
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={`flex flex-col gap-1 w-full ${msg.role === "user" ? "max-w-[85%] sm:max-w-[75%]" : "max-w-full"}`}>
                    <div
                      className={`group relative px-4 py-3 rounded-2xl ${msg.role === "user" ? "rounded-tr-md ml-auto" : "rounded-tl-md"}`}
                      style={
                        msg.role === "user"
                          ? {
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            boxShadow: "0 0 16px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.08)",
                            color: "rgba(255,255,255,0.9)",
                            fontSize: "0.9375rem",
                            lineHeight: "1.6",
                          }
                          : {
                            background: "transparent",
                            color: "rgba(255,255,255,0.85)",
                          }
                      }
                    >
                      {msg.role === "assistant" ? (
                        <div className="flex flex-col gap-2 w-full">
                          {/* Top Unified Process Accordion with Thinking + Terminal commands, followed by clean Markdown response */}
                          {(() => {
                            const { cleanText, extractedThinking, parsedBlocks, extractedPlan } = extractCleanAssistantContent(msg.content);
                            const allBlocks = msg.toolBlocks && msg.toolBlocks.length > 0 ? msg.toolBlocks : parsedBlocks;
                            const combinedThinking = msg.thinking || extractedThinking;
                            const visibleToolBlocks = allBlocks.filter(block => block.tool !== "deployment_setup");

                            return (
                              <>
                                {(visibleToolBlocks.length > 0 || Boolean(combinedThinking && combinedThinking.trim().length > 0)) && (
                                  <TopProcessAccordion
                                    blocks={visibleToolBlocks}
                                    thinking={combinedThinking}
                                    isStreaming={msg.streaming}
                                  />
                                )}

                                {!allBlocks.some(block => block.tool === "deployment_setup" || block.tool === "deploy") && !msg.streaming && /deployment setup card|setup card is now open/i.test(cleanText) && <div className="rounded-xl border border-white/10 p-4 text-sm"><p className="text-white/60 mb-2">The assistant mentioned deployment setup, but no setup request was received.</p><a href="/deployments/new" className="ray-btn-primary text-xs">Open deployment setup</a></div>}
                                {allBlocks.filter(block => (block.tool === "deployment_setup" || block.tool === "deploy") && block.status !== "running").map(block => <ChatDeploymentSetup key={block.id} output={block.output} sessionId={sessionId} proposalId={block.id} onInvestigate={id => { investigationSessionRef.current = sessionId; setDeploymentInvestigation(id); }} onMessage={result => setMessages(previous => {
                                  const message: Message = { id: result.id, role: "assistant", content: result.content, timestamp: new Date(result.createdAt) };
                                  const existing = previous.find(item => item.id === result.id);
                                  if (existing?.content === result.content) return previous;
                                  return existing ? previous.map(item => item.id === result.id ? message : item) : [...previous, message];
                                })} />)}

                                {extractedPlan && (
                                  <PlanCard
                                    plan={extractedPlan}
                                    isStreaming={msg.streaming}
                                    hasProceeded={
                                      idx < messages.length - 1 ||
                                      (msg.id ? proceededPlanKeys.has(msg.id) : false) ||
                                      proceededPlanKeys.has(extractedPlan.title)
                                    }
                                    onProceed={() => {
                                      setProceededPlanKeys((prev) => {
                                        const next = new Set(prev);
                                        if (msg.id) next.add(msg.id);
                                        if (extractedPlan.title) next.add(extractedPlan.title);
                                        return next;
                                      });
                                      sendText(`Proceed with plan for "${extractedPlan.title}"`, null, undefined, "action");
                                    }}
                                  />
                                )}

                                {cleanText ? (
                                  <MarkdownContent content={cleanText} />
                                ) : msg.streaming ? (
                                  (() => {
                                    const runningBlock = allBlocks.find((b) => b.status === "running");
                                    if (runningBlock) {
                                      return (
                                        <div className="flex items-center gap-2.5 text-white/80 text-xs py-1.5 font-mono">
                                          <StateSpinner color="emerald" size="sm" />
                                          <span>
                                            Executing: <strong className="text-emerald-300 font-semibold">{runningBlock.cmd || runningBlock.tool}</strong>
                                          </span>
                                        </div>
                                      );
                                    }
                                    if (combinedThinking && combinedThinking.trim().length > 0) {
                                      return (
                                        <div className="flex items-center gap-2.5 text-purple-200/90 text-xs py-1.5">
                                          <StateSpinner color="purple" size="sm" />
                                          <span className="font-sans font-medium">Thinking through steps…</span>
                                        </div>
                                      );
                                    }
                                    if (allBlocks.length > 0) {
                                      return (
                                        <div className="flex items-center gap-2.5 text-blue-200/90 text-xs py-1.5">
                                          <StateSpinner color="blue" size="sm" />
                                          <span className="font-sans font-medium">Formulating response…</span>
                                        </div>
                                      );
                                    }
                                    return (
                                      <div className="flex items-center gap-2.5 text-amber-200/90 text-xs py-1.5">
                                        <StateSpinner color="amber" size="sm" />
                                        <span className="font-sans font-medium">Analyzing workspace…</span>
                                      </div>
                                    );
                                  })()
                                ) : null}
                              </>
                            );
                          })()}

                          {/* Error card with Try again retry button / Auto-retry countdown */}
                          {(msg.errorMessage || isErrorContent(msg.content)) && (
                            <div className={`rounded-xl border ${autoRetryCountdown !== null && autoRetryCountdown > 0 || isApiKeyError(msg.errorMessage || msg.content) ? "border-amber-500/30 bg-amber-500/[0.08]" : "border-red-500/25 bg-red-500/[0.07]"} p-3.5 my-1.5 text-xs flex items-center justify-between gap-3 max-w-xl shadow-lg animate-fade-in`}>
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <div className={`w-5 h-5 rounded-md ${autoRetryCountdown !== null && autoRetryCountdown > 0 || isApiKeyError(msg.errorMessage || msg.content) ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"} flex items-center justify-center shrink-0 mt-0.5`}>
                                  {autoRetryCountdown !== null && autoRetryCountdown > 0 ? (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                                    </svg>
                                  ) : (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className={`font-semibold ${autoRetryCountdown !== null && autoRetryCountdown > 0 || isApiKeyError(msg.errorMessage || msg.content) ? "text-amber-200" : "text-red-200"} text-xs mb-0.5`}>
                                    {autoRetryCountdown !== null && autoRetryCountdown > 0
                                      ? `Connection Issue (Auto-retrying in ${autoRetryCountdown}s)`
                                      : isApiKeyError(msg.errorMessage || msg.content)
                                        ? "API Key Not Configured"
                                        : "Request Failed"}
                                  </div>
                                  <p className="text-white/80 leading-relaxed text-xs font-mono break-words whitespace-pre-wrap">
                                    {(msg.errorMessage || msg.content).replace(/^Error:\s*|^API Key Error:\s*/i, "")}
                                  </p>
                                </div>
                              </div>

                              {autoRetryCountdown !== null && autoRetryCountdown > 0 ? (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={handleRetry}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.12] hover:bg-white/[0.2] text-white border border-white/20 text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
                                  >
                                    <span>Retry Now</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleStop}
                                    className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-transparent hover:bg-white/5 text-white/50 hover:text-white/80 text-xs font-medium transition-all cursor-pointer"
                                  >
                                    <span>Cancel</span>
                                  </button>
                                </div>
                              ) : isApiKeyError(msg.errorMessage || msg.content) ? (
                                <Link
                                  href="/settings?tab=keys"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-white border border-white/20 text-xs font-semibold transition-all cursor-pointer flex-shrink-0"
                                >
                                  <span>Add API Key →</span>
                                </Link>
                              ) : (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={handleRetry}
                                    disabled={isLoading}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white text-black hover:bg-white/90 text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                                    </svg>
                                    <span>Try again</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleStop}
                                    className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-transparent hover:bg-white/5 text-white/50 hover:text-white/80 text-xs font-medium transition-all cursor-pointer"
                                  >
                                    <span>Cancel</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Live streaming indicator when not running a tool */}
                          {msg.streaming && (!msg.toolBlocks || !msg.toolBlocks.some((b) => b.status === "running")) && (
                            <span className="inline-block w-[2px] h-[1em] ml-0.5 animate-blink rounded-full align-middle bg-white/60" />
                          )}
                        </div>
                      ) : (
                        <div>
                          {(msg.attachedContext || msg.deployMode) && (
                            <div className="flex flex-col gap-1.5 mb-2.5">
                              {/* Deploy / Deep Deploy chip */}
                              {(msg.deployMode || msg.attachedContext?.deployMode || msg.attachedContext?.type === "deploy" || msg.attachedContext?.type === "deep-deploy") && (() => {
                                const mode = msg.deployMode || msg.attachedContext?.deployMode || (msg.attachedContext?.type === "deep-deploy" ? "deep-deploy" : "deploy");
                                const isDeep = mode === "deep-deploy";
                                return (
                                  <div
                                    className="px-3 py-1.5 rounded-lg flex items-center justify-between gap-3 text-xs font-mono shadow-sm"
                                    style={{
                                      background: "rgba(12,12,12,0.85)",
                                      border: isDeep ? "1px solid rgba(168,85,247,0.3)" : "1px solid rgba(16,185,129,0.3)",
                                    }}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div
                                        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                                        style={{ background: isDeep ? "rgba(168,85,247,0.15)" : "rgba(16,185,129,0.15)" }}
                                      >
                                        {isDeep ? (
                                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                          </svg>
                                        ) : (
                                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                            <polyline points="22 4 12 14.01 9 11.01" />
                                          </svg>
                                        )}
                                      </div>
                                      <span className="font-semibold text-white truncate max-w-[220px]">
                                        {isDeep ? "deep deploy" : "deploy"}
                                      </span>
                                    </div>
                                    <span
                                      className={`text-[10px] uppercase tracking-wider font-mono flex-shrink-0 px-1.5 py-0.5 rounded ${
                                        isDeep
                                          ? "text-purple-300 bg-purple-500/10 border border-purple-500/20"
                                          : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                                      }`}
                                    >
                                      {isDeep ? "Deep Verification" : "Immediate Deploy"}
                                    </span>
                                  </div>
                                );
                              })()}

                              {/* Target context chip (GitHub, Project, Container, Monitor) */}
                              {msg.attachedContext && msg.attachedContext.type !== "deploy" && msg.attachedContext.type !== "deep-deploy" && (
                                <div className="px-3 py-1.5 rounded-lg bg-black/50 border border-white/20 flex items-center justify-between gap-3 text-xs font-mono shadow-sm">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-white/10">
                                      {msg.attachedContext.type === "github" ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                                        </svg>
                                      ) : msg.attachedContext.type === "container" ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-sky-400">
                                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                        </svg>
                                      ) : msg.attachedContext.type === "monitor" ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                        </svg>
                                      ) : (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/70">
                                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                        </svg>
                                      )}
                                    </div>
                                    <span className="font-semibold text-white truncate max-w-[200px]">{msg.attachedContext.name}</span>
                                  </div>
                                  <span className="text-[10px] text-white/50 uppercase tracking-wider font-mono flex-shrink-0">
                                    {msg.attachedContext.type}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                          <p style={{ fontSize: "0.9375rem", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>{msg.content}</p>
                        </div>
                      )}
                    </div>
                    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} px-1`}>
                      <CopyButton text={msg.content} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Arrow Button for Chat */}
      {showChatScrollBottom && (
        <div className="absolute bottom-24 sm:bottom-28 right-6 sm:right-10 z-40 animate-fade-in pointer-events-auto">
          <button
            onClick={() => scrollToBottom("smooth")}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-[#181818]/95 hover:bg-[#252525] text-white border border-white/20 shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer group"
            title="Scroll to latest message"
            aria-label="Scroll to latest message"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="group-hover:translate-y-0.5 transition-transform text-white/90"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}

      {/* Input bar */}
      <div
        className="flex-shrink-0 px-4 sm:px-6 pb-4 sm:pb-5 pt-2"
        style={{ background: "transparent" }}
      >
        <div
          className="max-w-3xl mx-auto rounded-2xl transition-all duration-200 relative"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
          onFocus={() => { }}
        >
          {/* Missing API Key Warning Banner */}
          {apiKeysStatus !== null && !isKeyConfigured && (
            <div className="mx-3 mt-3 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-300 flex items-center justify-center flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="text-xs text-amber-200/90 truncate">
                  <span className="font-semibold text-amber-100">{activeProviderLabel} API key required</span>
                  <span className="text-amber-300/70 hidden sm:inline"> — add it in settings to chat with {modelName}</span>
                </div>
              </div>
              <Link
                href="/settings?tab=keys"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 text-xs font-semibold transition-colors flex-shrink-0 cursor-pointer"
              >
                <span>Add Key</span>
                <span className="text-[10px]">→</span>
              </Link>
            </div>
          )}

          {/* Slash Commands (/) Pop-up Menu */}
          {slashQuery !== null && filteredSlashCommands.length > 0 && (
            <div
              className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100"
              style={{
                background: "#0c0c0c",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 -10px 40px rgba(0,0,0,0.9)",
              }}
            >
              <div className="px-3.5 py-2 border-b border-white/[0.06] flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Commands & Context — ↑↓ to navigate · Enter to select
                </span>
                <span className="text-[10px] font-mono text-white/30">Esc to dismiss</span>
              </div>
              <div className="p-1.5 flex flex-col gap-0.5 max-h-[290px] overflow-y-auto">
                {filteredSlashCommands.map((cmd, idx) => (
                  <button
                    key={cmd.id}
                    type="button"
                    ref={(el) => { slashItemRefs.current[idx] = el; }}
                    onMouseDown={(e) => { e.preventDefault(); selectSlashCommand(cmd); }}
                    onMouseEnter={() => setSlashIndex(idx)}
                    className={`w-full px-3 py-2.5 rounded-xl text-left flex items-center gap-3 transition-colors cursor-pointer ${idx === slashIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                      }`}
                  >
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-white/50">
                      {cmd.icon}
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-mono text-xs font-semibold text-white">
                        {cmd.name}
                      </span>
                      <span className="text-xs text-white/40 truncate font-sans">
                        {cmd.description}
                      </span>
                    </div>
                    {idx === slashIndex && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded text-white/40 bg-white/[0.06] font-mono">
                        ⏎
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* @ Mention dropdown */}
          {mentionQuery !== null && filteredMentions.length > 0 && (
            <div
              className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden z-50"
              style={{
                background: "#0e0e0e",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
              }}
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Monitored Projects — ↑↓ to navigate · Enter to select</span>
              </div>
              <div className="max-h-[260px] overflow-y-auto">
                {filteredMentions.map((p: MonitorProject, idx: number) => (
                  <button
                    key={p.id}
                    ref={(el) => { mentionItemRefs.current[idx] = el; }}
                    onMouseDown={(e) => { e.preventDefault(); selectMention(p); }}
                    onMouseEnter={() => setMentionIndex(idx)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer"
                    style={{
                      color: "rgba(255,255,255,0.8)",
                      background: idx === mentionIndex ? "rgba(255,255,255,0.07)" : "transparent",
                      borderLeft: idx === mentionIndex ? "2px solid rgba(255,255,255,0.3)" : "2px solid transparent",
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: p.status === "active" ? "#22c55e" : p.status === "paused" ? "rgba(255,255,255,0.2)" : "#eab308" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>{p.projectPath}</div>
                    </div>
                    {idx === mentionIndex && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)" }}>⏎</span>
                    )}
                  </button>
                ))}
              </div>
              {monitorProjects.length === 0 && (
                <div className="px-3 py-3 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>No monitored projects. Add one in Monitor →</div>
              )}
            </div>
          )}
          {/* Linked context & action chips (Deploy, Deep Deploy, GitHub, Project, Container, Monitor, Upload) */}
          {(() => {
            // Compute active keys in their chronological addition order
            const activeKeys: ("project" | "context" | "deploy" | "execution")[] = [];
            for (const key of chipOrder) {
              if (key === "project" && attachedProject && !activeKeys.includes("project")) activeKeys.push("project");
              if (key === "context" && selectedContext && !activeKeys.includes("context")) activeKeys.push("context");
              if (key === "deploy" && deployMode && !activeKeys.includes("deploy")) activeKeys.push("deploy");
              if (key === "execution" && executionMode && !activeKeys.includes("execution")) activeKeys.push("execution");
            }
            // Fallback for any active item not yet captured in chipOrder
            if (attachedProject && !activeKeys.includes("project")) activeKeys.push("project");
            if (selectedContext && !activeKeys.includes("context")) activeKeys.push("context");
            if (deployMode && !activeKeys.includes("deploy")) activeKeys.push("deploy");
            if (executionMode && !activeKeys.includes("execution")) activeKeys.push("execution");

            if (activeKeys.length === 0) return null;

            return (
              <div className="flex flex-col gap-2 mx-3 mt-3">
                {activeKeys.map((key) => {
                  if (key === "execution" && executionMode) {
                    const isPlan = executionMode === "plan";
                    return (
                      <div
                        key="chip-execution"
                        className="px-3 py-1.5 rounded-xl flex items-center justify-between gap-2 animate-fade-in bg-[#0c0c0c] border border-white/[0.08]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-5 h-5 rounded-md bg-white/[0.06] border border-white/10 flex items-center justify-center text-white flex-shrink-0">
                            {isPlan ? (
                              <Icon icon="lucide:clipboard-check" width={11} height={11} />
                            ) : (
                              <Icon icon="lucide:zap" width={11} height={11} />
                            )}
                          </div>
                          <span className="text-xs font-semibold text-white truncate font-mono">
                            {isPlan ? "plan mode" : "action mode"}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                              isPlan
                                ? "text-white/60 bg-white/[0.04] border border-white/10"
                                : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                            }`}
                          >
                            {isPlan ? "Checklist & review before execution" : "Direct execution without approval"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setExecutionMode(null);
                            setChipOrder((prev) => prev.filter((k) => k !== "execution"));
                          }}
                          className="text-white/40 hover:text-white text-xs px-1 cursor-pointer transition-colors"
                          title={isPlan ? "Remove plan mode override" : "Remove action mode override"}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }

                  if (key === "deploy" && deployMode) {
                    const isDeep = deployMode === "deep-deploy";
                    return (
                      <div
                        key="chip-deploy"
                        className="px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 animate-fade-in"
                        style={{
                          background: "#0c0c0c",
                          border: isDeep ? "1px solid rgba(168,85,247,0.25)" : "1px solid rgba(16,185,129,0.25)",
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isDeep ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400 flex-shrink-0">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0">
                              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                              <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                          )}
                          <span className="text-xs font-semibold text-white truncate font-mono">
                            {isDeep ? "deep deploy" : "deploy"}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                              isDeep
                                ? "text-purple-300 bg-purple-500/10 border border-purple-500/20"
                                : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                            }`}
                          >
                            {isDeep ? "Deep verification & test build" : "Fast immediate deploy"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDeployMode(null);
                            setChipOrder((prev) => prev.filter((k) => k !== "deploy"));
                          }}
                          className="text-white/40 hover:text-white text-xs px-1 cursor-pointer transition-colors"
                          title={isDeep ? "Remove deep deploy" : "Remove deploy"}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }

                  if (key === "context" && selectedContext) {
                    return (
                      <div
                        key="chip-context"
                        className="px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 animate-fade-in"
                        style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {selectedContext.type === "project" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60 flex-shrink-0">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                          ) : selectedContext.type === "container" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 flex-shrink-0">
                              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            </svg>
                          ) : selectedContext.type === "github" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-white flex-shrink-0">
                              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0">
                              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                            </svg>
                          )}
                          <span className="text-xs font-semibold text-white truncate font-mono">
                            {selectedContext.name}
                          </span>
                          {/* Omit the verbose badge for GitHub */}
                          {selectedContext.type !== "github" && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded capitalize"
                              style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)" }}
                            >
                              {selectedContext.type} {selectedContext.detail ? `· ${selectedContext.detail}` : ""}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedContext(null);
                            setChipOrder((prev) => prev.filter((k) => k !== "context"));
                          }}
                          className="text-white/40 hover:text-white text-xs px-1 cursor-pointer transition-colors"
                          title="Clear linked context"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }

                  if (key === "project" && attachedProject) {
                    return (
                      <div
                        key="chip-project"
                        className="p-2.5 rounded-xl border border-white/[0.12] bg-[#0e0e0e] flex items-center justify-between gap-3 animate-in fade-in duration-150"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 text-white">
                            {attachedProject.type === "zip" ? (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                              </svg>
                            ) : (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                              </svg>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-white truncate">{attachedProject.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono">
                                {attachedProject.type === "zip" ? "ZIP Archive" : `${attachedProject.fileCount} files`}
                              </span>
                            </div>
                            <div className="text-[11px] text-white/40 flex items-center gap-1.5 font-mono">
                              <span>{formatFileSize(attachedProject.totalSize)}</span>
                              <span>·</span>
                              <span className="text-emerald-400">Ready to deploy with Docker</span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setAttachedProject(null);
                            setChipOrder((prev) => prev.filter((k) => k !== "project"));
                          }}
                          className="w-6 h-6 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                          title="Remove attachment"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            );
          })()}

          {/* Text area */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              attachedProject
                ? `Add instructions or press Enter to ${deployMode === "deep-deploy" ? "deep deploy" : "deploy"} ${attachedProject.name}…`
                : selectedContext
                  ? `Add instructions or press Enter to ${deployMode === "deep-deploy" ? "deep deploy" : deployMode === "deploy" ? "deploy" : "ask about"} ${selectedContext.name}…`
                  : deployMode
                    ? `Add instructions or press Enter to ${deployMode === "deep-deploy" ? "deep deploy" : "deploy"}…`
                    : executionMode === "plan"
                      ? "Enter prompt for checklist plan… (review in Tool Window before execution)"
                      : executionMode === "action"
                        ? "Enter prompt for direct execution… (runs commands immediately)"
                        : `Message ${modelName}… (type / for commands or @ for monitor)`
            }
            rows={1}
            className="w-full px-4 pt-3.5 pb-2 text-sm resize-none outline-none"
            style={{
              background: "transparent",
              color: "#fff",
              lineHeight: "1.6",
              maxHeight: "180px",
              fontFamily: "var(--font-sans)",
            }}
          />

          {/* Hidden file & folder inputs for project upload */}
          <input
            type="file"
            ref={zipInputRef}
            onChange={handleZipSelect}
            accept=".zip,.tar.gz,.tar"
            className="hidden"
          />
          <input
            type="file"
            ref={folderInputRef}
            onChange={handleFolderSelect}
            // @ts-expect-error webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
          />

          {/* Bottom bar: model selector, context picker, folder upload, and send/stop */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <ModelSelector value={modelId} onChange={handleModelChange} />

              {/* Slash Command / Context Quick Button */}
              <button
                type="button"
                onClick={() => {
                  if (slashQuery !== null) {
                    setSlashQuery(null);
                  } else {
                    setSlashQuery("");
                    setSlashStart(input.length);
                    setInput((prev) => prev ? `${prev} /` : "/");
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }
                }}
                title="Open slash commands and context menu"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors border cursor-pointer"
                style={{
                  background: (selectedContext || deployMode || executionMode) ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                  color: (selectedContext || deployMode || executionMode) ? "#ffffff" : "rgba(255,255,255,0.45)",
                  borderColor: (selectedContext || deployMode || executionMode) ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
                }}
              >
                {selectedContext?.type === "project" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                ) : selectedContext?.type === "container" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
                ) : selectedContext?.type === "github" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
                ) : selectedContext?.type === "monitor" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                ) : deployMode === "deep-deploy" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                ) : deployMode === "deploy" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                ) : executionMode === "plan" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></svg>
                ) : executionMode === "action" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                )}
                <span className="font-mono text-[11px] truncate max-w-[120px]">
                  {selectedContext
                    ? selectedContext.name
                    : deployMode
                      ? deployMode
                      : executionMode
                        ? executionMode
                        : "/ commands"}
                </span>
              </button>

              {/* Dedicated deploy pill in bottom bar when both context and deployMode are active */}
              {selectedContext && deployMode && (
                <button
                  type="button"
                  onClick={() => {
                    setDeployMode(null);
                    setChipOrder((prev) => prev.filter((k) => k !== "deploy"));
                  }}
                  title={deployMode === "deep-deploy" ? "Deep Deploy active (click to remove)" : "Deploy active (click to remove)"}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono transition-colors border cursor-pointer animate-fade-in"
                  style={{
                    background: deployMode === "deep-deploy" ? "rgba(168,85,247,0.12)" : "rgba(16,185,129,0.12)",
                    color: deployMode === "deep-deploy" ? "rgb(216,180,254)" : "rgb(52,211,153)",
                    borderColor: deployMode === "deep-deploy" ? "rgba(168,85,247,0.3)" : "rgba(16,185,129,0.3)",
                  }}
                >
                  {deployMode === "deep-deploy" ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  )}
                  <span>{deployMode === "deep-deploy" ? "deep deploy" : "deploy"}</span>
                  <span className="text-white/40 hover:text-white ml-0.5">✕</span>
                </button>
              )}

              {/* Dedicated execution pill in bottom bar when executionMode is active and either context or deployMode is set */}
              {executionMode && (selectedContext || deployMode) && (
                <button
                  type="button"
                  onClick={() => {
                    setExecutionMode(null);
                    setChipOrder((prev) => prev.filter((k) => k !== "execution"));
                  }}
                  title={executionMode === "plan" ? "Plan Mode active (click to remove)" : "Action Mode active (click to remove)"}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono transition-colors border cursor-pointer animate-fade-in bg-white/[0.06] border-white/15 text-white"
                >
                  {executionMode === "plan" ? (
                    <Icon icon="lucide:clipboard-check" width={11} height={11} className="text-white/80" />
                  ) : (
                    <Icon icon="lucide:zap" width={11} height={11} className="text-emerald-400" />
                  )}
                  <span>{executionMode === "plan" ? "plan" : "action"}</span>
                  <span className="text-white/40 hover:text-white ml-0.5">✕</span>
                </button>
              )}

              {/* Upload Project Button */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => zipInputRef.current?.click()}
                  disabled={isUploading}
                  title="Attach project ZIP archive for Docker deployment"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors text-white/40 hover:text-white hover:bg-white/5 border border-white/5 cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>Attach ZIP</span>
                </button>

                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isUploading}
                  title="Attach project folder for Docker deployment"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors text-white/40 hover:text-white hover:bg-white/5 border border-white/5 cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  </svg>
                  <span>Attach Folder</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isLoading || isUploading ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer"
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    color: "#f87171",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  {isUploading ? "Uploading…" : "Stop"}
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() && !attachedProject && !selectedContext && !deployMode}
                  className="w-8 h-8 flex items-center justify-center rounded-xl transition-all duration-150 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: (input.trim() || attachedProject || selectedContext || deployMode)
                      ? "#ffffff"
                      : "rgba(255,255,255,0.07)",
                    color: (input.trim() || attachedProject || selectedContext || deployMode) ? "#000" : "rgba(255,255,255,0.2)",
                    boxShadow: (input.trim() || attachedProject || selectedContext || deployMode)
                      ? "0 0 16px rgba(255,255,255,0.15)"
                      : "none",
                    border: "none",
                  }}
                  aria-label="Send message"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[10px] mt-2.5" style={{ color: "rgba(255,255,255,0.12)", fontFamily: "var(--font-mono)" }}>
          Enter to send · Shift+Enter for new line · Type / for commands or @ for monitor
        </p>
      </div>
    </div>
  );
}
