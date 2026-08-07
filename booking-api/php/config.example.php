<?php
declare(strict_types=1);

return [
    'api_key' => 'replace-with-the-same-value-as-BOOKING_API_KEY-in-vercel',
    'timezone' => 'Africa/Johannesburg',
    'database' => [
        'host' => 'localhost',
        'name' => 'gravitu9f0m0_ga_memory',
        'user' => 'gravitu9f0m0_ga_memory',
        'password' => 'replace-with-database-password',
        'charset' => 'utf8mb4',
    ],
    'booking' => [
        'hold_minutes' => 15,
        'reminder_hours' => [24, 2],
    ],
];
