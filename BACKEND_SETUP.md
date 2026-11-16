# NEXUS AI backend setup

This repository is hosted on GitHub Pages. Pages is static hosting and cannot safely store API keys or run video rendering. The Worker in `worker.js` is a starter backend; it is not deployed automatically by GitHub Pages.

## Current backend endpoints

- `GET /api/health`: reports which secrets/configuration values exist.
- `POST /api/story`: calls Groq and returns a Turkish narration plus scene-specific English visual prompts.
- `POST /api/video/start` and `GET /api/video/result?event_id=...`: generic Hugging Face Gradio queue bridge. The exact Space endpoint and input order must be read from the selected Space's **Use via API** panel first.
- `POST /api/tts`: intentionally not enabled until a TTS provider and its exact API contract are selected.
- MP4 rendering is not implemented here. Cloudflare Workers are not an FFmpeg video-rendering server.

## Cloudflare Worker deployment

1. Create/sign in to a Cloudflare account.
2. Create a Worker named `nexus-ai-api`.
3. Paste the contents of this file into the Worker's editor and deploy.
4. In Worker Settings > Variables and Secrets, add these as **Secrets** (never put keys in HTML or GitHub):
   - `GROQ_API_KEY` = the user's Groq API key
   - `HF_TOKEN` = optional Hugging Face access token
5. Add these as ordinary variables after checking the selected Space's API panel:
   - `HF_SPACE_URL` = Space host, e.g. `https://<space-subdomain>.hf.space`
   - `HF_API_NAME` = exact API endpoint name, without leading slash
   - `GROQ_MODEL` = optional; defaults to `openai/gpt-oss-20b`
6. Set `TTS_API_URL` and `TTS_API_KEY` only after choosing a provider and verifying its official API contract. The TTS secret must be a Worker Secret.
7. Copy the deployed Worker URL. The frontend must use that URL as its API base.

## Important limitations

- Hugging Face Spaces use a queue. Free ZeroGPU quota is limited (currently 5 GPU minutes/day for an authenticated free account; 2 minutes unauthenticated) and can be exhausted quickly.
- A public video Space may change its API name, input order, output format, or become unavailable. Test its API panel before enabling the video button.
- Final split-screen MP4 export needs a separate rendering service or a browser-side FFmpeg workflow. It is not honest to show an MP4 download button until that step succeeds.
- Do not send API keys in chat. Enter them only in the provider dashboard / Cloudflare Worker Secrets.
