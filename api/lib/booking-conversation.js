// Gravity Arena Hermes Booking Regression Fix R1.4
// Commit-Path Enforcement & Transaction State Continuity

const ACTIVITY_ALIASES = [
  { code: "FPV_RACING", name: "FPV Drone Racing", terms: ["fpv", "fpv racing", "drone racing"] },
  { code: "VR_RACING", name: "VR Racing", terms: ["vr racing", "virtual reality racing", "vr experience", "virtual reality experience", "vr"] },
  { code: "VR_ESCAPE", name: "VR Escape", terms: ["vr escape", "escape room"] },
  { code: "DRONE_TRAINING", name: "Drone Training", terms: ["drone training", "drone lesson", "learn drone"] },
  { code: "DRONE_PHOTOGRAPHY", name: "Drone Photography", terms: ["drone photography", "photography"] },
  { code: "DRONE_REPAIR", name: "Drone Repair", terms: ["drone repair", "repair workshop"] },
  { code: "SIMULATOR", name: "Simulator", terms: ["simulator", "flight simulator"] },
  { code: "CORPORATE_EVENT", name: "Corporate Event", terms: ["corporate", "team building"] },
  { code: "BIRTHDAY_PARTY", name: "Birthday Party", terms: ["birthday", "birthday party"] },
  { code: "STEM_PROGRAM", name: "STEM Program", terms: ["stem", "school workshop", "stem workshop"] },
];

