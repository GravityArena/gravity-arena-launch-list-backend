const ACTIVITY_ALIASES = [
  { code: "FPV_RACING", name: "FPV Drone Racing", terms: ["fpv", "fpv racing", "drone racing"] },
  { code: "VR_RACING", name: "VR Racing", terms: ["vr racing", "virtual reality racing"] },
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
    throw new Error(
      `Booking API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
  }

  return data;
}

function johannesburgDate(offsetDays = 0) {
  const now = new Date();
  const shifted = new Date(now.getTime() + offsetDays * 86400000);
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
  const normalized = text.toLowerCase();
  return ACTIVITY_ALIASES.find((activity) =>
    activity.terms.some((term) => normalized.includes(term))
  )?.code || null;
}

function activityName(code) {
  return ACTIVITY_ALIASES.find((activity) => activity.code === code)?.name || code;
}

function detectBookingDate(text = "") {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;

  const normalized = text.toLowerCase();
  if (normalized.includes("tomorrow")) return johannesburgDate(1);
  if (normalized.includes("today")) return johannesburgDate(0);
  return null;
}

function detectGuestCount(text = "") {
  const patterns = [
    /(\d{1,2})\s*(?:people|guests|persons|players|adults|kids|children)/i,
    /\bfor\s+(\d{1,2})\b/i,
  ];

  for (const pattern of patterns) {
    const value = Number(text.match(pattern)?.[1] || 0);
    if (value > 0 && value <= 100) return value;
  }

  return null;
}

function extractEmail(text = "") {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || null;
}

function detectPreferredPeriod(text = "") {
  const normalized = text.toLowerCase();
  if (/\bmorning\b/.test(normalized)) return "MORNING";
  if (/\bafternoon\b/.test(normalized)) return "AFTERNOON";
  if (/\bevening\b|\bnight\b/.test(normalized)) return "EVENING";
  return null;
}

function detectSelectedTime(text = "") {
  let match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) {
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  }

  match = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const meridiem = match[3].toLowerCase();

  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function detectSlotId(text = "") {
  const value = Number(text.match(/\bslot\s*#?\s*(\d+)\b/i)?.[1] || 0);
  return value > 0 ? value : null;
}

function hasBookingIntent(text = "") {
  return /\b(book|booking|reserve|reservation|available|availability|slot|time(?:s)? available)\b/i.test(text);
}

function isTerminalAssistantMessage(text = "") {
  return (
    /your gravity arena booking is confirmed/i.test(text) ||
    /your gravity arena booking has been cancelled/i.test(text) ||
    /\bstatus:\s*(?:cancelled|expired)\b/i.test(text)
  );
}

function activeHistory(history = []) {
  let terminalIndex = -1;

  history.forEach((item, index) => {
    if (item.role === "assistant" && isTerminalAssistantMessage(item.content)) {
      terminalIndex = index;
    }
  });

  return history.slice(terminalIndex + 1);
}

function deriveContext(message, history = []) {
  const active = activeHistory(history);
  const userTexts = active
    .filter((item) => item.role === "user")
    .map((item) => item.content);

  // History normally already includes the current inbound message.
  if (!userTexts.length || userTexts[userTexts.length - 1] !== message.text) {
    userTexts.push(message.text);
  }

  const context = {
    active: false,
    activityCode: null,
    date: null,
    guestCount: null,
    email: null,
    preferredPeriod: null,
    selectedTime: null,
    slotId: null,
  };

  for (const text of userTexts) {
    context.active =
      context.active ||
      hasBookingIntent(text) ||
      Boolean(detectActivityCode(text));

    context.activityCode = detectActivityCode(text) || context.activityCode;
    context.date = detectBookingDate(text) || context.date;
    context.guestCount = detectGuestCount(text) || context.guestCount;
    context.email = extractEmail(text) || context.email;
    context.preferredPeriod = detectPreferredPeriod(text) || context.preferredPeriod;
    context.selectedTime = detectSelectedTime(text) || context.selectedTime;
    context.slotId = detectSlotId(text) || context.slotId;
  }

  return context;
}

function periodMatches(startsAt, period) {
  if (!period) return true;
  const hour = Number(String(startsAt).slice(11, 13));

  if (period === "MORNING") return hour >= 6 && hour < 12;
  if (period === "AFTERNOON") return hour >= 12 && hour < 17;
  if (period === "EVENING") return hour >= 17 && hour <= 23;
  return true;
}

function timeMatches(startsAt, selectedTime) {
  return String(startsAt).slice(11, 16) === selectedTime;
}

function formatNaturalSlots(slots, { activityCode, date, guestCount, preferredPeriod }) {
  if (!slots.length) {
    const periodText = preferredPeriod ? ` in the ${preferredPeriod.toLowerCase()}` : "";
    return `I could not find an available ${activityName(activityCode)} slot${periodText} on ${date} for ${guestCount} guests. Would you like another date or time of day?`;
  }

  return [
    `${activityName(activityCode)} availability for ${guestCount} guests on ${date}:`,
    ...slots.slice(0, 8).map((slot) =>
      `• ${String(slot.starts_at).slice(11, 16)}–${String(slot.ends_at).slice(11, 16)} — ${slot.remaining_capacity} spaces remaining`
    ),
    "",
    slots.length === 1
      ? `Reply with the time (${String(slots[0].starts_at).slice(11, 16)}) if you would like this slot.`
      : "Which time would you prefer?",
  ].join("\n");
}

async function sendConfirmationEmail(booking) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena";

  if (!apiKey || !senderEmail || !booking?.customer_email) return false;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{
        email: booking.customer_email,
        name: booking.customer_name || "Gravity Arena Customer",
      }],
      subject: `Gravity Arena booking confirmed: ${booking.booking_reference}`,
      textContent: [
        `Hi ${booking.customer_name || "there"},`,
        "",
        "Your Gravity Arena booking is confirmed.",
        `Reference: ${booking.booking_reference}`,
        `Activity: ${booking.activity_name}`,
        `Date and time: ${booking.starts_at}`,
        `Guests: ${booking.guest_count}`,
        "",
        "Reply to our WhatsApp conversation if you need assistance.",
      ].join("\n"),
      tags: ["gravity-arena", "booking-confirmation"],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Booking confirmation email warning", {
      status: response.status,
      detail: detail.slice(0, 500),
    });
    return false;
  }

  return true;
}

async function getAvailability(context) {
  const params = new URLSearchParams({
    action: "availability",
    activity_code: context.activityCode,
    date: context.date,
    guest_count: String(context.guestCount),
  });

  const result = await bookingRequest(`/?${params.toString()}`, { method: "GET" });
  return Array.isArray(result?.slots) ? result.slots : [];
}

async function confirmBooking(message, context, selectedSlot) {
  const held = await bookingRequest("/?action=booking-create", {
    method: "POST",
    body: JSON.stringify({
      wa_id: message.from,
      slot_id: Number(selectedSlot.slot_id),
      guest_count: context.guestCount,
      customer_name: message.displayName || "",
      customer_email: context.email,
      notes: "Created through Gravity Arena conversational booking flow",
    }),
  });

  const confirmed = await bookingRequest("/?action=booking-confirm", {
    method: "POST",
    body: JSON.stringify({
      booking_reference: held.booking_reference,
    }),
  });

  const booking = confirmed.booking || {};
  const emailSent = await sendConfirmationEmail(booking);

  return [
    "✅ Your Gravity Arena booking is confirmed.",
    `Reference: ${booking.booking_reference || held.booking_reference}`,
    `Activity: ${booking.activity_name || held.activity_name || activityName(context.activityCode)}`,
    `Date and time: ${booking.starts_at || held.starts_at}`,
    `Guests: ${booking.guest_count || held.guest_count || context.guestCount}`,
    "",
    emailSent
      ? `A confirmation email has been sent to ${booking.customer_email || context.email}.`
      : "Your booking is confirmed, but I could not send the confirmation email. Your booking reference above is valid; the Gravity Arena team can resend the email if needed.",
  ].join("\n");
}

/**
 * Multi-turn deterministic booking flow.
 * Returns null when this is not an active booking conversation.
 */
export async function handleConversationalBooking(message, history = []) {
  if (!bookingConfig()) return null;

  const context = deriveContext(message, history);
  if (!context.active) return null;

  if (!context.activityCode) {
    return "Absolutely. Which Gravity Arena activity would you like to book?";
  }

  if (!context.guestCount) {
    return `Great — ${activityName(context.activityCode)}. How many guests will be attending?`;
  }

  if (!context.date) {
    return `Great — ${activityName(context.activityCode)} for ${context.guestCount} guests. What date would you like? You can say today, tomorrow, or use YYYY-MM-DD.`;
  }

  let slots = await getAvailability(context);

  if (context.preferredPeriod && !context.selectedTime && !context.slotId) {
    const periodSlots = slots.filter((slot) =>
      periodMatches(slot.starts_at, context.preferredPeriod)
    );

    return formatNaturalSlots(periodSlots, context);
  }

  let selectedSlot = null;

  if (context.slotId) {
    selectedSlot = slots.find((slot) => Number(slot.slot_id) === Number(context.slotId)) || null;
  } else if (context.selectedTime) {
    selectedSlot = slots.find((slot) => timeMatches(slot.starts_at, context.selectedTime)) || null;
  }

  if (context.selectedTime || context.slotId) {
    if (!selectedSlot) {
      return [
        `That time is not currently available for ${activityName(context.activityCode)} on ${context.date}.`,
        "",
        formatNaturalSlots(slots, context),
      ].join("\n");
    }

    if (!context.email) {
      return `Great — ${String(selectedSlot.starts_at).slice(11, 16)} is available for ${context.guestCount} guests. Please send the email address for the booking confirmation.`;
    }

    return confirmBooking(message, context, selectedSlot);
  }

  return formatNaturalSlots(slots, context);
}
