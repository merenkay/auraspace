<?php
// Environment station API (Arduino temperature / humidity / flammable gas).
//
//   GET  env/latest              newest stored row of the caller's station + server time
//   GET  env/history?minutes=60  rows of the last N minutes (1..1440), averaged to <= ~720 points
//   POST env/readings            {source:'live', rows:[{at,t,h,gas,gasMax,base,n,device}, ...]} (max 60 rows)
//
// Station scoping (privacy rule): the station is derived from the session, never from the request.
//   - demo crew (astronaut) and staff (surgeon, ground) share ONE station: 'mission' (the simulated cabin)
//   - a registered member has a private station 'm<crewId>' that only they can read or write
// The browser sends one averaged row per 10 s. Simulated values are refused. Rows older than 30 days are pruned.
declare(strict_types=1);

return (function (): array {
    $stationOf = function (array $u): array {
        if ($u['role'] === 'member') {
            if ($u['crewId'] === null) {
                fail('No sensor station for this account', 403);
            }
            return ['id' => 'm' . (int) $u['crewId'], 'crewId' => (int) $u['crewId'], 'shared' => false];
        }
        if (in_array($u['role'], ['astronaut', 'surgeon', 'ground'], true)) {
            return ['id' => 'mission', 'crewId' => null, 'shared' => true];
        }
        fail('Not allowed for your role', 403);
        return [];
    };

    $num = function ($v): ?float {
        return $v === null ? null : (float) $v;
    };

    $rowJson = function (array $r) use ($num): array {
        $ratio = $r['ratio'] ?? null;
        return [
            'at' => iso((string) $r['measured_at']),
            't' => $num($r['temp_c']),
            'h' => $num($r['rh_pct']),
            'gas' => $r['gas_raw'] === null ? null : round((float) $r['gas_raw'], 1),
            'gasMax' => $r['gas_max'] === null ? null : (int) round((float) $r['gas_max']),
            'base' => $r['gas_base'] === null ? null : (int) round((float) $r['gas_base']),
            'ratio' => $ratio === null ? null : round((float) $ratio, 2),
            'n' => (int) $r['samples'],
            'device' => (string) ($r['device'] ?? ''),
        ];
    };

    // A missing table means install.php has not been re-run since this module was added.
    $guard = function (Closure $fn): void {
        try {
            $fn();
        } catch (PDOException $e) {
            if ((string) $e->getCode() === '42S02') {
                fail('Sensor storage is not set up on the server yet (run install.php).', 503);
            }
            throw $e;
        }
    };

    // Validates one optional number; returns [ok, value].
    $check = function ($v, float $lo, float $hi): array {
        if ($v === null) {
            return [true, null];
        }
        if (!is_int($v) && !is_float($v)) {
            return [false, null];
        }
        $f = (float) $v;
        if (is_nan($f) || $f < $lo || $f > $hi) {
            return [false, null];
        }
        return [true, $f];
    };

    return [
        'GET env/latest' => function () use ($stationOf, $rowJson, $guard): void {
            $u = require_user();
            $s = $stationOf($u);
            $guard(function () use ($s, $rowJson): void {
                $st = db()->prepare('SELECT measured_at, temp_c, rh_pct, gas_raw, gas_max, gas_base, gas_max / NULLIF(gas_base, 0) AS ratio, samples, device
                    FROM env_readings WHERE station = ? ORDER BY measured_at DESC LIMIT 1');
                $st->execute([$s['id']]);
                $r = $st->fetch();
                json_out([
                    'station' => $s['id'],
                    'shared' => $s['shared'],
                    'reading' => $r ? $rowJson($r) : null,
                    'serverTime' => gmdate('Y-m-d\TH:i:s\Z'),
                ]);
            });
        },

        'GET env/history' => function () use ($stationOf, $rowJson, $guard): void {
            $u = require_user();
            $s = $stationOf($u);
            $minutes = (int) ($_GET['minutes'] ?? 60);
            if ($minutes < 1) {
                $minutes = 1;
            }
            if ($minutes > 1440) {
                $minutes = 1440;
            }
            // bucket length in whole seconds (multiple of 10) so that at most ~720 points are returned
            $bucket = (int) max(10, (int) ceil(($minutes * 60) / 720 / 10) * 10);
            $guard(function () use ($s, $rowJson, $minutes, $bucket): void {
                // $bucket is a server-computed integer, never user text
                $sql = 'SELECT FLOOR(UNIX_TIMESTAMP(measured_at) / ' . $bucket . ') AS b,
                        MIN(measured_at) AS measured_at, AVG(temp_c) AS temp_c, AVG(rh_pct) AS rh_pct, AVG(gas_raw) AS gas_raw,
                        MAX(gas_max) AS gas_max, MAX(gas_base) AS gas_base, MAX(gas_max / NULLIF(gas_base, 0)) AS ratio,
                        SUM(samples) AS samples, MAX(device) AS device
                    FROM env_readings
                    WHERE station = ? AND measured_at >= (UTC_TIMESTAMP() - INTERVAL ? MINUTE)
                    GROUP BY b ORDER BY b';
                $st = db()->prepare($sql);
                $st->execute([$s['id'], $minutes]);
                $rows = [];
                foreach ($st->fetchAll() as $r) {
                    $rows[] = $rowJson($r);
                }
                json_out(['station' => $s['id'], 'shared' => $s['shared'], 'bucketSeconds' => $bucket, 'rows' => $rows]);
            });
        },

        'POST env/readings' => function () use ($stationOf, $guard, $check): void {
            $u = require_user();
            $s = $stationOf($u);
            $b = body();
            if (($b['source'] ?? '') !== 'live') {
                fail('Only live sensor readings can be stored (simulated data is never saved).');
            }
            $rows = $b['rows'] ?? null;
            if (!is_array($rows) || count($rows) === 0) {
                fail('No readings');
            }
            if (count($rows) > 60) {
                fail('Too many readings in one request (max 60)', 413);
            }

            $now = time();
            $clean = [];
            $rejected = 0;
            foreach ($rows as $r) {
                if (!is_array($r) || !is_string($r['at'] ?? null) || strlen($r['at']) > 40) {
                    $rejected++;
                    continue;
                }
                $ts = strtotime($r['at']);
                if ($ts === false || $ts < $now - 7 * 86400 || $ts > $now + 300) {
                    $rejected++;
                    continue;
                }
                [$okT, $t] = $check($r['t'] ?? null, -40.0, 85.0);
                [$okH, $h] = $check($r['h'] ?? null, 0.0, 100.0);
                [$okG, $gas] = $check($r['gas'] ?? null, 0.0, 4095.0);
                [$okM, $gasMax] = $check($r['gasMax'] ?? null, 0.0, 4095.0);
                [$okB, $base] = $check($r['base'] ?? null, 1.0, 4095.0);
                [$okN, $n] = $check($r['n'] ?? 1, 1.0, 600.0);
                if (!$okT || !$okH || !$okG || !$okM || !$okB || !$okN || ($t === null && $h === null && $gas === null)) {
                    $rejected++;
                    continue;
                }
                $device = preg_replace('/[^\p{L}\p{N} .:+()_·\-]/u', '', (string) ($r['device'] ?? '')) ?? '';
                $clean[] = [
                    gmdate('Y-m-d H:i:s', $ts),
                    $t === null ? null : round($t, 2),
                    $h === null ? null : round($h, 2),
                    $gas === null ? null : round($gas, 1),
                    $gasMax === null ? null : (int) round($gasMax),
                    $base === null ? null : (int) round($base),
                    $n === null ? 1 : (int) round($n),
                    mb_substr(trim($device), 0, 40),
                ];
            }

            $guard(function () use ($u, $s, $clean, $rejected): void {
                $pdo = db();
                // Rate cap per uploader: about 8x the normal live rate, enough to flush an offline backlog.
                $st = $pdo->prepare('SELECT COUNT(*) FROM env_readings WHERE uploaded_by = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)');
                $st->execute([$u['id']]);
                if ((int) $st->fetchColumn() + count($clean) > 3000) {
                    fail('Upload limit reached. Readings stay in your browser; try again later.', 429);
                }

                $inserted = 0;
                if ($clean) {
                    $ins = $pdo->prepare('INSERT IGNORE INTO env_readings
                        (station, crew_id, measured_at, temp_c, rh_pct, gas_raw, gas_max, gas_base, samples, device, uploaded_by, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())');
                    $pdo->beginTransaction();
                    try {
                        foreach ($clean as $c) {
                            $ins->execute([$s['id'], $s['crewId'], $c[0], $c[1], $c[2], $c[3], $c[4], $c[5], $c[6], $c[7], $u['id']]);
                            $inserted += $ins->rowCount();
                        }
                        $pdo->commit();
                    } catch (Throwable $e) {
                        if ($pdo->inTransaction()) {
                            $pdo->rollBack();
                        }
                        throw $e;
                    }
                }

                // Retention: keep 30 days (cheap, occasional).
                if (random_int(1, 50) === 1) {
                    $pdo->exec('DELETE FROM env_readings WHERE measured_at < (UTC_TIMESTAMP() - INTERVAL 30 DAY) LIMIT 5000');
                }

                json_out(['ok' => true, 'inserted' => $inserted, 'duplicates' => count($clean) - $inserted, 'rejected' => $rejected]);
            });
        },
    ];
})();
