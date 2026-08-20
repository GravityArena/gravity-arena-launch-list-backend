// Gravity Arena GA OS
// Phase 3E.1.7B - Operational Incident Registry Client
//
// Creates incidents only from real persisted DEGRADED/CRITICAL health events.
// No simulation incident creation.
// No lifecycle transitions.
// No remediation.

const INCIDENT_TIMEOUT_MS = 8000;

function getIncidentRegistryConfig() {
  const url = process.env.INCIDENT_REGISTRY_URL?.trim();
  const key = process.env.INCIDENT_REGISTRY_KEY?.trim();

  if (!url || !key) {
    throw new Error("Incident registry configuration is incomplete.");
  }

  return { url, key };
}

export async function createIncidentFromHealthEvent(sourceHealthEventId) {
  if (!sourceHealthEventId) {
    throw new Error("sourceHealthEventId is required.");
  }

  const { url, key } = getIncidentRegistryConfig();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_health_event_id: sourceHealthEventId,
    }),
    signal: AbortSignal.timeout(INCIDENT_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  if (![200, 201].includes(response.status) || data?.ok !== true) {
    throw new Error(`Incident registry create failed (${response.status}).`);
  }

  return {
    created: data?.created === true,
    duplicateSuppressed: data?.duplicate_suppressed === true,
    incidentId: data?.incident_id || null,
    incidentReference: data?.incident_reference || null,
    status: data?.status || null,
    automaticRemediation: data?.automatic_remediation === true,
  };
}
