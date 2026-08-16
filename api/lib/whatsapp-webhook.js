import { handleConversationalBooking } from "./lib/booking-conversation.js";
import { handleBookingReschedule } from "./lib/booking-reschedule.js";
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
const MEMORY_HISTORY_LIMIT = 12;

const DEFAULT_HANDOVER_KEYWORDS = [
  "human", "agent", "person", "someone", "call me", "phone me",
  "complaint", "manager", "refund", "quotation", "quote", "urgent",
  "escalate", "speak to",
];

const ACTIVITY_ALIASES = [
  { code: "FPV_RACING", terms: ["fpv", "fpv racing", "drone racing"] },
  { code: "VR_RACING", terms: ["vr racing", "virtual reality racing"] },
  { code: "VR_ESCAPE", terms: ["vr escape", "escape room"] },
  { code: "DRONE_TRAINING", terms: ["drone training", "drone lesson", "learn drone"] },
  { code: "DRONE_PHOTOGRAPHY", terms: ["drone photography", "photography"] },
  { code: "DRONE_REPAIR", terms: ["drone repair", "repair workshop"] },
  { code: "SIMULATOR", terms: ["simulator", "flight simulator"] },
  { code: "CORPORATE_EVENT", terms: ["corporate", "team building"] },
  { code: "BIRTHDAY_PARTY", terms: ["birthday", "birthday party"] },
  { code: "STEM_PROGRAM", terms: ["stem", "school workshop", "stem workshop"] },
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

  console.log("Memory API request", {
    path,
    method: options.method || "GET",
  });

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
    `Memory API failed (${response.status}) on ${path}: ${JSON.stringify(data).slice(0, 500)}`
  );
}
  return data;
}

async function saveMemoryMessage({ waId, displayName = "", metaMessageId = "", direction, role, body }) {
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
        .filter((message) => ["user", "assistant"].includes(message.role) && typeof message.body === "string" && message.body.trim())
        .map((message) => ({ role: message.role, content: message.body.trim() }))
    : [];
}

async function getHandoverStatus(waId) {
  return memoryRequest(`/?action=handover-status&wa_id=${encodeURIComponent(waId)}`, { method: "GET" });
}

async function activateHandover(waId, team = "MARKETING", reason = "HUMAN_REQUEST") {
  return memoryRequest("/?action=handover-activate", {
    method: "POST",
    body: JSON.stringify({ wa_id: waId, team, reason }),
  });
}

