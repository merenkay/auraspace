<?php
// Environment station (Arduino temperature / humidity / flammable gas): 10-second averaged rows.
//   station   'mission' = the shared demo-mission cabin (demo crew + staff)
//             'm<crewId>' = a registered member's private station (crew_id set, used by purge)
//   gas_*     raw ADC values (uncalibrated, not ppm); gas_base = the user's clean-air baseline at that time
declare(strict_types=1);

return [
    'tables' => [
        "CREATE TABLE IF NOT EXISTS env_readings (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            station VARCHAR(24) NOT NULL,
            crew_id INT NULL,
            measured_at DATETIME NOT NULL,
            temp_c DECIMAL(5,2) NULL,
            rh_pct DECIMAL(5,2) NULL,
            gas_raw DECIMAL(6,1) NULL,
            gas_max SMALLINT UNSIGNED NULL,
            gas_base SMALLINT UNSIGNED NULL,
            samples SMALLINT UNSIGNED NOT NULL DEFAULT 1,
            device VARCHAR(40) NOT NULL DEFAULT '',
            uploaded_by INT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_station_time (station, measured_at),
            INDEX idx_crew (crew_id),
            INDEX idx_uploader_created (uploaded_by, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ],
    // Account deletion: the member's private station. Demo reset (crew row with owner_user_id NULL): the shared mission station.
    'purge' => function (PDO $pdo, int $crewId, int $userId): void {
        try {
            $pdo->prepare('DELETE FROM env_readings WHERE crew_id = ?')->execute([$crewId]);
            $st = $pdo->prepare('SELECT owner_user_id FROM crew WHERE id = ?');
            $st->execute([$crewId]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if ($row !== false && $row['owner_user_id'] === null) {
                $pdo->prepare('DELETE FROM env_readings WHERE station = ?')->execute(['mission']);
            }
        } catch (PDOException $e) {
            // Table not created yet (install.php not re-run): nothing to purge. Anything else is a real error.
            if ((string) $e->getCode() !== '42S02') {
                throw $e;
            }
        }
    },
];
