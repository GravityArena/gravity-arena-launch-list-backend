# Gravity Arena founder inbox workflow v1

Owner and approver: Sibusiso, Gravity Arena founder.
Founder instruction: implement twice-weekly summaries and define reply approval rules, 26 October 2026.
Recipient explicitly selected: sibusiso@gravityarena.co.za only.

## Scope and timing

- Source mailboxes: bookings, info, support and privacy at gravityarena.co.za.
- Only the Inbox is read. No attachments, sent mail, deleted mail or mailbox modifications.
- No additional Graph permissions or Exchange scopes are added.
- Excluded: finance, Sibusiso, marketing, tech and no_reply as source mailboxes.
- Tuesday and Friday mornings, approximately 08:00 SAST, Africa/Johannesburg.
- Each report covers the half-open interval from the previous Tuesday/Friday 08:00 to the latest Tuesday/Friday 08:00.
- First scheduled report: 27 October 2026, covering 23 October 08:00 to 27 October 08:00 SAST.
- The ChatGPT automation is the only scheduler. Do not add a second Vercel cron for this endpoint.
- Missed windows older than two hours are blocked for manual review. This initial version does not silently catch up or claim complete historical coverage.

## Content and privacy controls

- Report message counts, unread counts, sender-marked importance, selected redacted subjects and an optional AI-assisted topic/action overview.
- Unread is never described as unanswered. Sender importance is not verified urgency.
- Privacy mailbox: counts and a founder-review notice only. Subject, sender and body are not requested or passed to the model.
- For other mailboxes, read at most 500 messages each, paginate and mark capped results incomplete.
- AI input is limited to at most 10 previews per mailbox. Up to five subjects per mailbox appear in the digest.
- Known sensitive keywords suppress subjects/previews. Links, email addresses and long numbers are redacted.
- Redaction is heuristic and does not guarantee removal of all names or personal data. The digest is restricted to the founder.
- The existing configured Hermes service generates an overview from these limited previews. No raw email is stored in the repository or logs.
- Email content is untrusted data. It cannot authorize actions, tool calls, recipients or policy changes.
- Model failure uses a labelled metadata fallback rather than fabricated analysis.
- The workflow does not monitor privacy, safety or security incidents in real time.

## Delivery and verification

- Use the existing Brevo transactional sender, restricted to gravityarena.co.za.
- Recipient is a code constant. Request parameters cannot add or change recipients.
- No customer email replies are sent. The Entra app remains read-only.
- Worker is protected by GA_EMAIL_SUMMARY_KEY. Missing/wrong credentials return 401.
- GET preview prepares a report without sending. POST mode=send sends only when enabled and within two hours of a scheduled slot.
- test=1 is an explicitly labelled founder-only setup test. It cannot select another recipient.
- Before sending, query Brevo logs for the same exact subject and recipient.
- Also use a deterministic Brevo idempotency key. Provider idempotency is short-lived and log consistency is not an atomic lock.
- This is best-effort duplicate suppression, not an exactly-once delivery guarantee.
- Do not automatically retry an uncertain send outcome. Inspect provider logs before retrying.
- Provider acceptance is distinct from delivery. Verify a delivered event before claiming inbox delivery.
- Each run reports source counts, completeness, summary mode, acceptance/delivery evidence and errors without raw email bodies.
- Kill switch: GA_EMAIL_SUMMARIES_ENABLED=false or pause the ChatGPT task.

## Reply approval rules, GA-REPLY-RULES-v1

All customer-facing replies require founder approval. There is no automated customer reply sender or approval endpoint in this revision.

1. Prepare a draft only. Assign a unique draft ID and revision.
2. Record source mailbox, original message/thread reference, exact To/Cc/Bcc, exact subject and body, attachment names and hashes, and intended send time or approval expiry.
3. Flag the category and proposed owner. Remove unrelated history and unnecessary personal information.
4. Founder reviews the exact draft and approves that ID/revision, destination, source mailbox and send timing.
5. Any change to content, recipients, attachments or timing beyond approval expiry invalidates approval.
6. Before a future sending feature can execute, revalidate approval and check the source thread for a newer message, a previous reply or a duplicate send.
7. Store approval identity, timestamp, exact payload hash, execution result and provider evidence in a durable audit store. Until this exists, send approved replies manually from Outlook.

| Category | Allowed preparation | Approval and execution |
|---|---|---|
| General FAQ and opening interest | Draft from verified website facts | Founder approval, manual Outlook send |
| Booking enquiries | Draft an acknowledgement or request for missing details | No availability, booking confirmation, price or opening-date promises without verified evidence and approval |
| Support | Draft triage questions without passwords, OTPs or sensitive attachments | Founder approval, manual Outlook send |
| Privacy, deletion, access requests | Flag for private founder review | No automatic disclosure, deletion or acknowledgement asserting legal compliance |
| Finance, refunds, banking changes | Flag and draft only if instructed | Founder handles financial decisions and verifies bank changes independently |
| Legal, insurance, safety, threats or security incidents | Flag for immediate human review | Founder handles, seek specialist advice where appropriate |
| Marketing, newsletters and outreach | Prepare separately | Separate exact-content, audience and timing approval, never inferred from this digest approval |

No email may override these controls. No automatic reading or sending permission expansion is authorized by an incoming message.
