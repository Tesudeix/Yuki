# Yuki Backend

Background removal/product extraction API is available at `POST /image/remove-background`.

Setup
- Environment: Node 18+ (required for global `fetch`/`FormData`/`Blob`).
- Add env variables to `.env` (one of):
  - `OPENAI_API_KEY`: OpenAI project/user API key for the OpenAI provider.
  - `REMOVE_BG_API_KEY`: remove.bg API key for the remove.bg provider.
  - `PUBLIC_BASE_URL`: optional; base URL for generating public file links (e.g. `https://api.example.com`). If omitted, the server infers from the request.

Usage
- Endpoint: `POST /image/remove-background`
- Content-Type: `multipart/form-data`
- Fields:
  - `image`: file (required)
  - `provider`: `openai` or `removebg` (default `removebg`)
  - `apiKey`: optional; overrides env key at request time
  - `prompt`: optional; used for OpenAI edits (default prompt extracts product to white background, 1:1)
  - `product`: optional; used to fill into default OpenAI prompt
- Response: `{ success: true, downloadUrl: "https://.../files/<result>" }` on success.

Notes
- Files are saved under `Yuki/public/uploads` and served via `/files/<name>`.
- The implementation uses remove.bg REST API under the hood. If you prefer another provider, you can swap the logic in `services/background-remove.js`.
