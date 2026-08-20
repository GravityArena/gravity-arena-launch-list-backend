const REGISTRY_TIMEOUT_MS = 8000;

function getRegistryConfig() {
  const url = process.env.HEALTH_REGISTRY_URL?.trim();
  const key = process.env.HEALTH_REGISTRY_KEY?.trim();
  if (!url || !key) throw new Error("Health registry configuration is incomplete.");
  return { url, key };
}

export function sanitizeDependencyStatuses(checks = {}) {
  const value = (name) => {
    const status = String(checks?.[name]?.status || "UNKNOWN").toUpperCase();
    return ["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"].includes(status) ? status : "UNKNOWN";
  };
  return {
    memory_status: value("memory"),
    booking_status: value("booking"),
    hermes_status: value("hermes"),
    brevo_status: value("brevo"),
    whatsapp_status: value("whatsapp"),
  };
}

export async function readLatestHealthEvent() {
  const { url, key } = getRegistryConfig();
  const endpoint = new URL(url);
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) throw new Error(`Health registry read failed (${response.status}).`);
  return Array.isArray(data.events) && data.events.length > 0 ? data.events[0] : null;
}

export async function persistHealthEvent({ eventType, healthStatus, sourcePhase, checks = {}, alertSent = false, simulation = false, recordedAt = new Date().toISOString() }) {
  const { url, key } = getRegistryConfig();
  const body = {
    event_type: eventType,
    health_status: healthStatus,
    source_phase: sourcePhase,
    ...sanitizeDependencyStatuses(checks),
    alert_sent: Boolean(alertSent),
    simulation: Boolean(simulation),
    automatic_remediation: false,
    recorded_at: recordedAt,
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status !== 201 || data?.stored !== true) throw new Error(`Health registry write failed (${response.status}).`);
  return { stored: true, eventId: data.event_id || null, eventType: data.event_type || eventType, healthStatus: data.health_status || healthStatus };
}
