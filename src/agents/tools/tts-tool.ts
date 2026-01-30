import { Type } from "@sinclair/typebox";

import { loadConfig } from "../../config/config.js";
import type { MoltbotConfig } from "../../config/config.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { textToSpeech } from "../../tts/tts.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const TtsToolSchema = Type.Object({
  text: Type.String({ description: "Text to convert to speech." }),
  channel: Type.Optional(
    Type.String({ description: "Optional channel id to pick output format (e.g. telegram)." }),
  ),
});

export function createTtsTool(opts?: {
  config?: MoltbotConfig;
  agentChannel?: GatewayMessageChannel;
}): AnyAgentTool {
  return {
    label: "TTS",
    name: "tts",
    description:
      "Convert text to speech and return a MEDIA: path. Use when the user requests audio or TTS is enabled. Copy the MEDIA line exactly.",
    parameters: TtsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const text = readStringParam(params, "text", { required: true });
      const channel = readStringParam(params, "channel");
      const cfg = opts?.config ?? loadConfig();
      const result = await textToSpeech({
        text,
        cfg,
        channel: channel ?? opts?.agentChannel,
      });

      if (result.success && result.audioPath) {
        let mediaUrl = result.audioPath;
        try {
          const fs = await import("node:fs");
          const buffer = fs.readFileSync(result.audioPath);
          const base64 = buffer.toString("base64");
          const ext = result.audioPath.split(".").pop()?.toLowerCase();
          let mime = "audio/mpeg";
          if (ext === "opus") mime = "audio/ogg";
          else if (ext === "wav") mime = "audio/wav";
          mediaUrl = `data:${mime};base64,${base64}`;
        } catch {
          // Fallback to path if read fails (unlikely)
        }

        const lines: string[] = [];
        // Tag Telegram Opus output as a voice bubble instead of a file attachment.
        if (result.voiceCompatible) lines.push("[[audio_as_voice]]");
        lines.push(`MEDIA:${mediaUrl}`);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { audioPath: mediaUrl, provider: result.provider },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: result.error ?? "TTS conversion failed",
          },
        ],
        details: { error: result.error },
      };
    },
  };
}
