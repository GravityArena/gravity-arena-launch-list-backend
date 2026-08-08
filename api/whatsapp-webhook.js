// PHASE 3C.1 PATCH FOR api/whatsapp-webhook.js
// Add these helpers near the existing booking helpers.

function detectBookingReference(text) {
  return text.match(/\bGA-\d{8}-\d{6}\b/i)?.[0]?.toUpperCase() || null;
}

function isBookingLookupIntent(text) {
  return /\b(my booking|show (?:me )?my booking|booking details|what time is my booking|when is my booking|booking status)\b/i.test(text);
}

function isBookingCancellationIntent(text) {
  return /\b(cancel|cancelled|cancellation)\b/i.test(text) &&
    /\b(booking|reservation|reference)\b/i.test(text);
}

async function bookingManagementRequest(path, options = {}) {
  const config = getBookingConfig();
  if (!config) throw new Error("Booking API configuration is incomplete.");

  const response = await fetch(`${config.baseUrl}/booking-management.php${path}`, {
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
    const error = new Error(
      `Booking management failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

function formatBookingDetails(booking) {
  return [
    "Here are your Gravity Arena booking details:",
    `Reference: ${booking.booking_reference}`,
    `Status: ${booking.status}`,
    `Activity: ${booking.activity_name}`,
    `Date and time: ${booking.starts_at}`,
    `Guests: ${booking.guest_count}`,
  ].join("\n");
}

async function handleBookingManagementMessage(message) {
  if (!getBookingConfig()) return null;

  const bookingReference = detectBookingReference(message.text);

  if (isBookingCancellationIntent(message.text)) {
    let reference = bookingReference;

    if (!reference) {
      try {
        const lookup = await bookingManagementRequest(
          `?action=booking-lookup&wa_id=${encodeURIComponent(message.from)}`,
          { method: "GET" }
        );
        reference = lookup?.booking?.booking_reference || null;
      } catch (error) {
        if (error?.status === 404) return "I could not find an active booking linked to this WhatsApp number.";
        throw error;
      }
    }

    if (!reference) {
      return "Please send the booking reference you would like to cancel.";
    }

    try {
      const result = await bookingManagementRequest("?action=booking-cancel", {
        method: "POST",
        body: JSON.stringify({
          booking_reference: reference,
          wa_id: message.from,
          actor: "HERMES",
          reason: "Customer requested cancellation through WhatsApp",
        }),
      });

      if (result.already_cancelled) {
        return `Booking ${reference} is already cancelled.`;
      }

      return [
        "✅ Your Gravity Arena booking has been cancelled.",
        `Reference: ${result.booking?.booking_reference || reference}`,
        `Activity: ${result.booking?.activity_name || "Gravity Arena activity"}`,
        `Original date and time: ${result.booking?.starts_at || "Not available"}`,
        "",
        "The released space is now available for another booking.",
      ].join("\n");
    } catch (error) {
      if (error?.status === 404) return "I could not find that booking for this WhatsApp number.";
      if (error?.status === 409) return "That booking can no longer be cancelled automatically. I can connect you with the Gravity Arena team for assistance.";
      throw error;
    }
  }

  if (isBookingLookupIntent(message.text) || bookingReference) {
    const params = bookingReference
      ? `?action=booking-lookup&booking_reference=${encodeURIComponent(bookingReference)}&wa_id=${encodeURIComponent(message.from)}`
      : `?action=booking-lookup&wa_id=${encodeURIComponent(message.from)}`;

    try {
      const result = await bookingManagementRequest(params, { method: "GET" });
      return formatBookingDetails(result.booking);
    } catch (error) {
      if (error?.status === 404) return "I could not find a booking linked to this WhatsApp number.";
      throw error;
    }
  }

  return null;
}

// Then, inside the per-message processing flow, call this BEFORE handleBookingMessage(message):
//
// const bookingManagementReply = await handleBookingManagementMessage(message);
// const bookingReply = bookingManagementReply || await handleBookingMessage(message);
//
// Continue using bookingReply exactly as the existing webhook does.
