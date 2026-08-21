// Gravity Arena GA OS
// Phase 3E.1.7B - Health Event Registry Client
// Phase 3E.1.9B-3A enhancement: retain sanitized dependency diagnostics
//
// Sanitized persistence only.
// No customer PII.
// No secrets in payload.
// No automatic remediation.

const REGISTRY_TIMEOUT_MS = 8000;

function getRegistryConfig() {
  const url = process.env.HEALTH_REGISTRY_URL?.trim();
  const key = process.env.HEALTH_REGISTRY_KEY?.trim();

  if (!url || !key) {
    throw new Error("Health registry configuration is incomplete.");
  }

  return { url, key };
}

function sanitizeStatus(value) {
  const status = String(value || "UNKNOWN").toUpperCase();
  return ["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"].includes(status)
    ? status
    : "UNKNOWN";
}

function sanitizeReason(value) {
  const reason = String(value || "unknown")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 120);

  return reason || "unknown";
}

function sanitizeNullableInteger(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.round(number)
    : null;
}

export function sanitizeDependencyStatuses(checks = {}) {
  const value = (name) => sanitizeStatus(checks?.[name]?.status);

  return {
    memory_status: value("memory"),
    booking_status: value("booking"),
    hermes_status: value("hermes"),
    brevo_status: value("brevo"),
    whatsapp_status: value("whatsapp"),
  };
}

export function sanitizeDependencyDiagnostics(checks = {}) {
  const supported = ["memory", "booking", "hermes", "brevo", "whatsapp"];

  return Object.fromEntries(
    supported.map((name) => [
      name,
      {
        status: sanitizeStatus(checks?.[name]?.status),
        reason: sanitizeReason(checks?.[name]?.reason),
        http_status: sanitizeNullableInteger(checks?.[name]?.http_status),
        latency_ms: sanitizeNullableInteger(checks?.[name]?.latency_ms),
      },
    ])
  );
}

export async function readLatestHealthEvent() {
  const { url, key } = getRegistryConfig();
  const endpoint = new URL(url);
  endpoint.searchParams.set("limit", "1");

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok !== true) {
    throw new Error(`Health registry read failed (${response.status}).`);
  }

  return Array.isArray(data.events) && data.events.length > 0
    ? data.events[0]
    : null;
}

export async function persistHealthEvent({
  eventType,
  healthStatus,
  sourcePhase,
  checks = {},
  alertSent = false,
  simulation = false,
  recordedAt = new Date().toISOString(),
}) {
  const { url, key } = getRegistryConfig();
  const statuses = sanitizeDependencyStatuses(checks);
  const diagnostics = sanitizeDependencyDiagnostics(checks);

  const body = {
    event_type: eventType,
    health_status: healthStatus,
    source_phase: sourcePhase,
    ...statuses,
    checks: diagnostics,
    alert_sent: Boolean(alertSent),
    simulation: Boolean(simulation),
    automatic_remediation: false,
    recorded_at: recordedAt,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  if (response.status !== 201 || data?.stored !== true) {
    throw new Error(`Health registry write failed (${response.status}).`);
  }

  return {
    stored: true,
    eventId: data.event_id || null,
    eventType: data.event_type || eventType,
    healthStatus: data.health_status || healthStatus,
  };
}
