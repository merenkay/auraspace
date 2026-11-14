<?php
// Device-export imports (Samsung Health "Download personal data").
// The export is parsed in the browser; only one value per metric per local day arrives here.
// Rows go into the core `measurements` table with source 'device'; `import_keys` (schema/import.php)
// makes re-imports idempotent: person + metric + local day + device is stored once, and the first value is kept
// (records are append-only, so an import never overwrites an earlier one).
declare(strict_types=1);

return (function (): array {
    $devices = ['Galaxy Watch · Samsung Health', 'SYNTHETIC sample · Galaxy Watch · Samsung Health'];
    $metrics = ['hr', 'sleep', 'spo2', 'sys', 'dia', 'exercise', 'water', 'temp'];
    $maxRows = 400;

    return [
        // Imported history from before tracking day 1 (the core GET measurements route only serves day >= 1).
        'GET import/early' => function (): void {
            $u = require_user();
            $crewId = (int) ($_GET['crew'] ?? 0);
            if (!can_view_crew($u, $crewId)) {
                fail('Not allowed', 403);
            }
            $since = max(-100000, min(0, (int) ($_GET['since'] ?? -100000)));
            $sql = 'SELECT * FROM measurements WHERE crew_id = ? AND day < 1 AND day >= ? AND measured_at <= UTC_TIMESTAMP()';
            if ($u['role'] === 'ground') {
                $sql .= " AND metric <> 'mood'"; // same privacy rule as the core route
            }
            $st = db()->prepare($sql . ' ORDER BY measured_at LIMIT 20000');
            $st->execute([$crewId, $since]);
            json_out(['measurements' => array_map('measurement_json', $st->fetchAll())]);
        },

        'POST import/measurements' => function () use ($devices, $metrics, $maxRows): void {
            $u = require_user();
            require_role($u, ['astronaut', 'member']);
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            if ($u['crewId'] !== $crewId) {
                fail('You can only import data into your own record', 403);
            }
            $device = (string) ($b['device'] ?? '');
            if (!in_array($device, $devices, true)) {
                fail('Unknown device label');
            }
            $rows = $b['rows'] ?? null;
            if (!is_array($rows) || count($rows) === 0) {
                fail('No rows to import');
            }
            if (count($rows) > $maxRows) {
                fail("Too many rows in one request (max $maxRows)", 413);
            }

            $tz = tz();
            $today = new DateTimeImmutable('today', $tz);
            $curDay = (int) mission_for($u)['day'];
            $utc = new DateTimeZone('UTC');
            $nowUtc = new DateTimeImmutable('now', $utc);
            $result = ['added' => 0, 'unchanged' => 0, 'conflicts' => 0, 'rejected' => 0];
            $ids = [];

            $pdo = db();
            $findKey = $pdo->prepare('SELECT measurement_id FROM import_keys WHERE crew_id = ? AND metric = ? AND local_date = ? AND device = ? FOR UPDATE');
            $findRow = $pdo->prepare('SELECT value FROM measurements WHERE id = ? AND crew_id = ?');
            $insRow = $pdo->prepare("INSERT INTO measurements (crew_id, metric, value, day, measured_at, source, device, entered_by) VALUES (?, ?, ?, ?, ?, 'device', ?, ?)");
            $insKey = $pdo->prepare('INSERT INTO import_keys (crew_id, metric, local_date, device, measurement_id, imported_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE measurement_id = VALUES(measurement_id), imported_at = VALUES(imported_at)');

            $pdo->beginTransaction();
            try {
                foreach ($rows as $r) {
                    if (!is_array($r)) {
                        $result['rejected']++;
                        continue;
                    }
                    // metric and plausible range (same table as the core measurements route)
                    $metric = is_string($r['metric'] ?? null) ? $r['metric'] : '';
                    $value = $r['value'] ?? null;
                    if (!in_array($metric, $metrics, true) || !isset(METRICS[$metric]) || !(is_int($value) || is_float($value))) {
                        $result['rejected']++;
                        continue;
                    }
                    $v = (float) $value;
                    [$lo, $hi] = METRICS[$metric];
                    if (!is_finite($v) || $v < $lo || $v > $hi) {
                        $result['rejected']++;
                        continue;
                    }
                    // local calendar day of the value (export's time zone), not in the future, at most ~10 years old
                    $ld = is_string($r['localDate'] ?? null) ? $r['localDate'] : '';
                    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $ld) === 1 ? DateTimeImmutable::createFromFormat('!Y-m-d', $ld, $tz) : false;
                    if ($date === false || $date->format('Y-m-d') !== $ld) {
                        $result['rejected']++;
                        continue;
                    }
                    $ago = (int) round(($today->getTimestamp() - $date->getTimestamp()) / 86400);
                    if ($ago < -1 || $ago > 3660) {
                        $result['rejected']++;
                        continue;
                    }
                    // the row's own timestamp (ISO 8601 from the browser), stored in UTC, never in the future
                    $atRaw = is_string($r['at'] ?? null) ? $r['at'] : '';
                    if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/', $atRaw) !== 1) {
                        $result['rejected']++;
                        continue;
                    }
                    try {
                        $at = (new DateTimeImmutable($atRaw))->setTimezone($utc);
                    } catch (Throwable $e) {
                        $result['rejected']++;
                        continue;
                    }
                    if ($at > $nowUtc) {
                        $at = $nowUtc;
                    }

                    // dedupe: person + metric + local day + device
                    $findKey->execute([$crewId, $metric, $ld, $device]);
                    $mid = $findKey->fetchColumn();
                    $findKey->closeCursor();
                    if ($mid !== false) {
                        $findRow->execute([(int) $mid, $crewId]);
                        $old = $findRow->fetchColumn();
                        $findRow->closeCursor();
                        if ($old !== false) {
                            if (abs((float) $old - $v) < 0.005) {
                                $result['unchanged']++;
                            } else {
                                $result['conflicts']++; // keep the value imported first
                            }
                            continue;
                        }
                        // the measurement was removed (e.g. a reset): import it again below
                    }

                    $insRow->execute([$crewId, $metric, $v, $curDay - $ago, $at->format('Y-m-d H:i:s'), $device, $u['id']]);
                    $newId = (int) $pdo->lastInsertId();
                    $insKey->execute([$crewId, $metric, $ld, $device, $newId]);
                    $ids[] = $newId;
                    $result['added']++;
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }

            $measurements = [];
            if ($ids) {
                $in = implode(',', array_fill(0, count($ids), '?'));
                $st = $pdo->prepare("SELECT * FROM measurements WHERE id IN ($in) ORDER BY measured_at");
                $st->execute($ids);
                $measurements = array_map('measurement_json', $st->fetchAll());
            }
            audit(
                (int) $u['id'],
                'import',
                sprintf(
                    '%s: %d added, %d unchanged, %d kept, %d rejected',
                    $device === $devices[1] ? 'samsung-synthetic' : 'samsung',
                    $result['added'],
                    $result['unchanged'],
                    $result['conflicts'],
                    $result['rejected']
                )
            );
            json_out($result + ['measurements' => $measurements]);
        },
    ];
})();
