<?php
declare(strict_types=1);

function createBooking(PDO $pdo, array $config): never
{
    $body = getJsonBody();
    $waId = normalizeWaId((string)($body['wa_id'] ?? ''));
    $slotId = (int)($body['slot_id'] ?? 0);
    $guestCount = (int)($body['guest_count'] ?? 0);
    $customerName = trim((string)($body['customer_name'] ?? ''));
    $customerEmail = strtolower(trim((string)($body['customer_email'] ?? '')));
    $notes = trim((string)($body['notes'] ?? ''));

    if ($slotId < 1 || $guestCount < 1) {
        respond(422, ['ok' => false, 'error' => 'slot_id and guest_count are required.']);
    }
    if ($customerEmail !== '' && !filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        respond(422, ['ok' => false, 'error' => 'customer_email is invalid.']);
    }

    $pdo->beginTransaction();
    try {
        $slotStatement = $pdo->prepare(
            'SELECT s.id, s.activity_id, s.starts_at, s.ends_at, s.status,
                    a.code AS activity_code, a.name AS activity_name,
                    COALESCE(s.capacity_override, a.capacity) AS capacity
             FROM activity_slots s
             INNER JOIN activities a ON a.id = s.activity_id
             WHERE s.id = :slot_id AND a.active = 1
             FOR UPDATE'
        );
        $slotStatement->execute([':slot_id' => $slotId]);
        $slot = $slotStatement->fetch();

        if (!$slot || $slot['status'] !== 'OPEN') {
            $pdo->rollBack();
            respond(409, ['ok' => false, 'error' => 'Selected slot is not available.']);
        }

        $reservedStatement = $pdo->prepare(
            'SELECT COALESCE(SUM(guest_count), 0)
             FROM bookings
             WHERE slot_id = :slot_id
               AND status IN ("HELD", "CONFIRMED")
               AND (hold_expires_at IS NULL OR hold_expires_at > NOW())'
        );
        $reservedStatement->execute([':slot_id' => $slotId]);
        $reserved = (int)$reservedStatement->fetchColumn();
        $remaining = (int)$slot['capacity'] - $reserved;

        if ($guestCount > $remaining) {
            $pdo->rollBack();
            respond(409, [
                'ok' => false,
                'error' => 'Not enough capacity for this booking.',
                'remaining_capacity' => max(0, $remaining),
            ]);
        }

        $reference = generateBookingReference($pdo);
        $holdMinutes = max(1, (int)($config['booking']['hold_minutes'] ?? 15));
        $holdExpiresAt = (new DateTimeImmutable("+$holdMinutes minutes"))->format('Y-m-d H:i:s');

        $insert = $pdo->prepare(
            'INSERT INTO bookings (
                booking_reference, wa_id, customer_name, customer_email,
                activity_id, slot_id, guest_count, status, source,
                notes, hold_expires_at
             ) VALUES (
                :reference, :wa_id, NULLIF(:customer_name, ""),
                NULLIF(:customer_email, ""), :activity_id, :slot_id,
                :guest_count, "HELD", "WHATSAPP", NULLIF(:notes, ""),
                :hold_expires_at
             )'
        );
        $insert->execute([
            ':reference' => $reference,
            ':wa_id' => $waId,
            ':customer_name' => $customerName,
            ':customer_email' => $customerEmail,
            ':activity_id' => $slot['activity_id'],
            ':slot_id' => $slotId,
            ':guest_count' => $guestCount,
            ':notes' => $notes,
            ':hold_expires_at' => $holdExpiresAt,
        ]);

        $bookingId = (int)$pdo->lastInsertId();
        $event = $pdo->prepare(
            'INSERT INTO booking_events (booking_id, event_type, actor, details_json)
             VALUES (:booking_id, "BOOKING_HELD", "HERMES", :details_json)'
        );
        $event->execute([
            ':booking_id' => $bookingId,
            ':details_json' => json_encode(['hold_expires_at' => $holdExpiresAt]),
        ]);

        foreach ((array)($config['booking']['reminder_hours'] ?? [24, 2]) as $hours) {
            $scheduled = (new DateTimeImmutable($slot['starts_at']))
                ->modify('-' . max(1, (int)$hours) . ' hours');
            if ($scheduled > new DateTimeImmutable()) {
                $reminder = $pdo->prepare(
                    'INSERT INTO booking_reminders (booking_id, channel, scheduled_for)
                     VALUES (:booking_id, "WHATSAPP", :scheduled_for)'
                );
                $reminder->execute([
                    ':booking_id' => $bookingId,
                    ':scheduled_for' => $scheduled->format('Y-m-d H:i:s'),
                ]);
            }
        }

        $pdo->commit();
        respond(201, [
            'ok' => true,
            'booking_id' => $bookingId,
            'booking_reference' => $reference,
            'status' => 'HELD',
            'hold_expires_at' => $holdExpiresAt,
            'activity_code' => $slot['activity_code'],
            'activity_name' => $slot['activity_name'],
            'starts_at' => $slot['starts_at'],
            'ends_at' => $slot['ends_at'],
            'guest_count' => $guestCount,
        ]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('Booking creation failed: ' . $error->getMessage());
        respond(500, ['ok' => false, 'error' => 'Booking could not be created.']);
    }
}

