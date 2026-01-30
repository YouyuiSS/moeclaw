import { normalizeVerboseLevel } from "../auto-reply/thinking.js";
import { loadConfig } from "../config/config.js";
import { type AgentEventPayload, getAgentRunContext } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import { isTtsEnabled, resolveTtsConfig, resolveTtsPrefsPath, textToSpeech } from "../tts/tts.js";
import { loadSessionEntry } from "./session-utils.js";
import { cleanTextForTts } from "../utils/text-cleaner.js";
import { formatForLog } from "./ws-log.js";

/**
 * Check if webchat broadcasts should be suppressed for heartbeat runs.
 * Returns true if the run is a heartbeat and showOk is false.
 */
function shouldSuppressHeartbeatBroadcast(runId: string): boolean {
  const runContext = getAgentRunContext(runId);
  if (!runContext?.isHeartbeat) return false;

  try {
    const cfg = loadConfig();
    const visibility = resolveHeartbeatVisibility({ cfg, channel: "webchat" });
    return !visibility.showOk;
  } catch {
    // Default to suppressing if we can't load config
    return true;
  }
}

export type ChatRunEntry = {
  sessionKey: string;
  clientRunId: string;
};

export type ChatRunRegistry = {
  add: (sessionId: string, entry: ChatRunEntry) => void;
  peek: (sessionId: string) => ChatRunEntry | undefined;
  shift: (sessionId: string) => ChatRunEntry | undefined;
  remove: (sessionId: string, clientRunId: string, sessionKey?: string) => ChatRunEntry | undefined;
  clear: () => void;
};

export function createChatRunRegistry(): ChatRunRegistry {
  const chatRunSessions = new Map<string, ChatRunEntry[]>();

  const add = (sessionId: string, entry: ChatRunEntry) => {
    const queue = chatRunSessions.get(sessionId);
    if (queue) {
      queue.push(entry);
    } else {
      chatRunSessions.set(sessionId, [entry]);
    }
  };

  const peek = (sessionId: string) => chatRunSessions.get(sessionId)?.[0];

  const shift = (sessionId: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) return undefined;
    const entry = queue.shift();
    if (!queue.length) chatRunSessions.delete(sessionId);
    return entry;
  };

  const remove = (sessionId: string, clientRunId: string, sessionKey?: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) return undefined;
    const idx = queue.findIndex(
      (entry) =>
        entry.clientRunId === clientRunId && (sessionKey ? entry.sessionKey === sessionKey : true),
    );
    if (idx < 0) return undefined;
    const [entry] = queue.splice(idx, 1);
    if (!queue.length) chatRunSessions.delete(sessionId);
    return entry;
  };

  const clear = () => {
    chatRunSessions.clear();
  };

  return { add, peek, shift, remove, clear };
}

export type ChatRunState = {
  registry: ChatRunRegistry;
  buffers: Map<string, string>;
  mediaBuffers: Map<string, string[]>;
  deltaSentAt: Map<string, number>;
  abortedRuns: Map<string, number>;
  clear: () => void;
};

export function createChatRunState(): ChatRunState {
  const registry = createChatRunRegistry();
  const buffers = new Map<string, string>();
  const mediaBuffers = new Map<string, string[]>();
  const deltaSentAt = new Map<string, number>();
  const abortedRuns = new Map<string, number>();

  const clear = () => {
    registry.clear();
    buffers.clear();
    mediaBuffers.clear();
    deltaSentAt.clear();
    abortedRuns.clear();
  };

  return {
    registry,
    buffers,
    mediaBuffers,
    deltaSentAt,
    abortedRuns,
    clear,
  };
}

export type ChatEventBroadcast = (
  event: string,
  payload: unknown,
  opts?: { dropIfSlow?: boolean },
) => void;

export type NodeSendToSession = (sessionKey: string, event: string, payload: unknown) => void;

export type AgentEventHandlerOptions = {
  broadcast: ChatEventBroadcast;
  nodeSendToSession: NodeSendToSession;
  agentRunSeq: Map<string, number>;
  chatRunState: ChatRunState;
  resolveSessionKeyForRun: (runId: string) => string | undefined;
  clearAgentRunContext: (runId: string) => void;
};

