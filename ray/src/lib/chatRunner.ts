import prisma from "@/lib/prisma";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

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

export interface ChatRunEvent {
  line: string;
  timestamp: number;
}

export interface ChatRunSubscriber {
  write: (line: string) => void;
  close: () => void;
}

export interface ChatRun {
  sessionId: string;
  userId: string;
  modelId: string;
  executionMode?: string;
  status: "running" | "completed" | "error";
  startedAt: number;
  completedAt?: number;
  error?: string;
  events: ChatRunEvent[];
  fullAssistantText: string;
  thinkingText: string;
  toolBlocks: ToolBlock[];
  activeToolBlock: ToolBlock | null;
  subscribers: Set<ChatRunSubscriber>;
  abortController: AbortController;
}

export interface StartRunParams {
  sessionId: string;
  userId: string;
  messages: Array<{ role: string; content: string }>;
  modelId?: string;
  userMessageToSave?: string;
  attachedContextItem?: any;
  executionMode?: string;
}

class ChatRunnerManager {
  private runs: Map<string, ChatRun> = new Map();
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    // Retain manager across hot reloads
  }

  public getRun(sessionId: string): ChatRun | undefined {
    return this.runs.get(sessionId);
  }

  public getAllActiveRuns(userId: string): Record<string, { status: "running" | "completed" | "error"; startedAt: number; completedAt?: number; error?: string }> {
    const result: Record<string, { status: "running" | "completed" | "error"; startedAt: number; completedAt?: number; error?: string }> = {};
    for (const [sid, run] of this.runs.entries()) {
      if (run.userId === userId) {
        result[sid] = {
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          error: run.error,
        };
      }
    }
    return result;
  }

  public async startRun(params: StartRunParams): Promise<ChatRun> {
    const { sessionId, userId, messages, modelId = "MiniMax-M3", userMessageToSave, attachedContextItem } = params;

    // If already running, return existing run
    const existing = this.runs.get(sessionId);
    if (existing && existing.status === "running") {
      return existing;
    }

    // Clear any pending cleanup timer if restarting session
    const prevTimer = this.cleanupTimers.get(sessionId);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this.cleanupTimers.delete(sessionId);
    }

    // 1. Immediately save the user message to database if provided
    if (userMessageToSave) {
      try {
        const savedUserContent = attachedContextItem
          ? `<!-- attachedContext:${JSON.stringify(attachedContextItem)} -->\n${userMessageToSave}`
          : userMessageToSave;

        await prisma.rayChatMessage.create({
          data: {
            sessionId,
            role: "user",
            content: savedUserContent,
          },
        });

        await prisma.rayChatSession.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() },
        });
      } catch (err) {
        console.error(`[ChatRunner] Failed to save initial user message for session ${sessionId}:`, err);
      }
    }

    // 2. Initialize the run state
    const abortController = new AbortController();
    const run: ChatRun = {
      sessionId,
      userId,
      modelId,
      executionMode: params.executionMode,
      status: "running",
      startedAt: Date.now(),
      events: [],
      fullAssistantText: "",
      thinkingText: "",
      toolBlocks: [],
      activeToolBlock: null,
      subscribers: new Set(),
      abortController,
    };

    this.runs.set(sessionId, run);

    // 3. Kick off the asynchronous background execution (detached from client HTTP lifecycle)
    this.executeRunInBackground(run, messages).catch((err) => {
      console.error(`[ChatRunner] Uncaught error in background run for session ${sessionId}:`, err);
    });

    return run;
  }

  private async executeRunInBackground(run: ChatRun, rawMessages: Array<{ role: string; content: string }>) {
    const { sessionId, userId, modelId, executionMode, abortController } = run;

    try {
      // Load user monitor projects for AI context
      let monitorProjects: unknown[] = [];
      try {
        const dbProjects = await prisma.rayMonitorProject.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          include: {
            alerts: {
              where: { dismissed: false },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
          },
        });
        monitorProjects = dbProjects.map((p) => ({
          id: p.id,
          name: p.name,
          projectPath: p.projectPath,
          logPaths: p.logPaths,
          logCommand: p.logCommand,
          runCommand: p.runCommand,
          intervalSec: p.intervalSec,
          status: p.status,
          memory: p.memory,
          memoryStatus: p.memoryStatus,
          projectUrl: p.projectUrl,
          managedPid: p.managedPid,
          managedLogFile: p.managedLogFile,
          alerts: p.alerts.map((a) => ({
            severity: a.severity,
            message: a.message,
            createdAt: a.createdAt.toISOString(),
          })),
        }));
      } catch (dbErr) {
        console.warn("[ChatRunner] Could not load monitor projects:", dbErr);
      }

      // Load user's GitHub integration
      let githubToken: string | null = null;
      let githubUsername = "";
      try {
        const { getEffectiveGitHubToken } = await import("@/lib/github-app");
        githubToken = await getEffectiveGitHubToken(userId);
        const integration = await prisma.rayGithubIntegration.findFirst({
          where: { userId },
        });
        if (integration?.githubUsername) {
          githubUsername = integration.githubUsername;
        }
      } catch { /* silent */ }

      // Sanitize messages
      const sanitizedMessages = rawMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content.replace(/^<!-- (rayAssistantMeta|attachedContext):[\s\S]*?-->\n?/, "")
          : m.content,
      }));

      // Call Brain server from Node.js with independent abort signal
      const brainHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Connection: "close",
      };
      if (process.env.BRAIN_INTERNAL_SECRET) {
        brainHeaders["x-brain-secret"] = process.env.BRAIN_INTERNAL_SECRET;
      }

      const brainPayload = JSON.stringify({
        messages: sanitizedMessages,
        modelId,
        mode: "web",
        userId,
        monitorProjects,
        githubToken: githubToken || undefined,
        githubUsername: githubUsername || undefined,
        executionMode: executionMode || undefined,
      });

      let brainResponse: Response;
      try {
        brainResponse = await fetch(`${BRAIN_URL}/v1/chat`, {
          method: "POST",
          headers: brainHeaders,
          body: brainPayload,
          signal: abortController.signal,
        });
      } catch (fetchErr: any) {
        // If connection failed on configured BRAIN_URL, attempt standard alternate port (4500 <-> 3100)
        const isConnRefused =
          fetchErr?.message?.includes("fetch failed") ||
          fetchErr?.message?.includes("ECONNREFUSED") ||
          fetchErr?.cause?.code === "ECONNREFUSED";

        const alternateUrl = BRAIN_URL.includes(":3100")
          ? BRAIN_URL.replace(":3100", ":4500")
          : BRAIN_URL.includes(":4500")
          ? BRAIN_URL.replace(":4500", ":3100")
          : null;

        if (isConnRefused && alternateUrl) {
          try {
            brainResponse = await fetch(`${alternateUrl}/v1/chat`, {
              method: "POST",
              headers: brainHeaders,
              body: brainPayload,
              signal: abortController.signal,
            });
          } catch {
            throw fetchErr;
          }
        } else {
          throw fetchErr;
        }
      }

      if (!brainResponse.ok) {
        const errText = await brainResponse.text();
        throw new Error(errText.trim() ? `Brain error (${brainResponse.status}): ${errText.trim()}` : "Brain AI service error");
      }

      if (!brainResponse.body) {
        throw new Error("No response body received from Brain backend");
      }

      const reader = brainResponse.body.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = "";
      let hasStreamFinished = false;
      let streamError: string | undefined;

      const processLine = (line: string) => {
        if (!line.trim()) return;

        // Record in events buffer
        run.events.push({ line, timestamp: Date.now() });

        // Broadcast line immediately to all current subscribers
        this.broadcastToSubscribers(run, line + "\n");

        // Finish marker in AI SDK format (d:{"finishReason":"stop",...})
        if (line.startsWith("d:")) {
          hasStreamFinished = true;
          return;
        }

        // Error marker in AI SDK format (3:"...")
        if (line.startsWith("3:")) {
          const payload = line.slice(2).trim();
          try {
            const parsed: unknown = JSON.parse(payload);
            streamError = typeof parsed === "string" ? parsed : payload;
          } catch {
            streamError = payload || "Error generating response";
          }
          run.error = streamError;
          hasStreamFinished = true;
          return;
        }

        // Structured SSE event
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.slice(6));

            if (json.type === "thinking-delta" && typeof json.delta === "string") {
              run.thinkingText += json.delta;
              return;
            }

            if (json.type === "tool-start") {
              const newBlock: ToolBlock = {
                id: `tool-${Date.now()}-${Math.random()}`,
                tool: json.tool,
                cmd: json.cmd || json.tool,
                status: "running",
                output: "",
                startTime: Date.now(),
              };
              run.activeToolBlock = newBlock;
              run.toolBlocks.push(newBlock);
              return;
            }

            if (json.type === "tool-output" && run.activeToolBlock && json.delta) {
              run.activeToolBlock.output += json.delta;
              return;
            }

            if (json.type === "tool-end" && run.activeToolBlock) {
              run.activeToolBlock.status = (json.exit ?? 0) === 0 ? "completed" : "error";
              run.activeToolBlock.durationSec = Math.max(0.1, (Date.now() - run.activeToolBlock.startTime) / 1000);
              run.activeToolBlock.exit = json.exit ?? 0;
              run.activeToolBlock = null;
              return;
            }

            if (json.type === "text-delta" && typeof json.delta === "string") {
              run.fullAssistantText += json.delta;
              return;
            }
          } catch {
            // Partial JSON
          }
          return;
        }

        // Vercel AI SDK text-delta (0:"...")
        if (line.startsWith("0:")) {
          try {
            const parsed = JSON.parse(line.slice(2));
            if (typeof parsed === "string") {
              run.fullAssistantText += parsed;
            }
          } catch {
            // Partial
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        rawBuffer += decoder.decode(value, { stream: true });
        const lines = rawBuffer.split("\n");
        rawBuffer = lines.pop() ?? "";
        for (const line of lines) {
          processLine(line);
          if (hasStreamFinished) break;
        }
        if (hasStreamFinished) break;
      }

      if (rawBuffer.trim()) {
        processLine(rawBuffer);
      }

      // A Brain error frame is terminal. Do not turn an errored run into a
      // successful completion by appending a finish marker after it.
      if (streamError) {
        run.status = "error";
        run.completedAt = Date.now();
        try {
          await prisma.rayChatMessage.create({
            data: {
              sessionId,
              role: "assistant",
              content: streamError,
            },
          });
          await prisma.rayChatSession.update({
            where: { id: sessionId },
            data: { updatedAt: new Date() },
          });
        } catch (saveErr) {
          console.error(`[ChatRunner] Failed saving error message for session ${sessionId}:`, saveErr);
        }
        this.closeSubscribers(run);
        this.scheduleRunCleanup(sessionId, 60000);
        return;
      }

      // Finalize message content
      const finalFullContent = run.fullAssistantText.trim();
      let savedAssistantContent = finalFullContent;
      if (run.thinkingText || (run.toolBlocks && run.toolBlocks.length > 0)) {
        const meta = {
          thinking: run.thinkingText || undefined,
          toolBlocks: run.toolBlocks.length > 0 ? run.toolBlocks : undefined,
        };
        savedAssistantContent = `<!-- rayAssistantMeta:${JSON.stringify(meta)} -->\n${finalFullContent}`;
      }

      // Persist assistant message to MySQL via Prisma
      if (savedAssistantContent || run.toolBlocks.length > 0) {
        await prisma.rayChatMessage.create({
          data: {
            sessionId,
            role: "assistant",
            content: savedAssistantContent || "Done.",
          },
        });

        await prisma.rayChatSession.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() },
        });

        // If first assistant message in session, trigger auto-title in background
        this.triggerAutoTitle(sessionId, userId).catch((err) => {
          console.warn("[ChatRunner] Auto-title failed:", err);
        });
      }

      run.status = "completed";
      run.completedAt = Date.now();

      const finishMarker = 'd:{"finishReason":"stop"}';
      run.events.push({ line: finishMarker, timestamp: Date.now() });

      // Emit finish line to subscribers
      this.broadcastToSubscribers(run, `${finishMarker}\n\n`);
      this.closeSubscribers(run);

      // Keep the completed run in memory for 60 seconds so UI checkmark and status queries can see it
      this.scheduleRunCleanup(sessionId, 60000);
    } catch (err: any) {
      const isAbort = err?.name === "AbortError" || abortController.signal.aborted;
      let errorMsg = isAbort ? "Generation stopped." : (err?.message || "Error generating response");
      if (!isAbort && (errorMsg.includes("fetch failed") || errorMsg.includes("ECONNREFUSED") || err?.cause?.code === "ECONNREFUSED")) {
        errorMsg = "Unable to connect to PutmeIn Brain AI service. Please ensure PutmeIn background services are running (run 'ray start' or 'ray status').";
      }
      console.error(`[ChatRunner] Run error for session ${sessionId}:`, errorMsg);

      run.status = isAbort ? "completed" : "error";
      run.error = errorMsg;
      run.completedAt = Date.now();

      // Save partial message if any content was produced, or error message
      if (run.fullAssistantText.trim() || run.toolBlocks.length > 0) {
        try {
          const meta = {
            thinking: run.thinkingText || undefined,
            toolBlocks: run.toolBlocks.length > 0 ? run.toolBlocks : undefined,
          };
          const partialContent = `<!-- rayAssistantMeta:${JSON.stringify(meta)} -->\n${run.fullAssistantText.trim()}${isAbort ? "\n\n*(Generation stopped)*" : ""}`;
          await prisma.rayChatMessage.create({
            data: {
              sessionId,
              role: "assistant",
              content: partialContent,
            },
          });
        } catch (saveErr) {
          console.error(`[ChatRunner] Failed saving partial message for session ${sessionId}:`, saveErr);
        }
      } else if (!isAbort) {
        try {
          await prisma.rayChatMessage.create({
            data: {
              sessionId,
              role: "assistant",
              content: errorMsg,
            },
          });
          await prisma.rayChatSession.update({
            where: { id: sessionId },
            data: { updatedAt: new Date() },
          });
        } catch (saveErr) {
          console.error(`[ChatRunner] Failed saving error message for session ${sessionId}:`, saveErr);
        }
      }

      const errorLine = `3:${JSON.stringify(errorMsg)}`;
      run.events.push({ line: errorLine, timestamp: Date.now() });
      this.broadcastToSubscribers(run, `${errorLine}\n\n`);
      this.closeSubscribers(run);
      this.scheduleRunCleanup(sessionId, 60000);
    }
  }

  private async triggerAutoTitle(sessionId: string, userId: string) {
    try {
      const count = await prisma.rayChatMessage.count({
        where: { sessionId },
      });
      // Only generate title on first turn
      if (count <= 2) {
        const session = await prisma.rayChatSession.findFirst({
          where: { id: sessionId, userId },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 2 } },
        });
        if (session && session.messages.length >= 1) {
          const userMsg = session.messages[0].content.replace(/^<!-- (attachedContext|rayAssistantMeta):[\s\S]*?-->\n?/, "");
          const snippet = userMsg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 5).join(" ") || "New Chat";

          try {
            const res = await fetch(`${BRAIN_URL}/v1/sessions/generate-title`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                firstMessage: userMsg,
                userMessage: userMsg,
                assistantMessage: session.messages[1]?.content || "",
                modelId: session.model,
              }),
              signal: AbortSignal.timeout(4000),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.title) {
                const title = data.title.replace(/<[^>]+>/g, "").trim().replace(/^["']|["']$/g, "");
                await prisma.rayChatSession.update({
                  where: { id: sessionId },
                  data: { title },
                });
                return;
              }
            }
          } catch {
            // fallback to snippet
          }

          await prisma.rayChatSession.update({
            where: { id: sessionId },
            data: { title: snippet },
          });
        }
      }
    } catch (e) {
      console.warn("[ChatRunner] Title generation error:", e);
    }
  }

  public subscribe(sessionId: string, userId: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const run = this.runs.get(sessionId);
    let subscriber: ChatRunSubscriber | null = null;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        if (!run || run.userId !== userId) {
          // If no active run, send empty and close
          controller.close();
          return;
        }

        // Immediately flush SSE connection comment so HTTP 200 headers are sent to client without waiting
        controller.enqueue(encoder.encode(": connected\n\n"));

        // 1. Replay all buffered lines so far in order
        for (const ev of run.events) {
          controller.enqueue(encoder.encode(ev.line + "\n"));
        }

        // If run already completed, close stream immediately
        if (run.status !== "running") {
          controller.close();
          return;
        }

        subscriber = {
          write: (line: string) => {
            try {
              controller.enqueue(encoder.encode(line));
            } catch {
              if (subscriber) {
                run.subscribers.delete(subscriber);
              }
            }
          },
          close: () => {
            try {
              controller.close();
            } catch {}
          },
        };

        run.subscribers.add(subscriber);
      },
      cancel: () => {
        // When client disconnects/navigates away, unsubscribe listener.
        // DO NOT stop the background run!
        if (run && subscriber) {
          run.subscribers.delete(subscriber);
        }
      },
    });
  }

  public stopRun(sessionId: string, userId: string): boolean {
    const run = this.runs.get(sessionId);
    if (!run || run.userId !== userId) return false;
    if (run.status === "running") {
      run.abortController.abort();
      return true;
    }
    return false;
  }

  private broadcastToSubscribers(run: ChatRun, line: string) {
    for (const sub of run.subscribers) {
      try {
        sub.write(line);
      } catch {
        run.subscribers.delete(sub);
      }
    }
  }

  private closeSubscribers(run: ChatRun) {
    for (const sub of run.subscribers) {
      try {
        sub.close();
      } catch {}
    }
    run.subscribers.clear();
  }

  private scheduleRunCleanup(sessionId: string, delayMs: number) {
    const timer = setTimeout(() => {
      this.runs.delete(sessionId);
      this.cleanupTimers.delete(sessionId);
    }, delayMs);
    this.cleanupTimers.set(sessionId, timer);
  }
}

// Global singleton declaration
declare global {
  var __rayChatRunner: ChatRunnerManager | undefined;
}

if (!globalThis.__rayChatRunner) {
  globalThis.__rayChatRunner = new ChatRunnerManager();
}

export const chatRunner = globalThis.__rayChatRunner;
