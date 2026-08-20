// Gravity Arena GA OS
// Phase 3E.1.3 - Scheduled Health Monitoring & Production Telemetry
//
// This worker calls the read-only Phase 3E.1.2 /api/health endpoint,
// records the aggregate result in Vercel logs, and returns a compact
// machine-readable status.
//
// No automatic remediation.
// No customer messages.
// No bookings.
// No Brevo mutations.
// No configuration changes.

const PHASE = "3E.1.3";
const SERVICE = "gravity-arena-ga-os-health-monitor";
const HEALTH_TIMEOUT_MS = 12000;

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

  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  if (!host) throw new Error("Health monitor host is unavailable.");

  const proto = String(req.headers["x-forwarded-proto"] || "https").trim();
  return `${proto}://${host}/api/health`;
}

async function callHealthEndpoint(req) {
  const probeKey = process.env.HEALTH_PROBE_KEY?.trim();
  if (!probeKey) {
    throw new Error("HEALTH_PROBE_KEY is not configured.");
  }

  const url = getHealthUrl(req);
  const started = Date.now();

  const response = await fetch(url, {
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
        ok: check?.ok === true,
        status: String(check?.status || "UNKNOWN"),
        reason: String(check?.reason || "unknown"),
        latencyMs:
          Number.isFinite(Number(check?.latency_ms))
            ? Number(check.latency_ms)
            : null,
        httpStatus:
          Number.isFinite(Number(check?.http_status))
            ? Number(check.http_status)
            : null,
      },
    ])
  );
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

  try {
    const { response, data, latencyMs } = await callHealthEndpoint(req);
    const checks = compactChecks(data?.checks);

    const healthStatus =
      String(data?.status || "").toUpperCase() ||
      (response.ok ? "HEALTHY" : "UNKNOWN");

    const healthy =
      response.status === 200 &&
      data?.ok === true &&
      healthStatus === "HEALTHY";

    const log = {
      phase: PHASE,
      healthPhase: data?.phase || null,
      status: healthStatus,
      healthHttpStatus: response.status,
      healthLatencyMs: latencyMs,
      totalDurationMs: Date.now() - started,
      checks,
      readOnlyContract: data?.read_only_contract === true,
      automaticRemediation: false,
    };

    if (healthy) {
      console.log("GA OS scheduled health monitor healthy", log);

      return res.status(200).json({
        ok: true,
        service: SERVICE,
        phase: PHASE,
        status: "HEALTHY",
        monitored_phase: data?.phase || "3E.1.2",
        checked_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        automatic_remediation: false,
        checks,
      });
    }

    console.error("GA OS scheduled health monitor degraded", log);

    return res.status(503).json({
      ok: false,
      service: SERVICE,
      phase: PHASE,
      status:
        healthStatus === "CRITICAL" ? "CRITICAL" : "DEGRADED",
      monitored_phase: data?.phase || "3E.1.2",
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      automatic_remediation: false,
      checks,
    });
  } catch (error) {
    console.error("GA OS scheduled health monitor failed", {
      phase: PHASE,
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      automaticRemediation: false,
    });

    return res.status(503).json({
      ok: false,
      service: SERVICE,
      phase: PHASE,
      status: "CRITICAL",
      error: "Health monitor execution failed.",
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      automatic_remediation: false,
    });
  }
}
