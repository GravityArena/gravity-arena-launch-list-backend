// Founder conversation is the source. No current website verification is claimed.
export const FAQ_REVISION = "GA-FAQ-v1";
export const FAQ_SOURCE = {
  type: "founder_conversation", reviewedAt: "2026-10-26",
  reference: "Gravity Arena automation thread: pre-opening concepts, education and interest only",
  websiteVerification: "unavailable_2026-10-26",
  publishingApproval: "not_granted",
};
export const FAQS = [
  { id: "opening", question: "Are you open, and when will you open?",
    pattern: /\b(open|opening|launch|hours|operating|address|location)\b/i,
    answer: "Gravity Arena is in the development stage. We do not have a confirmed opening date, operating hours or public venue address to share yet.",
    evidence: "Founder pre-opening content instruction", status: "recorded_fact_draft_wording" },
  { id: "bookings", question: "Can I book or reserve a session?",
    pattern: /\b(book|booking|reserve|reservation|availability|birthday|party|corporate|event)\b/i,
    answer: "Thank you for your interest in Gravity Arena. We are collecting enquiries while the project develops. We cannot confirm a session, reservation or availability at this stage.",
    evidence: "Founder instruction: do not imply bookings are available", status: "recorded_constraint_draft_wording" },
  { id: "pricing", question: "What does it cost?",
    pattern: /\b(price|pricing|cost|fee|fees|rate|rates|package|payment|deposit)\b/i,
    answer: "Pricing and packages have not been confirmed for public release. We can record which activity interests you and share your enquiry with the founder.",
    evidence: "Founder instruction: no confirmed pricing claims", status: "recorded_constraint_draft_wording" },
  { id: "activities", question: "Which activities are being explored?",
    pattern: /\b(activity|activities|offer|experience|fpv|drone|racing|simulator|simulation|vr|virtual reality)\b/i,
    answer: "The Gravity Arena concept includes FPV drone racing, simulation and VR racing. These are planned concepts, and the final offering is still being developed.",
    evidence: "Founder approved concept and education pillars", status: "recorded_concept_draft_wording" },
  { id: "printing", question: "Will you offer 3D drone-part printing?",
    pattern: /\b(3d|print|printing|printed|spares|parts|prototype)\b/i,
    answer: "3D printing for drone parts and learning is part of the Gravity Arena concept. We are not confirming production services, materials, turnaround times or part suitability at this stage.",
    evidence: "Founder concept pillar: 3D drone-part printing", status: "recorded_concept_draft_wording" },
  { id: "photography", question: "Will you offer drone photography?",
    pattern: /\b(photo|photos|photography|filming|video|aerial)\b/i,
    answer: "Drone photography education and related experiences are part of the Gravity Arena concept. Classes, commercial services and availability have not been confirmed.",
    evidence: "Founder concept pillar: drone photography", status: "recorded_concept_draft_wording" },
  { id: "stem", question: "Will there be school or STEM programmes?",
    pattern: /\b(stem|school|education|learning|learn|class|classes|training|course|courses)\b/i,
    answer: "STEM learning is part of the Gravity Arena concept. Programme details, age requirements, supervision arrangements, dates and any accreditation still require confirmation.",
    evidence: "Founder concept pillar: STEM", status: "recorded_concept_draft_wording" },
  { id: "updates", question: "Where can I follow project updates?",
    pattern: /\b(update|updates|progress|social|instagram|facebook|follow)\b/i,
    answer: "You can follow Gravity Arena on Instagram at @gravityarenasa for project content. Opening dates and final services will only be communicated once confirmed.",
    evidence: "Founder supplied and previously verified Instagram handle", status: "recorded_handle_draft_wording" },
  { id: "support", question: "How can I get help with a technical issue?",
    pattern: /\b(support|help|issue|problem|error|website|signup|sign.up)\b/i,
    answer: "Please describe the issue, when it occurred and the page or activity involved. Do not send passwords, one-time codes, banking details or identity documents. We will review the information before advising on the next step.",
    evidence: "Conservative triage template, no resolution promise", status: "proposed_template" },
  { id: "general", question: "How can I make a general enquiry?",
    pattern: /\bgeneral enquiry\b/i,
    answer: "Thank you for contacting Gravity Arena. Please let us know which activity or aspect of the project interests you so that we can review your enquiry.",
    evidence: "Conservative enquiry template, no service promise", status: "proposed_template" },
];
export const FAQ_GAPS = [
  "Confirmed venue and public address", "Opening date and operating hours", "Prices and packages",
  "Public booking availability", "Age and supervision rules", "Accessibility arrangements",
  "Safety eligibility and operating rules", "Cancellation and refund terms",
  "Training accreditation and commercial drone service permissions",
  "Supplier partnerships and final equipment", "Response-time commitments", "Verified website FAQ text",
];
export function matchFaqs(text) {
  // Specific topics first. Limit response length, flag multiple topics for review.
  return [...FAQS].sort((a,b) => (a.id === "activities") - (b.id === "activities"))
    .filter(faq => faq.pattern.test(text)).slice(0, 3);
}
