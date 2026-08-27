// Thin client for the backend API.
const API = new URL("api/", document.baseURI).href;

export async function fetchModels() {
  const r = await fetch(API + "models");
  if (!r.ok) throw new Error("models unavailable");
  return r.json();
}

export async function fetchStudies() {
  const r = await fetch(API + "studies");
  return r.json();
}

export async function fetchOsdrDiagnostics() {
  const r = await fetch(API + "osdr/diagnostics");
  if (!r.ok) throw new Error("OSDR diagnostics unavailable");
  return r.json();
}

export async function testOsdrConnection() {
  const r = await fetch(API + "osdr/test-connection", { method: "POST" });
  if (!r.ok) throw new Error("OSDR connection test failed");
  return r.json();
}

export async function searchLiveOsdrStudies(query) {
  const r = await fetch(API + `osdr/search-live?q=${encodeURIComponent(query)}`);
  if (!r.ok) throw new Error("Live search failed");
  return r.json();
}

export async function searchLocalStudies(query, limit = 15) {
  const r = await fetch(API + `search?q=${encodeURIComponent(query)}&k=${limit}`);
  if (!r.ok) throw new Error("Local study search failed");
  return r.json();
}

export async function searchOsdrCatalog(query, { isLive = false, limit = 15 } = {}) {
  try {
    if (isLive) {
      const res = await searchLiveOsdrStudies(query);
      return res.results || [];
    }
    const res = await searchLocalStudies(query, limit);
    return res.results || [];
  } catch (err) {
    console.warn("Catalog search fallback:", err);
    // Fallback to cached studies
    const fallback = await fetchStudies().catch(() => ({ studies: [] }));
    const term = (query || "").toLowerCase();
    return (fallback.studies || [])
      .filter((s) => !term || s.study_id.toLowerCase().includes(term) || (s.title && s.title.toLowerCase().includes(term)))
      .map((s) => ({
        study_id: s.study_id,
        title: s.title,
        score: 1.0,
      }));
  }
}

export async function fetchAwgSuggestions() {
  const r = await fetch(API + "awg/suggestions");
  if (!r.ok) throw new Error("Failed to fetch AWG suggestions");
  return r.json();
}

export async function fetchAwgRandomPair() {
  const r = await fetch(API + "awg/random-pair");
  if (!r.ok) throw new Error("Failed to fetch random AWG pair");
  return r.json();
}

export async function fetchAwgCompatibility(studyA, studyB) {
  const r = await fetch(API + `awg/compatibility?studyA=${encodeURIComponent(studyA)}&studyB=${encodeURIComponent(studyB)}`);
  if (!r.ok) throw new Error("Failed to score study compatibility");
  return r.json();
}

export async function generateAwgMediaSet({ studies, query, summary }) {
  const resp = await fetch(API + "awg/media-set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Media set generation failed (${resp.status})`);
  }
  return resp.json();
}

export async function generateAwgImage({ studies, query, summary }) {
  const resp = await fetch(API + "awg/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Image generation failed (${resp.status})`);
  }
  return resp.json();
}

export async function generateAwgVideo({ studies, query, summary }) {
  const resp = await fetch(API + "awg/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Video generation failed (${resp.status})`);
  }
  return resp.json();
}

export async function generateTranslationalClip({ studies, query, summary, direction, seed }) {
  const resp = await fetch(API + "awg/translational-clip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary, direction, seed }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Translational clip generation failed (${resp.status})`);
  }
  return resp.json();
}

export const generateRelatableClip = generateTranslationalClip;

export async function fetchAwgMemeConcept({ studies, query, summary, memeAngle, seed, freshVariation }) {
  const resp = await fetch(API + "awg/meme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary, memeAngle, seed, freshVariation }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Meme clip generation failed (${resp.status})`);
  }
  return resp.json();
}

export const fetchAwgMemeClip = fetchAwgMemeConcept;

export async function fetchMediaAuditLog(limit = 20) {
  const resp = await fetch(API + `awg/media/audit?limit=${limit}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch media audit log (${resp.status})`);
  }
  return resp.json();
}

// Stream a chat answer. Calls onSources(studies, model, isAwg, awgDetails) once,
// then onToken(t) per token, then onDone().
export async function streamChat({ message, history, model }, { onSources, onToken, onError, onDone }) {
  try {
    const resp = await fetch(API + "chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, model }),
    });
    if (!resp.ok || !resp.body) {
      onError?.(`request failed (${resp.status})`);
      onDone?.();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        let event = "message";
        let data = "";
        for (const line of evt.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (event === "sources") {
            onSources?.(parsed.studies, parsed.model, parsed.isAwg, parsed.awgDetails);
          } else if (event === "token") {
            onToken?.(parsed);
          } else if (event === "error") {
            onError?.(parsed);
          } else if (event === "done") {
            onDone?.();
          }
        } catch {
          // ignore malformed SSE line
        }
      }
    }
    onDone?.();
  } catch (err) {
    onError?.(err?.message || "Network error");
    onDone?.();
  }
}
