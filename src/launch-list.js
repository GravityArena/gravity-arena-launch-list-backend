import { createHash, randomUUID } from "node:crypto";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://gravityarena.co.za",
  "https://www.gravityarena.co.za"
];
const MAX_BODY_BYTES = 10_000;
const BREVO_API_BASE = "https://api.brevo.com/v3";

function setHeader(response, name, value) {
  if (typeof response.setHeader === "function") {
    response.setHeader(name, value);
  }
}

function send(response, status, body) {
  if (typeof response.status === "function") {
    return response.status(status).json(body);
  }

  response.statusCode = status;
  setHeader(response, "Content-Type", "application/json; charset=utf-8");
  return response.end(JSON.stringify(body));
}

function parseAllowedOrigins(value) {
  const configured = String(value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.headers?.origin;
  if (origin && allowedOrigins.includes(origin)) {
    setHeader(response, "Access-Control-Allow-Origin", origin);
    setHeader(response, "Vary", "Origin");
  }
  setHeader(response, "Access-Control-Allow-Methods", "POST, OPTIONS");
  setHeader(response, "Access-Control-Allow-Headers", "Content-Type");
  setHeader(response, "Access-Control-Max-Age", "86400");
  return !origin || allowedOrigins.includes(origin);
}

function parseBody(request) {
  const contentLength = Number(request.headers?.["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    const error = new Error("Request body is too large.");
    error.status = 413;
    throw error;
  }

  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string" && request.body.length <= MAX_BODY_BYTES) {
    try {
      return JSON.parse(request.body);
    } catch {
      const error = new Error("Request body must be valid JSON.");
      error.status = 400;
      throw error;
    }
  }

  const error = new Error("Request body must be a JSON object.");
  error.status = 400;
  throw error;
}

function cleanText(value, maxLength) {
  if (value === undefined || value === null) return "";
  return String(value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeSubmission(body) {
  const email = cleanText(body.email, 254).toLowerCase();
  const firstName = cleanText(body.firstName ?? body.first_name, 70);
  const lastName = cleanText(body.lastName ?? body.last_name, 70);
  const honeypot = cleanText(
    body.website ?? body.website_url ?? body.company_website,
    200
  );

  if (honeypot) {
    return { isBot: true };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    const error = new Error("Please enter a valid email address.");
    error.status = 400;
    throw error;
  }

  if (body.consent === false || body.consent === "false") {
    const error = new Error("Consent is required to join the launch list.");
    error.status = 400;
    throw error;
  }

  return { email, firstName, lastName, isBot: false };
}

function requireConfiguration(environment) {
  const apiKey = cleanText(environment.BREVO_API_KEY, 500);
  const rawListId =
    environment.BREVO_MASTER_LIST_ID ?? environment.BREVO_LIST_ID;
  const listId = Number(rawListId);

  if (!apiKey || !Number.isInteger(listId) || listId <= 0) {
    const error = new Error("Brevo integration is not configured.");
    error.status = 503;
    error.code = "configuration_error";
    throw error;
  }

  return { apiKey, listId };
}

function buildAttributes(submission) {
  const attributes = {};
  if (submission.firstName) attributes.FIRSTNAME = submission.firstName;
  if (submission.lastName) attributes.LASTNAME = submission.lastName;
  return attributes;
}

async function addContactToBrevo({
  submission,
  configuration,
  environment,
  fetchImpl
}) {
  const attributes = buildAttributes(submission);
  const templateId = Number(environment.BREVO_DOI_TEMPLATE_ID);
  const doubleOptInEnabled = Number.isInteger(templateId) && templateId > 0;

  const path = doubleOptInEnabled
    ? "/contacts/doubleOptinConfirmation"
    : "/contacts";
  const body = doubleOptInEnabled
    ? {
        email: submission.email,
        attributes,
        includeListIds: [configuration.listId],
        templateId,
        redirectionUrl:
          cleanText(environment.BREVO_DOI_REDIRECT_URL, 500) ||
          "https://gravityarena.co.za"
      }
    : {
        email: submission.email,
        attributes,
        listIds: [configuration.listId],
        updateEnabled: true
      };

  const upstream = await fetchImpl(`${BREVO_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": configuration.apiKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000)
  });

  if (!upstream.ok) {
    let upstreamCode = "brevo_error";
    try {
      const upstreamBody = await upstream.json();
      upstreamCode = cleanText(upstreamBody.code, 80) || upstreamCode;
    } catch {
      // Brevo occasionally returns an empty or non-JSON error response.
    }
    const error = new Error("The signup service could not process the request.");
    error.status = upstream.status >= 500 ? 502 : 400;
    error.code = upstreamCode;
    throw error;
  }

  return { doubleOptInEnabled };
}

function anonymousEmailId(email) {
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}

export function createLaunchListHandler({
  fetchImpl = globalThis.fetch,
  environment = process.env,
  logger = console
} = {}) {
  return async function launchListHandler(request, response) {
    const requestId = randomUUID();
    setHeader(response, "X-Request-Id", requestId);
    setHeader(response, "Cache-Control", "no-store");

    const allowedOrigins = parseAllowedOrigins(environment.ALLOWED_ORIGINS);
    const originAllowed = applyCors(request, response, allowedOrigins);

    if (request.method === "OPTIONS") {
      if (!originAllowed) {
        return send(response, 403, { ok: false, error: "Origin not allowed." });
      }
      response.statusCode = 204;
      return response.end();
    }

    if (request.method !== "POST") {
      setHeader(response, "Allow", "POST, OPTIONS");
      return send(response, 405, { ok: false, error: "Method not allowed." });
    }

    if (!originAllowed) {
      return send(response, 403, { ok: false, error: "Origin not allowed." });
    }

    try {
      const submission = normalizeSubmission(parseBody(request));
      if (submission.isBot) {
        return send(response, 200, {
          ok: true,
          message: "Thank you. Your request has been received."
        });
      }

      const configuration = requireConfiguration(environment);
      const result = await addContactToBrevo({
        submission,
        configuration,
        environment,
        fetchImpl
      });

      logger.info?.("launch_list_signup", {
        requestId,
        emailId: anonymousEmailId(submission.email),
        doubleOptIn: result.doubleOptInEnabled
      });

      return send(response, 200, {
        ok: true,
        doubleOptIn: result.doubleOptInEnabled,
        message: result.doubleOptInEnabled
          ? "Please check your email to confirm your place on the launch list."
          : "Welcome to the Gravity Arena launch list."
      });
    } catch (error) {
      const status =
        Number.isInteger(error.status) && error.status >= 400
          ? error.status
          : error.name === "TimeoutError"
            ? 504
            : 500;
      const code = cleanText(error.code, 80) || "request_failed";

      logger.error?.("launch_list_signup_failed", {
        requestId,
        status,
        code,
        message: error.message
      });

      const publicMessage =
        status >= 500
          ? "The signup service is temporarily unavailable. Please try again."
          : error.message;
      return send(response, status, {
        ok: false,
        code,
        error: publicMessage
      });
    }
  };
}