function bookingConfig() {
  const baseUrl = process.env.BOOKING_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.BOOKING_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

async function bookingRequest(path, options = {}) {
  const config = bookingConfig();
  if (!config) throw new Error("Booking API configuration is incomplete.");

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Booking API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function johannesburgDate(offsetDays = 0) {
  const shifted = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(shifted);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function detectActivityCode(text = "") {
  const normalized = String(text).toLowerCase();
  return ACTIVITY_ALIASES.find((a) => a.terms.some((term) => normalized.includes(term)))?.code || null;
}

function activityName(code) {
  return ACTIVITY_ALIASES.find((a) => a.code === code)?.name || code;
}

function detectBookingDate(text = "") {
  text = String(text);
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;

  const normalized = text.toLowerCase();
  if (normalized.includes("tomorrow")) return johannesburgDate(1);
  if (normalized.includes("today")) return johannesburgDate(0);

  const monthMap = {
    january:1, jan:1, february:2, feb:2, march:3, mar:3,
    april:4, apr:4, may:5, june:6, jun:6, july:7, jul:7,
    august:8, aug:8, september:9, sep:9, sept:9,
    october:10, oct:10, november:11, nov:11, december:12, dec:12,
  };

  let m = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(20\d{2})\b/i);
  if (m) {
    const day=Number(m[1]), month=monthMap[m[2].toLowerCase()], year=Number(m[3]);
    if (day>=1 && day<=31 && month) return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }

  m = normalized.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i);
  if (m) {
    const month=monthMap[m[1].toLowerCase()], day=Number(m[2]), year=Number(m[3]);
    if (day>=1 && day<=31 && month) return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }

  m = normalized.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (m) {
    const day=Number(m[1]), month=Number(m[2]), year=Number(m[3]);
    if (day>=1 && day<=31 && month>=1 && month<=12) return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }
  return null;
}

function detectGuestCount(text = "") {
  const valueText = String(text).trim();

  // R1.4: a bare reply such as "4" is a valid answer to "How many guests?"
  // This was the primary state-continuity regression in R1.3.
  const bare = valueText.match(/^(\d{1,2})$/);
  if (bare) {
    const value = Number(bare[1]);
    if (value > 0 && value <= 100) return value;
  }

  const patterns = [
    /(\d{1,2})\s*(?:people|guests|persons|players|adults|kids|children)/i,
    /\bfor\s+(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const value = Number(valueText.match(pattern)?.[1] || 0);
    if (value > 0 && value <= 100) return value;
  }
  return null;
}

function extractEmail(text = "") {
  return String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || null;
}

function detectCustomerName(text = "") {
  text = String(text);
  const email = extractEmail(text);
  if (!email) return null;

  const idx = text.toLowerCase().indexOf(email.toLowerCase());
  const beforeEmail = idx >= 0 ? text.slice(0, idx).trim().replace(/[,:;|]+$/g, "").trim() : "";

  if (/^[A-Za-z][A-Za-z' -]{1,79}$/.test(beforeEmail) && beforeEmail.split(/\s+/).length <= 6) {
    return beforeEmail;
  }

  return text.match(/\b(?:my name is|name is|i am|i'm)\s+([A-Za-z][A-Za-z' -]{1,79}?)(?=\s*(?:,|;|\||and\s+my\s+email|email|$))/i)?.[1]?.trim() || null;
}

function detectPreferredPeriod(text = "") {
  const n = String(text).toLowerCase();
  if (/\bmorning\b/.test(n)) return "MORNING";
  if (/\bafternoon\b/.test(n)) return "AFTERNOON";
  if (/\bevening\b|\bnight\b/.test(n)) return "EVENING";
  return null;
}

function detectSelectedTime(text = "") {
  text = String(text);
  let m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return `${String(Number(m[1])).padStart(2,"0")}:${m[2]}`;

  m = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (!m) return null;

  let hour=Number(m[1]);
  const minute=m[2]||"00";
  const meridiem=m[3].toLowerCase();
  if (meridiem==="pm" && hour!==12) hour+=12;
  if (meridiem==="am" && hour===12) hour=0;
  return `${String(hour).padStart(2,"0")}:${minute}`;
}

function detectSlotId(text = "") {
  const value = Number(String(text).match(/\bslot\s*#?\s*(\d+)\b/i)?.[1] || 0);
  return value > 0 ? value : null;
}

function hasBookingIntent(text = "") {
  return /\b(book|booking|reserve|reservation|slot|availability|times? available)\b/i.test(String(text));
}

function isResetIntent(text = "") {
  return /\b(start over|start again|restart|begin again|reset(?: the)? booking|forget (?:that|this)|clear (?:that|this))\b/i.test(String(text));
}

function isExplicitNewBookingStart(text = "") {
  text = String(text);
  return /\b(?:i\s+)?(?:would like|want|need)\s+to\s+(?:make\s+)?(?:a\s+)?(?:book|booking|reserve)\b/i.test(text) ||
    /\b(?:please\s+)?(?:book|reserve)\b/i.test(text) ||
    /\bmake\s+(?:a\s+)?booking\b/i.test(text) ||
    /\bnew booking\b/i.test(text);
}

function isOfferingsQuery(text = "") {
  text = String(text);
  return /\bwhat (?:activities|experiences|services).*gravity arena\b/i.test(text) ||
    /\bwhat (?:does|do) gravity arena offer\b/i.test(text) ||
    /\b(?:provide|give|show).*list.*gravity arena.*offer/i.test(text) ||
    /\bwhat activities are available at gravity arena\b/i.test(text);
}

function formatOfferings() {
  return [
    "Gravity Arena currently offers:",
    ...ACTIVITY_ALIASES.map((a)=>`• ${a.name}`),
    "",
    "If you’d like to make a booking, tell me which activity you’re interested in.",
  ].join("\n");
}

function isTerminalAssistantMessage(text = "") {
  text = String(text);
  return /(?:your\s+)?(?:gravity arena\s+)?booking is confirmed!?/i.test(text) ||
    /(?:your\s+)?(?:gravity arena\s+)?booking has been cancelled/i.test(text) ||
    /\bstatus:\s*(?:cancelled|expired)\b/i.test(text) ||
    /\bReference:\s*GA-\d{8}-\d{6}\b/i.test(text);
}

function isAffirmativeBookingReply(text = "") {
  return /^(?:yes|yes please|confirm|confirm it|please confirm|go ahead|proceed|book it|do it|okay|ok)$/i.test(String(text).trim());
}

function findSessionBoundary(history = []) {
  let boundary = 0;
  history.forEach((item,index)=>{
    const text=String(item?.content||item?.text||"");

    if (item.role==="assistant" && isTerminalAssistantMessage(text)) {
      boundary=index+1;
      return;
    }
    if (item.role==="user" && (isResetIntent(text)||isExplicitNewBookingStart(text))) {
      boundary=index;
    }
  });
  return boundary;
}

function deriveContext(message, history = []) {
  const boundary=findSessionBoundary(history);
  const activeHistory=history.slice(boundary);

  const context={
    active:false,
    activityCode:null,
    date:null,
    guestCount:null,
    email:null,
    customerName:null,
    preferredPeriod:null,
    selectedTime:null,
    slotId:null,
    transactionBoundary:boundary,
  };

  const applyText=(text="")=>{
    const activity=detectActivityCode(text);
    const date=detectBookingDate(text);
    const guests=detectGuestCount(text);
    const email=extractEmail(text);
    const customerName=detectCustomerName(text);
    const preferredPeriod=detectPreferredPeriod(text);
    const selectedTime=detectSelectedTime(text);
    const slotId=detectSlotId(text);

    context.active=context.active ||
      hasBookingIntent(text) || Boolean(activity) || Boolean(date) || Boolean(guests) ||
      Boolean(email) || Boolean(customerName) || Boolean(preferredPeriod) ||
      Boolean(selectedTime) || Boolean(slotId);

    if (activity && context.activityCode && activity!==context.activityCode) {
      context.activityCode=activity;
      // Do not leak inventory state from the previous activity.
      context.date=null;
      context.guestCount=null;
      context.preferredPeriod=null;
      context.selectedTime=null;
      context.slotId=null;
    } else if (activity) {
      context.activityCode=activity;
    }

    if (date) context.date=date;
    if (guests) context.guestCount=guests;
    if (email) context.email=email;
    if (customerName) context.customerName=customerName;
    if (preferredPeriod) context.preferredPeriod=preferredPeriod;
    if (selectedTime) context.selectedTime=selectedTime;
    if (slotId) context.slotId=slotId;
  };

  for (const item of activeHistory) {
    if (item.role!=="user") continue;
    applyText(String(item?.content||item?.text||""));
  }

  const currentText=String(message?.text||"");
  const lastActiveUser=[...activeHistory].reverse().find((i)=>i.role==="user");
  const lastText=String(lastActiveUser?.content||lastActiveUser?.text||"");

  if (!lastActiveUser || lastText!==currentText) applyText(currentText);
  return context;
}

function currentHasBookingField(text = "") {
  return Boolean(
    detectActivityCode(text) || detectBookingDate(text) || detectGuestCount(text) ||
    extractEmail(text) || detectCustomerName(text) || detectPreferredPeriod(text) ||
    detectSelectedTime(text) || detectSlotId(text) || isAffirmativeBookingReply(text)
  );
}

function periodMatches(startsAt, period) {
  const hour=Number(String(startsAt).slice(11,13));
  if (period==="MORNING") return hour>=6 && hour<12;
  if (period==="AFTERNOON") return hour>=12 && hour<17;
  if (period==="EVENING") return hour>=17;
  return true;
}

function formatNaturalSlots(slots, context) {
  if (!slots.length) {
    return `I could not find an available ${activityName(context.activityCode)} slot on ${context.date} for ${context.guestCount} guests. Would you like another date or time of day?`;
  }
  return [
    `${activityName(context.activityCode)} availability for ${context.guestCount} guests on ${context.date}:`,
    ...slots.slice(0,8).map((slot)=>`• ${String(slot.starts_at).slice(11,16)}–${String(slot.ends_at).slice(11,16)} — ${slot.remaining_capacity} spaces remaining`),
    "",
    "Which time would you prefer?",
  ].join("\n");
}

async function getAvailability(context) {
  const params=new URLSearchParams({
    action:"availability",
    activity_code:context.activityCode,
    date:context.date,
    guest_count:String(context.guestCount),
  });
  const result=await bookingRequest(`/?${params.toString()}`,{method:"GET"});
  return Array.isArray(result?.slots)?result.slots:[];
}

async function sendConfirmationEmail(booking) {
  const apiKey=process.env.BREVO_API_KEY?.trim();
  const senderEmail=process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName=process.env.BREVO_SENDER_NAME?.trim()||"Gravity Arena";
  if (!apiKey || !senderEmail || !booking?.customer_email) return false;

  const response=await fetch("https://api.brevo.com/v3/smtp/email",{
    method:"POST",
    headers:{"api-key":apiKey,accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({
      sender:{email:senderEmail,name:senderName},
      to:[{email:booking.customer_email,name:booking.customer_name||"Gravity Arena Customer"}],
      subject:`Gravity Arena booking confirmed: ${booking.booking_reference}`,
      textContent:[
        `Hi ${booking.customer_name||"there"},`,"",
        "Your Gravity Arena booking is confirmed.",
        `Reference: ${booking.booking_reference}`,
        `Activity: ${booking.activity_name}`,
        `Date and time: ${booking.starts_at}`,
        `Guests: ${booking.guest_count}`,
      ].join("\n"),
      tags:["gravity-arena","booking-confirmation"],
    }),
    signal:AbortSignal.timeout(8000),
  });
  return response.ok;
}

function normalizedEmail(value="") {
  return String(value||"").trim().toLowerCase();
}

function bookingIdempotencyKey(message,context,slot) {
  return [
    "wa",String(message.from||"").replace(/\D/g,""),
    "slot",String(slot?.slot_id||""),
    "guests",String(context.guestCount||""),
    "email",normalizedEmail(context.email),
  ].join(":");
}

function assertPersistedConfirmedBooking(held,confirmed,context,slot) {
  const booking=confirmed?.booking;
  const reference=booking?.booking_reference;

  if (!booking || !reference || !/^GA-\d{8}-\d{6}$/.test(String(reference))) {
    throw new Error("BOOKING_PERSISTENCE_NOT_VERIFIED");
  }

  if (String(booking.status||"").toUpperCase()!=="CONFIRMED") {
    throw new Error("BOOKING_STATUS_NOT_CONFIRMED");
  }

  const expectedSlotId=Number(slot?.slot_id);
  const persistedSlotId=Number(booking?.slot_id);
  if (expectedSlotId>0 && persistedSlotId>0 && expectedSlotId!==persistedSlotId) {
    throw new Error("BOOKING_SLOT_MISMATCH");
  }

  const expectedGuests=Number(context?.guestCount);
  const persistedGuests=Number(booking?.guest_count);
  if (expectedGuests>0 && persistedGuests>0 && expectedGuests!==persistedGuests) {
    throw new Error("BOOKING_GUEST_COUNT_MISMATCH");
  }

  const expectedEmail=normalizedEmail(context?.email);
  const persistedEmail=normalizedEmail(booking?.customer_email);
  if (expectedEmail && persistedEmail && expectedEmail!==persistedEmail) {
    throw new Error("BOOKING_EMAIL_MISMATCH");
  }

  return booking;
}

async function confirmBooking(message,context,slot) {
  const idempotencyKey=bookingIdempotencyKey(message,context,slot);

  try {
    const held=await bookingRequest("/?action=booking-create",{
      method:"POST",
      body:JSON.stringify({
        wa_id:message.from,
        slot_id:Number(slot.slot_id),
        guest_count:context.guestCount,
        customer_name:context.customerName||message.displayName||"",
        customer_email:context.email,
        notes:"Created through Gravity Arena Hermes R1.4 conversational booking flow",
        idempotency_key:idempotencyKey,
      }),
    });

    if (!held?.booking_reference) {
      return [
        "I could not safely complete that booking because the booking record could not be verified.",
        "No confirmation has been issued.",
        "Please try again in a moment.",
      ].join("\n");
    }

    const confirmed=await bookingRequest("/?action=booking-confirm",{
      method:"POST",
      body:JSON.stringify({booking_reference:held.booking_reference}),
    });

    let booking;
    try {
      booking=assertPersistedConfirmedBooking(held,confirmed,context,slot);
    } catch (error) {
      console.error("Hermes R1.4 persistence verification failed",{
        error:error?.message||String(error),
        heldReference:held?.booking_reference||null,
        idempotencyKey,
      });
      return [
        "I could not safely verify that the booking was persisted, so I have not issued a confirmation.",
        "Please try again in a moment.",
      ].join("\n");
    }

    const emailSent=confirmed?.already_confirmed ? true : await sendConfirmationEmail(booking);

    return [
      "✅ Your Gravity Arena booking is confirmed.",
      `Reference: ${booking.booking_reference}`,
      `Activity: ${booking.activity_name||activityName(context.activityCode)}`,
      `Date and time: ${booking.starts_at}`,
      `Guests: ${booking.guest_count||context.guestCount}`,
      "",
      emailSent
        ? `A confirmation email has been sent to ${booking.customer_email||context.email}.`
        : "Your booking is confirmed, but I could not send the confirmation email. Your booking reference above is valid.",
    ].join("\n");
  } catch (error) {
    console.error("Hermes R1.4 booking create/confirm failed",{
      error:error?.message||String(error),
      slotId:slot?.slot_id||null,
      idempotencyKey,
    });
    return [
      "I could not safely complete the booking right now.",
      "No new confirmation has been issued.",
      "Please try again shortly.",
    ].join("\n");
  }
}

export async function handleConversationalBooking(message, history = []) {
  if (!bookingConfig()) return null;
  const text=message.text||"";

  if (isResetIntent(text)) {
    return "Absolutely — we can start over. Which Gravity Arena activity would you like to book?";
  }
  if (isOfferingsQuery(text)) return formatOfferings();

  const currentStartsBooking=isExplicitNewBookingStart(text)||hasBookingIntent(text)||Boolean(detectActivityCode(text));
  const currentContinuesBooking=currentHasBookingField(text);
  const context=deriveContext(message,history);

  if (!currentStartsBooking && !currentContinuesBooking) return null;
  if (isAffirmativeBookingReply(text) && !context.active) return null;
  if (!context.active) return null;

  console.log("Hermes booking context R1.4",{
    activityCode:context.activityCode,
    date:context.date,
    guestCount:context.guestCount,
    emailPresent:Boolean(context.email),
    customerNamePresent:Boolean(context.customerName),
    preferredPeriod:context.preferredPeriod,
    selectedTime:context.selectedTime,
    slotId:context.slotId,
    transactionBoundary:context.transactionBoundary,
  });

  if (!context.activityCode) return "Absolutely. Which Gravity Arena activity would you like to book?";
  if (!context.guestCount) return `Great — ${activityName(context.activityCode)}. How many guests will be attending?`;
  if (!context.date) return `Great — ${activityName(context.activityCode)} for ${context.guestCount} guests. What date would you like? You can say today, tomorrow, or use YYYY-MM-DD.`;

  const slots=await getAvailability(context);

  if (context.preferredPeriod && !context.selectedTime && !context.slotId) {
    return formatNaturalSlots(slots.filter((s)=>periodMatches(s.starts_at,context.preferredPeriod)),context);
  }

  let selectedSlot=null;
  if (context.slotId) selectedSlot=slots.find((s)=>Number(s.slot_id)===Number(context.slotId));
  if (!selectedSlot && context.selectedTime) {
    selectedSlot=slots.find((s)=>String(s.starts_at).slice(11,16)===context.selectedTime);
  }

  if (context.selectedTime || context.slotId) {
    if (!selectedSlot) {
      return ["That time is not currently available.","",formatNaturalSlots(slots,context)].join("\n");
    }

    if (!context.email) {
      return `Great — ${String(selectedSlot.starts_at).slice(11,16)} is available for ${context.guestCount} guests. Please send your name and email address for the booking confirmation.`;
    }

    // R1.4 COMMIT GATE:
    // Once the transaction has activity + guest count + date + selected inventory + email,
    // the deterministic booking engine owns the turn. Do not fall through to the LLM.
    return confirmBooking(message,context,selectedSlot);
  }

  return formatNaturalSlots(slots,context);
}

// Test-only exports: harmless in production and allow deterministic regression testing.
export const __test = {
  detectGuestCount,
  detectBookingDate,
  detectSelectedTime,
  deriveContext,
  bookingIdempotencyKey,
};
