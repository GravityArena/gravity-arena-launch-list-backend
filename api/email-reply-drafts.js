import { authorized, graphToken } from "../lib/email-digest-core.js";
import { prepareDraft, REPLY_REVISION } from "../lib/email-reply-core.js";
export const config = { maxDuration: 120 };
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") return res.status(405).json({ error: "read_only_endpoint" });
  if (!authorized(req.headers.authorization, process.env.GA_EMAIL_SUMMARY_KEY?.trim()))
    return res.status(401).json({ error: "unauthorized" });
  try {
    const token = await graphToken();
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const batches = await Promise.all(["bookings", "info", "support"].map(async mailbox => {
      const params = new URLSearchParams({
        "$filter": "receivedDateTime ge " + since + " and isRead eq false",
        "$select": "id,conversationId,internetMessageId,lastModifiedDateTime,subject,from,replyTo,bodyPreview,receivedDateTime",
        "$orderby": "receivedDateTime desc", "$top": "10",
      });
      const response = await fetch("https://graph.microsoft.com/v1.0/users/" +
        encodeURIComponent(mailbox + "@gravityarena.co.za") + "/mailFolders/inbox/messages?" + params, {
        headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("mailbox_read_failed");
      const data = await response.json();
      return { mailbox, capped: Boolean(data["@odata.nextLink"]),
        items: data.value.map(message => prepareDraft(mailbox, message)) };
    }));
    return res.status(200).json({ ok: true, revision: REPLY_REVISION, since, batches,
      persisted: false, outlookDraftsCreated: false, sendingEnabled: false,
      note: "Private review queue must be persisted separately. Never save customer data in the public source repository." });
  } catch {
    console.error("Gravity Arena reply preparation failed", { revision: REPLY_REVISION });
    return res.status(502).json({ ok: false, error: "reply_preparation_failed" });
  }
}
