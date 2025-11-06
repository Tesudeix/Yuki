const fs = require("fs");
const path = require("path");

// Uses remove.bg REST API: https://api.remove.bg/v1.0/removebg
// Returns { success: true, buffer } or { success: false, error }
async function removeBackgroundWithRemoveBg(imagePath, apiKey) {
  try {
    if (typeof fetch !== "function") {
      return { success: false, error: "Global fetch is not available. Use Node 18+ or add a fetch polyfill." };
    }

    const data = await fs.promises.readFile(imagePath);
    const blob = new Blob([data]);
    const form = new FormData();
    form.append("image_file", blob, "upload.png");
    form.append("size", "auto");

    const resp = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
    });

    const contentType = resp.headers.get("content-type") || "";
    if (!resp.ok) {
      let message = `remove.bg error (${resp.status})`;
      try {
        if (contentType.includes("application/json")) {
          const j = await resp.json();
          message = j?.errors?.[0]?.title || j?.error?.message || message;
        } else {
          const t = await resp.text();
          if (t) message += `: ${t}`;
        }
      } catch {}
      return { success: false, error: message };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    return { success: true, buffer };
  } catch (err) {
    return { success: false, error: err?.message || "Unknown error" };
  }
}

module.exports = { removeBackgroundWithRemoveBg };

// OpenAI Images Edit provider
// Uses POST https://api.openai.com/v1/images/edits with model=gpt-image-1
// Returns { success: true, buffer } or { success: false, error }
async function removeBackgroundWithOpenAI(imagePath, apiKey, prompt, size = "1024x1024", orgId) {
  try {
    if (typeof fetch !== "function") {
      return { success: false, error: "Global fetch is not available. Use Node 18+ or add a fetch polyfill." };
    }
    const data = await fs.promises.readFile(imagePath);
    const ext = (path.extname(imagePath || "").toLowerCase() || "").replace(/^\./, "");
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "application/octet-stream";
    const filename = path.basename(imagePath || "upload.png") || "upload.png";
    const blob = new Blob([data], { type: mime });
    const form = new FormData();
    form.append("model", "gpt-image-1");
    // OpenAI Images Edit accepts single file in 'image'. Repeat 'image' to send multiple.
    form.append("image", blob, filename);
    if (prompt && String(prompt).trim().length > 0) {
      form.append("prompt", String(prompt));
    } else {
      form.append("prompt", "Remove background to pure white (#FFFFFF), keep sharp clean edges, 1:1 square, high-resolution.");
    }
    if (size) form.append("size", size);

    const headers = { "Authorization": `Bearer ${apiKey}` };
    if (orgId) headers["OpenAI-Organization"] = orgId;
    const resp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers,
      body: form,
    });

    const contentType = resp.headers.get("content-type") || "";
    const textIfAny = async () => { try { return await resp.text(); } catch { return ""; } };

    if (!resp.ok) {
      let message = `OpenAI Images error (${resp.status})`;
      try {
        if (contentType.includes("application/json")) {
          const j = JSON.parse(await textIfAny());
          message = j?.error?.message || message;
        } else {
          const t = await textIfAny();
          if (t) message += `: ${t}`;
        }
      } catch {}
      return { success: false, error: message };
    }

    // Handle both JSON (b64) and direct image binary responses
    if (contentType.startsWith("image/")) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      return { success: true, buffer };
    }

    const bodyText = await textIfAny();
    try {
      const json = bodyText ? JSON.parse(bodyText) : {};
      const b64 = json?.data?.[0]?.b64_json;
      const url = json?.data?.[0]?.url;
      if (b64) {
        const buffer = Buffer.from(b64, "base64");
        return { success: true, buffer };
      }
      if (url && typeof url === "string") {
        // Fetch the image from the returned URL
        const r2 = await fetch(url);
        if (!r2.ok) return { success: false, error: `OpenAI URL fetch failed (${r2.status})` };
        const buffer = Buffer.from(await r2.arrayBuffer());
        return { success: true, buffer };
      }
      return { success: false, error: "No image returned from OpenAI" };
    } catch {
      return { success: false, error: "Failed to parse OpenAI response" };
    }
  } catch (err) {
    return { success: false, error: err?.message || "Unknown error" };
  }
}

module.exports.removeBackgroundWithOpenAI = removeBackgroundWithOpenAI;

// Nano Banana provider (configurable endpoint)
// Expects env NANO_BANANA_ENDPOINT or NANO_BANANA_API_URL to be a full URL
// Returns { success: true, buffer } or { success: false, error }
async function removeBackgroundWithNanoBanana(imagePath, apiKey, endpoint, prompt) {
  try {
    if (typeof fetch !== "function") {
      return { success: false, error: "Global fetch is not available. Use Node 18+ or add a fetch polyfill." };
    }
    const url = (endpoint || process.env.NANO_BANANA_ENDPOINT || process.env.NANO_BANANA_API_URL || "").trim();
    if (!url) {
      return { success: false, error: "Nano Banana endpoint is not configured. Provide 'nbUrl' or set NANO_BANANA_ENDPOINT." };
    }
    if (!apiKey) {
      return { success: false, error: "Nano Banana API key is missing" };
    }
    const data = await fs.promises.readFile(imagePath);
    const form = new FormData();
    const filename = require("path").basename(imagePath || "upload.png") || "upload.png";
    form.append("image", new Blob([data]), filename);
    if (prompt) form.append("prompt", String(prompt));

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
      },
      body: form,
    });

    const ct = resp.headers.get("content-type") || "";
    if (!resp.ok) {
      let msg = `Nano Banana error (${resp.status})`;
      try {
        if (ct.includes("application/json")) {
          const j = await resp.json();
          msg = j?.error || j?.message || msg;
        } else {
          const t = await resp.text(); if (t) msg += `: ${t}`;
        }
      } catch {}
      return { success: false, error: msg };
    }

    if (ct.startsWith("image/")) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      return { success: true, buffer };
    }

    try {
      const j = await resp.json();
      const b64 = j?.data?.b64 || j?.b64 || j?.image_b64;
      const fileUrl = j?.data?.url || j?.url || j?.result_url;
      if (b64) return { success: true, buffer: Buffer.from(b64, "base64") };
      if (fileUrl) {
        const r2 = await fetch(fileUrl);
        if (!r2.ok) return { success: false, error: `Fetch result URL failed (${r2.status})` };
        return { success: true, buffer: Buffer.from(await r2.arrayBuffer()) };
      }
      return { success: false, error: "Nano Banana response missing image data" };
    } catch {
      return { success: false, error: "Failed to parse Nano Banana response" };
    }
  } catch (err) {
    return { success: false, error: err?.message || "Unknown error" };
  }
}

module.exports.removeBackgroundWithNanoBanana = removeBackgroundWithNanoBanana;
