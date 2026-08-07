const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";

function isAuthorized(req) {
  const expected =
    process.env.BOOKING_REMINDER_CRON_KEY?.trim() ||
    process.env.CRON_SECRET?.trim();
  const suppliedHeader = String(req.headers["x-api-key"] || "").trim();
  const auth = String(req.headers.authorization || "").trim();
  const suppliedBearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return Boolean(expected && (suppliedHeader === expected || suppliedBearer === expected));
}

function getBookingConfig() {
  const baseUrl = process.env.BOOKING_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.BOOKING_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new Error("Booking API configuration is incomplete.");
  return { baseUrl, apiKey };
}

async function bookingRequest(path, options = {}) {
  const { baseUrl, apiKey } = getBookingConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

async function sendWhatsAppText(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) throw new Error("WhatsApp configuration is incomplete.");

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
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`WhatsApp reminder failed (${response.status}): ${detail.slice(0, 500)}`);
  }
}

function buildReminderText(reminder) {
  return [
    `Reminder from Gravity Arena`,
    `Booking: ${reminder.booking_reference}`,
    `Activity: ${reminder.activity_name}`,
    `Starts: ${reminder.starts_at}`,
    `Guests: ${reminder.guest_count}`,
    "",
    "We look forward to seeing you. Reply here if you need assistance with your booking.",
  ].join("\n");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  try {
    const due = await bookingRequest("/?action=reminders-due&limit=25", { method: "GET" });
    const reminders = Array.isArray(due?.reminders) ? due.reminders : [];
    let sent = 0;
    let failed = 0;

    for (const reminder of reminders) {
      try {
        await sendWhatsAppText(reminder.wa_id, buildReminderText(reminder));
        await bookingRequest("/?action=reminder-sent", {
          method: "POST",
          body: JSON.stringify({ reminder_id: reminder.reminder_id }),
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        try {
          await bookingRequest("/?action=reminder-failed", {
            method: "POST",
            body: JSON.stringify({
              reminder_id: reminder.reminder_id,
              failure_reason: error instanceof Error ? error.message : String(error),
            }),
          });
        } catch (markError) {
          console.error("Reminder failure state update warning", {
            reminderId: reminder.reminder_id,
            message: markError instanceof Error ? markError.message : String(markError),
          });
        }
      }
    }

    return res.status(200).json({ ok: true, due: reminders.length, sent, failed });
  } catch (error) {
    console.error("Booking reminder worker error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({ ok: false, error: "Reminder worker failed." });
  }
}
