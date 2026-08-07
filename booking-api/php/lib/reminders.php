<?php
declare(strict_types=1);

function listDueReminders(PDO $pdo): never
{
    $limit = max(1, min(100, (int)($_GET['limit'] ?? 25)));

    $sql = 'SELECT
                r.id AS reminder_id,
                r.channel,
                r.scheduled_for,
                b.id AS booking_id,
                b.booking_reference,
                b.wa_id,
                b.customer_name,
                b.customer_email,
                b.guest_count,
                b.status AS booking_status,
                a.code AS activity_code,
                a.name AS activity_name,
                s.starts_at,
                s.ends_at
            FROM booking_reminders r
            INNER JOIN bookings b ON b.id = r.booking_id
            INNER JOIN activities a ON a.id = b.activity_id
            INNER JOIN activity_slots s ON s.id = b.slot_id
            WHERE r.status = "PENDING"
              AND r.channel = "WHATSAPP"
              AND r.scheduled_for <= NOW()
              AND b.status IN ("HELD", "CONFIRMED")
            ORDER BY r.scheduled_for ASC
            LIMIT ' . $limit;

    $statement = $pdo->query($sql);
    respond(200, ['ok' => true, 'reminders' => $statement->fetchAll()]);
}

function markReminderSent(PDO $pdo): never
{
    $body = getJsonBody();
    $reminderId = (int)($body['reminder_id'] ?? 0);
    if ($reminderId < 1) {
        respond(422, ['ok' => false, 'error' => 'reminder_id is required.']);
    }

    $statement = $pdo->prepare(
        'UPDATE booking_reminders
         SET status = "SENT", sent_at = NOW(), failure_reason = NULL
         WHERE id = :id AND status = "PENDING"'
    );
    $statement->execute([':id' => $reminderId]);

    respond(200, [
        'ok' => true,
        'reminder_id' => $reminderId,
        'status' => 'SENT',
        'updated' => $statement->rowCount() > 0,
    ]);
}

function markReminderFailed(PDO $pdo): never
{
    $body = getJsonBody();
    $reminderId = (int)($body['reminder_id'] ?? 0);
    $reason = trim((string)($body['failure_reason'] ?? 'Reminder delivery failed'));
    if ($reminderId < 1) {
        respond(422, ['ok' => false, 'error' => 'reminder_id is required.']);
    }

    $statement = $pdo->prepare(
        'UPDATE booking_reminders
         SET status = "FAILED", failure_reason = :reason
         WHERE id = :id AND status = "PENDING"'
    );
    $statement->execute([
        ':id' => $reminderId,
        ':reason' => substr($reason, 0, 500),
    ]);

    respond(200, [
        'ok' => true,
        'reminder_id' => $reminderId,
        'status' => 'FAILED',
        'updated' => $statement->rowCount() > 0,
    ]);
}
