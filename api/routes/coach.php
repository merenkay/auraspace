<?php
// AURA coach API: training profile + session log for the personalised programme.
//
//   GET  coach/state?crew=<id>   -> {profile: {...} | null, logs: [...]}  (logs oldest first, newest 120)
//   POST coach/profile           {crewId, profile: {focus[], confirmed, level, daysPerWeek, minutes, equipment[], limits[], startedAt, context}} -> {profile}
//   POST coach/log               {crewId, log: {date, sessionKey, minutes, effort, pain}} -> {item}   (one log per session and date; re-logging replaces it)
//
// Privacy (same as clinic.php): astronauts and members read and write only their own record. The flight surgeon may
// READ the simulated demo crew (can_view_crew). Mission control (ground) may not read. Allowed ids mirror
// src/data/coach/catalog.ts and src/lib/coach/profile.ts.
declare(strict_types=1);

return (function (): array {
    $allowed = [
        'focus' => ['muscle', 'bone', 'balance', 'back', 'bp', 'glucose', 'mood', 'sleep', 'joints', 'fitness'],
        'level' => ['starting', 'some', 'regular'],
        'equipment' => ['ared', 't2', 'cevis', 'chair', 'wall', 'band', 'light-weights', 'dumbbells', 'bench', 'step', 'bike', 'treadmill'],
        'limits' => ['knee', 'hip', 'shoulder', 'wrist', 'back', 'no-floor', 'seated', 'no-impact'],
        'days' => [2, 3, 4, 5, 6, 7],
        'minutes' => [15, 20, 30, 45, 60, 75, 90, 120],
    ];

    // Read rule: self users only their own record; surgeon only the demo crew; ground never.
    $canRead = function (array $u, int $crewId): bool {
        if ($u['role'] === 'ground') {
            return false;
        }
        if (is_self_user($u)) {
            return $u['crewId'] === $crewId;
        }
        return $u['role'] === 'surgeon' && can_view_crew($u, $crewId);
    };

    $selfOnly = function (array $u, int $crewId): void {
        require_role($u, ['astronaut', 'member']);
        if ($u['crewId'] !== $crewId) {
            fail('You can only change your own record', 403);
        }
    };

    // A missing table/column (install.php not re-run after a deploy) answers with the same 503 as the rest of the API.
    $guard = function (Closure $fn): void {
        try {
            $fn();
        } catch (PDOException $e) {
            if (in_array(sqlstate($e), ['42S02', '42S22'], true)) {
                error_log('AURA coach: ' . $e->getMessage());
                fail('Feature tables are not installed yet — re-run the installer (api/install.php).', 503);
            }
            throw $e;
        }
    };

    $encode = function (array $data): string {
        return (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    };

    $ids = function ($list, array $ok, int $max): array {
        if (!is_array($list)) {
            return [];
        }
        $out = [];
        foreach ($list as $v) {
            if (is_string($v) && in_array($v, $ok, true) && !in_array($v, $out, true)) {
                $out[] = $v;
            }
            if (count($out) >= $max) {
                break;
            }
        }
        return $out;
    };

    // A real calendar date in YYYY-MM-DD form, or null.
    $validDate = function ($v): ?string {
        if (!is_string($v) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m)) {
            return null;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $v : null;
    };

    $profileJson = function (array $row): array {
        $d = json_decode((string) $row['data'], true);
        $d = is_array($d) ? $d : [];
        return [
            'focus' => is_array($d['focus'] ?? null) ? $d['focus'] : [],
            'confirmed' => ($d['confirmed'] ?? false) === true,
            'level' => (string) ($d['level'] ?? ''),
            'daysPerWeek' => (int) ($d['daysPerWeek'] ?? 0),
            'minutes' => (int) ($d['minutes'] ?? 0),
            'equipment' => is_array($d['equipment'] ?? null) ? $d['equipment'] : [],
            'limits' => is_array($d['limits'] ?? null) ? $d['limits'] : [],
            'startedAt' => (string) ($d['startedAt'] ?? ''),
            'context' => (string) ($d['context'] ?? ''),
            'updatedAt' => iso((string) $row['updated_at']),
        ];
    };

    $logJson = function (array $row): array {
        return [
            'id' => (int) $row['id'],
            'date' => substr((string) $row['session_date'], 0, 10),
            'sessionKey' => (string) $row['session_key'],
            'minutes' => (int) $row['minutes'],
            'effort' => (int) $row['effort'],
            'pain' => (int) $row['pain'] === 1,
            'createdAt' => iso((string) $row['created_at']),
        ];
    };

    return [
        'GET coach/state' => function () use ($canRead, $guard, $profileJson, $logJson): void {
            $u = require_user();
            $crewId = (int) ($_GET['crew'] ?? 0);
            if (!$canRead($u, $crewId)) {
                fail('Not allowed', 403);
            }
            $guard(function () use ($crewId, $profileJson, $logJson): void {
                $st = db()->prepare('SELECT data, updated_at FROM coach_profiles WHERE crew_id = ?');
                $st->execute([$crewId]);
                $row = $st->fetch();
                $st = db()->prepare('SELECT id, session_date, session_key, minutes, effort, pain, created_at FROM coach_logs WHERE crew_id = ? ORDER BY session_date DESC, id DESC LIMIT 120');
                $st->execute([$crewId]);
                $logs = array_reverse(array_map($logJson, $st->fetchAll()));
                json_out(['profile' => $row ? $profileJson($row) : null, 'logs' => $logs]);
            });
        },

        'POST coach/profile' => function () use ($selfOnly, $guard, $ids, $allowed, $validDate, $profileJson, $encode): void {
            $u = require_user();
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            $selfOnly($u, $crewId);
            $p = is_array($b['profile'] ?? null) ? $b['profile'] : [];
            $context = (string) ($p['context'] ?? '');
            $level = (string) ($p['level'] ?? '');
            $days = is_int($p['daysPerWeek'] ?? null) ? $p['daysPerWeek'] : (int) ($p['daysPerWeek'] ?? 0);
            $minutes = is_int($p['minutes'] ?? null) ? $p['minutes'] : (int) ($p['minutes'] ?? 0);
            $started = $validDate($p['startedAt'] ?? null);
            $focus = $ids($p['focus'] ?? null, $allowed['focus'], 3);
            if (!in_array($context, CONTEXTS, true) || !in_array($level, $allowed['level'], true) || !in_array($days, $allowed['days'], true)
                || !in_array($minutes, $allowed['minutes'], true) || $started === null || !$focus) {
                fail('Invalid training profile');
            }
            $data = [
                'focus' => $focus,
                'confirmed' => ($p['confirmed'] ?? false) === true,
                'level' => $level,
                'daysPerWeek' => $days,
                'minutes' => $minutes,
                'equipment' => $ids($p['equipment'] ?? null, $allowed['equipment'], 12),
                'limits' => $ids($p['limits'] ?? null, $allowed['limits'], 8),
                'startedAt' => $started,
                'context' => $context,
            ];
            $guard(function () use ($u, $crewId, $data, $profileJson, $encode): void {
                // Upsert without VALUES() (deprecated in MySQL 8.0.20+): the new values are bound a second time.
                $json = $encode($data);
                db()->prepare('INSERT INTO coach_profiles (crew_id, data, updated_at, updated_by) VALUES (?, ?, UTC_TIMESTAMP(), ?)
                    ON DUPLICATE KEY UPDATE data = ?, updated_at = UTC_TIMESTAMP(), updated_by = ?')
                    ->execute([$crewId, $json, $u['id'], $json, $u['id']]);
                audit($u['id'], 'coach_profile');
                $st = db()->prepare('SELECT data, updated_at FROM coach_profiles WHERE crew_id = ?');
                $st->execute([$crewId]);
                json_out(['profile' => $profileJson($st->fetch())]);
            });
        },

        'POST coach/log' => function () use ($selfOnly, $guard, $validDate, $logJson): void {
            $u = require_user();
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            $selfOnly($u, $crewId);
            $l = is_array($b['log'] ?? null) ? $b['log'] : [];
            $date = $validDate($l['date'] ?? null);
            $key = $l['sessionKey'] ?? null;
            $minutes = $l['minutes'] ?? null;
            $effort = $l['effort'] ?? null;
            if ($date === null || !is_string($key) || !preg_match('/^[a-z0-9]{1,16}$/', $key)
                || !is_int($minutes) || $minutes < 0 || $minutes > 300 || !is_int($effort) || $effort < 0 || $effort > 10) {
                fail('Invalid session log');
            }
            // Logs are for sessions that have happened: no later than tomorrow (time zones), no older than a year.
            $utc = new DateTimeZone('UTC');
            $today = new DateTimeImmutable('now', $utc);
            if ($date > $today->modify('+1 day')->format('Y-m-d') || $date < $today->modify('-366 days')->format('Y-m-d')) {
                fail('Session date out of range');
            }
            $pain = ($l['pain'] ?? false) === true ? 1 : 0;
            $guard(function () use ($u, $crewId, $date, $key, $minutes, $effort, $pain, $logJson): void {
                $pdo = db();
                $st = $pdo->prepare('SELECT COUNT(*) FROM coach_logs WHERE crew_id = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)');
                $st->execute([$crewId]);
                if ((int) $st->fetchColumn() >= 60) {
                    fail('Too many session logs in the last hour. Try again later.', 429);
                }
                $pdo->prepare('INSERT INTO coach_logs (crew_id, session_date, session_key, minutes, effort, pain, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)
                    ON DUPLICATE KEY UPDATE minutes = ?, effort = ?, pain = ?, created_at = UTC_TIMESTAMP(), created_by = ?')
                    ->execute([$crewId, $date, $key, $minutes, $effort, $pain, $u['id'], $minutes, $effort, $pain, $u['id']]);
                audit($u['id'], 'coach_log', "$date $key");
                $st = $pdo->prepare('SELECT id, session_date, session_key, minutes, effort, pain, created_at FROM coach_logs WHERE crew_id = ? AND session_date = ? AND session_key = ?');
                $st->execute([$crewId, $date, $key]);
                json_out(['item' => $logJson($st->fetch())]);
            });
        },
    ];
})();
