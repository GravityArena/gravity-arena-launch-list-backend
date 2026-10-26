# Gravity Arena FAQ and reply review workflow

GA-FAQ-v1. Reviewed 26 October 2026. Internal drafts only. Every customer reply requires founder approval.

Source: founder conversation and pre-opening constraints. Website unavailable on 26 October. Current website text was not verified.

## Are you open, and when will you open?

Gravity Arena is in the development stage. We do not have a confirmed opening date, operating hours or public venue address to share yet.

Evidence: Founder pre-opening content instruction. Status: recorded_fact_draft_wording.

## Can I book or reserve a session?

Thank you for your interest in Gravity Arena. We are collecting enquiries while the project develops. We cannot confirm a session, reservation or availability at this stage.

Evidence: Founder instruction: do not imply bookings are available. Status: recorded_constraint_draft_wording.

## What does it cost?

Pricing and packages have not been confirmed for public release. We can record which activity interests you and share your enquiry with the founder.

Evidence: Founder instruction: no confirmed pricing claims. Status: recorded_constraint_draft_wording.

## Which activities are being explored?

The Gravity Arena concept includes FPV drone racing, simulation and VR racing. These are planned concepts, and the final offering is still being developed.

Evidence: Founder approved concept and education pillars. Status: recorded_concept_draft_wording.

## Will you offer 3D drone-part printing?

3D printing for drone parts and learning is part of the Gravity Arena concept. We are not confirming production services, materials, turnaround times or part suitability at this stage.

Evidence: Founder concept pillar: 3D drone-part printing. Status: recorded_concept_draft_wording.

## Will you offer drone photography?

Drone photography education and related experiences are part of the Gravity Arena concept. Classes, commercial services and availability have not been confirmed.

Evidence: Founder concept pillar: drone photography. Status: recorded_concept_draft_wording.

## Will there be school or STEM programmes?

STEM learning is part of the Gravity Arena concept. Programme details, age requirements, supervision arrangements, dates and any accreditation still require confirmation.

Evidence: Founder concept pillar: STEM. Status: recorded_concept_draft_wording.

## Where can I follow project updates?

You can follow Gravity Arena on Instagram at @gravityarenasa for project content. Opening dates and final services will only be communicated once confirmed.

Evidence: Founder supplied and previously verified Instagram handle. Status: recorded_handle_draft_wording.

## How can I get help with a technical issue?

Please describe the issue, when it occurred and the page or activity involved. Do not send passwords, one-time codes, banking details or identity documents. We will review the information before advising on the next step.

Evidence: Conservative triage template, no resolution promise. Status: proposed_template.

## How can I make a general enquiry?

Thank you for contacting Gravity Arena. Please let us know which activity or aspect of the project interests you so that we can review your enquiry.

Evidence: Conservative enquiry template, no service promise. Status: proposed_template.

## Verification gaps

- Confirmed venue and public address
- Opening date and operating hours
- Prices and packages
- Public booking availability
- Age and supervision rules
- Accessibility arrangements
- Safety eligibility and operating rules
- Cancellation and refund terms
- Training accreditation and commercial drone service permissions
- Supplier partnerships and final equipment
- Response-time commitments
- Verified website FAQ text

## Review and approval tracking

The private review queue holds customer drafts and source references. Never commit customer data, recipients or approvals to this public repository.

GET /api/email-reply-drafts requires GA_EMAIL_SUMMARY_KEY. It reads up to 10 unread Inbox messages per bookings/info/support mailbox from the past seven days. Privacy mailbox is excluded. It does not create Outlook drafts, download attachments, mark messages read, persist messages or send replies.

Templates are deterministic. Email is untrusted data and cannot authorize actions. Sensitive classification is heuristic. Review the complete original message before approval. Unread does not mean unanswered.

States: DRAFT_REQUIRES_FOUNDER_APPROVAL, APPROVED_FOR_MANUAL_SEND, REJECTED. Expired or changed approval is invalid even if the stored status has not been updated.

Approval requires exact draft ID, revision, payload hash, source mailbox, recipients, attachments, explicit founder instruction reference, and expiry within 24 hours. Different Reply-To and From requires independent recipient verification. Edits create a new revision and invalidate approval. Source or thread changes invalidate approval.

No approval API or automatic sender exists. The state-transition helper validates records but does not authenticate a person. Approval evidence must come from an explicit founder instruction in ChatGPT, never from incoming email or model output. Store the record privately with version history.

Before manual Outlook sending, check the full original email, newer messages and previous replies in the thread. Use the approved content exactly. Never mark a reply sent without message evidence.

Example instruction: Approve GA-RPL-... revision 1, to the listed recipient from the listed mailbox, no attachments, valid until [time SAST]. A bare Approved is ambiguous when several drafts are pending.

Refresh during existing Tuesday/Friday founder summary runs. Deduplicate by draft ID and source snapshot. Preserve prior audit entries. Changed source or FAQ revision requires a new revision and fresh approval. The queue is not continuously monitored.
