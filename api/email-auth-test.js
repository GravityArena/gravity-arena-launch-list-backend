import { timingSafeEqual, createHash } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";

const REVISION = "GA-EMAIL-AUTH-TEST-v1";
const AUDIENCE = "api://AzureADTokenExchange";
const SUBJECT = "owner:gravity-arena-team:project:gravity-arena-launch-list-backend:environment:production";
const ISSUER = "https://oidc.vercel.com/gravity-arena-team";
const MAILBOXES = [
  ["bookings", 200], ["info", 200], ["support", 200], ["privacy", 200],
  ["finance", 403], ["sibusiso", 403],
];
const digest = value => createHash("sha256").update(value).digest();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const key = process.env.GA_EMAIL_TEST_KEY?.trim();
  const supplied = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (!key || !timingSafeEqual(digest(supplied), digest("Bearer " + key))) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // Temporary diagnostic automatically expires even on immutable deployments.
  if (Date.now() > Date.parse("2026-10-28T23:59:59Z")) {
    return res.status(410).json({ error: "diagnostic_expired" });
  }
  const tenant = process.env.AZURE_TENANT_ID?.trim();
  const client = process.env.AZURE_CLIENT_ID?.trim();
  if (tenant !== "451259a6-e4ff-403d-9c96-7583f7e99622" ||
      client !== "14784a79-119c-4fc7-a691-a83727127bff") {
    return res.status(503).json({ revision: REVISION, stage: "configuration", error: "unexpected_or_missing_identity" });
  }
  let stage = "vercel_oidc";
  try {
    const assertion = await getVercelOidcToken({ audience: AUDIENCE });
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
    // Claims here are diagnostic checks. Entra verifies the signature during exchange.
    const identity = { issuer: claims.iss, subject: claims.sub, audience: claims.aud };
    if (claims.iss !== ISSUER || claims.sub !== SUBJECT || claims.aud !== AUDIENCE) {
      return res.status(502).json({ revision: REVISION, stage, error: "oidc_claim_mismatch", identity });
    }
    stage = "entra_exchange";
    const exchange = await fetch("https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client, grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: assertion,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await exchange.json();
    if (!exchange.ok || !data.access_token) {
      return res.status(502).json({ revision: REVISION, stage, identity,
        error: typeof data.error === "string" ? data.error : "token_exchange_failed",
        errorCodes: Array.isArray(data.error_codes) ? data.error_codes : [],
      });
    }
    stage = "graph_mailbox_scope";
    const results = await Promise.all(MAILBOXES.map(async ([name, expected]) => {
      const mailbox = name + "@gravityarena.co.za";
      try {
        const response = await fetch("https://graph.microsoft.com/v1.0/users/" +
          encodeURIComponent(mailbox) + "/mailFolders/inbox/messages?$top=1&$select=id", {
          headers: { Authorization: "Bearer " + data.access_token },
          signal: AbortSignal.timeout(15000),
        });
        // Discard the body. No message identifiers, subjects or content leave the function.
        await response.body?.cancel();
        return { mailbox, expected, status: response.status, passed: response.status === expected };
      } catch {
        return { mailbox, expected, status: null, passed: false, error: "request_failed" };
      }
    }));
    const ok = results.every(result => result.passed);
    console.info("Gravity Arena email authentication diagnostic", { revision: REVISION, ok, stage });
    return res.status(ok ? 200 : 502).json({
      revision: REVISION, ok, stage, identity, tokenExchange: "passed",
      testedAt: new Date().toISOString(), results,
    });
  } catch {
    console.error("Gravity Arena email authentication diagnostic failed", { revision: REVISION, stage });
    return res.status(502).json({ revision: REVISION, stage, error: "diagnostic_failed" });
  }
}
