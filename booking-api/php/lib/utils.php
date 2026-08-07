<?php
declare(strict_types=1);

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function getJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        respond(400, ['ok' => false, 'error' => 'Invalid JSON body.']);
    }

    return $decoded;
}

function normalizeWaId(string $value): string
{
    $normalized = preg_replace('/\D+/', '', $value) ?? '';
    if ($normalized === '' || strlen($normalized) < 8 || strlen($normalized) > 20) {
        respond(422, ['ok' => false, 'error' => 'A valid wa_id is required.']);
    }
    return $normalized;
}

function requireString(array $body, string $field, int $maxLength = 255): string
{
    $value = trim((string)($body[$field] ?? ''));
    if ($value === '') {
        respond(422, ['ok' => false, 'error' => "$field is required."]);
    }
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength, 'UTF-8')
        : substr($value, 0, $maxLength);
}

function generateBookingReference(PDO $pdo): string
{
    for ($attempt = 0; $attempt < 5; $attempt++) {
        $reference = sprintf(
            'GA-%s-%06d',
            date('Ymd'),
            random_int(0, 999999)
        );

        $statement = $pdo->prepare('SELECT 1 FROM bookings WHERE booking_reference = :reference LIMIT 1');
        $statement->execute([':reference' => $reference]);
        if (!$statement->fetchColumn()) {
            return $reference;
        }
    }

    throw new RuntimeException('Could not generate a unique booking reference.');
}
