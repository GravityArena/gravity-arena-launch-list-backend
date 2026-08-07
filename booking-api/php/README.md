# Gravity Arena Booking API (Afrihost PHP)

Deploy the contents of this directory to the document root for `booking.gravityarena.co.za`.

## Required files

- `index.php`
- `.htaccess`
- `lib/auth.php`
- `lib/utils.php`
- `lib/activities.php`
- `lib/bookings.php`
- `config.php` created from `config.example.php`

Do not expose or commit the real `config.php`.

## Configuration

Copy `config.example.php` to `config.php` and set:

- database host, name, user and password
- a strong 64-character `api_key`
- hold duration and reminder hours

The `api_key` must exactly match Vercel `BOOKING_API_KEY`.

## Endpoints

Public health check:

- `GET /?action=health`

Protected endpoints using `Authorization: Bearer <BOOKING_API_KEY>`:

- `GET /?action=activities`
- `GET /?action=availability&activity_code=FPV_RACING&date=2026-08-15&guest_count=4`
- `POST /?action=booking-create`
- `GET /?action=booking-status&booking_reference=GA-20260807-123456`
- `POST /?action=booking-cancel`

## Example booking-create body

```json
{
  "wa_id": "27672748537",
  "slot_id": 1,
  "guest_count": 4,
  "customer_name": "Sibusiso",
  "customer_email": "customer@example.com",
  "notes": "WhatsApp booking test"
}
```

## Acceptance sequence

1. Upload the package and create `config.php`.
2. Confirm `GET /?action=health` returns `database: connected`.
3. Confirm `activities` returns the ten seeded activities.
4. Insert future rows into `activity_slots`.
5. Test availability for one activity and date.
6. Create a held booking and verify `bookings`, `booking_events` and `booking_reminders`.
7. Test status and cancellation.
8. Point Vercel `BOOKING_API_URL` to `https://booking.gravityarena.co.za` and redeploy Preview.
