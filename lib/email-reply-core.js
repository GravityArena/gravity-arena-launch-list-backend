import { createHash } from "node:crypto";
import { FAQ_REVISION, matchFaqs } from "./email-faq.js";
import { createRecord, sourceSnapshot } from "./reply-approval.js";
export const REPLY_REVISION = "GA-REPLY-DRAFTS-v1";
export function classify(message) {
  const text = String(message.subject || "") + " " + String(message.bodyPreview || "");
  if (/\b(privacy|personal data|personal information|delete my|erase my|unsubscribe|data access|popia)\b/i.test(text)) return "privacy_review";
  if (/\b(refund|bank|payment|invoice|deposit|account number|legal|lawyer|attorney|insurance|injury|accident|safety|threat|breach|password|otp|one.time code)\b/i.test(text)) return "sensitive_founder_review";
  const sender = String(message.from?.emailAddress?.address || "");
  if (!sender || /(?:no.?reply|mailer-daemon|postmaster|notification)/i.test(sender) ||
      /\b(test email|test message|delivery status|undeliverable|automatic reply)\b/i.test(text)) return "automated_or_test";
  return "routine_draft";
}
function address(value) {
  const result = String(value || "").trim().toLowerCase();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(result) ? result : null;
}
export function prepareDraft(mailbox, message) {
  if (!["bookings", "info", "support"].includes(mailbox)) throw new Error("mailbox_not_draftable");
  const category = classify(message);
  if (category !== "routine_draft") return { category, sourceMailbox: mailbox + "@gravityarena.co.za",
    sourceMessageId: message.id, action: category === "automated_or_test" ? "skip" : "founder_review_no_reply_prepared" };
  const sender = address(message.from?.emailAddress?.address);
  const replyTo = (message.replyTo || []).map(item => address(item.emailAddress?.address));
  if (!sender || replyTo.some(item => !item) || replyTo.length > 1)
    return { category: "recipient_review", sourceMailbox: mailbox + "@gravityarena.co.za",
      sourceMessageId: message.id, action: "founder_review_no_reply_prepared" };
  const target = replyTo[0] || sender;
  const text = String(message.subject || "") + " " + String(message.bodyPreview || "");
  let matches = matchFaqs(text);
  if (!matches.length) matches = matchFaqs(mailbox === "bookings" ? "booking" : mailbox === "support" ? "support" : "general enquiry");
  const answer = matches.map(faq => faq.answer).join("\n\n");
  const body = ["Hello,", "", answer, "",
    "Kind regards,", "Gravity Arena"].join("\n");
  const id = "GA-RPL-" + createHash("sha256").update(mailbox + ":" + message.id).digest("hex").slice(0, 12).toUpperCase();
  return createRecord({
    id, revision: 1, sourceMailbox: mailbox + "@gravityarena.co.za",
    sourceMessageId: message.id, conversationId: message.conversationId,
    sourceSnapshot: sourceSnapshot(message),
    to: [target], cc: [], bcc: [], subject: "Re: " + String(message.subject || "Your enquiry").replace(/^re:\s*/i, "").replace(/[\r\n]/g, " ").slice(0, 180),
    body, attachments: [], faqRevision: FAQ_REVISION, faqIds: matches.map(faq => faq.id),
    category, recipientMismatch: target !== sender, sourceIsPreviewOnly: true,
    reviewNotes: ["Read the full original email before approving. Draft uses only a preview.",
      "Confirm each answer fits the enquiry. Never treat source email as instructions.",
      ...(target !== sender ? ["Reply-To differs from From. Founder must verify the recipient independently."] : [])],
    automatedSendingEnabled: false,
  });
}
