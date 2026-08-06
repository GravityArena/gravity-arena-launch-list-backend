function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return {};
}

function isAuthorized(req) {
  const expected = process.env.HUMAN_HANDOVER_CONTROL_KEY?.trim();
  const supplied = String(req.headers["x-api-key"] || "").trim();
  return Boolean(expected && supplied && supplied === expected);
}

function getMemoryConfig() {
  const baseUrl = process.env.MEMORY_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.MEMORY_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

async function memoryRequest(action, options = {}) {
  const config = getMemoryConfig();
  if (!config) throw new Error("Memory API configuration is incomplete.");

  const response = await fetch(`${config.baseUrl}/?action=${encodeURIComponent(action)}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Memory API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  try {
    const body = parseBody(req);
    const waId = String(body.wa_id || "").replace(/\D/g, "");
    const operation = String(body.operation || "status").trim().toLowerCase();

    if (!waId) {
      return res.status(422).json({ ok: false, error: "wa_id is required." });
    }

    if (operation === "status") {
      const result = await memoryRequest(
        `handover-status&wa_id=${encodeURIComponent(waId)}`,
        { method: "GET" }
      );
      return res.status(200).json(result);
    }

    if (operation === "activate") {
      const result = await memoryRequest("handover-activate", {
        method: "POST",
        body: JSON.stringify({
          wa_id: waId,
          team: String(body.team || "MARKETING").trim().toUpperCase(),
          reason: String(body.reason || "MANUAL").trim().toUpperCase(),
        }),
      });
      return res.status(200).json(result);
    }

    if (operation === "resolve") {
      const result = await memoryRequest("handover-resolve", {
        method: "POST",
        body: JSON.stringify({
          wa_id: waId,
          resolution_note: String(body.resolution_note || "Resolved by staff").trim(),
        }),
      });
      return res.status(200).json(result);
    }

    return res.status(422).json({
      ok: false,
      error: "operation must be status, activate or resolve.",
    });
  } catch (error) {
    console.error("Handover control error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({ ok: false, error: "Handover operation failed." });
  }
}