function getBrevoConfig() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return null;
  const listId = Number(process.env.BREVO_LEAD_LIST_ID || 0);
  return { apiKey, listId: Number.isInteger(listId) && listId > 0 ? listId : null };
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
    throw new Error(`Brevo API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

function extractEmail(text) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || null;
}

function splitDisplayName(displayName) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

async function captureBrevoLead({ email, displayName }) {
  const config = getBrevoConfig();
  if (!email || !config) return null;
  const { firstName, lastName } = splitDisplayName(displayName || "");
  const attributes = { FIRSTNAME: firstName, LASTNAME: lastName };
  let result;
  try {
    result = await brevoRequest("/contacts", {
      method: "POST",
      body: JSON.stringify({ email, attributes, updateEnabled: true }),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!text.includes("400") && !text.includes("already") && !text.includes("duplicate")) throw error;
    result = await brevoRequest(`/contacts/${encodeURIComponent(email)}?identifierType=email_id`, {
      method: "PUT",
      body: JSON.stringify({ attributes, ...(config.listId ? { listIds: [config.listId] } : {}) }),
    });
  }
  if (config.listId) {
    try {
      await brevoRequest(`/contacts/lists/${config.listId}/contacts/add`, {
        method: "POST",
        body: JSON.stringify({ emails: [email] }),
      });
    } catch (error) {
      const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (!text.includes("already in list") && !text.includes("contact already in list")) throw error;
    }
  }
  return result;
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

async function sendEscalationEmail({ waId, displayName, messageText, history }) {
  const recipient = process.env.HUMAN_ESCALATION_EMAIL?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena Hermes";
  const brevoConfigured = Boolean(getBrevoConfig());

  console.log("Human escalation email evaluation", {
    recipientConfigured: Boolean(recipient),
    senderConfigured: Boolean(senderEmail),
    brevoConfigured,
    senderSuffix: waId?.slice(-4) || "",
  });

  if (!recipient || !senderEmail || !brevoConfigured) {
    console.warn("Human escalation email skipped", {
      recipientConfigured: Boolean(recipient),
      senderConfigured: Boolean(senderEmail),
      brevoConfigured,
      senderSuffix: waId?.slice(-4) || "",
    });
    return null;
  }

  const transcript = history.slice(-8).map((item) => `${item.role.toUpperCase()}: ${item.content}`).join("\n");

  console.log("Human escalation email sending", {
    senderSuffix: waId?.slice(-4) || "",
  });

  const result = await brevoRequest("/smtp/email", {
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
        "Recent conversation:", transcript || "No prior messages available.",
      ].join("\n"),
      tags: ["gravity-arena", "whatsapp-handover"],
    }),
  });

  console.log("Human escalation email sent", {
    accepted: Boolean(result),
    senderSuffix: waId?.slice(-4) || "",
  });

  return result;
}

function getBookingConfig() {
  const baseUrl = process.env.BOOKING_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.BOOKING_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

async function bookingRequest(path, options = {}) {
  const config = getBookingConfig();
  if (!config) throw new Error("Booking API configuration is incomplete.");
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Booking API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}


// --- GA OS Phase 3C.1: Booking lookup + cancellation ---

function detectBookingReference(text) {
  return text.match(/\bGA-\d{8}-\d{6}\b/i)?.[0]?.toUpperCase() || null;
}

function isBookingLookupIntent(text) {
  return /\b(my booking|show (?:me )?my booking|booking details|what time is my booking|when is my booking|booking status)\b/i.test(text);
}

function isBookingCancellationIntent(text) {
  return /\b(cancel|cancelled|cancellation)\b/i.test(text) &&
    /\b(booking|reservation|reference)\b/i.test(text);
}

async function bookingManagementRequest(path, options = {}) {
  const config = getBookingConfig();
  if (!config) throw new Error("Booking API configuration is incomplete.");

  const response = await fetch(`${config.baseUrl}/booking-management.php${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      `Booking management failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

function formatBookingDetails(booking) {
  return [
    "Here are your Gravity Arena booking details:",
    `Reference: ${booking.booking_reference}`,
    `Status: ${booking.status}`,
    `Activity: ${booking.activity_name}`,
    `Date and time: ${booking.starts_at}`,
    `Guests: ${booking.guest_count}`,
  ].join("\n");
}

async function handleBookingManagementMessage(message) {
  if (!getBookingConfig()) return null;

  const bookingReference = detectBookingReference(message.text);

  if (isBookingCancellationIntent(message.text)) {
    let reference = bookingReference;

    if (!reference) {
      try {
        const lookup = await bookingManagementRequest(
          `?action=booking-lookup&wa_id=${encodeURIComponent(message.from)}`,
          { method: "GET" }
        );
        reference = lookup?.booking?.booking_reference || null;
      } catch (error) {
        if (error?.status === 404) {
          return "I could not find a booking linked to this WhatsApp number.";
        }
        throw error;
      }
    }

    if (!reference) {
      return "Please send the booking reference you would like to cancel.";
    }

    try {
      const result = await bookingManagementRequest("?action=booking-cancel", {
        method: "POST",
        body: JSON.stringify({
          booking_reference: reference,
          wa_id: message.from,
          actor: "HERMES",
          reason: "Customer requested cancellation through WhatsApp",
        }),
      });

      if (result.already_cancelled) {
        return `Booking ${reference} is already cancelled.`;
      }

      return [
        "✅ Your Gravity Arena booking has been cancelled.",
        `Reference: ${result.booking?.booking_reference || reference}`,
        `Activity: ${result.booking?.activity_name || "Gravity Arena activity"}`,
        `Original date and time: ${result.booking?.starts_at || "Not available"}`,
        "",
        "The released space is now available for another booking.",
      ].join("\n");
    } catch (error) {
      if (error?.status === 404) {
        return "I could not find that booking for this WhatsApp number.";
      }
      if (error?.status === 409) {
        return "That booking can no longer be cancelled automatically. I can connect you with the Gravity Arena team for assistance.";
      }
      throw error;
    }
  }

  if (isBookingLookupIntent(message.text) || bookingReference) {
    const params = bookingReference
      ? `?action=booking-lookup&booking_reference=${encodeURIComponent(bookingReference)}&wa_id=${encodeURIComponent(message.from)}`
      : `?action=booking-lookup&wa_id=${encodeURIComponent(message.from)}`;

    try {
      const result = await bookingManagementRequest(params, { method: "GET" });
      return formatBookingDetails(result.booking);
    } catch (error) {
      if (error?.status === 404) {
        return "I could not find a booking linked to this WhatsApp number.";
      }
      throw error;
    }
  }

  return null;
}

// --- End GA OS Phase 3C.1 ---

function detectActivityCode(text) {
  const normalized = text.toLowerCase();
  return ACTIVITY_ALIASES.find((activity) => activity.terms.some((term) => normalized.includes(term)))?.code || null;
}

function johannesburgDate(offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now.getTime() + offsetDays * 86400000));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function detectBookingDate(text) {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const normalized = text.toLowerCase();
  if (normalized.includes("tomorrow")) return johannesburgDate(1);
  if (normalized.includes("today")) return johannesburgDate(0);
  return null;
}

function detectGuestCount(text) {
  const patterns = [/(\d{1,2})\s*(?:people|guests|persons|players)/i, /\bfor\s+(\d{1,2})\b/i];
  for (const pattern of patterns) {
    const value = Number(text.match(pattern)?.[1] || 0);
    if (value > 0 && value <= 100) return value;
  }
  return null;
}

function detectSlotId(text) {
  const value = Number(text.match(/\bslot\s*#?\s*(\d+)\b/i)?.[1] || 0);
  return value > 0 ? value : null;
}

function isBookingIntent(text) {
  return /\b(book|booking|available|availability|reserve|slot)\b/i.test(text);
}

function isExplicitBookingConfirmation(text) {
  return /\b(confirm|confirmed|yes book|book it|reserve it|go ahead)\b/i.test(text);
}

function formatSlots(slots) {
  if (!slots.length) return "I could not find an available slot matching that request.";
  return [
    "These slots are currently available:",
    ...slots.slice(0, 8).map((slot) => `• Slot ${slot.slot_id}: ${slot.starts_at} — ${slot.remaining_capacity} spaces remaining`),
    "",
    "To book, reply with: Confirm slot <number> for <guest count> people and include your email address.",
  ].join("\n");
}

async function sendBookingConfirmationEmail(booking) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena";
  if (!booking?.customer_email || !senderEmail || !getBrevoConfig()) return null;
  return brevoRequest("/smtp/email", {
    method: "POST",
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: booking.customer_email, name: booking.customer_name || "Gravity Arena Customer" }],
      subject: `Gravity Arena booking confirmed: ${booking.booking_reference}`,
      textContent: [
        `Hi ${booking.customer_name || "there"},`, "",
        "Your Gravity Arena booking is confirmed.",
        `Reference: ${booking.booking_reference}`,
        `Activity: ${booking.activity_name}`,
        `Date and time: ${booking.starts_at}`,
        `Guests: ${booking.guest_count}`,
        "", "Reply to our WhatsApp conversation if you need assistance.",
      ].join("\n"),
      tags: ["gravity-arena", "booking-confirmation"],
    }),
  });
}

async function handleBookingMessage(message) {
  if (!getBookingConfig() || !isBookingIntent(message.text)) return null;

  const activityCode = detectActivityCode(message.text);
  const date = detectBookingDate(message.text);
  const guestCount = detectGuestCount(message.text);
  const slotId = detectSlotId(message.text);
  const email = extractEmail(message.text);

  if (isExplicitBookingConfirmation(message.text) && slotId) {
    if (!guestCount) return "Before I reserve that slot, please tell me how many guests will attend.";
    if (!email) return "Before I reserve that slot, please send the email address for the booking confirmation.";

    const held = await bookingRequest("/?action=booking-create", {
      method: "POST",
      body: JSON.stringify({
        wa_id: message.from,
        slot_id: slotId,
        guest_count: guestCount,
        customer_name: message.displayName || "",
        customer_email: email,
        notes: "Created through Gravity Arena Hermes WhatsApp booking skill",
      }),
    });

    const confirmed = await bookingRequest("/?action=booking-confirm", {
      method: "POST",
      body: JSON.stringify({ booking_reference: held.booking_reference }),
    });

    const booking = confirmed.booking || {};
    try {
      await sendBookingConfirmationEmail(booking);
    } catch (error) {
      console.error("Booking confirmation email warning", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return [
      "✅ Your Gravity Arena booking is confirmed.",
      `Reference: ${booking.booking_reference || held.booking_reference}`,
      `Activity: ${booking.activity_name || held.activity_name}`,
      `Date and time: ${booking.starts_at || held.starts_at}`,
      `Guests: ${booking.guest_count || held.guest_count}`,
      "",
      "I’ve also sent the booking confirmation to your email address.",
    ].join("\n");
  }

  if (!activityCode) return "Which Gravity Arena activity would you like to book?";
  if (!date) return "What date would you prefer? You can say today, tomorrow, or use YYYY-MM-DD.";
  if (!guestCount) return "How many guests should I check availability for?";

  const params = new URLSearchParams({
    action: "availability",
    activity_code: activityCode,
    date,
    guest_count: String(guestCount),
  });
  const availability = await bookingRequest(`/?${params.toString()}`, { method: "GET" });
  return formatSlots(Array.isArray(availability?.slots) ? availability.slots : []);
}

async function askHermes(userText, history = []) {
  const apiUrl = process.env.HERMES_API_URL?.trim();
  const apiKey = process.env.HERMES_API_KEY?.trim();
  const model = process.env.HERMES_MODEL?.trim();
  if (!apiUrl || !model) {
    return "Thanks for contacting Gravity Arena. Your message has been received and a team member will assist you shortly.";
  }
  const systemPrompt = process.env.HERMES_SYSTEM_PROMPT ||
    "You are Gravity Arena's customer assistant. Be concise, professional and friendly. Use conversation history. Never invent prices, availability, policies or dates. Booking availability and confirmed bookings are handled by the Gravity Arena booking engine. Do not claim a booking is confirmed unless the booking engine supplied a booking reference. Do not expose internal information.";
  const conversationMessages = history.length ? history : [{ role: "user", content: userText }];
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
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
  return data.choices?.[0]?.message?.content?.trim() || "Thanks for contacting Gravity Arena. A team member will assist you shortly.";
}

async function sendWhatsAppText(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required.");
  const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "text",
      text: { preview_url: false, body: text.slice(0, 4096) },
    }),
  });
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
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).json({ ok: false, error: "Webhook verification failed." });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed." });

  try {
    const payload = parseBody(req);
    const messages = getIncomingMessages(payload);
    console.log("WhatsApp webhook received", {
      object: payload.object,
      messageCount: messages.length,
      fields: (payload.entry || []).flatMap((entry) => (entry.changes || []).map((change) => change.field)),
      memoryEnabled: Boolean(getMemoryConfig()),
      brevoEnabled: Boolean(getBrevoConfig()),
      bookingEnabled: Boolean(getBookingConfig()),
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
          console.log("Duplicate WhatsApp message ignored", { messageId: message.messageId });
          continue;
        }
        history = (await getMemoryHistory(message.from)) || [];
        const statusResult = await getHandoverStatus(message.from);
        handoverStatus = statusResult?.handover_status || "AI_ACTIVE";
      } catch (memoryError) {
        console.error("Conversation memory read/write warning", {
          message: memoryError instanceof Error ? memoryError.message : String(memoryError),
        });
      }

      const email = extractEmail(message.text);
      if (email) {
        try {
          await captureBrevoLead({ email, displayName: message.displayName });
          console.log("Brevo lead captured", {
            emailDomain: email.split("@")[1], senderSuffix: message.from.slice(-4),
            listId: getBrevoConfig()?.listId || null,
          });
        } catch (brevoError) {
          console.error("Brevo lead capture warning", {
            message: brevoError instanceof Error ? brevoError.message : String(brevoError),
          });
        }
      }

      let reply = null;
      let handover = handoverStatus === "HUMAN_ACTIVE";
      let aiPaused = handover;
      let bookingHandled = false;

      if (requiresHumanHandover(message.text)) {
        handover = true;
        aiPaused = true;
        reply = process.env.HUMAN_HANDOVER_REPLY?.trim() ||
          "I have alerted the Gravity Arena team. A team member will contact you as soon as possible. Please share your name, email address and preferred contact time if you have not already done so.";
        try { await activateHandover(message.from); } catch (error) {
          console.error("Human handover activation warning", { message: error instanceof Error ? error.message : String(error) });
        }
        try {
          await sendEscalationEmail({ waId: message.from, displayName: message.displayName, messageText: message.text, history });
        } catch (error) {
          console.error("Human escalation notification warning", { message: error instanceof Error ? error.message : String(error) });
        }
      } else if (handoverStatus === "HUMAN_ACTIVE") {
        aiPaused = true;
        handover = true;
        reply = process.env.HUMAN_HANDOVER_WAITING_REPLY?.trim() ||
          "Your conversation is still with the Gravity Arena team. A team member has been notified and will respond as soon as possible. You can continue sending any additional details here.";
        console.log("Hermes paused for active human handover", { senderSuffix: message.from.slice(-4), statusReplySent: true });
      } else {
        try {
          const bookingRescheduleReply =
  await handleBookingReschedule(message, history);

const bookingManagementReply = bookingRescheduleReply
  ? null
  : await handleBookingManagementMessage(message);

const conversationalBookingReply =
  bookingRescheduleReply || bookingManagementReply
    ? null
    : await handleConversationalBooking(message, history);

reply =
  bookingRescheduleReply ||
  bookingManagementReply ||
  conversationalBookingReply ||
  await handleBookingMessage(message);

bookingHandled = Boolean(
  bookingRescheduleReply ||
  bookingManagementReply ||
  conversationalBookingReply ||
  reply
);

        } catch (bookingError) {
          console.error("Booking skill warning", {
            message: bookingError instanceof Error ? bookingError.message : String(bookingError),
          });
          reply = "I’m having trouble checking the booking system right now. I can still help with general questions, or I can connect you with the Gravity Arena team.";
          bookingHandled = true;
        }
        if (!reply) reply = await askHermes(message.text, history);
      }

      if (reply) {
        await sendWhatsAppText(message.from, reply);
        try {
          await saveMemoryMessage({
            waId: message.from, displayName: message.displayName,
            direction: "OUTBOUND", role: "assistant", body: reply,
          });
        } catch (memoryError) {
          console.error("Conversation memory reply-write warning", {
            message: memoryError instanceof Error ? memoryError.message : String(memoryError),
          });
        }
      }

      processed += 1;
      console.log("WhatsApp enquiry processed", {
        handoverStatus, aiPaused, replySent: Boolean(reply), bookingHandled,
        messageId: message.messageId, senderSuffix: message.from?.slice(-4),
        historyMessages: history.length, leadCaptured: Boolean(email), handover,
      });
    }

    return res.status(200).json({ ok: true, processed });
  } catch (error) {
    console.error("WhatsApp gateway error", { message: error instanceof Error ? error.message : String(error) });
    return res.status(200).json({ ok: false, processed: 0 });
  }
}
