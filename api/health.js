const PHASE = "3E.1.2";
const SERVICE = "gravity-arena-ga-os-health";
const DEFAULT_TIMEOUT_MS = 5000;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

function suppliedProbeKey(req) {
  const direct = String(req.headers["x-api-key"] || "").trim();
  if (direct) return direct;
  const auth = String(req.headers.authorization || "").trim();
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function isAuthorized(req) {
  const expected = process.env.HEALTH_PROBE_KEY?.trim();
  const supplied = suppliedProbeKey(req);
  return Boolean(expected && supplied && supplied === expected);
}

function statusRecord(status, reason, latencyMs, extra = {}) {
  return { ok: status === "HEALTHY", status, reason, latency_ms: latencyMs, ...extra };
}

async function timedFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    return { response, latencyMs: Date.now() - started, error: null };
  } catch (error) {
    return { response: null, latencyMs: Date.now() - started, error };
  }
}

function sanitizedErrorReason(error) {
  if (!error) return "unknown_error";
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|aborted/i.test(message)) return "timeout";
  if (/fetch failed|network|econn|enotfound|dns/i.test(message)) return "unreachable";
  return "request_failed";
}

async function probeMemory() {
  const baseUrl = process.env.MEMORY_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.MEMORY_API_KEY?.trim();
  if (!baseUrl || !apiKey) return statusRecord("CRITICAL", "configuration_incomplete", 0);

  const url = new URL(`${baseUrl}/`);
  url.searchParams.set("action", "handover-list");
  url.searchParams.set("limit", "1");

  const { response, latencyMs, error } = await timedFetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });

  if (error) return statusRecord("CRITICAL", sanitizedErrorReason(error), latencyMs);
  if (response.status === 200) return statusRecord("HEALTHY", "reachable", latencyMs, { http_status: 200 });
  if ([401,403].includes(response.status)) return statusRecord("CRITICAL", "authentication_failed", latencyMs, { http_status: response.status });
  return statusRecord(response.status >= 500 ? "CRITICAL" : "DEGRADED", "unexpected_response", latencyMs, { http_status: response.status });
}

async function probeBooking() {
  const baseUrl = process.env.BOOKING_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.BOOKING_API_KEY?.trim();
  if (!baseUrl || !apiKey) return statusRecord("CRITICAL", "configuration_incomplete", 0);

  const url = new URL(`${baseUrl}/`);
  url.searchParams.set("action", "reminders-due");
  url.searchParams.set("limit", "1");

  const { response, latencyMs, error } = await timedFetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });

  if (error) return statusRecord("CRITICAL", sanitizedErrorReason(error), latencyMs);
  if (response.status === 200) return statusRecord("HEALTHY", "reachable", latencyMs, { http_status: 200 });
  if ([401,403].includes(response.status)) return statusRecord("CRITICAL", "authentication_failed", latencyMs, { http_status: response.status });
  return statusRecord(response.status >= 500 ? "CRITICAL" : "DEGRADED", "unexpected_response", latencyMs, { http_status: response.status });
}

async function probeBrevo() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return statusRecord("CRITICAL", "configuration_incomplete", 0);

  const { response, latencyMs, error } = await timedFetch("https://api.brevo.com/v3/account", {
    method: "GET",
    headers: { "api-key": apiKey, Accept: "application/json" },
  });

  if (error) return statusRecord("CRITICAL", sanitizedErrorReason(error), latencyMs);
  if (response.status === 200) return statusRecord("HEALTHY", "reachable", latencyMs, { http_status: 200 });
  if ([401,403].includes(response.status)) return statusRecord("CRITICAL", "authentication_failed", latencyMs, { http_status: response.status });
  return statusRecord(response.status >= 500 ? "CRITICAL" : "DEGRADED", "unexpected_response", latencyMs, { http_status: response.status });
}

async function probeWhatsApp() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return statusRecord("CRITICAL", "configuration_incomplete", 0);

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}`);
  url.searchParams.set("fields", "id,display_phone_number,verified_name");

  const { response, latencyMs, error } = await timedFetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (error) return statusRecord("CRITICAL", sanitizedErrorReason(error), latencyMs);
  if (response.status === 200) return statusRecord("HEALTHY", "reachable", latencyMs, { http_status: 200, phone_number_id_match: true });
  if ([401,403].includes(response.status)) return statusRecord("CRITICAL", "authentication_failed", latencyMs, { http_status: response.status });
  return statusRecord(response.status >= 500 ? "CRITICAL" : "DEGRADED", "unexpected_response", latencyMs, { http_status: response.status });
}

async function probeHermes() {
  const apiUrl = process.env.HERMES_API_URL?.trim();
  const apiKey = process.env.HERMES_API_KEY?.trim();
  const model = process.env.HERMES_MODEL?.trim();
  if (!apiUrl || !model) return statusRecord("CRITICAL", "configuration_incomplete", 0);

  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const { response, latencyMs, error } = await timedFetch(apiUrl, { method: "GET", headers });
  if (error) return statusRecord("CRITICAL", sanitizedErrorReason(error), latencyMs);
  if ([401,403].includes(response.status)) return statusRecord("CRITICAL", "authentication_failed", latencyMs, { http_status: response.status });
  if (response.status >= 500) return statusRecord("CRITICAL", "upstream_error", latencyMs, { http_status: response.status });
  if ([200,400,404,405,422].includes(response.status)) {
    return statusRecord("HEALTHY", "reachable_non_generative", latencyMs, { http_status: response.status, model_configured: true });
  }
  return statusRecord("DEGRADED", "unexpected_response", latencyMs, { http_status: response.status });
}

function summarize(checks) {
  const values = Object.values(checks);
  if (values.some(c => c.status === "CRITICAL")) return { ok:false, status:"CRITICAL" };
  if (values.some(c => ["DEGRADED","UNKNOWN"].includes(c.status))) return { ok:false, status:"DEGRADED" };
  return { ok:true, status:"HEALTHY" };
}

export default async function handler(req, res) {
  noStore(res);
  res.setHeader("Allow", "GET");

  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, service:SERVICE, phase:PHASE, error:"Method not allowed." });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok:false, service:SERVICE, phase:PHASE, error:"Unauthorized." });
  }

  const started = Date.now();

  const [memory, booking, hermes, brevo, whatsapp] = await Promise.all([
    probeMemory(),
    probeBooking(),
    probeHermes(),
    probeBrevo(),
    probeWhatsApp(),
  ]);

  const checks = { memory, booking, hermes, brevo, whatsapp };
  const overall = summarize(checks);

  console.log("GA OS health probe completed", {
    phase: PHASE,
    status: overall.status,
    durationMs: Date.now() - started,
    checks: Object.fromEntries(Object.entries(checks).map(([name, check]) => [
      name,
      { status:check.status, reason:check.reason, latencyMs:check.latency_ms, httpStatus:check.http_status ?? null }
    ])),
  });

  return res.status(overall.ok ? 200 : 503).json({
    ok: overall.ok,
    service: SERVICE,
    phase: PHASE,
    status: overall.status,
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    read_only_contract: true,
    automatic_remediation: false,
    checks,
  });
}
