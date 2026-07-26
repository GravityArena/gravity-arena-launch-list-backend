/**
 * Gravity Arena launch-list API
 * Upload this file to: api/launch-list.js
 */

const BREVO_CONTACTS_URL = "https://api.brevo.com/v3/contacts";

function getAllowedOrigins() {
  return (
    process.env.ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGIN ||
    "https://gravityarena.co.za,https://www.gravityarena.co.za"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function clean(value, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return {};
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasConsent(value) {
  return [true, "true", "yes", "on", "1", 1].includes(value);
}

function getListId() {
  const rawListId =
    process.env.BREVO_MASTER_LIST_ID || process.env.BREVO_LIST_ID || "";

  const listId = Number(rawListId);

  if (!Number.isInteger(listId) || listId <= 0) {
    throw new Error(
      "BREVO_MASTER_LIST_ID or BREVO_LIST_ID must be a positive integer."
    );
  }

  return listId;
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Gravity Arena launch-list API",
      version: "2.1.0",
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed.",
    });
  }

  try {
    const body = parseBody(req);

    const honeypot = clean(
      body.website || body.companyWebsite || body.address2 || body.company
    );

    if (honeypot) {
      return res.status(200).json({ ok: true });
    }

    const firstName = clean(
      body.firstName || body.firstname || body.first_name,
      80
    );

    const lastName = clean(
      body.lastName || body.lastname || body.last_name,
      80
    );

    const email = clean(body.email, 254).toLowerCase();
    const interest =
      clean(body.interest || body.segment, 100) || "General Updates";
    const consentGiven = hasConsent(body.consent);

    if (!email || !isValidEmail(email)) {
      console.warn("Launch-list validation failed: invalid email.");
      return res.status(400).json({
        ok: false,
        error: "Please enter a valid email address.",
      });
    }

    if (!consentGiven) {
      console.warn("Launch-list validation failed: consent not provided.");
      return res.status(400).json({
        ok: false,
        error: "Marketing consent is required.",
      });
    }

    const apiKey = process.env.BREVO_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("BREVO_API_KEY is not configured.");
    }

    const listId = getListId();
    const signupDate = new Date().toISOString().slice(0, 10);

    const payload = {
      email,
      updateEnabled: true,
      listIds: [listId],
      attributes: {
        FIRSTNAME: firstName,
        LASTNAME: lastName,
        INTEREST: interest,
        SOURCE: "Website",
        STATUS: "Prospect",
        SIGNUPDATE: signupDate,
        CONSENT: "Yes",
        SEGMENT: interest,
      },
    };

    const brevoResponse = await fetch(BREVO_CONTACTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await brevoResponse.text();

    if (!brevoResponse.ok) {
      console.error("Brevo API request failed.", {
        status: brevoResponse.status,
        response: responseText,
      });

      return res.status(502).json({
        ok: false,
        error: "We could not complete your signup. Please try again shortly.",
      });
    }

    console.log("Gravity Arena launch-list signup completed.", {
      emailDomain: email.split("@")[1] || "unknown",
      interest,
      listId,
    });

    return res.status(200).json({
      ok: true,
      message: "You have joined the Gravity Arena launch list.",
    });
  } catch (error) {
    console.error("Gravity Arena launch-list error.", {
      message: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      ok: false,
      error: "Unexpected server error. Please try again shortly.",
    });
  }
}
