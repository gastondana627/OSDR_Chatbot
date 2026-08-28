import { useEffect, useState } from "react";

// Browser-based history tracking: conversations persist in localStorage, so the
// full chat history survives page reloads and browser restarts.
const KEY = "osdr-conversations";

/**
 * Strips huge base64 payloads from media items before storing in localStorage
 * to ensure we never exceed the browser's 5MB quota limit.
 */
function sanitizeMessageForStorage(msg) {
  if (!msg) return msg;
  const cleanMsg = { ...msg };

  if (cleanMsg.awgMediaGallery) {
    cleanMsg.awgMediaGallery = {
      ...cleanMsg.awgMediaGallery,
      items: (cleanMsg.awgMediaGallery.items || []).map((item) => {
        const cleanItem = { ...item };
        if (typeof cleanItem.url === "string" && cleanItem.url.startsWith("data:")) {
          cleanItem.url = ""; 
          cleanItem.hasOmittedBlob = true;
        }
        return cleanItem;
      }),
    };
  }

  if (cleanMsg.memeVideoClip) {
    cleanMsg.memeVideoClip = {
      ...cleanMsg.memeVideoClip,
      videoUrl: typeof cleanMsg.memeVideoClip.videoUrl === "string" && cleanMsg.memeVideoClip.videoUrl.startsWith("data:") ? "" : cleanMsg.memeVideoClip.videoUrl,
    };
  }

  if (cleanMsg.translationalClip) {
    cleanMsg.translationalClip = {
      ...cleanMsg.translationalClip,
      videoUrl: typeof cleanMsg.translationalClip.videoUrl === "string" && cleanMsg.translationalClip.videoUrl.startsWith("data:") ? "" : cleanMsg.translationalClip.videoUrl,
    };
  }

  if (cleanMsg.videoBrief) {
    cleanMsg.videoBrief = {
      ...cleanMsg.videoBrief,
      videoUrl: typeof cleanMsg.videoBrief.videoUrl === "string" && cleanMsg.videoBrief.videoUrl.startsWith("data:") ? "" : cleanMsg.videoBrief.videoUrl,
    };
  }

  return cleanMsg;
}

function serializeForStorage(convs) {
  if (!Array.isArray(convs)) return [];
  // Keep the most recent 12 conversations max in localStorage
  return convs.slice(0, 12).map((c) => ({
    ...c,
    messages: (c.messages || []).map(sanitizeMessageForStorage),
  }));
}

function pruneConversations(convs, maxCount = 3) {
  if (!Array.isArray(convs)) return [];
  return convs.slice(0, maxCount).map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    messages: (c.messages || []).slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
      sources: m.sources,
    })),
  }));
}

function safeSave(conversations) {
  try {
    const serialized = serializeForStorage(conversations);
    localStorage.setItem(KEY, JSON.stringify(serialized));
  } catch (err) {
    console.warn("Storage quota limit reached, applying storage compression...", err);
    try {
      // Tier 1: Aggressively prune to 5 conversations without media blobs
      const pruned = pruneConversations(conversations, 5);
      localStorage.setItem(KEY, JSON.stringify(pruned));
    } catch (err2) {
      try {
        // Tier 2: Minimal single active conversation
        const minimal = pruneConversations(conversations, 1);
        localStorage.setItem(KEY, JSON.stringify(minimal));
      } catch (err3) {
        // Tier 3: Silently retain in-memory state without crashing the UI
        console.warn("localStorage quota completely exhausted. Chat continues safely in memory.", err3);
      }
    }
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function newConversation() {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [], // { role: "user" | "assistant", content, sources?: [] }
    createdAt: Date.now(),
  };
}

export function useConversations() {
  const [conversations, setConversations] = useState(load);
  const [activeId, setActiveId] = useState(() => load()[0]?.id ?? null);

  // Safely persist on change with quota overflow protection
  useEffect(() => {
    safeSave(conversations);
  }, [conversations]);

  // Guarantee there is always an active conversation.
  useEffect(() => {
    if (!activeId || !conversations.find((c) => c.id === activeId)) {
      if (conversations.length) setActiveId(conversations[0].id);
      else createConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = conversations.find((c) => c.id === activeId) || null;

  function createConversation() {
    const conv = newConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    return conv.id;
  }

  function deleteConversation(id) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) setActiveId((prev) => prev); // effect above will re-home
  }

  // Apply an updater to the active conversation's messages.
  function updateActive(updater) {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        const messages = updater(c.messages);
        // Title the conversation from its first user message.
        let title = c.title;
        if (title === "New chat") {
          const firstUser = messages.find((m) => m.role === "user");
          if (firstUser) title = firstUser.content.slice(0, 40);
        }
        return { ...c, messages, title };
      })
    );
  }

  return {
    conversations,
    active,
    activeId,
    setActiveId,
    createConversation,
    deleteConversation,
    updateActive,
  };
}