function getBookingStatus(PDO $pdo): never
{
    $reference = strtoupper(trim((string)($_GET['booking_reference'] ?? '')));
    if ($reference === '') {
        respond(422, ['ok' => false, 'error' => 'booking_reference is required.']);
    }

    $statement = $pdo->prepare(
        'SELECT b.booking_reference, b.wa_id, b.customer_name, b.customer_email,
                b.guest_count, b.status, b.source, b.notes, b.hold_expires_at,
                a.code AS activity_code, a.name AS activity_name,
                s.starts_at, s.ends_at
         FROM bookings b
         INNER JOIN activities a ON a.id = b.activity_id
         INNER JOIN activity_slots s ON s.id = b.slot_id
         WHERE b.booking_reference = :reference
         LIMIT 1'
    );
    $statement->execute([':reference' => $reference]);
    $booking = $statement->fetch();

    if (!$booking) {
        respond(404, ['ok' => false, 'error' => 'Booking not found.']);
    }
    respond(200, ['ok' => true, 'booking' => $booking]);
}

function cancelBooking(PDO $pdo): never
{
    $body = getJsonBody();
    $reference = strtoupper(requireString($body, 'booking_reference', 32));
    $reason = trim((string)($body['reason'] ?? 'Customer requested cancellation'));

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'SELECT id, status FROM bookings
             WHERE booking_reference = :reference FOR UPDATE'
        );
        $statement->execute([':reference' => $reference]);
        $booking = $statement->fetch();
        if (!$booking) {
            $pdo->rollBack();
            respond(404, ['ok' => false, 'error' => 'Booking not found.']);
        }
        if ($booking['status'] === 'CANCELLED') {
            $pdo->rollBack();
            respond(200, ['ok' => true, 'booking_reference' => $reference, 'status' => 'CANCELLED']);
        }

        $update = $pdo->prepare(
            'UPDATE bookings SET status = "CANCELLED", hold_expires_at = NULL
             WHERE id = :booking_id'
        );
        $update->execute([':booking_id' => $booking['id']]);

        $event = $pdo->prepare(
            'INSERT INTO booking_events (booking_id, event_type, actor, details_json)
             VALUES (:booking_id, "BOOKING_CANCELLED", "HERMES", :details_json)'
        );
        $event->execute([
            ':booking_id' => $booking['id'],
            ':details_json' => json_encode(['reason' => $reason]),
        ]);

        $cancelReminders = $pdo->prepare(
            'UPDATE booking_reminders SET status = "CANCELLED"
             WHERE booking_id = :booking_id AND status = "PENDING"'
        );
        $cancelReminders->execute([':booking_id' => $booking['id']]);

        $pdo->commit();
        respond(200, ['ok' => true, 'booking_reference' => $reference, 'status' => 'CANCELLED']);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('Booking cancellation failed: ' . $error->getMessage());
        respond(500, ['ok' => false, 'error' => 'Booking could not be cancelled.']);
    }
}
