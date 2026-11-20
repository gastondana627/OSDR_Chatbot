export type EvidenceBundleFormat = "markdown" | "json";

export interface EvidenceBundleEntryInput {
  prompt?: unknown;
  response?: unknown;
  citedAccessions?: unknown;
  model?: unknown;
  provider?: unknown;
}

interface EvidenceBundleEntry {
  userPrompt: string;
  assistantResponse: string;
  citedAccessions: string[];
  model: string;
  provider: string;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalizeAccession(value: string): string | undefined {
  const match = value.trim().match(/^OSD[-_]?(\d+)$/i);
  return match ? `OSD-${match[1]}` : undefined;
}

function collectAccessions(entry: EvidenceBundleEntryInput): string[] {
  const text = [asText(entry.prompt), asText(entry.response)].join("\n");
  const found = text.match(/OSD[-_]?\d+/gi) || [];
  const supplied = Array.isArray(entry.citedAccessions)
    ? entry.citedAccessions
        .map((value) => {
          if (typeof value === "string") return value;
          if (!value || typeof value !== "object") return undefined;
          const record = value as Record<string, unknown>;
          return [record.study_id, record.accession, record.id].find(
            (candidate): candidate is string => typeof candidate === "string"
          );
        })
        .filter((value): value is string => typeof value === "string")
    : [];
  const normalized = [...supplied, ...found]
    .map(canonicalizeAccession)
    .filter((accession): accession is string => accession !== undefined);
  return Array.from(new Set(normalized));
}

function normalizeEntry(entry: EvidenceBundleEntryInput): EvidenceBundleEntry {
  return {
    userPrompt: asText(entry.prompt),
    assistantResponse: asText(entry.response),
    citedAccessions: collectAccessions(entry),
    model: asText(entry.model) || "Not reported",
    provider: asText(entry.provider) || "Not reported",
  };
}

export function createEvidenceBundle(
  input: EvidenceBundleEntryInput[],
  format: EvidenceBundleFormat,
  timestamp: Date = new Date()
): { body: string; contentType: string; extension: string } {
  const generatedAt = timestamp.toISOString();
  const entries = input.map(normalizeEntry);

  if (format === "json") {
    const latest = entries[entries.length - 1];
    return {
      body: JSON.stringify(
        {
          formatVersion: "1.0",
          generatedAt,
          activeModel: latest?.model || "Not reported",
          activeProvider: latest?.provider || "Not reported",
          entries,
        },
        null,
        2
      ),
      contentType: "application/json; charset=utf-8",
      extension: "json",
    };
  }

  const sections = entries.map((entry, index) => {
    return [
      `## Exchange ${index + 1}`,
      "",
      `**User prompt**`,
      "",
      entry.userPrompt || "_No prompt recorded._",
      "",
      `**Assistant response**`,
      "",
      entry.assistantResponse || "_No response recorded._",
      "",
      `**Cited OSDR accessions:** ${entry.citedAccessions.join(", ") || "None"}`,
      `**Model:** ${entry.model}`,
      `**Provider:** ${entry.provider}`,
    ].join("\n");
  });

  return {
    body: [
      "# OSDR ChatBot Evidence Bundle",
      "",
      `**Generated (UTC):** ${generatedAt}`,
      "",
      ...sections,
      "",
    ].join("\n"),
    contentType: "text/markdown; charset=utf-8",
    extension: "md",
  };
}
