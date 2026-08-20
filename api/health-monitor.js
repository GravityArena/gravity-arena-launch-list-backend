// Gravity Arena GA OS
// Phase 3E.1.7B - Health Monitoring + Automatic Incident Creation

import {
  persistHealthEvent,
  readLatestHealthEvent,
} from "./lib/health-registry.js";

import {
  createIncidentFromHealthEvent,
} from "./lib/incident-registry.js";

const PHASE = "3E.1.7B";
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


function getAcceptanceSimulation(req) {
  const marker = String(req.query?.simulate || "").trim();
  if (marker !== "ACCEPTANCE_TEST_3E_1_7") return null;

  const expected = process.env.INCIDENT_ACCEPTANCE_TEST_KEY?.trim();
  const supplied = String(req.headers["x-ga-incident-acceptance-key"] || "").trim();

  if (!expected || !supplied || supplied !== expected) {
    const error = new Error("Acceptance simulation authorization failed.");
    error.statusCode = 403;
    throw error;
  }

  const requested = String(req.query?.status || "DEGRADED").toUpperCase();
  if (!["DEGRADED", "CRITICAL"].includes(requested)) {
    const error = new Error("Acceptance simulation status must be DEGRADED or CRITICAL.");
    error.statusCode = 422;
    throw error;
  }

  return {
    marker,
    status: requested,
    checks: {
      memory: { ok: true, status: "HEALTHY", reason: "acceptance_simulation" },
      booking: { ok: true, status: "HEALTHY", reason: "acceptance_simulation" },
      hermes: { ok: true, status: "HEALTHY", reason: "acceptance_simulation" },
      brevo: { ok: true, status: "HEALTHY", reason: "acceptance_simulation" },
      whatsapp: { ok: true, status: "HEALTHY", reason: "acceptance_simulation" },
    },
  };
}

function getHealthUrl(req) {
  const explicit = process.env.GA_OS_HEALTH_URL?.trim();
  if (explicit) return explicit;

  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  ).trim();

  if (!host) throw new Error("Health monitor host is unavailable.");

  const proto = String(req.headers["x-forwarded-proto"] || "https").trim();
  return `${proto}://${host}/api/health`;
}

async function callHealthEndpoint(req) {
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
        ok: check?.ok === true,
        status: String(check?.status || "UNKNOWN"),
        reason: String(check?.reason || "unknown"),
        latencyMs: Number.isFinite(Number(check?.latency_ms))
          ? Number(check.latency_ms)
          : null,
        httpStatus: Number.isFinite(Number(check?.http_status))
          ? Number(check.http_status)
          : null,
      },
    ])
  );
}

function registryChecks(checks = {}) {
  return Object.fromEntries(
    Object.entries(checks).map(([name, check]) => [
      name,
      { status: String(check?.status || "UNKNOWN") },
    ])
  );
}

function isScheduledHealthySnapshotTime(date = new Date()) {
  const minute = date.getUTCMinutes();
  return minute === 2 || minute === 32;
}

async function persistMonitorState({
  healthStatus,
  checks,
  recordedAt,
}) {
  let latest = null;

  try {
    latest = await readLatestHealthEvent();
  } catch (error) {
    console.error("GA OS health registry latest-event read failed", {
      phase: PHASE,
      message: error instanceof Error ? error.message : String(error),
      automaticRemediation: false,
    });
  }

  const previousStatus = String(latest?.health_status || "").toUpperCase();

  if (healthStatus === "HEALTHY") {
    if (previousStatus && previousStatus !== "HEALTHY") {
      return persistHealthEvent({
        eventType: "RECOVERY",
        healthStatus: "HEALTHY",
        sourcePhase: PHASE,
        checks: registryChecks(checks),
        recordedAt,
      });
    }

    if (isScheduledHealthySnapshotTime(new Date(recordedAt))) {
      return persistHealthEvent({
        eventType: "HEALTH_SNAPSHOT",
        healthStatus: "HEALTHY",
        sourcePhase: PHASE,
        checks: registryChecks(checks),
        recordedAt,
      });
    }

    return { stored: false, reason: "healthy_snapshot_not_due" };
  }

  const eventType =
    healthStatus === "CRITICAL" ? "CRITICAL" : "DEGRADED";

  if (
    latest &&
    String(latest.event_type || "").toUpperCase() === eventType &&
    previousStatus === healthStatus &&
    latest.simulation !== true
  ) {
    return { stored: false, reason: "unchanged_unhealthy_state" };
  }

  return persistHealthEvent({
    eventType,
    healthStatus,
    sourcePhase: PHASE,
    checks: registryChecks(checks),
    recordedAt,
  });
}

