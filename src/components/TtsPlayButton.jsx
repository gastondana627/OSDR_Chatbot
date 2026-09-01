import { useState, useEffect, useRef } from "react";
import { fetchTtsAudio } from "../api.js";

// In-memory session audio cache to prevent redundant backend calls
const audioCache = new Map();

// Global audio playback manager ensuring only ONE response speaks at a time
let globalAudio = null;
let currentActiveId = null;
const playbackListeners = new Set();

function notifyPlaybackState() {
  playbackListeners.forEach((listener) => {
    listener(currentActiveId, globalAudio ? !globalAudio.paused : false);
  });
}

function stopGlobalPlayback() {
  if (globalAudio) {
    try {
      globalAudio.pause();
      globalAudio.currentTime = 0;
    } catch {}
    globalAudio = null;
    currentActiveId = null;
    notifyPlaybackState();
  }
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

  const handlePlayToggle = async () => {
    setErrorMsg("");

    // If currently playing this exact message -> toggle pause
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

    if (!audioData) {
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
        console.warn("[TTS Client Error]:", err?.message || err);
        setErrorMsg(err?.message || "Speech synthesis failed.");
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
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
          console.warn("[Audio Element Error]:", e);
          setIsPlaying(false);
          setIsPaused(false);
          currentActiveId = null;
          globalAudio = null;
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
        console.warn("[Audio Play Exception]:", playErr);
        setErrorMsg("Unable to initiate audio playback.");
        setIsPlaying(false);
        setIsPaused(false);
        currentActiveId = null;
        globalAudio = null;
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
            ? "Pause speech"
            : isPaused
            ? "Resume speech"
            : `Play spoken response (${usedProvider ? usedProvider.toUpperCase() : "TTS"})`
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
