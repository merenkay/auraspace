<?php
// AURA report read markers: one row per report whose reply the crew member has opened (routes/reportread.php).
declare(strict_types=1);

return [
    'tables' => [
        "CREATE TABLE IF NOT EXISTS report_reads (
            report_id BIGINT NOT NULL PRIMARY KEY,
            crew_id INT NOT NULL,
            user_id INT NULL,
            read_at DATETIME NOT NULL,
            INDEX idx_crew (crew_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ],
    // Account deletion and demo reset: the reports themselves are deleted by index.php; remove their read markers too.
    'purge' => function (PDO $pdo, int $crewId, int $userId): void {
        try {
            $pdo->prepare('DELETE FROM report_reads WHERE crew_id = ?')->execute([$crewId]);
        } catch (PDOException $e) {
            // Table not created yet (install.php not re-run): nothing to purge. Anything else is a real error.
            if (!in_array(sqlstate($e), ['42S02', '42S22'], true)) {
                throw $e;
            }
        }
    },
];
