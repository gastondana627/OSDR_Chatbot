import { getGeminiApiKey, getOpenAiApiKey } from "./env";
import { GoogleGenAI } from "@google/genai";

export type TtsProviderMode = "auto" | "gemini" | "openai";

export interface TtsRequestOptions {
  text: string;
  provider?: TtsProviderMode;
  chatModel?: string;
  messageId?: string;
  voice?: string;
}

export interface TtsResult {
  status: "ok" | "error";
  audioBase64?: string;
  mimeType?: string;
  provider?: "gemini" | "openai";
  model?: string;
  voice?: string;
  spokenText?: string;
  durationEstimateSec?: number;
  messageId?: string;
  error?: string;
  errorCategory?: string;
}

export interface TtsCapabilities {
  configuredProviders: ("gemini" | "openai")[];
  defaultProvider: "gemini" | "openai" | "none";
  geminiConfigured: boolean;
  openaiConfigured: boolean;
  geminiModel: string;
  openaiModel: string;
  geminiVoice: string;
  openaiVoice: string;
  providerMode: TtsProviderMode;
}

// ---------------------------------------------------------------------------
// PCM to WAV Container Header Builder (16-bit Mono/Stereo)
// ---------------------------------------------------------------------------
export function pcmToWav(
  pcmData: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // subchunk1 size
  buffer.writeUInt16LE(1, 20); // audio format: 1 = PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  pcmData.copy(buffer, 44);
  return buffer;
}

// ---------------------------------------------------------------------------
// Speech-Friendly Text Normalizer for Scientific / AWG Content
// ---------------------------------------------------------------------------
export function prepareSpeechText(rawText: string, maxLength = 1200): string {
  if (!rawText || typeof rawText !== "string") return "";

  let clean = rawText
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove markdown images
    .replace(/!\[.*?\]\(.*?\)/g, "")
    // Convert markdown links [Label](url) -> Label
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    // Remove markdown table divider lines (e.g. |---|---| or |--:|:--|)
    .replace(/^\s*\|?[\s:-]+\|[\s:-|]+\s*$/gm, "")
    // Strip leading/trailing table pipes
    .replace(/^\s*\|/gm, "")
    .replace(/\|\s*$/gm, "")
    // Replace cell divider pipes with comma pause
    .replace(/\s*\|\s*/g, ", ")
    // Remove standalone table dashes
    .replace(/^[\s-:|,-]+$/gm, "")
    // Remove headers (# Header)
    .replace(/^#+\s+/gm, "")
    // Remove bold/italics
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Remove blockquotes (> quote)
    .replace(/^>\s+/gm, "")
    // Convert list bullets (* or - or 1.) to natural pauses
    .replace(/^[\s*•-]+\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    // Remove emojis
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-⛿\u{2700}-➿\u{1FA00}-\u{1FAFF}]/gu, "")
    // Clean excessive punctuation / commas
    .replace(/,\s*,+/g, ",")
    .replace(/\.\s*\.+/g, ".")
    // Collapse multiple whitespace/newlines
    .replace(/\n\s*\n/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length > maxLength) {
    let truncated = clean.slice(0, maxLength);
    const lastPeriod = truncated.lastIndexOf(". ");
    if (lastPeriod > maxLength * 0.6) {
      truncated = truncated.slice(0, lastPeriod + 1);
    } else {
      const lastComma = truncated.lastIndexOf(", ");
      if (lastComma > maxLength * 0.6) {
        truncated = truncated.slice(0, lastComma);
      }
    }
    clean = `${truncated.trim()} For complete details, refer to the printed response above.`;
  }

  return clean;
}

// ---------------------------------------------------------------------------
// Capabilities Inspector
// ---------------------------------------------------------------------------
export function getTtsCapabilities(): TtsCapabilities {
  const geminiKey = getGeminiApiKey();
  const openaiKey = getOpenAiApiKey();
  const geminiConfigured = Boolean(geminiKey && geminiKey.length > 0);
  const openaiConfigured = Boolean(openaiKey && openaiKey.length > 0);

  const configuredProviders: ("gemini" | "openai")[] = [];
  if (geminiConfigured) configuredProviders.push("gemini");
  if (openaiConfigured) configuredProviders.push("openai");

  const envMode = (process.env.TTS_PROVIDER?.trim().toLowerCase() || "auto") as TtsProviderMode;
  const providerMode: TtsProviderMode = ["auto", "gemini", "openai"].includes(envMode) ? envMode : "auto";

  let defaultProvider: "gemini" | "openai" | "none" = "none";
  if (providerMode === "openai" && openaiConfigured) {
    defaultProvider = "openai";
  } else if (providerMode === "gemini" && geminiConfigured) {
    defaultProvider = "gemini";
  } else if (geminiConfigured) {
    defaultProvider = "gemini";
  } else if (openaiConfigured) {
    defaultProvider = "openai";
  }

  return {
    configuredProviders,
    defaultProvider,
    geminiConfigured,
    openaiConfigured,
    geminiModel: process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash",
    openaiModel: process.env.OPENAI_TTS_MODEL?.trim() || "tts-1",
    geminiVoice: process.env.GEMINI_TTS_VOICE?.trim() || "Aoede",
    openaiVoice: process.env.OPENAI_TTS_VOICE?.trim() || "alloy",
    providerMode,
  };
}

