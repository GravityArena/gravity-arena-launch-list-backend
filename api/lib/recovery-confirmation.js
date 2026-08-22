// Gravity Arena GA OS
// Phase 3E.1.9B-4D-2
// Confirmed recovery worker client.

const RECOVERY_TIMEOUT_MS = 8000;

function getRecoveryConfig() {
  const url = process.env.RECOVERY_CONFIRMATION_URL?.trim();
  const key = process.env.INCIDENT_REGISTRY_KEY?.trim();

  if (!url || !key) {
    return null;
  }

  return { url, key };
}

export async function observeRecoveryState({
  checks,
  healthEventId = null,
}) {
  const config = getRecoveryConfig();

  if (!config) {
    return {
      attempted: false,
      reason: "recovery_confirmation_not_configured",
      resolvedCount: 0,
      pendingEscalationsSuppressed: 0,
      automaticRemediation: false,
    };
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      health_event_id: healthEventId,
      checks,
    }),
    signal: AbortSignal.timeout(RECOVERY_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  if (response.status !== 200 || data?.ok !== true) {
    throw new Error(
      `Recovery confirmation worker failed (${response.status}).`
    );
  }

  const results = data?.results || {};

  return {
    attempted: true,
    reason: "recovery_confirmation_processed",
    resolvedCount: Number(data?.resolved_count || 0),
    pendingEscalationsSuppressed: Number(
      data?.pending_escalations_suppressed || 0
    ),
    results,
    incidentAutoClose: data?.incident_auto_close === true,
    automaticRemediation: false,
  };
}
