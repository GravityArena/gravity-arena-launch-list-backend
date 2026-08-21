// Gravity Arena GA OS
// Phase 3E.1.9B-4A - Recovery Correlation Client
//
// Correlation only.
// No incident lifecycle transition.
// No notification delivery.
// No automatic remediation.

const RECOVERY_TIMEOUT_MS = 8000;

function getRecoveryConfig() {
  const url = process.env.INCIDENT_RECOVERY_URL?.trim();
  const key = process.env.INCIDENT_REGISTRY_KEY?.trim();

  if (!url || !key) {
    throw new Error("Incident recovery configuration is incomplete.");
  }

  return { url, key };
}

export async function correlateRecoveryEvent(recoveryHealthEventId) {
  if (!recoveryHealthEventId) {
    throw new Error("recoveryHealthEventId is required.");
  }

  const { url, key } = getRecoveryConfig();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recovery_health_event_id: recoveryHealthEventId,
    }),
    signal: AbortSignal.timeout(RECOVERY_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok !== true) {
    throw new Error(`Recovery correlation failed (${response.status}).`);
  }

  return {
    correlated: data?.correlated === true,
    duplicateSuppressed: data?.duplicate_suppressed === true,
    reason: data?.reason || null,
    incidentIdPresent: Boolean(data?.incident_id || data?.link?.incident_id),
    incidentReferencePresent: Boolean(data?.incident_reference),
    dependency: data?.dependency || data?.link?.dependency || null,
    observedDurationSeconds:
      Number.isFinite(Number(data?.observed_duration_seconds))
        ? Number(data.observed_duration_seconds)
        : null,
    notificationSent: false,
    incidentClosed: false,
    lifecycleChanged: false,
    automaticRemediation: false,
  };
}
