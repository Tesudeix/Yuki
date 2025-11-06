// Simple code optimization via OpenAI Chat Completions
// Exports: optimizeCodeWithOpenAI(input)

/**
 * @typedef {Object} OptimizeInput
 * @property {string} apiKey - OpenAI API key
 * @property {string} code - Source code to optimize
 * @property {string=} language - Optional language hint (e.g., "javascript", "python")
 * @property {string=} goals - Optional textual goals (e.g., performance, readability, security)
 * @property {string=} model - Optional OpenAI model (default: gpt-4o-mini)
 */

/**
 * @typedef {Object} OptimizeResult
 * @property {boolean} success
 * @property {string=} optimizedCode
 * @property {string=} notes
 * @property {string=} model
 * @property {string=} error
 */

/**
 * @param {OptimizeInput} params
 * @returns {Promise<OptimizeResult>}
 */
async function optimizeCodeWithOpenAI(params) {
  try {
    const { apiKey, code, language = "", goals = "", model = "gpt-4o-mini" } = params || {};
    if (!apiKey) return { success: false, error: "Missing OpenAI API key" };
    if (!code || typeof code !== "string") return { success: false, error: "Missing 'code'" };

    const sys = [
      "You are a world-class software engineer and code optimizer.",
      "Optimize the provided code while preserving behavior.",
      "Focus on readability, performance, safety, and idiomatic patterns.",
      "Return ONLY a strict JSON object with keys: optimizedCode, notes.",
      "Do not include markdown fences or extra text.",
    ].join(" ");

    const userPrompt = [
      language ? `Language: ${language}` : undefined,
      goals ? `Goals: ${goals}` : undefined,
      "Code:\n" + code,
    ].filter(Boolean).join("\n\n");

    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const orgId = params.orgId || process.env.OPENAI_ORG_ID || process.env.OPENAI_ORGANIZATION_ID;
    if (orgId) headers["OpenAI-Organization"] = orgId;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const contentType = resp.headers.get("content-type") || "";
    const text = await resp.text();
    if (!resp.ok) {
      let message = `OpenAI error (${resp.status})`;
      try {
        if (contentType.includes("application/json")) {
          const j = JSON.parse(text);
          message = j?.error?.message || message;
        } else if (text) {
          message += `: ${text}`;
        }
      } catch {}
      return { success: false, error: message };
    }

    let json;
    try { json = JSON.parse(text); } catch { return { success: false, error: "Failed to parse OpenAI response" }; }
    const content = json?.choices?.[0]?.message?.content || "";
    if (!content) return { success: false, error: "Empty response from OpenAI" };

    let parsed;
    try { parsed = JSON.parse(content); } catch { return { success: false, error: "Model did not return valid JSON" }; }

    return {
      success: true,
      optimizedCode: String(parsed.optimizedCode || ""),
      notes: String(parsed.notes || ""),
      model,
    };
  } catch (err) {
    return { success: false, error: err?.message || "Unknown error" };
  }
}

module.exports = { optimizeCodeWithOpenAI };
