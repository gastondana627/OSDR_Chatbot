import { useState, useEffect, useRef } from "react";
import { fetchTtsAudio } from "../../api.js";
import {
  cleanMarkdownForBrowserSpeech,
  isBrowserSpeechSupported,
  selectPreferredBrowserVoice,
  splitSpeechChunks,
} from "../../utils/browserSpeech.js";

// In-memory session audio cache to prevent redundant backend calls
const audioCache = new Map();

// If server neural TTS fails (e.g. quota/402/unconfigured), temporarily bypass server roundtrips
// so Browser Web Speech plays instantaneously at $0 with zero API key needed.
let serverTtsCooldownUntilMs = 0;
const SERVER_TTS_COOLDOWN_MS = 10 * 60 * 1000;

// Global audio playback manager ensuring only ONE response speaks at a time
let globalAudio = null;
let globalSpeechActive = false;
let globalSpeechPaused = false;
let globalSpeechSessionId = 0;
let currentActiveId = null;
const playbackListeners = new Set();

function notifyPlaybackState() {
  const isPlayingNow = globalAudio
    ? !globalAudio.paused
    : globalSpeechActive && !globalSpeechPaused;
  playbackListeners.forEach((listener) => {
    listener(currentActiveId, isPlayingNow);
  });
}

function stopGlobalPlayback() {
  let changed = false;
  if (globalAudio) {
    try {
      globalAudio.pause();
      globalAudio.currentTime = 0;
    } catch {}
    globalAudio = null;
    changed = true;
  }
  if (globalSpeechActive || globalSpeechPaused) {
    globalSpeechSessionId += 1;
    globalSpeechActive = false;
    globalSpeechPaused = false;
    if (isBrowserSpeechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    changed = true;
  }
  if (currentActiveId !== null) {
    currentActiveId = null;
    changed = true;
  }
  if (changed) {
    notifyPlaybackState();
  }
}

function speakWithBrowserSynthesis(rawText, ownerId, { onEnd, onError }) {
  if (!isBrowserSpeechSupported()) {
    onError?.("Browser speech synthesis is not supported in this browser.");
    return false;
  }

  const cleaned = cleanMarkdownForBrowserSpeech(rawText);
  const chunks = splitSpeechChunks(cleaned, 220);
  if (!chunks.length) {
    onError?.("No readable text available for speech.");
    return false;
  }

  try {
    window.speechSynthesis.cancel();
  } catch {}

  const sessionId = ++globalSpeechSessionId;
  const voices = window.speechSynthesis.getVoices?.() || [];
  const chosenVoice = selectPreferredBrowserVoice(voices);

  globalSpeechActive = true;
  globalSpeechPaused = false;
  currentActiveId = ownerId;
  notifyPlaybackState();

  const speakChunkAt = (index) => {
    if (sessionId !== globalSpeechSessionId) return;
    if (index >= chunks.length) {
      globalSpeechActive = false;
      globalSpeechPaused = false;
      currentActiveId = null;
      notifyPlaybackState();
      onEnd?.();
      return;
    }

    const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
    if (chosenVoice) {
      utterance.voice = chosenVoice;
      utterance.lang = chosenVoice.lang || "en-US";
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      if (sessionId !== globalSpeechSessionId) return;
      speakChunkAt(index + 1);
    };

    utterance.onerror = (evt) => {
      if (sessionId !== globalSpeechSessionId) return;
      // Ignore intentional cancellation errors
      if (evt?.error === "canceled" || evt?.error === "interrupted") return;
      globalSpeechActive = false;
      globalSpeechPaused = false;
      currentActiveId = null;
      notifyPlaybackState();
      onError?.(`Browser speech error: ${evt?.error || "playback failed"}`);
    };

    window.speechSynthesis.speak(utterance);
  };

  speakChunkAt(0);
  return true;
}

export default function TtsPlayButton({ text, messageId, chatModel = "gemini-3.7-flash" }) {
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [durationSec, setDurationSec] = useState(null);
  const [usedProvider, setUsedProvider] = useState(null);

  const stableIdRef = useRef(messageId || `msg-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    const handleGlobalUpdate = (activeId, isAudioPlaying) => {
      if (activeId === stableIdRef.current) {
        setIsPlaying(isAudioPlaying);
        setIsPaused(!isAudioPlaying);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
    };

    playbackListeners.add(handleGlobalUpdate);
    return () => {
      playbackListeners.delete(handleGlobalUpdate);
    };
  }, []);

  const startBrowserFallback = () => {
    const cleaned = cleanMarkdownForBrowserSpeech(text);
    const estSec = Math.max(1, Math.round((cleaned.length / 15) * 10) / 10);
    setDurationSec(estSec);
    setUsedProvider("browser");
    setErrorMsg("");

    const started = speakWithBrowserSynthesis(text, stableIdRef.current, {
      onEnd: () => {
        setIsPlaying(false);
        setIsPaused(false);
      },
      onError: (msg) => {
        setErrorMsg(msg);
        setIsPlaying(false);
        setIsPaused(false);
      },
    });
    if (!started) {
      setErrorMsg("Speech synthesis unavailable in this browser.");
    }
    return started;
  };

  const handlePlayToggle = async () => {
    setErrorMsg("");

    // 1. Toggle pause/resume if this exact message is active on Browser Speech
    if (currentActiveId === stableIdRef.current && globalSpeechActive && isBrowserSpeechSupported()) {
      if (!globalSpeechPaused) {
        try {
          window.speechSynthesis.pause();
          globalSpeechPaused = true;
          setIsPlaying(false);
          setIsPaused(true);
          notifyPlaybackState();
          return;
        } catch {}
      } else {
        try {
          window.speechSynthesis.resume();
          globalSpeechPaused = false;
          setIsPlaying(true);
          setIsPaused(false);
          notifyPlaybackState();
          return;
        } catch {}
      }
    }

    // 2. Toggle pause/resume if this exact message is active on HTML5 Audio (Gemini/OpenAI TTS)
    if (currentActiveId === stableIdRef.current && globalAudio) {
      if (!globalAudio.paused) {
        globalAudio.pause();
        setIsPlaying(false);
        setIsPaused(true);
        notifyPlaybackState();
        return;
      } else {
        try {
          await globalAudio.play();
          setIsPlaying(true);
          setIsPaused(false);
          notifyPlaybackState();
          return;
        } catch (playErr) {
          console.warn("[TTS Playback Resume Error]:", playErr);
        }
      }
    }

    // Stop any other currently playing message
    stopGlobalPlayback();

    // Check Cache first
    const cacheKey = `tts:${stableIdRef.current}:${(text || "").slice(0, 80)}`;
    let audioData = audioCache.get(cacheKey);

    const shouldSkipServer = Date.now() < serverTtsCooldownUntilMs;

    if (!audioData && !shouldSkipServer) {
      setLoading(true);
      try {
        const res = await fetchTtsAudio({
          text,
          messageId: stableIdRef.current,
          chatModel,
          provider: "auto",
        });

        if (!res?.audioBase64) {
          throw new Error(res?.error || "Audio payload empty from TTS provider.");
        }

        audioData = {
          audioBase64: res.audioBase64,
          mimeType: res.mimeType || "audio/wav",
          provider: res.provider || "gemini",
          model: res.model,
          voice: res.voice,
          durationEstimateSec: res.durationEstimateSec,
        };

        audioCache.set(cacheKey, audioData);
      } catch (err) {
        console.warn("[TTS Server Fallback -> Browser Speech]:", err?.message || err);
        serverTtsCooldownUntilMs = Date.now() + SERVER_TTS_COOLDOWN_MS;
        setLoading(false);
        // Zero-API-key seamless fallback to Browser Web Speech API
        if (isBrowserSpeechSupported()) {
          startBrowserFallback();
          return;
        }
        setErrorMsg(err?.message || "Speech synthesis failed.");
        return;
      } finally {
        setLoading(false);
      }
    }

    // If server TTS is in cooldown (e.g. $0 / quota mode), jump immediately into zero-key Browser Speech
    if (!audioData && shouldSkipServer) {
      if (isBrowserSpeechSupported()) {
        startBrowserFallback();
        return;
      }
      setErrorMsg("Speech synthesis unavailable in this browser.");
      return;
    }

    if (audioData?.audioBase64) {
      setDurationSec(audioData.durationEstimateSec);
      setUsedProvider(audioData.provider);

      try {
        const audioSrc = `data:${audioData.mimeType};base64,${audioData.audioBase64}`;
        const newAudio = new Audio(audioSrc);

        newAudio.onended = () => {
          setIsPlaying(false);
          setIsPaused(false);
          currentActiveId = null;
          globalAudio = null;
          notifyPlaybackState();
        };

        newAudio.onerror = (e) => {
          console.warn("[Audio Element Error -> Browser Speech]:", e);
          currentActiveId = null;
          globalAudio = null;
          if (isBrowserSpeechSupported()) {
            startBrowserFallback();
            return;
          }
          setIsPlaying(false);
          setIsPaused(false);
          setErrorMsg("Audio format playback error in browser.");
          notifyPlaybackState();
        };

        globalAudio = newAudio;
        currentActiveId = stableIdRef.current;
        await newAudio.play();
        setIsPlaying(true);
        setIsPaused(false);
        notifyPlaybackState();
      } catch (playErr) {
        console.warn("[Audio Play Exception -> Browser Speech]:", playErr);
        currentActiveId = null;
        globalAudio = null;
        if (isBrowserSpeechSupported()) {
          startBrowserFallback();
          return;
        }
        setErrorMsg("Unable to initiate audio playback.");
        setIsPlaying(false);
        setIsPaused(false);
        notifyPlaybackState();
      }
    }
  };

  const handleStop = (e) => {
    e.stopPropagation();
    stopGlobalPlayback();
    setIsPlaying(false);
    setIsPaused(false);
  };

  if (!text || typeof text !== "string" || !text.trim()) {
    return null;
  }

  const providerLabel =
    usedProvider === "browser"
      ? "Browser Voice ($0)"
      : usedProvider
      ? usedProvider.toUpperCase()
      : "Voice";

  return (
    <div className="tts-control-container">
      <button
        type="button"
        className={`tts-play-btn ${isPlaying ? "is-playing" : ""} ${isPaused ? "is-paused" : ""} ${loading ? "is-loading" : ""}`}
        onClick={handlePlayToggle}
        disabled={loading}
        title={
          loading
            ? "Synthesizing spoken audio..."
            : isPlaying
            ? `Pause speech (${providerLabel})`
            : isPaused
            ? `Resume speech (${providerLabel})`
            : `Play spoken response (${providerLabel})`
        }
      >
        {loading ? (
          <>
            <span className="tts-spinner" />
            <span className="tts-btn-label">Generating speech…</span>
          </>
        ) : isPlaying ? (
          <>
            <span className="tts-icon">⏸</span>
            <span className="tts-btn-label">Pause</span>
            <span className="tts-soundwave-bars">
              <span className="bar bar-1" />
              <span className="bar bar-2" />
              <span className="bar bar-3" />
            </span>
          </>
        ) : isPaused ? (
          <>
            <span className="tts-icon">▶</span>
            <span className="tts-btn-label">Resume</span>
          </>
        ) : (
          <>
            <span className="tts-icon">🔊</span>
            <span className="tts-btn-label">Play response</span>
            {durationSec ? <span className="tts-duration-chip">~{Math.round(durationSec)}s</span> : null}
          </>
        )}
      </button>

      {(isPlaying || isPaused) && (
        <button
          type="button"
          className="tts-stop-btn"
          onClick={handleStop}
          title="Stop speech playback"
        >
          ⏹
        </button>
      )}

      {errorMsg && (
        <div className="tts-error-badge" title={errorMsg}>
          <span>⚠️ Speech unavailable</span>
        </div>
      )}
    </div>
  );
}
