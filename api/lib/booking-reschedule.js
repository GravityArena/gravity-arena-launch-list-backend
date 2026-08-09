function bookingConfig() {
  const baseUrl = process.env.BOOKING_API_URL?.trim()?.replace(/\/$/, "");
  const apiKey = process.env.BOOKING_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

function detectBookingReference(text = "") {
  return text.match(/\bGA-\d{8}-\d{6}\b/i)?.[0]?.toUpperCase() || null;
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
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const normalized = text.toLowerCase();
  if (normalized.includes("tomorrow")) return johannesburgDate(1);
  if (normalized.includes("today")) return johannesburgDate(0);
  return null;
}

function detectTargetTime(text = "") {
  let match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;

  match = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const meridiem = match[3].toLowerCase();
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function isRescheduleIntent(text = "") {
  return /\b(move|reschedule|change|shift)\b/i.test(text) &&
    /\b(booking|reservation|it|time|date)\b/i.test(text);
}

function isYes(text = "") {
  return /^(?:yes|yes please|confirm|confirmed|go ahead|do it|please do|okay|ok)$/i.test(text.trim());
}

function isNo(text = "") {
  return /^(?:no|no thanks|no thank you|cancel|stop|leave it|keep it)$/i.test(text.trim());
}

function latestPendingRequest(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.role !== "user") continue;

    const text = item.content || "";
    if (!isRescheduleIntent(text)) continue;

    const reference = detectBookingReference(text);
    const targetDate = detectTargetDate(text);
    const targetTime = detectTargetTime(text);

    if (targetDate && targetTime) {
      return { reference, targetDate, targetTime };
    }
  }
  return null;
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
  const response = await fetch(
    `${config.baseUrl}/booking-management.php?action=booking-lookup&wa_id=${encodeURIComponent(waId)}`,
    {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(8000),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Booking lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data.booking;
}

async function sendUpdatedEmail(booking) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Gravity Arena Hermes";

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
      subject: `Gravity Arena booking updated: ${booking.booking_reference}`,
      textContent: [
        `Hi ${booking.customer_name || "there"},`,
        "",
        "Your Gravity Arena booking has been rescheduled.",
        `Reference: ${booking.booking_reference}`,
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

  if (!response.ok) {
    console.error("Reschedule confirmation email warning", {
      status: response.status,
      detail: (await response.text()).slice(0, 500),
    });
    return false;
  }

  return true;
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

export async function handleBookingReschedule(message, history = []) {
  if (!bookingConfig()) return null;

  const current = message.text || "";
  const directIntent = isRescheduleIntent(current);

  if (directIntent) {
    let reference = detectBookingReference(current);
    const targetDate = detectTargetDate(current);
    const targetTime = detectTargetTime(current);

    if (!reference) {
      try {
        const booking = await lookupLatestBooking(message.from);
        reference = booking?.booking_reference || null;
      } catch (error) {
        if (error?.status === 404) {
          return "I could not find a booking linked to this WhatsApp number.";
        }
        throw error;
      }
    }

    if (!targetDate) {
      return `I found booking ${reference}. What date would you like to move it to?`;
    }

    if (!targetTime) {
      return `I found booking ${reference}. What time would you like on ${targetDate}?`;
    }

    try {
      const preview = await managementRequest("booking-reschedule-preview", {
        booking_reference: reference,
        wa_id: message.from,
        target_date: targetDate,
        target_time: targetTime,
      });

      return formatPreview(preview);
    } catch (error) {
      if (error?.status === 404) {
        return "I could not find that booking for this WhatsApp number.";
      }
      if (error?.status === 409) {
        if (error?.data?.remaining_capacity !== undefined) {
          return `That slot does not have enough capacity for your group. It currently has ${error.data.remaining_capacity} spaces available.`;
        }
        return "That requested slot is not available. Please choose another date or time.";
      }
      throw error;
    }
  }

  const pending = latestPendingRequest(history);
  if (!pending) return null;

  if (isNo(current)) {
    return "No problem — I have kept your existing booking unchanged.";
  }

  if (!isYes(current)) {
    return null;
  }

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

    const emailSent = await sendUpdatedEmail(booking);

    return [
      "✅ Your Gravity Arena booking has been rescheduled.",
      `Reference: ${booking.booking_reference}`,
      `Activity: ${booking.activity_name}`,
      `New date and time: ${booking.starts_at}`,
      `Guests: ${booking.guest_count}`,
      "",
      emailSent
        ? `An updated confirmation email has been sent to ${booking.customer_email}.`
        : "The booking was rescheduled successfully, but I could not send the updated confirmation email.",
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
