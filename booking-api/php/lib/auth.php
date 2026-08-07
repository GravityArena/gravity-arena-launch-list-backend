<?php
declare(strict_types=1);

function getBearerToken(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';

    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp((string)$name, 'Authorization') === 0) {
                $header = (string)$value;
                break;
            }
        }
    }

    return preg_match('/^Bearer\s+(.+)$/i', trim($header), $matches)
        ? trim($matches[1])
        : null;
}

function requireApiAuthentication(array $config): void
{
    $expected = trim((string)($config['api_key'] ?? ''));
    $provided = getBearerToken();

    if ($expected === '' || $provided === null || !hash_equals($expected, $provided)) {
        respond(401, ['ok' => false, 'error' => 'Unauthorized.']);
    }
}
