const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const MEMORY_HISTORY_LIMIT = 12;

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
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationMessages,
      ],
      max_completion_tokens: 350,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Hermes API failed (${response.status}): ${detail.slice(0, 500)}`
    );
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
    throw new Error(
      "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required."
    );
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
    throw new Error(
      `WhatsApp send failed (${response.status}): ${detail.slice(0, 500)}`
    );
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

    return res
      .status(403)
      .json({ ok: false, error: "Webhook verification failed." });
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
    });

    let processed = 0;

    for (const message of messages) {
      let history = [];

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
      } catch (memoryError) {
        console.error("Conversation memory read/write warning", {
          message:
            memoryError instanceof Error
              ? memoryError.message
              : String(memoryError),
        });
      }

      const reply = await askHermes(message.text, history);
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

      processed += 1;

      console.log("WhatsApp enquiry processed", {
        messageId: message.messageId,
        senderSuffix: message.from?.slice(-4),
        historyMessages: history.length,
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
