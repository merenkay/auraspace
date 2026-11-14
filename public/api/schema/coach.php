<?php
// AURA coach: one training profile per person (crew row) and their session log.
//   coach_profiles   data = JSON {focus[], confirmed, level, daysPerWeek, minutes, equipment[], limits[], startedAt, context},
//                    ids validated by routes/coach.php
//   coach_logs       one row per planned session and date; re-logging the same session replaces it
declare(strict_types=1);

return [
    'tables' => [
        "CREATE TABLE IF NOT EXISTS coach_profiles (
            crew_id INT NOT NULL PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME NOT NULL,
            updated_by INT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS coach_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            crew_id INT NOT NULL,
            session_date DATE NOT NULL,
            session_key VARCHAR(16) NOT NULL,
            minutes SMALLINT NOT NULL,
            effort TINYINT NOT NULL,
            pain TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            created_by INT NULL,
            UNIQUE KEY uq_crew_session (crew_id, session_date, session_key),
            INDEX idx_crew_created (crew_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ],
    // Account deletion and demo reset: remove this person's training profile and session log.
    'purge' => function (PDO $pdo, int $crewId, int $userId): void {
        foreach (['coach_profiles', 'coach_logs'] as $table) {
            try {
                $pdo->prepare("DELETE FROM $table WHERE crew_id = ?")->execute([$crewId]);
            } catch (PDOException $e) {
                // Table not created yet (install.php not re-run): nothing to purge. Anything else is a real error.
                if (!in_array(sqlstate($e), ['42S02', '42S22'], true)) {
                    throw $e;
                }
            }
        }
    },
];
