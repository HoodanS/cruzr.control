// Cloudflare Worker: serves ./public and handles POST /chat -> Gemini API.
// Secret required: GEMINI_API_KEY  (set in the dashboard or with `wrangler secret put`)

const SYSTEM =
  "You are Cruzr, a friendly service robot. Reply in the same language the user wrote in " +
  "(Arabic or English; for Arabic use simple, clear Arabic). Keep answers short (1 to 3 sentences) " +
  "because they are spoken aloud. Plain text only: no markdown, no emojis, no lists.";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function validMessages(m) {
  if (!Array.isArray(m) || m.length === 0 || m.length > 20) return false;
  if (m[0].role !== "user" || m[m.length - 1].role !== "user") return false;
  return m.every(
    (x, i) =>
      x &&
      x.role === (i % 2 === 0 ? "user" : "assistant") &&
      typeof x.content === "string" &&
      x.content.length > 0 &&
      x.content.length <= 2000
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/chat") return new Response("Not found", { status: 404 });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (!env.GEMINI_API_KEY) return json({ error: "Server misconfigured", detail: "Missing GEMINI_API_KEY secret" }, 500);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const messages = body?.messages;
    if (!validMessages(messages)) return json({ error: "Invalid messages" }, 400);

    // Gemini uses "model" instead of "assistant" for the role name.
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const model = env.MODEL || "gemini-3.8-flash";
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents,
            generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
          }),
        }
      );
      const data = await r.json();
      if (!r.ok) {
        console.error("Gemini API error:", r.status, JSON.stringify(data));
        return json({ error: "Upstream error", detail: data.error?.message || "" }, 502);
      }
      const reply = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!reply) {
        console.error("Empty reply:", JSON.stringify(data));
        return json({ error: "Empty reply" }, 502);
      }
      return json({ reply });
    } catch (err) {
      console.error(err);
      return json({ error: "Server error" }, 500);
    }
  },
};