// ---------------------------------------------------------------------------
// Core TTS Generation Engine
// ---------------------------------------------------------------------------
export async function generateTtsAudio(options: TtsRequestOptions): Promise<TtsResult> {
  const startTs = Date.now();
  const rawText = String(options.text || "").trim();
  const messageId = options.messageId || `tts-${Date.now()}`;

  if (!rawText) {
    return {
      status: "error",
      error: "No text provided for TTS generation.",
      errorCategory: "invalid_payload",
      messageId,
    };
  }

  const spokenText = prepareSpeechText(rawText);
  const caps = getTtsCapabilities();

  // 1. Resolve Provider Target
  const requestedMode = options.provider || caps.providerMode || "auto";
  let targetProvider: "gemini" | "openai" | "none" = "none";
  const chatModel = String(options.chatModel || "").toLowerCase();

  if (requestedMode === "openai") {
    if (caps.openaiConfigured) {
      targetProvider = "openai";
    } else if (caps.geminiConfigured) {
      targetProvider = "gemini"; // fallback
    }
  } else if (requestedMode === "gemini") {
    if (caps.geminiConfigured) {
      targetProvider = "gemini";
    } else if (caps.openaiConfigured) {
      targetProvider = "openai"; // fallback
    }
  } else {
    // "auto" mode: Match based on chat model preference, then fall back
    const prefersOpenAi =
      chatModel.includes("gpt") ||
      chatModel.includes("o1") ||
      chatModel.includes("o3") ||
      chatModel.includes("openai");

    if (prefersOpenAi && caps.openaiConfigured) {
      targetProvider = "openai";
    } else if (caps.geminiConfigured) {
      targetProvider = "gemini";
    } else if (caps.openaiConfigured) {
      targetProvider = "openai";
    }
  }

  if (targetProvider === "none") {
    return {
      status: "error",
      error: "No TTS provider API keys (GEMINI_API_KEY or OPENAI_API_KEY) are configured on the server.",
      errorCategory: "provider_unconfigured",
      messageId,
    };
  }

  // 2. Execute Provider TTS Call
  try {
    if (targetProvider === "gemini") {
      const apiKey = getGeminiApiKey()!;
      const model = caps.geminiModel;
      const voice = options.voice || caps.geminiVoice;

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Please read this exact text aloud naturally and clearly, with standard scientific pacing. Read only the text:\n\n${spokenText}`,
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const audioPart = parts.find((p: any) => p.inlineData?.data);

      if (!audioPart || !audioPart.inlineData?.data) {
        throw new Error("Gemini model did not return audio in candidate response.");
      }

      const rawBase64 = audioPart.inlineData.data;
      const returnedMime = audioPart.inlineData.mimeType || "audio/pcm;rate=24000";

      let finalBase64 = rawBase64;
      let finalMime = returnedMime;

      if (returnedMime.includes("pcm") || returnedMime.includes("raw")) {
        const rateMatch = returnedMime.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
        const pcmBuffer = Buffer.from(rawBase64, "base64");
        const wavBuffer = pcmToWav(pcmBuffer, sampleRate, 1, 16);
        finalBase64 = wavBuffer.toString("base64");
        finalMime = "audio/wav";
      }

      const elapsed = Date.now() - startTs;
      const durationEstimateSec = Math.max(1, Math.round((spokenText.length / 14) * 10) / 10);

      console.info(
        `[TTS Generation] RequestID=${messageId} | Provider=gemini | Model=${model} | Voice=${voice} | SpokenChars=${spokenText.length} | Latency=${elapsed}ms | Status=ok`
      );

      return {
        status: "ok",
        audioBase64: finalBase64,
        mimeType: finalMime,
        provider: "gemini",
        model,
        voice,
        spokenText,
        durationEstimateSec,
        messageId,
      };
    } else {
      // OpenAI TTS Call
      const apiKey = getOpenAiApiKey()!;
      const model = caps.openaiModel;
      const voice = options.voice || caps.openaiVoice;

      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: spokenText,
          voice,
          response_format: "mp3",
        }),
      });

      if (!res.ok) {
        let errDetail = "";
        try {
          const json = await res.json();
          errDetail = json?.error?.message || JSON.stringify(json);
        } catch {
          errDetail = await res.text();
        }
        throw new Error(`OpenAI TTS HTTP ${res.status}: ${errDetail}`);
      }

      const arrayBuf = await res.arrayBuffer();
      const audioBase64 = Buffer.from(arrayBuf).toString("base64");
      const elapsed = Date.now() - startTs;
      const durationEstimateSec = Math.max(1, Math.round((spokenText.length / 14) * 10) / 10);

      console.info(
        `[TTS Generation] RequestID=${messageId} | Provider=openai | Model=${model} | Voice=${voice} | SpokenChars=${spokenText.length} | Latency=${elapsed}ms | Status=ok`
      );

      return {
        status: "ok",
        audioBase64,
        mimeType: "audio/mpeg",
        provider: "openai",
        model,
        voice,
        spokenText,
        durationEstimateSec,
        messageId,
      };
    }
  } catch (err: any) {
    const elapsed = Date.now() - startTs;
    console.warn(
      `[TTS Generation Error] RequestID=${messageId} | Provider=${targetProvider} | Elapsed=${elapsed}ms | Error=${err?.message || err}`
    );

    // Fallback: If Gemini failed and OpenAI is configured, try OpenAI
    if (targetProvider === "gemini" && caps.openaiConfigured) {
      console.info(`[TTS Fallback] Attempting OpenAI TTS fallback after Gemini failure for ${messageId}`);
      return generateTtsAudio({ ...options, provider: "openai" });
    }

    // Fallback: If OpenAI failed and Gemini is configured, try Gemini
    if (targetProvider === "openai" && caps.geminiConfigured) {
      console.info(`[TTS Fallback] Attempting Gemini TTS fallback after OpenAI failure for ${messageId}`);
      return generateTtsAudio({ ...options, provider: "gemini" });
    }

    return {
      status: "error",
      error: err?.message || "TTS audio generation failed.",
      errorCategory: "generation_failed",
      provider: targetProvider,
      messageId,
    };
  }
}