export function createAgentEventHandler({
  broadcast,
  nodeSendToSession,
  agentRunSeq,
  chatRunState,
  resolveSessionKeyForRun,
  clearAgentRunContext,
}: AgentEventHandlerOptions) {
  const emitChatDelta = (
    sessionKey: string,
    clientRunId: string,
    seq: number,
    text: string,
    mediaUrls?: string[],
  ) => {
    chatRunState.buffers.set(clientRunId, text);
    if (mediaUrls && mediaUrls.length > 0) {
      chatRunState.mediaBuffers.set(clientRunId, mediaUrls);
    }
    const now = Date.now();
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
    if (now - last < 150) return;
    chatRunState.deltaSentAt.set(clientRunId, now);
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: now,
      },
    };
    // Suppress webchat broadcast for heartbeat runs when showOk is false
    if (!shouldSuppressHeartbeatBroadcast(clientRunId)) {
      broadcast("chat", payload, { dropIfSlow: true });
    }
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const emitChatFinal = async (
    sessionKey: string,
    clientRunId: string,
    seq: number,
    jobState: "done" | "error",
    error?: unknown,
  ) => {
    const text = chatRunState.buffers.get(clientRunId)?.trim() ?? "";
    const mediaUrls = chatRunState.mediaBuffers.get(clientRunId);
    chatRunState.buffers.delete(clientRunId);
    chatRunState.mediaBuffers.delete(clientRunId);
    chatRunState.deltaSentAt.delete(clientRunId);

    // Capture suppression state early before any async/await ensures context is still available
    const suppressBroadcast = shouldSuppressHeartbeatBroadcast(clientRunId);

    let finalMediaUrls = mediaUrls;

    if (jobState === "done" && text && (!mediaUrls || mediaUrls.length === 0)) {
      try {
        const cfg = loadConfig();
        const config = resolveTtsConfig(cfg);
        const prefsPath = resolveTtsPrefsPath(config);

        // Check if TTS is enabled for this session/globally

        if (isTtsEnabled(config, prefsPath)) {
          // Basic check. ideally we check session override too but loadSessionEntry does that partly via config?
          // Actually isTtsEnabled takes config and returns boolean.

          const cleanText = cleanTextForTts(text);

          const ttsResult = await textToSpeech({
            text: cleanText,
            cfg,
            prefsPath,
            // channel? We don't have channel info strictly here, but could pass 'webchat' or similar if needed
            // For now, undefined channel uses default provider
          });

          if (ttsResult.success && ttsResult.audioPath) {
            let mediaUrl = ttsResult.audioPath;
            try {
              const fs = await import("node:fs");
              const buffer = fs.readFileSync(ttsResult.audioPath);
              const base64 = buffer.toString("base64");
              const ext = ttsResult.audioPath.split(".").pop()?.toLowerCase();
              let mime = "audio/mpeg";
              if (ext === "opus") mime = "audio/ogg";
              else if (ext === "wav") mime = "audio/wav";
              mediaUrl = `data:${mime};base64,${base64}`;
              finalMediaUrls = [mediaUrl];
            } catch (e) {
              console.error("Auto-TTS read error:", e);
            }
          }
        }
      } catch (err) {
        console.error("Auto-TTS injection failed:", err);
      }
    }

    if (jobState === "done") {
      const hasContent = text || (finalMediaUrls && finalMediaUrls.length > 0);
      const payload = {
        runId: clientRunId,
        sessionKey,
        seq,
        state: "final" as const,
        message: hasContent
          ? {
              role: "assistant",
              content: [{ type: "text", text }],
              timestamp: Date.now(),
              mediaUrl: finalMediaUrls?.[0],
              mediaUrls: finalMediaUrls?.length ? finalMediaUrls : undefined,
            }
          : undefined,
      };
      // Suppress webchat broadcast for heartbeat runs when showOk is false
      if (!suppressBroadcast) {
        broadcast("chat", payload);
      }
      nodeSendToSession(sessionKey, "chat", payload);
      return;
    }
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "error" as const,
      errorMessage: error ? formatForLog(error) : undefined,
    };
    broadcast("chat", payload);
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const shouldEmitToolEvents = (runId: string, sessionKey?: string) => {
    const runContext = getAgentRunContext(runId);
    const runVerbose = normalizeVerboseLevel(runContext?.verboseLevel);
    if (runVerbose) return runVerbose === "on";
    if (!sessionKey) return false;
    try {
      const { cfg, entry } = loadSessionEntry(sessionKey);
      const sessionVerbose = normalizeVerboseLevel(entry?.verboseLevel);
      if (sessionVerbose) return sessionVerbose === "on";
      const defaultVerbose = normalizeVerboseLevel(cfg.agents?.defaults?.verboseDefault);
      return defaultVerbose === "on";
    } catch {
      return false;
    }
  };

  return (evt: AgentEventPayload) => {
    const chatLink = chatRunState.registry.peek(evt.runId);
    const sessionKey = chatLink?.sessionKey ?? resolveSessionKeyForRun(evt.runId);
    const clientRunId = chatLink?.clientRunId ?? evt.runId;
    const isAborted =
      chatRunState.abortedRuns.has(clientRunId) || chatRunState.abortedRuns.has(evt.runId);
    // DEBUG: Trace sessionKey resolution for webchat events
    if (evt.stream === "assistant" || evt.stream === "lifecycle") {
      const textPreview = typeof evt.data?.text === "string" ? evt.data.text.slice(0, 50) : "N/A";
      const hasMedia =
        Array.isArray(evt.data?.mediaUrls) && (evt.data.mediaUrls as unknown[]).length > 0;
      console.log(
        `[server-chat] evt.runId=${evt.runId} stream=${evt.stream} chatLink=${!!chatLink} sessionKey=${sessionKey ?? "UNDEFINED"} text=${textPreview} media=${hasMedia ? (evt.data?.mediaUrls as unknown[]).length : 0}`,
      );
    }
    // Include sessionKey so Control UI can filter tool streams per session.
    const agentPayload = sessionKey ? { ...evt, sessionKey } : evt;
    const last = agentRunSeq.get(evt.runId) ?? 0;
    if (evt.stream === "tool" && !shouldEmitToolEvents(evt.runId, sessionKey)) {
      agentRunSeq.set(evt.runId, evt.seq);
      return;
    }
    if (evt.seq !== last + 1) {
      broadcast("agent", {
        runId: evt.runId,
        stream: "error",
        ts: Date.now(),
        sessionKey,
        data: {
          reason: "seq gap",
          expected: last + 1,
          received: evt.seq,
        },
      });
    }
    agentRunSeq.set(evt.runId, evt.seq);
    broadcast("agent", agentPayload);

    const lifecyclePhase =
      evt.stream === "lifecycle" && typeof evt.data?.phase === "string" ? evt.data.phase : null;

    if (sessionKey) {
      nodeSendToSession(sessionKey, "agent", agentPayload);
      if (!isAborted && evt.stream === "assistant" && typeof evt.data?.text === "string") {
        const mediaUrls = Array.isArray(evt.data.mediaUrls) ? evt.data.mediaUrls : undefined;
        emitChatDelta(sessionKey, clientRunId, evt.seq, evt.data.text, mediaUrls);
      } else if (!isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        if (chatLink) {
          const finished = chatRunState.registry.shift(evt.runId);
          if (!finished) {
            clearAgentRunContext(evt.runId);
            return;
          }
          emitChatFinal(
            finished.sessionKey,
            finished.clientRunId,
            evt.seq,
            lifecyclePhase === "error" ? "error" : "done",
            evt.data?.error,
          );
          clearAgentRunContext(evt.runId);
        } else {
          emitChatFinal(
            sessionKey,
            evt.runId,
            evt.seq,
            lifecyclePhase === "error" ? "error" : "done",
            evt.data?.error,
          );
        }
      } else if (isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        chatRunState.abortedRuns.delete(clientRunId);
        chatRunState.abortedRuns.delete(evt.runId);
        chatRunState.buffers.delete(clientRunId);
        chatRunState.deltaSentAt.delete(clientRunId);
        if (chatLink) {
          chatRunState.registry.remove(evt.runId, clientRunId, sessionKey);
        }
      }
    }
  };
}
