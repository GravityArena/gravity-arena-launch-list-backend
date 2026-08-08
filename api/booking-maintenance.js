function isAuthorized(req) {
  const expected =
    process.env.BOOKING_MAINTENANCE_CRON_KEY?.trim() ||
    process.env.CRON_SECRET?.trim();

  const auth = String(req.headers.authorization || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  return Boolean(expected && bearer === expected);
}

function getBookingConfig() {
  const baseUrl = process.env.BOOKING_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.BOOKING_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    throw new Error("Booking API configuration is incomplete.");
  }

  return { baseUrl, apiKey };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed.",
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized.",
    });
  }

  try {
    const { baseUrl, apiKey } = getBookingConfig();

    const response = await fetch(`${baseUrl}/booking-maintenance.php`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    const bodyText = await response.text();
    let data = {};

    try {
      data = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      throw new Error(
        `Booking maintenance returned invalid JSON (${response.status}): ${bodyText.slice(0, 500)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Booking maintenance failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
      );
    }

    console.info("Booking maintenance completed", {
      expired: Number(data.expired || 0),
      generated: Number(data.generated || 0),
      windowDays: Number(data.window_days || 0),
      timezone: data.timezone || null,
    });

    return res.status(200).json({
      ok: true,
      expired: Number(data.expired || 0),
      generated: Number(data.generated || 0),
      window_days: Number(data.window_days || 0),
      timezone: data.timezone || null,
    });
  } catch (error) {
    console.error("Booking maintenance worker error", {
      message: error instanceof Error ? error.message : String(error),
    });

    return res.status(502).json({
      ok: false,
      error: "Booking maintenance worker failed.",
    });
  }
}
