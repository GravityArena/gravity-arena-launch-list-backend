const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
const MEMORY_HISTORY_LIMIT = 12;
const DEFAULT_HANDOVER_KEYWORDS = [
  "human",
  "agent",
  "person",
  "someone",
  "call me",
  "phone me",
  "complaint",
  "manager",
  "refund",
  "quotation",
  "quote",
  "urgent",
  "escalate",
  "speak to",
];

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return {};
}

function getIncomingMessages(payload) {
  const messages = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contactsByWaId = new Map(
        (value.contacts || []).map((contact) => [
          contact.wa_id,
          contact.profile?.name || "",
        ])
      );

      for (const message of value.messages || []) {
        if (message.type === "text" && message.text?.body) {
          messages.push({
            from: message.from,
            displayName: contactsByWaId.get(message.from) || "",
            messageId: message.id,
            text: message.text.body.trim(),
          });
        }
      }
    }
  }

  return messages;
}

function getMemoryConfig() {
  const baseUrl = process.env.MEMORY_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.MEMORY_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

async function memoryRequest(path, options = {}) {
  const config = getMemoryConfig();
  if (!config) return null;

  const response = await fetch(`${config.baseUrl}${path}`, {
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

async function saveMemoryMessage({
  waId,
  displayName = "",
  metaMessageId = "",
  direction,
  role,
  body,
}) {
  return memoryRequest("/?action=message", {
    method: "POST",
    body: JSON.stringify({
      wa_id: waId,
      display_name: displayName,
      meta_message_id: metaMessageId,
      direction,
      role,
      body,
    }),
  });
}

async function getMemoryHistory(waId) {
  const result = await memoryRequest(
    `/?action=history&wa_id=${encodeURIComponent(waId)}&limit=${MEMORY_HISTORY_LIMIT}`,
    { method: "GET" }
  );

  return Array.isArray(result?.messages)
    ? result.messages
        .filter(
          (message) =>
            ["user", "assistant"].includes(message.role) &&
            typeof message.body === "string" &&
            message.body.trim()
        )
        .map((message) => ({
          role: message.role,
          content: message.body.trim(),
        }))
    : [];
}

function extractEmail(text) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || null;
}

function splitDisplayName(displayName) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function getHandoverKeywords() {
  const configured = process.env.HUMAN_HANDOVER_KEYWORDS?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_HANDOVER_KEYWORDS;
}

function requiresHumanHandover(text) {
  const normalized = text.toLowerCase();
  return getHandoverKeywords().some((keyword) => normalized.includes(keyword));
}

function getBrevoConfig() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return null;

  const listId = Number(process.env.BREVO_LEAD_LIST_ID || 0);
  return {
    apiKey,
    listId: Number.isInteger(listId) && listId > 0 ? listId : null,
  };
}
async function getHandoverStatus(waId) {
  return memoryRequest(
    `/?action=handover-status&wa_id=${encodeURIComponent(waId)}`,
    { method: "GET" }
  );
}

async function activateHandover(waId, team = "MARKETING", reason = "QUOTATION") {
  return memoryRequest("/?action=handover-activate", {
    method: "POST",
    body: JSON.stringify({
      wa_id: waId,
      team,
      reason,
    }),
  });
}
async function brevoRequest(path, options = {}) {
  const config = getBrevoConfig();
  if (!config) return null;

  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...options,
    headers: {
      "api-key": config.apiKey,
      accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Brevo API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  return data;
}
async function addContactToBrevoList(email, listId) {
  if (!email || !listId) return null;

  return brevoRequest(`/contacts/lists/${listId}/contacts/add`, {
    method: "POST",
    body: JSON.stringify({
      emails: [email],
    }),
  });
}
async function captureBrevoLead({ email, waId, displayName }) {
  const config = getBrevoConfig();
  if (!email || !config) return null;

  const { firstName, lastName } = splitDisplayName(displayName || "");
  const { listId } = config;

  const normalizedWaId = String(waId || "").replace(/\D/g, "");

const internationalNumber = normalizedWaId
  ? `+${normalizedWaId}`
  : "";

const attributes = {
  FIRSTNAME: firstName,
  LASTNAME: lastName,
};

  let contactResult;

  try {
    contactResult = await brevoRequest("/contacts", {
      method: "POST",
      body: JSON.stringify({
        email,
        attributes,
        updateEnabled: true,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    const isContactConflict =
      message.includes("(400)") ||
      message.toLowerCase().includes("already") ||
      message.toLowerCase().includes("duplicate");

    if (!isContactConflict) {
      throw error;
    }

    contactResult = await brevoRequest(
      `/contacts/${encodeURIComponent(email)}?identifierType=email_id`,
      {
        method: "PUT",
        body: JSON.stringify({
          attributes,
          ...(listId ? { listIds: [listId] } : {}),
        }),
      }
    );
  }

  if (listId) {
  try {
    await addContactToBrevoList(email, listId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    const alreadyInList =
      message.includes("already in list") ||
      message.includes("contact already in list");

    if (!alreadyInList) {
      throw error;
    }

    console.log("Brevo contact already in lead list", {
      emailDomain: email.split("@")[1],
      listId,
    });
  }
}
  return contactResult;
}

async function sendEscalationEmail({ waId, displayName, messageText, history }) {
  const recipient = process.env.HUMAN_ESCALATION_EMAIL?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena Hermes";
  if (!recipient || !senderEmail || !getBrevoConfig()) return null;

  const transcript = history
    .slice(-8)
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n");

  return brevoRequest("/smtp/email", {
    method: "POST",
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: recipient, name: "Gravity Arena Team" }],
      subject: `WhatsApp handover required: ${displayName || waId}`,
      textContent: [
        "A customer requested human assistance on WhatsApp.",
        `Customer: ${displayName || "Unknown"}`,
        `WhatsApp: ${waId}`,
        `Latest message: ${messageText}`,
        "",
        "Recent conversation:",
        transcript || "No prior messages available.",
      ].join("\n"),
      tags: ["gravity-arena", "whatsapp-handover"],
    }),
  });
}

async function askHermes(userText, history = []) {
  const apiUrl = process.env.HERMES_API_URL?.trim();
  const apiKey = process.env.HERMES_API_KEY?.trim();
  const model = process.env.HERMES_MODEL?.trim();

  if (!apiUrl || !model) {
    return "Thanks for contacting Gravity Arena. Your message has been received and a team member will assist you shortly.";
  }

  const systemPrompt =
    process.env.HERMES_SYSTEM_PROMPT ||
    "You are Gravity Arena's customer assistant. Be concise, professional and friendly. Use the supplied conversation history to understand follow-up questions. Never invent prices, availability, policies or dates. When information is missing, collect the customer's name, email, activity of interest, preferred date and number of guests, then say a team member will confirm. Do not expose internal information.";

  const conversationMessages = history.length
    ? history
    : [{ role: "user", content: userText }];

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...conversationMessages],
      max_completion_tokens: 350,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Hermes API failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  return (
    data.choices?.[0]?.message?.content?.trim() ||
    "Thanks for contacting Gravity Arena. A team member will assist you shortly."
  );
}

async function sendWhatsAppText(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required.");
  }

  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text.slice(0, 4096) },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${detail.slice(0, 500)}`);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ ok: false, error: "Webhook verification failed." });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  try {
    const payload = parseBody(req);
    const messages = getIncomingMessages(payload);

    console.log("WhatsApp webhook received", {
      object: payload.object,
      messageCount: messages.length,
      fields: (payload.entry || []).flatMap((entry) =>
        (entry.changes || []).map((change) => change.field)
      ),
      memoryEnabled: Boolean(getMemoryConfig()),
      brevoEnabled: Boolean(getBrevoConfig()),
    });

    let processed = 0;

    for (const message of messages) {
  let history = [];
  let handoverStatus = "AI_ACTIVE";

      try {
        const stored = await saveMemoryMessage({
          waId: message.from,
          displayName: message.displayName,
          metaMessageId: message.messageId,
          direction: "INBOUND",
          role: "user",
          body: message.text,
        });

        if (stored?.duplicate) {
          console.log("Duplicate WhatsApp message ignored", {
            messageId: message.messageId,
          });
          continue;
        }

        history = (await getMemoryHistory(message.from)) || [];
        const statusResult = await getHandoverStatus(message.from);

handoverStatus =
  statusResult?.handover_status || "AI_ACTIVE";
      } catch (memoryError) {
        console.error("Conversation memory read/write warning", {
          message: memoryError instanceof Error ? memoryError.message : String(memoryError),
        });
      }

      const email = extractEmail(message.text);

if (email) {
  try {
    const brevoResult = await captureBrevoLead({
      email,
      waId: message.from,
      displayName: message.displayName,
    });

    console.log("Brevo lead captured", {
      emailDomain: email.split("@")[1],
      senderSuffix: message.from.slice(-4),
      listId: getBrevoConfig()?.listId || null,
      success: Boolean(brevoResult),
    });
  } catch (brevoError) {
    console.error("Brevo lead capture warning", {
      message:
        brevoError instanceof Error
          ? brevoError.message
          : String(brevoError),
    });
  }
}

      let reply = null;
      let handover = handoverStatus === "HUMAN_ACTIVE";
      let aiPaused = handover;

      if (requiresHumanHandover(message.text)) {
        handover = true;
        aiPaused = true;
        reply =
          process.env.HUMAN_HANDOVER_REPLY?.trim() ||
          "I have alerted the Gravity Arena team. A team member will contact you as soon as possible. Please share your name, email address and preferred contact time if you have not already done so.";
try {
  await activateHandover(
    message.from,
    "MARKETING",
    "HUMAN_REQUEST"
  );
} catch (memoryError) {
  console.error("Human handover activation warning", {
    message:
      memoryError instanceof Error
        ? memoryError.message
        : String(memoryError),
  });
}
        try {
          await sendEscalationEmail({
            waId: message.from,
            displayName: message.displayName,
            messageText: message.text,
            history,
          });
        } catch (brevoError) {
          console.error("Human escalation notification warning", {
            message: brevoError instanceof Error ? brevoError.message : String(brevoError),
          });
        }
      } else if (handoverStatus === "HUMAN_ACTIVE") {
  aiPaused = true;
  handover = true;

  reply =
    process.env.HUMAN_HANDOVER_WAITING_REPLY?.trim() ||
    "Your conversation is still with the Gravity Arena team. A team member has been notified and will respond as soon as possible. You can continue sending any additional details here.";

  console.log("Hermes paused for active human handover", {
    senderSuffix: message.from.slice(-4),
    statusReplySent: true,
  });
} else {
  reply = await askHermes(message.text, history);
}
if (reply) {
  await sendWhatsAppText(message.from, reply);

  try {
    await saveMemoryMessage({
      waId: message.from,
      displayName: message.displayName,
      direction: "OUTBOUND",
      role: "assistant",
      body: reply,
    });
  } catch (memoryError) {
    console.error("Conversation memory reply-write warning", {
      message:
        memoryError instanceof Error
          ? memoryError.message
          : String(memoryError),
    });
  }
}

      processed += 1;

      console.log("WhatsApp enquiry processed", {
        handoverStatus,
        aiPaused,
        replySent: Boolean(reply),
        messageId: message.messageId,
        senderSuffix: message.from?.slice(-4),
        historyMessages: history.length,
        leadCaptured: Boolean(email),
        handover,
      });
    }

    return res.status(200).json({ ok: true, processed });
  } catch (error) {
    console.error("WhatsApp gateway error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(200).json({ ok: false, processed: 0 });
  }
}
