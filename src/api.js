// Thin client for the backend API with robust URL resolution and production diagnostics.
export function getApiBaseUrl() {
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return `${window.location.origin}/api/`;
  }
  return "/api/";
}

export function buildApiUrl(endpoint) {
  const clean = String(endpoint || "").replace(/^\/+/, "");
  return `${getApiBaseUrl()}${clean}`;
}

const API = getApiBaseUrl();

async function handleApiResponse(response, contextName, targetUrl) {
  if (!response.ok) {
    let detail = "";
    try {
      const json = await response.json();
      detail = json.error || json.message || JSON.stringify(json);
    } catch {
      try {
        const text = await response.text();
        if (text && !text.includes("<!DOCTYPE html>")) {
          detail = text.slice(0, 300);
        }
      } catch {}
    }

    let category = "API Error";
    if (response.status === 404) {
      category = "404 Route Not Found";
      detail = detail || `Endpoint '${targetUrl}' was not found. Verify Vercel /api routing and serverless function deployment.`;
    } else if (response.status === 401 || response.status === 403) {
      category = "Auth/Config Error";
      detail = detail || "GEMINI_API_KEY is missing or unauthorized in the server environment.";
    } else if (response.status === 429) {
      category = "Quota/Rate Limit Error";
      detail = detail || "Gemini API rate limit or quota exceeded.";
    } else if (response.status >= 500) {
      category = "Backend Server Error";
      detail = detail || "Internal server error occurred while processing the request.";
    }

    const err = new Error(`[${category} ${response.status}] ${contextName}: ${detail}`);
    err.status = response.status;
    err.url = targetUrl;
    throw err;
  }
  return response.json();
}

export async function fetchHealth() {
  const url = buildApiUrl("health");
  const r = await fetch(url);
  return handleApiResponse(r, "Health Check", url);
}

export async function fetchModels() {
  const url = buildApiUrl("models");
  const r = await fetch(url);
  return handleApiResponse(r, "Fetch Models", url);
}

export async function fetchStudies() {
  const url = buildApiUrl("studies");
  const r = await fetch(url);
  return handleApiResponse(r, "Fetch Studies", url);
}

export async function fetchOsdrDiagnostics() {
  const url = buildApiUrl("osdr/diagnostics");
  const r = await fetch(url);
  return handleApiResponse(r, "OSDR Diagnostics", url);
}

export async function testOsdrConnection() {
  const url = buildApiUrl("osdr/test-connection");
  const r = await fetch(url, { method: "POST" });
  return handleApiResponse(r, "Test OSDR Connection", url);
}

export async function searchLiveOsdrStudies(query) {
  const url = buildApiUrl(`osdr/search-live?q=${encodeURIComponent(query)}`);
  const r = await fetch(url);
  return handleApiResponse(r, "Search Live OSDR", url);
}

export async function searchLocalStudies(query, limit = 15) {
  const url = buildApiUrl(`search?q=${encodeURIComponent(query)}&k=${limit}`);
  const r = await fetch(url);
  return handleApiResponse(r, "Search Local Studies", url);
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
  const url = buildApiUrl("awg/suggestions");
  const r = await fetch(url);
  return handleApiResponse(r, "Fetch AWG Suggestions", url);
}

export async function fetchAwgRandomPair() {
  const url = buildApiUrl("awg/random-pair");
  const r = await fetch(url);
  return handleApiResponse(r, "Fetch Random AWG Pair", url);
}

export async function fetchAwgCompatibility(studyA, studyB) {
  const url = buildApiUrl(`awg/compatibility?studyA=${encodeURIComponent(studyA)}&studyB=${encodeURIComponent(studyB)}`);
  const r = await fetch(url);
  return handleApiResponse(r, "Fetch AWG Compatibility", url);
}

export async function generateAwgMediaSet({ studies, query, summary }) {
  const url = buildApiUrl("awg/media-set");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary }),
  });
  return handleApiResponse(resp, "Generate AWG Media Set", url);
}

export async function generateAwgImage({ studies, query, summary }) {
  const url = buildApiUrl("awg/image");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary }),
  });
  return handleApiResponse(resp, "Generate AWG Image", url);
}

export async function generateAwgVideo({ studies, query, summary }) {
  const url = buildApiUrl("awg/video");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary }),
  });
  return handleApiResponse(resp, "Generate AWG Video", url);
}

export async function generateTranslationalClip({ studies, query, summary, direction, seed }) {
  const url = buildApiUrl("awg/translational-clip");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary, direction, seed }),
  });
  return handleApiResponse(resp, "Generate Translational Clip", url);
}

export const generateRelatableClip = generateTranslationalClip;

export async function fetchAwgMemeConcept({ studies, query, summary, memeAngle, seed, freshVariation }) {
  const url = buildApiUrl("awg/meme");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, query, summary, memeAngle, seed, freshVariation }),
  });
  return handleApiResponse(resp, "Generate AWG Meme Concept", url);
}

export const fetchAwgMemeClip = fetchAwgMemeConcept;

export async function fetchMediaAuditLog(limit = 20) {
  const url = buildApiUrl(`awg/media/audit?limit=${limit}`);
  const resp = await fetch(url);
  return handleApiResponse(resp, "Fetch Media Audit Log", url);
}

// Stream a chat answer. Calls onSources(studies, model, isAwg, awgDetails) once,
// then onToken(t) per token, then onDone().
export async function streamChat({ message, history, model }, { onSources, onToken, onError, onDone }) {
  const targetUrl = buildApiUrl("chat");
  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, model }),
    });

    if (!resp.ok || !resp.body) {
      let detail = "";
      try {
        const json = await resp.json();
        detail = json.error || json.message || "";
      } catch {
        try {
          const text = await resp.text();
          if (text && !text.includes("<!DOCTYPE html>")) {
            detail = text.slice(0, 200);
          }
        } catch {}
      }

      if (resp.status === 404) {
        onError?.(`[HTTP 404] Backend route not found at ${targetUrl}. Check Vercel serverless /api configuration (vercel.json).`);
      } else if (resp.status === 401 || resp.status === 403) {
        onError?.(`[HTTP ${resp.status}] Authentication / Configuration Error: GEMINI_API_KEY is not configured or unauthorized on server.`);
      } else if (resp.status === 429) {
        onError?.(`[HTTP 429] Rate Limit / Quota Exceeded: Google Gemini model quota exhausted.`);
      } else if (resp.status >= 500) {
        onError?.(`[HTTP ${resp.status}] Server Error: ${detail || "Internal backend exception"}`);
      } else {
        onError?.(`[HTTP ${resp.status}] Request failed: ${detail || `Status code ${resp.status}`}`);
      }
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
            // Check if error is quota exhaustion vs logic error
            const errStr = String(parsed);
            if (errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED") || errStr.includes("Quota")) {
              onError?.(`[Gemini Quota Exceeded (429)] ${errStr}`);
            } else {
              onError?.(parsed);
            }
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
    onError?.(`[Network / Client Error] ${err?.message || "Failed to reach backend API"}`);
    onDone?.();
  }
}

