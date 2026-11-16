const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Groq-Key,X-HF-Token",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const HF_SPACE_URL = env.HF_SPACE_URL || "https://henrybit-musetalk-1-5.hf.space";
    const HF_API_NAME = env.HF_API_NAME || "/generate";

    try {
      if (url.pathname === "/api/health") {
        return json({
          ok: true,
          groqConfigured: Boolean(env.GROQ_API_KEY),
          videoConfigured: Boolean(HF_SPACE_URL && HF_API_NAME),
          ttsConfigured: Boolean(env.TTS_API_URL && env.TTS_API_KEY)
        });
      }

      if (url.pathname === "/api/story" && request.method === "POST") {
        const groqKey = request.headers.get("X-Groq-Key") || env.GROQ_API_KEY;
        if (!groqKey) return json({ error: "Groq API anahtarını uygulama ayarlarına gir." }, 401);
        const input = await request.json();
        const idea = String(input.idea || "").slice(0, 12000);
        const narration = String(input.narration || "").slice(0, 18000);
        const count = Math.min(12, Math.max(2, Number(input.count) || 6));
        if (!idea && !narration) return json({ error: "Enter a story idea or narration." }, 400);

        const system = `You are the story editor and visual director for NEXUS AI, a Turkish short-video studio. Respond only with valid JSON. Create exactly ${count} sequential scenes. If narration is supplied, preserve its meaning and divide it naturally; do not invent facts. If only an idea is supplied, write a coherent Turkish narration suitable for a short video. Every scene must have: voice_text in Turkish, visual_prompt in detailed English, and duration_seconds as a number. Visual prompts must depict the exact event being narrated, include shot composition, camera movement, lighting, environment and realistic details, and maintain continuity of characters, clothing, location, time period and visual style. Do not add unrelated scenes, visible text, logos or watermarks. Keep all narration segments in the same story order. JSON shape: {"title":"...","narration":"...","scenes":[{"voice_text":"...","visual_prompt":"...","duration_seconds":5}]}. The title and narration are Turkish.`;
        const user = JSON.stringify({
          title: String(input.title || "").slice(0, 300),
          idea,
          narration,
          aspect_ratio: String(input.ratio || "9:16"),
          style: String(input.style || "Sinematik belgesel"),
          scene_count: count,
          identity_rules: String(input.identity || "").slice(0, 3000)
        });

        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + groqKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: env.GROQ_MODEL || "openai/gpt-oss-20b",
            temperature: 0.7,
            max_completion_tokens: 7000,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content: user }]
          })
        });
        const raw = await upstream.text();
        if (!upstream.ok) return json({ error: "Groq request failed", detail: raw.slice(0, 1500) }, upstream.status);
        const envelope = JSON.parse(raw);
        const content = envelope.choices?.[0]?.message?.content || "{}";
        let result;
        try { result = JSON.parse(content); }
        catch { return json({ error: "AI returned invalid JSON", raw: content.slice(0, 2000) }, 502); }
        if (!Array.isArray(result.scenes)) return json({ error: "AI response has no scenes array." }, 502);
        return json(result);
      }

      // Upload a portrait or narration audio file to the configured Gradio Space.
      if (url.pathname === "/api/video/upload" && request.method === "POST") {
        if (!HF_SPACE_URL || !HF_API_NAME) return json({ error: "Video Space is not configured.", diagnostics: { hasSpaceUrl: Boolean(env.HF_SPACE_URL), hasApiName: Boolean(env.HF_API_NAME) } }, 503);
        const incoming = await request.formData();
        const file = incoming.get("file");
        if (!file || typeof file.arrayBuffer !== "function") return json({ error: "A file field is required." }, 400);
        const form = new FormData();
        form.append("files", file, file.name || "upload.bin");
        const headers = {};
        const hfToken = request.headers.get("X-HF-Token") || env.HF_TOKEN;
        if (hfToken) headers.Authorization = "Bearer " + hfToken;
        const base = HF_SPACE_URL.replace(/\/$/, "");
        const upstream = await fetch(base + "/gradio_api/upload", { method: "POST", headers, body: form });
        const raw = await upstream.text();
        if (!upstream.ok) return json({ error: "Hugging Face upload failed", detail: raw.slice(0, 1500) }, upstream.status);
        let uploaded;
        try { uploaded = JSON.parse(raw); } catch { return json({ error: "Unexpected upload response", detail: raw.slice(0, 1000) }, 502); }
        const path = Array.isArray(uploaded) ? uploaded[0] : uploaded.path;
        if (!path) return json({ error: "Upload response did not include a file path.", detail: raw.slice(0, 1000) }, 502);
        return json({ path });
      }

      // Generic Gradio Space queue bridge. The exact Space API name and input array
      // must be read from that Space's "Use via API" panel before production use.
      if (url.pathname === "/api/video/start" && request.method === "POST") {
        if (!HF_SPACE_URL || !HF_API_NAME) return json({ error: "Set HF_SPACE_URL and HF_API_NAME after checking the Space API panel.", diagnostics: { hasSpaceUrl: Boolean(env.HF_SPACE_URL), hasApiName: Boolean(env.HF_API_NAME) } }, 503);
        const body = await request.json();
        if (!Array.isArray(body.data)) return json({ error: "Expected { data: [...] } using the Space's exact API input order." }, 400);
        const base = HF_SPACE_URL.replace(/\/$/, "");
        const headers = { "Content-Type": "application/json" };
        const hfToken = request.headers.get("X-HF-Token") || env.HF_TOKEN;
        if (hfToken) headers.Authorization = "Bearer " + hfToken;
        const apiName = String(HF_API_NAME).split("/").filter(Boolean).join("/");
        const upstream = await fetch(base + "/gradio_api/call/" + apiName, {
          method: "POST", headers, body: JSON.stringify({ data: body.data })
        });
        const raw = await upstream.text();
        if (!upstream.ok) return json({ error: "Hugging Face Space request failed", detail: raw.slice(0, 1500) }, upstream.status);
        return json(JSON.parse(raw));
      }

      if (url.pathname === "/api/video/result" && request.method === "GET") {
        if (!HF_SPACE_URL || !HF_API_NAME) return json({ error: "Video Space is not configured." }, 503);
        const eventId = url.searchParams.get("event_id");
        if (!eventId) return json({ error: "event_id is required." }, 400);
        const base = HF_SPACE_URL.replace(/\/$/, "");
        const headers = {};
        const hfToken = request.headers.get("X-HF-Token") || env.HF_TOKEN;
        if (hfToken) headers.Authorization = "Bearer " + hfToken;
        const apiName = String(HF_API_NAME).split("/").filter(Boolean).join("/");
        const upstream = await fetch(base + "/gradio_api/call/" + apiName + "/" + encodeURIComponent(eventId), { headers });
        const raw = await upstream.text();
        if (!upstream.ok) return json({ error: "Hugging Face result request failed", detail: raw.slice(0, 1500) }, upstream.status);
        return new Response(raw, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream; charset=utf-8" } });
      }

      // Provider-specific TTS adapter will be added once the selected provider's
      // exact REST request and response format is confirmed. Never expose keys in HTML.
      if (url.pathname === "/api/tts") {
        return json({ error: "TTS provider adapter is not configured yet. API credentials must be stored as Worker secrets." }, 501);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: "Worker error", detail: String(error?.message || error) }, 500);
    }
  }
};