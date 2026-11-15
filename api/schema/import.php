<?php
// Device-export imports (Samsung Health): dedupe index for imported daily values.
// The values themselves live in the core `measurements` table (source 'device'); this table remembers which
// person + metric + local day + device has already been imported, so re-importing never creates duplicates.
declare(strict_types=1);

return [
    'tables' => [
        "CREATE TABLE IF NOT EXISTS import_keys (
            crew_id INT NOT NULL, metric VARCHAR(16) NOT NULL, local_date DATE NOT NULL, device VARCHAR(60) NOT NULL,
            measurement_id BIGINT NOT NULL, imported_at DATETIME NOT NULL,
            PRIMARY KEY (crew_id, metric, local_date, device), INDEX idx_measurement (measurement_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ],
    // account deletion and demo reset already delete the person's measurements; drop their import keys too
    'purge' => function (PDO $pdo, int $crewId, int $userId): void {
        $pdo->prepare('DELETE FROM import_keys WHERE crew_id = ?')->execute([$crewId]);
    },
];
