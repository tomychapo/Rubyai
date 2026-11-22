const instruction = "You are Ruby, Chapo's personal Australian AI assistant. Be warm, witty, direct and naturally conversational. Keep spoken replies concise unless asked for detail. Use the supplied conversation for context and be honest about what you remember.";
const encoder = new TextEncoder();

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function matchesCode(supplied, expected) {
  if (!supplied.startsWith("Bearer ") || supplied.length > 300) return false;
  const [actual, target] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied.slice(7))),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  return crypto.subtle.timingSafeEqual(actual, target);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname !== "/api/chat") return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (request.headers.get("Origin") !== url.origin) return json({ error: "Open Ruby from her own site." }, 403);
    if (!env.GEMINI || !env.RUBY_ACCESS_CODE || !env.CHAT_LIMIT) {
      return json({ error: "Ruby’s server setup is incomplete." }, 503);
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!(await env.CHAT_LIMIT.limit({ key: ip })).success) {
      return json({ error: "Too many attempts. Try again in a minute." }, 429);
    }
    if (!(await matchesCode(request.headers.get("Authorization") || "", env.RUBY_ACCESS_CODE))) {
      return json({ error: "Enter your Ruby access code and try again." }, 401);
    }
    let payload;
    try {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      let body = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          return json({ error: "The chat request is too large." }, 413);
        }
        body += decoder.decode(value, { stream: true });
      }
      payload = JSON.parse(body + decoder.decode());
    } catch {
      return json({ error: "Invalid chat request." }, 400);
    }
    const message = typeof payload?.message === "string" ? payload.message.trim() : "";
    if (!message || message.length > 2000) {
      return json({ error: "Use between 1 and 2,000 characters." }, 400);
    }
    const history = Array.isArray(payload.history) ? payload.history.slice(-12) : [];
    const contents = history
      .filter(entry => ["user", "model"].includes(entry?.role) && typeof entry.text === "string" && entry.text.trim())
      .map(entry => ({ role: entry.role, parts: [{ text: entry.text.slice(0, 1000) }] }));
    contents.push({ role: "user", parts: [{ text: message }] });
    const model = env.GEMINI_MODEL || "gemini-3.1-flash-lite";
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instruction }] },
            contents,
            generationConfig: { maxOutputTokens: 768 }
          }),
          signal: AbortSignal.timeout(25000)
        }
      );
      if (response.status === 429) return json({ error: "Gemini’s quota is busy. Try again later." }, 429);
      if (!response.ok) return json({ error: "Gemini is unavailable. Check the model and key in Cloudflare." }, 502);
      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts
        ?.filter(part => !part.thought && typeof part.text === "string")
        .map(part => part.text).join("").trim();
      if (!reply) return json({ error: "Gemini returned no reply. Try rephrasing." }, 502);
      return json({ reply });
    } catch {
      return json({ error: "Ruby couldn’t reach Gemini. Try again shortly." }, 502);
    }
  }
};
