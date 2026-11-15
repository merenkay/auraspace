<?php
// Space weather: a shared cache of public NASA DONKI / NOAA SWPC feeds (no personal data) and a per-network hit counter.
//   spaceweather_cache   one row per feed: whitelisted JSON payload, when it was fetched, last attempt and its outcome
//   spaceweather_hits    requests per network per minute for rate limiting; the address is stored only as an HMAC,
//                        rows older than a day are deleted by the route
declare(strict_types=1);

return [
    'tables' => [
        "CREATE TABLE IF NOT EXISTS spaceweather_cache (
            source VARCHAR(24) NOT NULL PRIMARY KEY,
            payload MEDIUMTEXT NULL,
            bytes INT UNSIGNED NOT NULL DEFAULT 0,
            status VARCHAR(12) NOT NULL DEFAULT 'empty',
            error VARCHAR(200) NOT NULL DEFAULT '',
            fetched_at DATETIME NULL,
            attempt_at DATETIME NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS spaceweather_hits (
            ip_hash CHAR(64) NOT NULL,
            minute_at DATETIME NOT NULL,
            hits INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (ip_hash, minute_at),
            INDEX idx_minute (minute_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ],
    // Public data only: nothing belongs to a person, so account deletion and demo reset have nothing to remove here.
    'purge' => function (PDO $pdo, int $crewId, int $userId): void {
    },
];
