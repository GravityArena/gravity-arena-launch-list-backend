function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return {};
}

function isAuthorized(req) {
  const expected = process.env.BOOKING_CONTROL_KEY?.trim();
  const supplied = String(req.headers["x-api-key"] || "").trim();
  return Boolean(expected && supplied && supplied === expected);
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
    throw new Error(
      `Booking API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  return data;
}

async function sendBrevoBookingConfirmation(booking) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena";
  const email = booking?.customer_email?.trim();

  if (!apiKey || !senderEmail || !email) return { skipped: true };

  const startsAt = String(booking.starts_at || "");
  const body = [
    `Hi ${booking.customer_name || "there"},`,
    "",
    "Your Gravity Arena booking is confirmed.",
    `Booking reference: ${booking.booking_reference}`,
    `Activity: ${booking.activity_name}`,
    `Date and time: ${startsAt}`,
    `Guests: ${booking.guest_count}`,
    "",
    "Please keep your booking reference for any changes or support requests.",
    "",
    "Gravity Arena",
  ].join("\n");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email, name: booking.customer_name || "Gravity Arena Customer" }],
      subject: `Gravity Arena booking confirmed: ${booking.booking_reference}`,
      textContent: body,
      tags: ["gravity-arena", "booking-confirmation"],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brevo confirmation failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  return { sent: true };
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
    const operation = String(body.operation || "").trim().toLowerCase();

    if (!["availability", "create", "confirm", "status", "cancel"].includes(operation)) {
      return res.status(422).json({
        ok: false,
        error: "operation must be availability, create, confirm, status or cancel.",
      });
    }

    let result;

    if (operation === "availability") {
      const params = new URLSearchParams();
      params.set("action", "availability");
      params.set("activity_code", String(body.activity_code || ""));
      if (body.date) params.set("date", String(body.date));
      if (body.guest_count) params.set("guest_count", String(body.guest_count));
      result = await bookingRequest(`/?${params.toString()}`, { method: "GET" });
    }

    if (operation === "create") {
      result = await bookingRequest("/?action=booking-create", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    if (operation === "confirm") {
      result = await bookingRequest("/?action=booking-confirm", {
        method: "POST",
        body: JSON.stringify(body),
      });

      let emailResult = { skipped: true };
      try {
        emailResult = await sendBrevoBookingConfirmation(result?.booking);
      } catch (emailError) {
        console.error("Booking confirmation email warning", {
          message: emailError instanceof Error ? emailError.message : String(emailError),
        });
        emailResult = { sent: false };
      }
      result = { ...result, confirmation_email: emailResult };
    }

    if (operation === "status") {
      const params = new URLSearchParams({
        action: "booking-status",
        booking_reference: String(body.booking_reference || ""),
      });
      result = await bookingRequest(`/?${params.toString()}`, { method: "GET" });
    }

    if (operation === "cancel") {
      result = await bookingRequest("/?action=booking-cancel", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Booking control error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({ ok: false, error: "Booking operation failed." });
  }
}
