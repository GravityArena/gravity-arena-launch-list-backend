// Gravity Arena Booking Reschedule R1.1
// Natural-language intent + multi-turn state continuity + updated-email delivery hardening

function bookingConfig() {
  const baseUrl = process.env.BOOKING_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.BOOKING_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

function detectBookingReference(text = "") {
  return String(text).match(/\bGA-\d{8}-\d{6}\b/i)?.[0]?.toUpperCase() || null;
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

function detectTargetDate(text = "") {
  const value = String(text);
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;

  const normalized = value.toLowerCase();
  if (normalized.includes("tomorrow")) return johannesburgDate(1);
  if (normalized.includes("today")) return johannesburgDate(0);

  const monthMap = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
    august: 8, aug: 8, september: 9, sep: 9, sept: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  };

  let m = normalized.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(20\d{2})\b/i
  );
  if (m) {
    const day = Number(m[1]);
    const month = monthMap[m[2].toLowerCase()];
    const year = Number(m[3]);
    if (day >= 1 && day <= 31 && month) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  m = normalized.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

function detectTargetTime(text = "") {
  const value = String(text);

  let match = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) {
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  }

  match = value.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const meridiem = match[3].toLowerCase();

  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function isRescheduleIntent(text = "") {
  const value = String(text);

  const action =
    /\b(move|reschedule|change|shift|update|modify|amend)\b/i.test(value) ||
    /\bnew\s+(?:date|time|slot)\b/i.test(value);

  const object =
    /\b(booking|reservation|appointment|it|time|date|slot)\b/i.test(value) ||
    Boolean(detectBookingReference(value));

  return action && object;
}

function isYes(text = "") {
  return /^(?:yes|yes please|confirm|confirmed|go ahead|do it|please do|okay|ok|proceed)$/i.test(
    String(text).trim()
  );
}

function isNo(text = "") {
  return /^(?:no|no thanks|no thank you|cancel|stop|leave it|keep it|keep current booking)$/i.test(
    String(text).trim()
  );
}

function isTerminalRescheduleAssistantMessage(text = "") {
  const value = String(text);
  return (
    /booking has been rescheduled/i.test(value) ||
    /kept your existing booking unchanged/i.test(value) ||
    /already scheduled for/i.test(value)
  );
}

function findRescheduleBoundary(history = []) {
  let boundary = 0;

  history.forEach((item, index) => {
    if (item?.role !== "assistant") return;

    const text = String(item?.content || item?.text || "");
    if (isTerminalRescheduleAssistantMessage(text)) {
      boundary = index + 1;
    }
  });

  return boundary;
}

function derivePendingReschedule(history = [], currentText = "") {
  const boundary = findRescheduleBoundary(history);
  const active = history.slice(boundary);

  let intentIndex = -1;

  for (let i = active.length - 1; i >= 0; i--) {
    const item = active[i];
    if (item?.role !== "user") continue;

    const text = String(item?.content || item?.text || "");
    if (isRescheduleIntent(text)) {
      intentIndex = i;
      break;
    }
  }

  if (intentIndex < 0 && isRescheduleIntent(currentText)) {
    return {
      active: true,
      reference: detectBookingReference(currentText),
      targetDate: detectTargetDate(currentText),
      targetTime: detectTargetTime(currentText),
    };
  }

  if (intentIndex < 0) return null;

  const state = {
    active: true,
    reference: null,
    targetDate: null,
    targetTime: null,
  };

  const apply = (text = "") => {
    const reference = detectBookingReference(text);
    const targetDate = detectTargetDate(text);
    const targetTime = detectTargetTime(text);

    if (reference) state.reference = reference;
    if (targetDate) state.targetDate = targetDate;
    if (targetTime) state.targetTime = targetTime;
  };

  for (let i = intentIndex; i < active.length; i++) {
    const item = active[i];
    if (item?.role !== "user") continue;
    apply(String(item?.content || item?.text || ""));
  }

  const lastActiveUser = [...active].reverse().find((item) => item?.role === "user");
  const lastText = String(lastActiveUser?.content || lastActiveUser?.text || "");

  if (!lastActiveUser || lastText !== String(currentText)) {
    apply(currentText);
  }

  return state;
}

async function managementRequest(action, body) {
  const config = bookingConfig();
  if (!config) throw new Error("Booking API configuration is incomplete.");

  const response = await fetch(
    `${config.baseUrl}/booking-management.php?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      `Booking reschedule API failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function lookupLatestBooking(waId) {
  const config = bookingConfig();
  if (!config) throw new Error("Booking API configuration is incomplete.");

  const response = await fetch(
    `${config.baseUrl}/booking-management.php?action=booking-lookup&wa_id=${encodeURIComponent(waId)}`,
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(8000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      `Booking lookup failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data.booking;
}

async function sendUpdatedEmail(booking) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena";
  const recipientEmail = String(booking?.customer_email || "").trim().toLowerCase();
  const bookingReference = String(booking?.booking_reference || "").trim();

  if (!apiKey || !senderEmail || !recipientEmail) {
    console.error("Reschedule confirmation email skipped", {
      bookingReference: bookingReference || null,
      recipientDomain: recipientEmail.includes("@")
        ? recipientEmail.split("@")[1]
        : null,
      brevoConfigured: Boolean(apiKey),
      senderConfigured: Boolean(senderEmail),
      recipientPresent: Boolean(recipientEmail),
    });

    return {
      sent: false,
      status: null,
      messageId: null,
      reason: "CONFIG_OR_RECIPIENT_MISSING",
    };
  }

  let response;

  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: senderName,
        },
        to: [{
          email: recipientEmail,
          name: booking.customer_name || "Gravity Arena Customer",
        }],
        subject: `Gravity Arena booking updated: ${bookingReference}`,
        textContent: [
          `Hi ${booking.customer_name || "there"},`,
          "",
          "Your Gravity Arena booking has been rescheduled.",
          `Reference: ${bookingReference}`,
          `Activity: ${booking.activity_name}`,
          `New date and time: ${booking.starts_at}`,
          `Guests: ${booking.guest_count}`,
          "",
          "Reply to our WhatsApp conversation if you need assistance.",
        ].join("\n"),
        tags: ["gravity-arena", "booking-rescheduled"],
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error("Reschedule confirmation email request failed", {
      bookingReference: bookingReference || null,
      recipientDomain: recipientEmail.split("@")[1] || null,
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      sent: false,
      status: null,
      messageId: null,
      reason: "BREVO_REQUEST_FAILED",
    };
  }

  const data = await response.json().catch(() => ({}));
  const messageId = String(data?.messageId || data?.message_id || "").trim() || null;

  if (!response.ok) {
    console.error("Reschedule confirmation email failed", {
      bookingReference: bookingReference || null,
      recipientDomain: recipientEmail.split("@")[1] || null,
      status: response.status,
      error: JSON.stringify(data).slice(0, 500),
    });

    return {
      sent: false,
      status: response.status,
      messageId,
      reason: "BREVO_REJECTED",
    };
  }

  console.log("Reschedule confirmation email sent", {
    bookingReference: bookingReference || null,
    recipientDomain: recipientEmail.split("@")[1] || null,
    status: response.status,
    messageId,
  });

  return {
    sent: true,
    status: response.status,
    messageId,
    reason: null,
  };
}

function formatPreview(result) {
  const booking = result.booking;
  const target = result.target_slot;

  if (result.no_change) {
    return `Booking ${booking.booking_reference} is already scheduled for ${booking.starts_at}.`;
  }

  return [
    `${String(target.starts_at).slice(11, 16)}–${String(target.ends_at).slice(11, 16)} is available for ${booking.activity_name}.`,
    "",
    "Current booking:",
    `${booking.starts_at} — ${booking.guest_count} guests`,
    "",
    "Proposed new booking:",
    `${target.starts_at} — ${booking.guest_count} guests`,
    "",
    `Would you like me to reschedule ${booking.booking_reference} to this time?`,
    "Reply Yes to confirm or No to keep your current booking.",
  ].join("\n");
}

async function previewReschedule(message, state) {
  let reference = state.reference;

  if (!reference) {
    try {
      const booking = await lookupLatestBooking(message.from);
      reference = booking?.booking_reference || null;
    } catch (error) {
      if (error?.status === 404) {
        return {
          handled: true,
          reply: "I could not find a booking linked to this WhatsApp number.",
        };
      }
      throw error;
    }
  }

  if (!reference) {
    return {
      handled: true,
      reply: "I could not identify the booking to reschedule.",
    };
  }

  if (!state.targetDate) {
    return {
      handled: true,
      reply: `I found booking ${reference}. What date would you like to move it to?`,
    };
  }

  if (!state.targetTime) {
    return {
      handled: true,
      reply: `I found booking ${reference}. What time would you like on ${state.targetDate}?`,
    };
  }

  try {
    const preview = await managementRequest("booking-reschedule-preview", {
      booking_reference: reference,
      wa_id: message.from,
      target_date: state.targetDate,
      target_time: state.targetTime,
    });

    console.log("Hermes booking reschedule preview R1.1", {
      bookingReference: reference,
      targetDate: state.targetDate,
      targetTime: state.targetTime,
      noChange: Boolean(preview?.no_change),
    });

    return {
      handled: true,
      reply: formatPreview(preview),
    };
  } catch (error) {
    if (error?.status === 404) {
      return {
        handled: true,
        reply: "I could not find that booking for this WhatsApp number.",
      };
    }

    if (error?.status === 409) {
      if (error?.data?.remaining_capacity !== undefined) {
        return {
          handled: true,
          reply: `That slot does not have enough capacity for your group. It currently has ${error.data.remaining_capacity} spaces available.`,
        };
      }

      return {
        handled: true,
        reply: "That requested slot is not available. Please choose another date or time.",
      };
    }

    throw error;
  }
}

export async function handleBookingReschedule(message, history = []) {
  if (!bookingConfig()) return null;

  const current = String(message.text || "");
  const directIntent = isRescheduleIntent(current);
  const pending = derivePendingReschedule(history, current);

  if (!directIntent && !pending) return null;

  if (isNo(current) && pending) {
    return "No problem — I have kept your existing booking unchanged.";
  }

  if (isYes(current) && pending?.targetDate && pending?.targetTime) {
    let reference = pending.reference;

    if (!reference) {
      const booking = await lookupLatestBooking(message.from);
      reference = booking?.booking_reference || null;
    }

    if (!reference) {
      return "I could not identify the booking to reschedule.";
    }

    try {
      const result = await managementRequest("booking-reschedule-confirm", {
        booking_reference: reference,
        wa_id: message.from,
        target_date: pending.targetDate,
        target_time: pending.targetTime,
      });

      const booking = result.booking;

      if (result.already_rescheduled) {
        return `Booking ${reference} is already scheduled for ${booking.starts_at}.`;
      }

      const emailResult = await sendUpdatedEmail(booking);

      console.log("Hermes booking reschedule delivery R1.1", {
        bookingReference: booking.booking_reference,
        targetDate: pending.targetDate,
        targetTime: pending.targetTime,
        emailSent: Boolean(emailResult?.sent),
        emailStatus: emailResult?.status ?? null,
        emailMessageId: emailResult?.messageId ?? null,
        emailReason: emailResult?.reason ?? null,
      });

      return [
        "✅ Your Gravity Arena booking has been rescheduled.",
        `Reference: ${booking.booking_reference}`,
        `Activity: ${booking.activity_name}`,
        `New date and time: ${booking.starts_at}`,
        `Guests: ${booking.guest_count}`,
        "",
        emailResult?.sent
          ? `An updated confirmation email has been sent to ${booking.customer_email}.`
          : "The booking was rescheduled successfully, but the updated confirmation email could not be sent right now.",
      ].join("\n");
    } catch (error) {
      if (error?.status === 409) {
        return "That slot is no longer available. Your original booking has not been changed. Please choose another time.";
      }

      if (error?.status === 404) {
        return "I could not find that booking for this WhatsApp number.";
      }

      throw error;
    }
  }

  if (pending) {
    const preview = await previewReschedule(message, pending);
    return preview.reply;
  }

  return null;
}

export const __test = {
  detectBookingReference,
  detectTargetDate,
  detectTargetTime,
  isRescheduleIntent,
  derivePendingReschedule,
};
