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

    if (!["availability", "create", "status", "cancel"].includes(operation)) {
      return res.status(422).json({
        ok: false,
        error: "operation must be availability, create, status or cancel.",
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
