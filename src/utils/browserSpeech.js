// ==============================================================================
// Zero-API-Key Browser Web Speech API Fallback (`window.speechSynthesis`)
// ==============================================================================
// Cleans scientific markdown/tables and chunks utterances into <=220-char
// sentences so Chrome/Safari/Edge never truncate long OSDR explanations.

export function cleanMarkdownForBrowserSpeech(rawText, maxLength = 2400) {
  if (!rawText || typeof rawText !== "string") return "";

  let clean = rawText
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^\s*\|?[\s:-]+\|[\s:-|]+\s*$/gm, "")
    .replace(/^\s*\|/gm, "")
    .replace(/\|\s*$/gm, "")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^[\s*•-]+\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}]/gu, "")
    .replace(/\n\s*\n/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/,\s*,+/g, ",")
    .replace(/\.\s*\.+/g, ".")
    .trim();

  if (clean.length > maxLength) {
    let cut = clean.slice(0, maxLength);
    const lastPeriod = cut.lastIndexOf(". ");
    if (lastPeriod > maxLength * 0.6) {
      cut = cut.slice(0, lastPeriod + 1);
    }
    clean = `${cut.trim()} For complete details, refer to the text above.`;
  }

  return clean;
}

/**
 * Split speech text into sentence-sized chunks (<= maxChunkChars) to avoid
 * Chromium's ~15-second SpeechSynthesisUtterance silent cutoff bug.
 */
export function splitSpeechChunks(cleanText, maxChunkChars = 220) {
  const text = String(cleanText || "").trim();
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let current = "";

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    if (current && current.length + 1 + sentence.length > maxChunkChars) {
      chunks.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChunkChars) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      // Split overly long sentence on commas or spaces
      const words = sentence.split(/\s+/);
      let piece = "";
      for (const word of words) {
        if (piece && piece.length + 1 + word.length > maxChunkChars) {
          chunks.push(piece.trim());
          piece = word;
        } else {
          piece = piece ? `${piece} ${word}` : word;
        }
      }
      if (piece) chunks.push(piece.trim());
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

export function isBrowserSpeechSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

export function selectPreferredBrowserVoice(voices = []) {
  if (!Array.isArray(voices) || !voices.length) return null;
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v?.lang || ""));
  const pool = english.length ? english : voices;

  const preferredPatterns = [
    /Google US English/i,
    /Samantha/i,
    /Ava|Allison|Daniel|Karen/i,
    /Natural|Neural|Aria|Jenny|Guy/i,
  ];
  for (const pattern of preferredPatterns) {
    const match = pool.find((v) => pattern.test(v?.name || ""));
    if (match) return match;
  }
  return pool.find((v) => v.default) || pool[0] || null;
}
