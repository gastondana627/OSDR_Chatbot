/**
 * memeMarkdown.ts
 *
 * Robust, schema-aware Markdown serialization engine for AWG Meme outreach concepts.
 * Guarantees zero `[object Object]` leaks across all structured and semi-structured outputs.
 */

export interface MarkdownFormatOptions {
  debug?: boolean;
  indent?: string;
  inline?: boolean;
  bulletPrefix?: string;
}

/**
 * Converts camelCase or snake_case keys into Title Case labels.
 * e.g. "visualMetaphor" -> "Visual Metaphor", "optical_density" -> "Optical Density"
 */
export function formatKeyLabel(key: string): string {
  if (!key) return "";
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Universal safe stringifier for plain single-line text (e.g. titles, hooks, tooltips).
 * Never returns `"[object Object]"`.
 */
export function toPlainSafeString(val: any): string {
  if (val == null) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    return val.map(toPlainSafeString).filter(Boolean).join(" ");
  }
  if (typeof val === "object") {
    // Single key text wrappers
    if (val.text && Object.keys(val).length === 1) return toPlainSafeString(val.text);
    if (val.content && Object.keys(val).length === 1) return toPlainSafeString(val.content);
    if (val.fact && Object.keys(val).length === 1) return toPlainSafeString(val.fact);

    if (val.expectation && val.reality) {
      return `Expectation: ${toPlainSafeString(val.expectation)} | Reality: ${toPlainSafeString(val.reality)}`;
    }
    if (val.setup && val.punchline) {
      const parts = [`Setup: ${toPlainSafeString(val.setup)}`];
      if (val.evidence) parts.push(`Evidence: ${toPlainSafeString(val.evidence)}`);
      if (val.reality) parts.push(`Reality: ${toPlainSafeString(val.reality)}`);
      parts.push(`Punchline: ${toPlainSafeString(val.punchline)}`);
      return parts.join(" | ");
    }
    return Object.entries(val)
      .map(([k, v]) => `${formatKeyLabel(k)}: ${toPlainSafeString(v)}`)
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

/**
 * Formats `{ expectation, reality }` objects into labeled markdown sections.
 */
export function formatExpectationRealityToMarkdown(
  val: Record<string, any>,
  options: MarkdownFormatOptions = {}
): string {
  const indent = options.indent || "";
  const lines: string[] = [];

  if (val.expectation != null) {
    const expText = formatValueToMarkdown(val.expectation, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **Expectation**: ${expText}`);
  }
  if (val.reality != null) {
    const realText = formatValueToMarkdown(val.reality, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **Reality**: ${realText}`);
  }

  // Handle any extra keys
  for (const [k, v] of Object.entries(val)) {
    if (k === "expectation" || k === "reality") continue;
    const vText = formatValueToMarkdown(v, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **${formatKeyLabel(k)}**: ${vText}`);
  }

  return lines.join("\n");
}

/**
 * Formats `{ setup, reality, evidence, punchline }` narrative beats into labeled markdown sections.
 */
export function formatBeatsToMarkdown(
  val: Record<string, any>,
  options: MarkdownFormatOptions = {}
): string {
  const indent = options.indent || "";
  const lines: string[] = [];

  if (val.setup != null) {
    const text = formatValueToMarkdown(val.setup, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **Setup**: ${text}`);
  }
  if (val.evidence != null) {
    const text = formatValueToMarkdown(val.evidence, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **Evidence**: ${text}`);
  }
  if (val.reality != null) {
    const text = formatValueToMarkdown(val.reality, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **Reality**: ${text}`);
  }
  if (val.punchline != null) {
    const text = formatValueToMarkdown(val.punchline, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **Punchline**: ${text}`);
  }

  // Handle extra keys
  for (const [k, v] of Object.entries(val)) {
    if (["setup", "evidence", "reality", "punchline"].includes(k)) continue;
    const text = formatValueToMarkdown(v, { ...options, indent: indent + "  " });
    lines.push(`${indent}- **${formatKeyLabel(k)}**: ${text}`);
  }

  return lines.join("\n");
}

/**
 * Universal safe Markdown formatter for any value in the AWG Meme payload.
 *
 * Rules:
 * 1. Primitives formatted directly.
 * 2. Arrays converted to bullet lists.
 * 3. `{ expectation, reality }` formatted into labeled markdown sections.
 * 4. `{ setup, reality, evidence, punchline }` formatted into labeled markdown sections.
 * 5. Unknown objects formatted to key-value sections or JSON fenced blocks in debug mode.
 * 6. Never produces `"[object Object]"`.
 */
export function formatValueToMarkdown(val: any, options: MarkdownFormatOptions = {}): string {
  if (val == null) return "";

  // 1. Primitive strings, numbers, booleans
  if (typeof val === "string") {
    return val.trim();
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }

  // 2. Arrays -> Bullet lists
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    const indent = options.indent || "";
    return val
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "object") {
          // If item is dialogue or speaker/text
          if (item.speaker && (item.text != null || item.line != null)) {
            const speaker = toPlainSafeString(item.speaker) || "Speaker";
            const text = formatValueToMarkdown(item.text != null ? item.text : item.line, {
              ...options,
              indent: indent + "  ",
            });
            return `${indent}- **${speaker}**: ${text}`;
          }
          // If item is expectation/reality
          if (item.expectation || item.reality) {
            return formatExpectationRealityToMarkdown(item, { ...options, indent });
          }
          // If item is setup/punchline
          if (item.setup || item.punchline || item.evidence) {
            return formatBeatsToMarkdown(item, { ...options, indent });
          }
          // General object in array
          const sub = formatValueToMarkdown(item, { ...options, indent: indent + "  " });
          return `${indent}- ${sub.trimStart()}`;
        }
        return `${indent}- ${formatValueToMarkdown(item, options)}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  // 3. Structured objects
  if (typeof val === "object") {
    const isDebug = options.debug ?? (process.env.DEBUG === "true" || process.env.NODE_ENV === "development");

    // Single text/content/fact wrapper
    if (val.text && Object.keys(val).length === 1) {
      return formatValueToMarkdown(val.text, options);
    }
    if (val.content && Object.keys(val).length === 1) {
      return formatValueToMarkdown(val.content, options);
    }
    if (val.fact && Object.keys(val).length === 1) {
      return formatValueToMarkdown(val.fact, options);
    }

    // Pattern A: Expectation vs. Reality
    const hasExp = "expectation" in val;
    const hasReal = "reality" in val;
    if (hasExp || (hasReal && !("setup" in val) && !("punchline" in val))) {
      return formatExpectationRealityToMarkdown(val, options);
    }

    // Pattern B: Narrative Beats { setup, reality, evidence, punchline }
    const hasBeats = "setup" in val || "punchline" in val || "evidence" in val;
    if (hasBeats) {
      return formatBeatsToMarkdown(val, options);
    }

    // Pattern C: Speaker & Dialogue
    if (val.speaker && (val.text != null || val.line != null)) {
      const speaker = toPlainSafeString(val.speaker) || "Speaker";
      const text = formatValueToMarkdown(val.text != null ? val.text : val.line, options);
      return `**${speaker}**: ${text}`;
    }

    // Pattern D: Study fact object { study_id, observedFinding }
    if (val.study_id && (val.observedFinding || val.finding)) {
      const sid = toPlainSafeString(val.study_id);
      const finding = formatValueToMarkdown(val.observedFinding || val.finding, options);
      return `**[${sid}]**: ${finding}`;
    }

    // Pattern E: Unknown Object in Debug mode -> JSON code block
    if (isDebug) {
      try {
        const jsonStr = JSON.stringify(val, null, 2);
        return `\`\`\`json\n${jsonStr}\n\`\`\``;
      } catch {
        // Continue to fallback
      }
    }

    // Pattern F: Unknown Object in standard mode -> Formatted key-value list
    const entries = Object.entries(val);
    if (entries.length === 0) return "";

    const indent = options.indent || "";
    return entries
      .map(([k, v]) => {
        const label = formatKeyLabel(k);
        const sub = formatValueToMarkdown(v, { ...options, indent: indent + "  " });
        if (sub.includes("\n")) {
          return `${indent}**${label}**:\n${sub}`;
        }
        return `${indent}**${label}**: ${sub}`;
      })
      .join("\n");
  }

  return "";
}

/**
 * Formats the grounded facts array or single fact cleanly into bullet list.
 */
export function formatGroundedFactsMarkdown(facts: any): string {
  if (!facts) return "- *No specific empirical observations cataloged.*";
  if (Array.isArray(facts)) {
    if (facts.length === 0) return "- *No specific empirical observations cataloged.*";
    return facts
      .map((f) => {
        if (!f) return "";
        if (typeof f === "object") {
          if (f.study_id && (f.observedFinding || f.finding || f.fact)) {
            const sid = toPlainSafeString(f.study_id);
            const finding = formatValueToMarkdown(f.observedFinding || f.finding || f.fact);
            return `- **[${sid}]**: ${finding}`;
          }
          return formatValueToMarkdown(f);
        }
        const text = formatValueToMarkdown(f);
        return text.startsWith("-") ? text : `- ${text}`;
      })
      .filter(Boolean)
      .join("\n");
  }
  const single = formatValueToMarkdown(facts);
  return single.startsWith("-") ? single : `- ${single}`;
}

/**
 * Formats dialogue and conceptual panel beats cleanly into a sub-bullet list.
 */
export function formatDialogueOrPanelsMarkdown(dialogue: any): string {
  if (!dialogue) return "";
  const arr = Array.isArray(dialogue) ? dialogue : [dialogue];
  if (arr.length === 0) return "";

  return arr
    .map((d: any) => {
      if (!d) return "";
      if (typeof d === "string") {
        return `  - ${d}`;
      }
      if (typeof d === "object") {
        const speaker = toPlainSafeString(d.speaker || d.character || d.source || "OSDR Narrative");
        const text = formatValueToMarkdown(d.text != null ? d.text : (d.dialogue != null ? d.dialogue : d));
        return `  - **${speaker}**: ${text}`;
      }
      return `  - ${toPlainSafeString(d)}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Formats the visual metaphor field into appropriate markdown layout.
 */
export function formatVisualMetaphorMarkdown(metaphor: any): string {
  if (!metaphor) return "- **Visual Metaphor**: *Not specified*";
  if (typeof metaphor === "string") {
    return `- **Visual Metaphor**: ${metaphor.trim()}`;
  }
  if (typeof metaphor === "object") {
    if (metaphor.expectation || metaphor.reality) {
      const expReal = formatExpectationRealityToMarkdown(metaphor, { indent: "  " });
      return `- **Visual Metaphor**:\n${expReal}`;
    }
    if (metaphor.setup || metaphor.punchline || metaphor.evidence) {
      const beats = formatBeatsToMarkdown(metaphor, { indent: "  " });
      return `- **Visual Metaphor**:\n${beats}`;
    }
    const formatted = formatValueToMarkdown(metaphor, { indent: "  " });
    return `- **Visual Metaphor**:\n${formatted}`;
  }
  return `- **Visual Metaphor**: ${toPlainSafeString(metaphor)}`;
}

/**
 * Formats the AWG Meme Clip payload into clean, compact, clip-first chat markdown.
 * Avoids long reports, essays, or scenario beats as requested.
 */
export function formatMemeToMarkdown(
  memeConcept: any,
  options: { sidA?: string; sidB?: string; debug?: boolean } = {}
): string {
  if (!memeConcept || typeof memeConcept !== "object") {
    return "### 🎬 AWG Meme Clip\n*No meme clip available.*";
  }

  const sidA = options.sidA || memeConcept.studies?.[0] || memeConcept.studyA?.study_id || "OSD-87";
  const sidB = options.sidB || memeConcept.studies?.[1] || memeConcept.studyB?.study_id || "OSD-100";

  const premise =
    toPlainSafeString(memeConcept.premise) ||
    toPlainSafeString(memeConcept.memeHook) ||
    toPlainSafeString(memeConcept.memeTitle) ||
    "Mouse retina: preparing for spaceflight like it is a group project with three different omics teams.";

  const sAAssay = memeConcept.studyA?.assay ? ` (${memeConcept.studyA.assay})` : "";
  const sBAssay = memeConcept.studyB?.assay ? ` (${memeConcept.studyB.assay})` : "";

  return (
    `### 🎬 AWG Meme Clip\n\n` +
    `> *“${premise.replace(/\n/g, " ")}”*\n\n` +
    `✦ **[CONCEPTUAL COMMUNICATION]** Based on [**${sidA}**](https://osdr.nasa.gov/bio/repo/data/studies/${sidA})${sAAssay} × [**${sidB}**](https://osdr.nasa.gov/bio/repo/data/studies/${sidB})${sBAssay}`
  );
}
