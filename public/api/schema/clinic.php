<?php
// AURA clinic: one health profile per person (crew row) and their saved consultation results.
//   clinic_profiles      data = JSON {ageBand, conditions[], allergies[], medicines[], notes}, ids validated by routes/clinic.php
//   clinic_assessments   data = JSON {conditionName, strength, findings[{id, answer}], note}
declare(strict_types=1);

return [
    'tables' => [
        "CREATE TABLE IF NOT EXISTS clinic_profiles (
            crew_id INT NOT NULL PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME NOT NULL,
            updated_by INT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS clinic_assessments (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            crew_id INT NOT NULL,
            created_at DATETIME NOT NULL,
            context VARCHAR(8) NOT NULL,
            urgency VARCHAR(12) NOT NULL,
            condition_id VARCHAR(48) NULL,
            data TEXT NOT NULL,
            created_by INT NULL,
            INDEX idx_crew_created (crew_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ],
    // Account deletion and demo reset: remove this person's profile and saved assessments.
    'purge' => function (PDO $pdo, int $crewId, int $userId): void {
        foreach (['clinic_profiles', 'clinic_assessments'] as $table) {
            try {
                $pdo->prepare("DELETE FROM $table WHERE crew_id = ?")->execute([$crewId]);
            } catch (PDOException $e) {
                // Table not created yet (install.php not re-run): nothing to purge. Anything else is a real error.
                if ((string) $e->getCode() !== '42S02') {
                    throw $e;
                }
            }
        }
    },
];
