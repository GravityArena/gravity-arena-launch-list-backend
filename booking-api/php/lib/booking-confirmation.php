<?php
declare(strict_types=1);

function confirmBooking(PDO $pdo): never
{
    $body = getJsonBody();
    $reference = strtoupper(requireString($body, 'booking_reference', 32));

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'SELECT b.id, b.status, b.hold_expires_at, b.booking_reference,
                    b.wa_id, b.customer_name, b.customer_email, b.guest_count,
                    a.code AS activity_code, a.name AS activity_name,
                    s.starts_at, s.ends_at
             FROM bookings b
             INNER JOIN activities a ON a.id = b.activity_id
             INNER JOIN activity_slots s ON s.id = b.slot_id
             WHERE b.booking_reference = :reference
             FOR UPDATE'
        );
        $statement->execute([':reference' => $reference]);
        $booking = $statement->fetch();

        if (!$booking) {
            $pdo->rollBack();
            respond(404, ['ok' => false, 'error' => 'Booking not found.']);
        }

        if ($booking['status'] === 'CONFIRMED') {
            $pdo->rollBack();
            respond(200, ['ok' => true, 'booking' => $booking]);
        }

        if ($booking['status'] !== 'HELD') {
            $pdo->rollBack();
            respond(409, ['ok' => false, 'error' => 'Only HELD bookings can be confirmed.']);
        }

        if ($booking['hold_expires_at'] !== null && strtotime((string)$booking['hold_expires_at']) < time()) {
            $pdo->rollBack();
            respond(409, ['ok' => false, 'error' => 'Booking hold has expired.']);
        }

        $update = $pdo->prepare(
            'UPDATE bookings
             SET status = "CONFIRMED", hold_expires_at = NULL
             WHERE id = :booking_id'
        );
        $update->execute([':booking_id' => $booking['id']]);

        $event = $pdo->prepare(
            'INSERT INTO booking_events (booking_id, event_type, actor, details_json)
             VALUES (:booking_id, "BOOKING_CONFIRMED", "HERMES", :details_json)'
        );
        $event->execute([
            ':booking_id' => $booking['id'],
            ':details_json' => json_encode(['confirmed_at' => date('c')]),
        ]);

        $pdo->commit();
        $booking['status'] = 'CONFIRMED';
        $booking['hold_expires_at'] = null;
        respond(200, ['ok' => true, 'booking' => $booking]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('Booking confirmation failed: ' . $error->getMessage());
        respond(500, ['ok' => false, 'error' => 'Booking could not be confirmed.']);
    }
}
