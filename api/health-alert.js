// Gravity Arena GA OS
// Phase 3E.1.4 - Controlled Operational Alerting
//
// Alert-only worker.
// No automatic remediation.
// No customer messaging.
// No booking mutation.
// No production configuration changes.

const PHASE = "3E.1.4";
const SERVICE = "gravity-arena-ga-os-health-alert";
const HEALTH_TIMEOUT_MS = 12000;
const BREVO_TIMEOUT_MS = 8000;

function isAuthorized(req) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const auth = String(req.headers.authorization || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  const direct = String(req.headers["x-api-key"] || "").trim();

  return Boolean(
    (bearer && bearer === expected) ||
    (direct && direct === expected)
  );
}

function getHealthUrl(req) {
  const explicit = process.env.GA_OS_HEALTH_URL?.trim();
  if (explicit) return explicit;

  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  ).trim();

  if (!host) throw new Error("Health alert host is unavailable.");

  const proto = String(req.headers["x-forwarded-proto"] || "https").trim();
  return `${proto}://${host}/api/health`;
}

function getAlertRecipient() {
  return (
    process.env.GA_OS_ALERT_EMAIL?.trim() ||
    process.env.FOUNDER_ESCALATION_EMAIL?.trim() ||
    process.env.HUMAN_ESCALATION_EMAIL?.trim() ||
    ""
  );
}

function getBrevoConfig() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName =
    process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena GA OS";

  if (!apiKey || !senderEmail) {
    throw new Error("Brevo alert configuration is incomplete.");
  }

  return { apiKey, senderEmail, senderName };
}

async function callHealth(req) {
  const probeKey = process.env.HEALTH_PROBE_KEY?.trim();
  if (!probeKey) {
    throw new Error("HEALTH_PROBE_KEY is not configured.");
  }

  const started = Date.now();

  const response = await fetch(getHealthUrl(req), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${probeKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  return {
    response,
    data,
    latencyMs: Date.now() - started,
  };
}

function compactChecks(checks = {}) {
  return Object.fromEntries(
    Object.entries(checks).map(([name, check]) => [
      name,
      {
        status: String(check?.status || "UNKNOWN"),
        reason: String(check?.reason || "unknown"),
        latency_ms:
          Number.isFinite(Number(check?.latency_ms))
            ? Number(check.latency_ms)
            : null,
        http_status:
          Number.isFinite(Number(check?.http_status))
            ? Number(check.http_status)
            : null,
      },
    ])
  );
}

function failingChecks(checks = {}) {
  return Object.entries(checks)
    .filter(([, check]) => String(check?.status || "").toUpperCase() !== "HEALTHY")
    .map(([name, check]) => ({
      name,
      status: String(check?.status || "UNKNOWN"),
      reason: String(check?.reason || "unknown"),
      http_status:
        Number.isFinite(Number(check?.http_status))
          ? Number(check.http_status)
          : null,
      latency_ms:
        Number.isFinite(Number(check?.latency_ms))
          ? Number(check.latency_ms)
          : null,
    }));
}

async function sendAlertEmail({ recipient, healthStatus, healthHttpStatus, checks, checkedAt }) {
  const { apiKey, senderEmail, senderName } = getBrevoConfig();
  const failed = failingChecks(checks);

  const subject = `[GA OS ${healthStatus}] Production health alert`;

  const lines = [
    `Gravity Arena GA OS production health status: ${healthStatus}`,
    `Phase: ${PHASE}`,
    `Checked at: ${checkedAt}`,
    `Health endpoint HTTP status: ${healthHttpStatus}`,
    "",
    "Affected dependencies:",
  ];

  if (failed.length === 0) {
    lines.push("- Health endpoint returned an unhealthy aggregate status.");
  } else {
    for (const item of failed) {
      lines.push(
        `- ${item.name}: ${item.status}, reason=${item.reason}, http=${item.http_status ?? "n/a"}, latency_ms=${item.latency_ms ?? "n/a"}`
      );
    }
  }

  lines.push(
    "",
    "Action required:",
    "Review Vercel logs and the affected upstream service.",
    "No automatic remediation has been performed.",
    "",
    "Gravity Arena GA OS"
  );

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: [
        {
          email: recipient,
          name: "Gravity Arena Operations",
        },
      ],
      subject,
      textContent: lines.join("\n"),
      tags: ["gravity-arena", "ga-os", "health-alert"],
    }),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Brevo alert delivery failed (${response.status}).`);
  }

  return {
    status: response.status,
    messageId: data?.messageId || null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Allow", "GET");

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      service: SERVICE,
      phase: PHASE,
      error: "Method not allowed.",
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      service: SERVICE,
      phase: PHASE,
      error: "Unauthorized.",
    });
  }

  const started = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const { response, data, latencyMs } = await callHealth(req);

    const healthStatus = String(
      data?.status || (response.ok ? "HEALTHY" : "UNKNOWN")
    ).toUpperCase();

    const checks = compactChecks(data?.checks);

    const healthy =
      response.status === 200 &&
      data?.ok === true &&
      healthStatus === "HEALTHY";

    if (healthy) {
      console.log("GA OS operational alert check healthy", {
        phase: PHASE,
        healthStatus,
        healthHttpStatus: response.status,
        healthLatencyMs: latencyMs,
        alertSent: false,
        automaticRemediation: false,
      });

      return res.status(200).json({
        ok: true,
        service: SERVICE,
        phase: PHASE,
        status: "HEALTHY",
        alert_sent: false,
        checked_at: checkedAt,
        duration_ms: Date.now() - started,
        automatic_remediation: false,
      });
    }

    const recipient = getAlertRecipient();

    if (!recipient) {
      console.error("GA OS operational alert recipient unavailable", {
        phase: PHASE,
        healthStatus,
        healthHttpStatus: response.status,
        checks,
        automaticRemediation: false,
      });

      return res.status(503).json({
        ok: false,
        service: SERVICE,
        phase: PHASE,
        status: healthStatus === "CRITICAL" ? "CRITICAL" : "DEGRADED",
        alert_sent: false,
        error: "Operational alert recipient is not configured.",
        checked_at: checkedAt,
        automatic_remediation: false,
      });
    }

    const delivery = await sendAlertEmail({
      recipient,
      healthStatus,
      healthHttpStatus: response.status,
      checks,
      checkedAt,
    });

    console.error("GA OS operational health alert sent", {
      phase: PHASE,
      healthStatus,
      healthHttpStatus: response.status,
      healthLatencyMs: latencyMs,
      alertSent: true,
      deliveryStatus: delivery.status,
      deliveryMessageIdPresent: Boolean(delivery.messageId),
      failedChecks: failingChecks(checks),
      automaticRemediation: false,
    });

    // The alert worker itself completed successfully, so return 200.
    // The unhealthy production state remains explicit in `status`.
    return res.status(200).json({
      ok: true,
      service: SERVICE,
      phase: PHASE,
      status: healthStatus === "CRITICAL" ? "CRITICAL" : "DEGRADED",
      alert_sent: true,
      checked_at: checkedAt,
      duration_ms: Date.now() - started,
      automatic_remediation: false,
      checks,
    });
  } catch (error) {
    console.error("GA OS operational alert worker failed", {
      phase: PHASE,
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      automaticRemediation: false,
    });

    return res.status(502).json({
      ok: false,
      service: SERVICE,
      phase: PHASE,
      status: "CRITICAL",
      alert_sent: false,
      error: "Operational alert worker failed.",
      checked_at: checkedAt,
      duration_ms: Date.now() - started,
      automatic_remediation: false,
    });
  }
}
