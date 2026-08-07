<?php
declare(strict_types=1);

function listActivities(PDO $pdo): never
{
    $statement = $pdo->query(
        'SELECT id, code, name, description, duration_minutes, booking_buffer_minutes,
                capacity, price_cents, currency, minimum_age, equipment_required,
                staff_required, colour, icon
         FROM activities
         WHERE active = 1
         ORDER BY name'
    );

    respond(200, ['ok' => true, 'activities' => $statement->fetchAll()]);
}

function listAvailability(PDO $pdo): never
{
    $activityCode = strtoupper(trim((string)($_GET['activity_code'] ?? '')));
    $date = trim((string)($_GET['date'] ?? ''));
    $guestCount = max(1, (int)($_GET['guest_count'] ?? 1));

    if ($activityCode === '') {
        respond(422, ['ok' => false, 'error' => 'activity_code is required.']);
    }
    if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        respond(422, ['ok' => false, 'error' => 'date must use YYYY-MM-DD.']);
    }

    $sql = 'SELECT
                s.id AS slot_id,
                a.code AS activity_code,
                a.name AS activity_name,
                s.starts_at,
                s.ends_at,
                COALESCE(s.capacity_override, a.capacity) AS capacity,
                COALESCE(SUM(CASE
                    WHEN b.status IN ("HELD", "CONFIRMED")
                     AND (b.hold_expires_at IS NULL OR b.hold_expires_at > NOW())
                    THEN b.guest_count ELSE 0 END), 0) AS reserved_guests
            FROM activity_slots s
            INNER JOIN activities a ON a.id = s.activity_id
            LEFT JOIN bookings b ON b.slot_id = s.id
            WHERE a.code = :activity_code
              AND a.active = 1
              AND s.status = "OPEN"
              AND s.starts_at >= NOW()';

    if ($date !== '') {
        $sql .= ' AND DATE(s.starts_at) = :booking_date';
    }

    $sql .= ' GROUP BY s.id, a.code, a.name, s.starts_at, s.ends_at,
                      COALESCE(s.capacity_override, a.capacity)
              HAVING (capacity - reserved_guests) >= :guest_count
              ORDER BY s.starts_at
              LIMIT 50';

    $statement = $pdo->prepare($sql);
    $statement->bindValue(':activity_code', $activityCode);
    if ($date !== '') {
        $statement->bindValue(':booking_date', $date);
    }
    $statement->bindValue(':guest_count', $guestCount, PDO::PARAM_INT);
    $statement->execute();

    $slots = array_map(static function (array $row): array {
        $row['slot_id'] = (int)$row['slot_id'];
        $row['capacity'] = (int)$row['capacity'];
        $row['reserved_guests'] = (int)$row['reserved_guests'];
        $row['remaining_capacity'] = $row['capacity'] - $row['reserved_guests'];
        return $row;
    }, $statement->fetchAll());

    respond(200, ['ok' => true, 'slots' => $slots]);
}
