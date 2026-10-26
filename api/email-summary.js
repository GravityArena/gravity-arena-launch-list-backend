import {
  REVISION, RECIPIENT, authorized, windowFor, graphToken, buildDigest,
  subjectFor, priorDelivery, sendDigest, deliveryStatus,
} from "../lib/email-digest-core.js";

export const config = { maxDuration: 120 };
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "method_not_allowed" });
  if (!authorized(req.headers.authorization, process.env.GA_EMAIL_SUMMARY_KEY?.trim())) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const mode = String(req.query?.mode || "preview");
  if (!["preview", "send", "status"].includes(mode)) return res.status(400).json({ error: "invalid_mode" });
  if (mode === "send" && req.method !== "POST") return res.status(405).json({ error: "post_required" });
  const now = new Date();
  const window = windowFor(now);
  const isTest = req.query?.test === "1";
  const subject = (isTest ? "TEST | " : "") + subjectFor(window);
  let stage = "delivery_history";
  try {
    if (mode === "status") {
      const prior = await priorDelivery(subject, window);
      return res.status(200).json({ ok: true, revision: REVISION, window, subject,
        accepted: prior.found, ...(prior.found ? await deliveryStatus(prior.messageId) : {}) });
    }
    if (mode === "send") {
      if (!isTest && process.env.GA_EMAIL_SUMMARIES_ENABLED !== "true") return res.status(409).json({ error: "sending_disabled" });
      // Only the current scheduled slot, and only within two hours. Late/missed windows require review.
      if (!isTest && now - new Date(window.end) > 2 * 3600000) return res.status(409).json({ error: "outside_send_window", window });
      const prior = await priorDelivery(subject, window);
      if (prior.found) return res.status(200).json({ ok: true, duplicateSuppressed: true, subject,
        ...(await deliveryStatus(prior.messageId)) });
    }
    stage = "graph_read";
    const digest = await buildDigest(window, await graphToken());
    const stats = digest.reports.map(({ topics, ...report }) => report);
    if (mode === "preview") return res.status(200).json({
      ok: true, revision: REVISION, mode, recipient: RECIPIENT, subject, window,
      reports: stats, summaryMode: digest.overview.mode, draft: digest.text, repliesEnabled: false,
    });
    stage = "brevo_send";
    const messageId = await sendDigest(subject, digest.text, window);
    console.info("Gravity Arena digest accepted", { revision: REVISION, windowEnd: window.end });
    return res.status(200).json({ ok: true, revision: REVISION, mode, subject, window,
      accepted: true, delivered: false, messageId, reports: stats, summaryMode: digest.overview.mode, repliesEnabled: false });
  } catch {
    console.error("Gravity Arena digest failed", { revision: REVISION, stage });
    return res.status(502).json({ ok: false, revision: REVISION, stage,
      error: "digest_failed", sendOutcome: stage === "brevo_send" ? "unknown_check_provider_before_retry" : "not_sent" });
  }
}
