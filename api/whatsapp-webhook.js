const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

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
      for (const message of value.messages || []) {
        if (message.type === "text" && message.text?.body) {
          messages.push({
            from: message.from,
            messageId: message.id,
            text: message.text.body.trim(),
          });
        }
      }
    }
  }
  return messages;
}

async function askHermes(userText) {
  const apiUrl = process.env.HERMES_API_URL?.trim();
  const apiKey = process.env.HERMES_API_KEY?.trim();
  const model = process.env.HERMES_MODEL?.trim();

  if (!apiUrl || !model) {
    return "Thanks for contacting Gravity Arena. Your message has been received and a team member will assist you shortly.";
  }

  const systemPrompt = process.env.HERMES_SYSTEM_PROMPT ||
    "You are Gravity Arena's customer assistant. Be concise, professional and friendly. Never invent prices, availability, policies or dates. When information is missing, collect the customer's name, email, activity of interest, preferred date and number of guests, then say a team member will confirm. Do not expose internal information.";

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
        { role: "user", content: userText },
      ],
      temperature: 0.3,
      max_tokens: 350,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Hermes API failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ||
    "Thanks for contacting Gravity Arena. A team member will assist you shortly.";
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
    throw new Error(`WhatsApp send failed (${response.status}): ${detail.slice(0, 300)}`);
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

    // Meta expects a fast 200 response. This implementation handles the small
    // Phase 1 workload inline; move processing to a queue before higher volume.
    for (const message of messages) {
      const reply = await askHermes(message.text);
      await sendWhatsAppText(message.from, reply);
      console.log("WhatsApp enquiry processed", {
        messageId: message.messageId,
        senderSuffix: message.from?.slice(-4),
      });
    }

    return res.status(200).json({ ok: true, processed: messages.length });
  } catch (error) {
    console.error("WhatsApp gateway error", {
      message: error instanceof Error ? error.message : String(error),
    });

    // Return 200 so Meta does not repeatedly redeliver a message while the
    // integration is being configured. Production queueing will add retries.
    return res.status(200).json({ ok: false, processed: 0 });
  }
}
