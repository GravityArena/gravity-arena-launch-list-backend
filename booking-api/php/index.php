<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/lib/utils.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/activities.php';
require_once __DIR__ . '/lib/bookings.php';

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    respond(503, ['ok' => false, 'error' => 'Booking API configuration is missing.']);
}

$config = require $configPath;
date_default_timezone_set((string)($config['timezone'] ?? 'Africa/Johannesburg'));

try {
    $database = $config['database'] ?? [];
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        $database['host'] ?? 'localhost',
        $database['name'] ?? '',
        $database['charset'] ?? 'utf8mb4'
    );

    $pdo = new PDO(
        $dsn,
        (string)($database['user'] ?? ''),
        (string)($database['password'] ?? ''),
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (Throwable $error) {
    error_log('Booking API database connection failed: ' . $error->getMessage());
    respond(503, ['ok' => false, 'error' => 'Database unavailable.']);
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$action = strtolower(trim((string)($_GET['action'] ?? 'health')));

if ($method === 'GET' && $action === 'health') {
    respond(200, [
        'ok' => true,
        'service' => 'gravity-arena-booking-api',
        'database' => 'connected',
        'timezone' => date_default_timezone_get(),
    ]);
}

requireApiAuthentication($config);

if ($method === 'GET' && $action === 'activities') {
    listActivities($pdo);
}
if ($method === 'GET' && $action === 'availability') {
    listAvailability($pdo);
}
if ($method === 'POST' && $action === 'booking-create') {
    createBooking($pdo, $config);
}
if ($method === 'GET' && $action === 'booking-status') {
    getBookingStatus($pdo);
}
if ($method === 'POST' && $action === 'booking-cancel') {
    cancelBooking($pdo);
}

respond(404, ['ok' => false, 'error' => 'Endpoint not found.']);
