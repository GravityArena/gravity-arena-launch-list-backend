// Gravity Arena GA OS
// Phase 3E.1.9B-4B - Controlled Recovery Notification Client
//
// Sends notification request only after accepted recovery correlation.
// No lifecycle transition.
// No incident closure.
// No remediation.

const RECOVERY_NOTIFICATION_TIMEOUT_MS = 12000;

function getRecoveryNotificationConfig() {
  const url = process.env.INCIDENT_RECOVERY_NOTIFICATION_URL?.trim();
  const key = process.env.INCIDENT_REGISTRY_KEY?.trim();

  if (!url || !key) {
    throw new Error("Recovery notification configuration is incomplete.");
  }

  return { url, key };
}

export async function sendRecoveryNotification(recoveryLinkId) {
  if (!recoveryLinkId) {
    throw new Error("recoveryLinkId is required.");
  }

  const { url, key } = getRecoveryNotificationConfig();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recovery_link_id: recoveryLinkId,
    }),
    signal: AbortSignal.timeout(RECOVERY_NOTIFICATION_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok !== true) {
    throw new Error(
      `Recovery notification request failed (${response.status}).`
    );
  }

  return {
    notification: data?.notification || null,
    notificationIdPresent: Boolean(data?.notification_id),
    incidentIdPresent: Boolean(data?.incident_id),
    incidentReference: data?.incident_reference || null,
    dependency: data?.dependency || null,
    providerMessageIdPresent: data?.provider_message_id_present === true,
    observedDurationSeconds:
      Number.isFinite(Number(data?.observed_duration_seconds))
        ? Number(data.observed_duration_seconds)
        : null,
    pendingEscalationsSuppressed:
      Number.isFinite(Number(data?.pending_escalations_suppressed))
        ? Number(data.pending_escalations_suppressed)
        : 0,
    lifecycleChanged: false,
    incidentClosed: false,
    automaticRemediation: false,
  };
}
