-- Gravity Arena Booking API - controlled FPV test slots
-- Safe to re-run because activity_slots has a unique key on (activity_id, starts_at).

INSERT INTO activity_slots (activity_id, starts_at, ends_at, status)
SELECT id, '2026-08-08 10:00:00', '2026-08-08 11:00:00', 'OPEN'
FROM activities WHERE code = 'FPV_RACING'
ON DUPLICATE KEY UPDATE ends_at = VALUES(ends_at), status = 'OPEN';

INSERT INTO activity_slots (activity_id, starts_at, ends_at, status)
SELECT id, '2026-08-08 12:00:00', '2026-08-08 13:00:00', 'OPEN'
FROM activities WHERE code = 'FPV_RACING'
ON DUPLICATE KEY UPDATE ends_at = VALUES(ends_at), status = 'OPEN';

INSERT INTO activity_slots (activity_id, starts_at, ends_at, status)
SELECT id, '2026-08-08 14:00:00', '2026-08-08 15:00:00', 'OPEN'
FROM activities WHERE code = 'FPV_RACING'
ON DUPLICATE KEY UPDATE ends_at = VALUES(ends_at), status = 'OPEN';

INSERT INTO activity_slots (activity_id, starts_at, ends_at, status)
SELECT id, '2026-08-08 16:00:00', '2026-08-08 17:00:00', 'OPEN'
FROM activities WHERE code = 'FPV_RACING'
ON DUPLICATE KEY UPDATE ends_at = VALUES(ends_at), status = 'OPEN';

SELECT s.id AS slot_id, a.code, a.name, s.starts_at, s.ends_at, s.status,
       COALESCE(s.capacity_override, a.capacity) AS capacity
FROM activity_slots s
JOIN activities a ON a.id = s.activity_id
WHERE a.code = 'FPV_RACING'
  AND DATE(s.starts_at) = '2026-08-08'
ORDER BY s.starts_at;