async function maybeCreateIncident({
  healthStatus,
  registryResult,
}) {
  if (!["DEGRADED", "CRITICAL"].includes(healthStatus)) {
    return {
      attempted: false,
      created: false,
      reason: "healthy_state",
    };
  }

  if (registryResult?.stored !== true || !registryResult?.eventId) {
    return {
      attempted: false,
      created: false,
      reason: registryResult?.reason || "health_event_not_persisted",
    };
  }

  const result = await createIncidentFromHealthEvent(registryResult.eventId);

  return {
    attempted: true,
    created: result.created,
    duplicateSuppressed: result.duplicateSuppressed,
    incidentIdPresent: Boolean(result.incidentId),
    incidentReferencePresent: Boolean(result.incidentReference),
    status: result.status,
    automaticRemediation: false,
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
    const acceptance = getAcceptanceSimulation(req);

    if (acceptance) {
      const checks = compactChecks(acceptance.checks);

      const registry = await persistHealthEvent({
        eventType: "SIMULATION",
        healthStatus: acceptance.status,
        sourcePhase: PHASE,
        checks: registryChecks(checks),
        simulation: true,
        recordedAt: checkedAt,
      });

      const incident = await createIncidentFromHealthEvent(
        registry.eventId,
        { acceptanceTest: true }
      );

      console.warn("GA OS controlled incident acceptance simulation", {
        phase: PHASE,
        marker: acceptance.marker,
        simulatedStatus: acceptance.status,
        registryStored: registry?.stored === true,
        incidentCreated: incident?.created === true,
        duplicateSuppressed: incident?.duplicateSuppressed === true,
        automaticRemediation: false,
      });

      return res.status(200).json({
        ok: true,
        service: SERVICE,
        phase: PHASE,
        status: acceptance.status,
        real_health_status: "NOT_MODIFIED",
        simulation: true,
        acceptance_test: acceptance.marker,
        registry_persisted: registry?.stored === true,
        source_health_event_id: registry?.eventId || null,
        incident_attempted: true,
        incident_created: incident?.created === true,
        duplicate_suppressed: incident?.duplicateSuppressed === true,
        incident_id: incident?.incidentId || null,
        incident_reference: incident?.incidentReference || null,
        incident_status: incident?.status || null,
        automatic_remediation: false,
        checks,
      });
    }

    const { response, data, latencyMs } = await callHealthEndpoint(req);
    const checks = compactChecks(data?.checks);

    const rawStatus =
      String(data?.status || "").toUpperCase() ||
      (response.ok ? "HEALTHY" : "UNKNOWN");

    const effectiveStatus =
      response.status === 200 &&
      data?.ok === true &&
      rawStatus === "HEALTHY"
        ? "HEALTHY"
        : rawStatus === "CRITICAL"
          ? "CRITICAL"
          : "DEGRADED";

    let registry = null;

    try {
      registry = await persistMonitorState({
        healthStatus: effectiveStatus,
        checks,
        recordedAt: checkedAt,
      });
    } catch (error) {
      console.error("GA OS health registry persistence failed", {
        phase: PHASE,
        message: error instanceof Error ? error.message : String(error),
        automaticRemediation: false,
      });

      registry = {
        stored: false,
        reason: "registry_write_failed",
      };
    }

    let incident = null;

    try {
      incident = await maybeCreateIncident({
        healthStatus: effectiveStatus,
        registryResult: registry,
      });
    } catch (error) {
      console.error("GA OS automatic incident creation failed", {
        phase: PHASE,
        message: error instanceof Error ? error.message : String(error),
        healthEventIdPresent: Boolean(registry?.eventId),
        automaticRemediation: false,
      });

      incident = {
        attempted: true,
        created: false,
        reason: "incident_create_failed",
      };
    }

    const log = {
      phase: PHASE,
      monitoredPhase: data?.phase || null,
      status: effectiveStatus,
      healthHttpStatus: response.status,
      healthLatencyMs: latencyMs,
      totalDurationMs: Date.now() - started,
      registryStored: registry?.stored === true,
      registryReason: registry?.reason || null,
      incidentAttempted: incident?.attempted === true,
      incidentCreated: incident?.created === true,
      duplicateSuppressed: incident?.duplicateSuppressed === true,
      incidentIdPresent: incident?.incidentIdPresent === true,
      incidentReferencePresent: incident?.incidentReferencePresent === true,
      incidentReason: incident?.reason || null,
      checks,
      automaticRemediation: false,
    };

    if (effectiveStatus === "HEALTHY") {
      console.log("GA OS scheduled health monitor healthy", log);

      return res.status(200).json({
        ok: true,
        service: SERVICE,
        phase: PHASE,
        status: "HEALTHY",
        monitored_phase: data?.phase || "3E.1.2",
        checked_at: checkedAt,
        duration_ms: Date.now() - started,
        registry_persisted: registry?.stored === true,
        registry_reason: registry?.reason || null,
        incident_attempted: false,
        incident_created: false,
        automatic_remediation: false,
        checks,
      });
    }

    console.error("GA OS scheduled health monitor degraded", log);

    return res.status(503).json({
      ok: false,
      service: SERVICE,
      phase: PHASE,
      status: effectiveStatus,
      monitored_phase: data?.phase || "3E.1.2",
      checked_at: checkedAt,
      duration_ms: Date.now() - started,
      registry_persisted: registry?.stored === true,
      registry_reason: registry?.reason || null,
      incident_attempted: incident?.attempted === true,
      incident_created: incident?.created === true,
      duplicate_suppressed: incident?.duplicateSuppressed === true,
      incident_status: incident?.status || null,
      automatic_remediation: false,
      checks,
    });
  } catch (error) {
    if (Number.isInteger(error?.statusCode)) {
      return res.status(error.statusCode).json({
        ok: false,
        service: SERVICE,
        phase: PHASE,
        error: error instanceof Error ? error.message : String(error),
        automatic_remediation: false,
      });
    }

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
      checked_at: checkedAt,
      duration_ms: Date.now() - started,
      registry_persisted: false,
      incident_attempted: false,
      incident_created: false,
      automatic_remediation: false,
    });
  }
}
