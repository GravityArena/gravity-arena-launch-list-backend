const SUPPORTED_PLATFORMS = new Set(["facebook", "instagram"]);
const SUPPORTED_FORMATS = new Set(["single-image", "carousel", "reel"]);

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return {};
}

function isAuthorized(req) {
  const expected = process.env.SOCIAL_DRAFT_API_KEY?.trim();
  if (!expected) return false;

  const supplied = String(req.headers["x-api-key"] || "").trim();
  return supplied.length > 0 && supplied === expected;
}

async function createSocialDraft({ platform, format, topic, objective, audience }) {
  const apiUrl = process.env.HERMES_API_URL?.trim();
  const apiKey = process.env.HERMES_API_KEY?.trim();
  const model = process.env.HERMES_MODEL?.trim();

  if (!apiUrl || !apiKey || !model) {
    throw new Error("Hermes model configuration is incomplete.");
  }

  const brandPrompt =
    process.env.SOCIAL_BRAND_PROMPT?.trim() ||
    "Gravity Arena is a premium, futuristic immersive entertainment and skills brand in South Africa. Its content pillars include FPV and drone racing, VR and sim racing, drone photography, 3D printing, STEM learning, corporate experiences and birthday experiences. Never invent prices, launch dates, addresses, availability, certifications, partnerships or performance claims. Draft only; do not state or imply that anything has been published or approved.";

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `${brandPrompt}\nReturn valid JSON only with keys: platform, format, headline, caption, hashtags, creative_brief, call_to_action, compliance_notes, founder_approval_status. founder_approval_status must always be DRAFT_REQUIRES_FOUNDER_APPROVAL.`,
        },
        {
          role: "user",
          content: [
            `Platform: ${platform}`,
            `Format: ${format}`,
            `Topic: ${topic}`,
            `Objective: ${objective || "Awareness and qualified interest"}`,
            `Audience: ${audience || "South African families, enthusiasts, schools and corporate teams"}`,
          ].join("\n"),
        },
      ],
      max_completion_tokens: 700,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Hermes API failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Hermes returned an empty social draft.");

  try {
    return JSON.parse(raw.replace(/^```json\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return {
      platform,
      format,
      draft_text: raw,
      founder_approval_status: "DRAFT_REQUIRES_FOUNDER_APPROVAL",
    };
  }
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
    const platform = String(body.platform || "").trim().toLowerCase();
    const format = String(body.format || "").trim().toLowerCase();
    const topic = String(body.topic || "").trim();

    if (!SUPPORTED_PLATFORMS.has(platform)) {
      return res.status(422).json({ ok: false, error: "platform must be facebook or instagram." });
    }

    if (!SUPPORTED_FORMATS.has(format)) {
      return res.status(422).json({ ok: false, error: "format must be single-image, carousel or reel." });
    }

    if (!topic || topic.length > 500) {
      return res.status(422).json({ ok: false, error: "A topic of 1 to 500 characters is required." });
    }

    const draft = await createSocialDraft({
      platform,
      format,
      topic,
      objective: String(body.objective || "").trim(),
      audience: String(body.audience || "").trim(),
    });

    return res.status(200).json({
      ok: true,
      mode: "draft-only",
      publishing_enabled: false,
      draft,
    });
  } catch (error) {
    console.error("Social draft error", {
      message: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({ ok: false, error: "Social draft could not be generated." });
  }
}
