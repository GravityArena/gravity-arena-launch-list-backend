import { createHash } from "node:crypto";
export const POLICY_REVISION = "GA-REPLY-RULES-v1";
export const FOUNDER = "sibusiso@gravityarena.co.za";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function payloadHash(draft) {
  return digest([draft.id, draft.revision, draft.sourceMailbox, draft.sourceSnapshot,
    draft.sourceMessageId, draft.conversationId, draft.category, draft.recipientMismatch,
    draft.to, draft.cc || [], draft.bcc || [], draft.subject, draft.body, draft.attachments || [],
    draft.faqRevision, POLICY_REVISION]);
}
export function sourceSnapshot(message) {
  return digest([message.id, message.lastModifiedDateTime, message.conversationId,
    message.internetMessageId, message.from?.emailAddress?.address,
    message.replyTo || [], message.subject, message.bodyPreview]);
}
export function createRecord(draft, now = new Date()) {
  return { ...draft, status: "DRAFT_REQUIRES_FOUNDER_APPROVAL", payloadHash: payloadHash(draft),
    createdAt: now.toISOString(), approval: null,
    audit: [{ action: "prepared", at: now.toISOString(), revision: draft.revision, payloadHash: payloadHash(draft) }] };
}
export function approve(record, evidence, now = new Date()) {
  if (record.status !== "DRAFT_REQUIRES_FOUNDER_APPROVAL" || record.escalationOnly)
    throw new Error("draft_not_approvable");
  if (record.recipientMismatch && evidence.recipientVerified !== true) throw new Error("recipient_verification_required");
  if (record.payloadHash !== payloadHash(record)) throw new Error("payload_changed");
  if (evidence.actor !== FOUNDER || !evidence.instructionReference ||
      evidence.revision !== record.revision || evidence.payloadHash !== record.payloadHash)
    throw new Error("exact_founder_approval_required");
  const expires = new Date(evidence.expiresAt);
  if (!Number.isFinite(+expires) || expires <= now || expires - now > 24 * 3600000)
    throw new Error("approval_expiry_required_within_24_hours");
  const approval = { actor: FOUNDER, instructionReference: evidence.instructionReference,
    at: now.toISOString(), expiresAt: expires.toISOString(), payloadHash: record.payloadHash,
    revision: record.revision, recipientVerified: evidence.recipientVerified === true };
  return { ...record, status: "APPROVED_FOR_MANUAL_SEND", approval,
    audit: [...record.audit, { action: "approved_manual_only", ...approval }] };
}
export function reject(record, evidence, now = new Date()) {
  if (evidence.actor !== FOUNDER || !evidence.instructionReference) throw new Error("founder_evidence_required");
  return { ...record, status: "REJECTED", approval: null,
    audit: [...record.audit, { action: "rejected", at: now.toISOString(), ...evidence }] };
}
export function revise(record, changes, now = new Date()) {
  const allowed = ["to", "cc", "bcc", "subject", "body", "attachments"];
  if (Object.keys(changes).some(key => !allowed.includes(key))) throw new Error("invalid_revision_fields");
  const updated = { ...record, ...changes, revision: record.revision + 1,
    status: "DRAFT_REQUIRES_FOUNDER_APPROVAL", approval: null };
  updated.payloadHash = payloadHash(updated);
  updated.audit = [...record.audit, { action: "revised_approval_invalidated", at: now.toISOString(),
    revision: updated.revision, payloadHash: updated.payloadHash }];
  return updated;
}
export function assess(record, currentSnapshot, latestThreadMessageId, now = new Date()) {
  if (record.payloadHash !== payloadHash(record)) return { valid: false, reason: "payload_changed" };
  if (currentSnapshot !== record.sourceSnapshot || latestThreadMessageId !== record.sourceMessageId)
    return { valid: false, reason: "source_or_thread_changed" };
  if (record.status !== "APPROVED_FOR_MANUAL_SEND" || !record.approval) return { valid: false, reason: "not_approved" };
  if (record.approval.expiresAt <= now.toISOString()) return { valid: false, reason: "approval_expired" };
  if (record.approval.payloadHash !== record.payloadHash) return { valid: false, reason: "approval_mismatch" };
  return { valid: true, reason: "manual_outlook_send_only", automatedSendingEnabled: false };
}
