<?php
// AURA API router: /api/index.php?r=<route>
declare(strict_types=1);
require __DIR__ . '/lib.php';

$route = (string) ($_GET['r'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Writes must be JSON (blocks simple cross-site form posts; cookies are SameSite=Lax as well).
if ($method === 'POST' && stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    fail('Expected application/json', 415);
}

try {
    if ($route === 'health') {
        try {
            $n = (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
            json_out(['ok' => true, 'db' => $n > 0]);
        } catch (Throwable $e) {
            json_out(['ok' => true, 'db' => false]);
        }
    }

    switch ("$method $route") {
        case 'GET auth/me':
            json_out(['user' => current_user()]);

        case 'POST auth/login': {
            start_session();
            $b = body();
            $ip = $_SERVER['REMOTE_ADDR'] ?? '';
            $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at > (UTC_TIMESTAMP() - INTERVAL 15 MINUTE)');
            $st->execute([$ip]);
            if ((int) $st->fetchColumn() >= 10) {
                fail('Too many attempts. Try again in 15 minutes.', 429);
            }
            $st = db()->prepare('SELECT * FROM users WHERE username = ?');
            $st->execute([strtolower(trim((string) ($b['username'] ?? '')))]);
            $u = $st->fetch();
            if (!$u || !password_verify((string) ($b['password'] ?? ''), $u['password_hash'])) {
                db()->prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, UTC_TIMESTAMP())')->execute([$ip]);
                fail('Unknown user or wrong password.', 401);
            }
            session_regenerate_id(true);
            $_SESSION['uid'] = (int) $u['id'];
            audit((int) $u['id'], 'login');
            json_out(['user' => user_json($u)]);
        }

        case 'POST auth/demo': {
            if (empty(config()['allow_demo'])) {
                fail('Demo access is disabled', 403);
            }
            start_session();
            $b = body();
            $role = (string) ($b['role'] ?? '');
            if ($role === 'astronaut') {
                $st = db()->prepare("SELECT * FROM users WHERE role = 'astronaut' AND crew_id = ?");
                $st->execute([(int) ($b['crewId'] ?? 1)]);
            } elseif (in_array($role, ['surgeon', 'ground'], true)) {
                $st = db()->prepare('SELECT * FROM users WHERE role = ? ORDER BY id LIMIT 1');
                $st->execute([$role]);
            } else {
                fail('Unknown role');
            }
            $u = $st->fetch();
            if (!$u) {
                fail('Demo user not found', 404);
            }
            session_regenerate_id(true);
            $_SESSION['uid'] = (int) $u['id'];
            audit((int) $u['id'], 'demo_login');
            json_out(['user' => user_json($u)]);
        }

        case 'POST auth/logout':
            start_session();
            $_SESSION = [];
            session_destroy();
            json_out(['ok' => true]);

        case 'GET mission':
            require_user();
            json_out(['mission' => mission()]);

        case 'GET crew': {
            $u = require_user();
            $rows = db()->query('SELECT id, name, callsign, position, color FROM crew ORDER BY id')->fetchAll();
            $crew = array_map(fn ($c) => ['id' => (int) $c['id'], 'name' => $c['name'], 'callsign' => $c['callsign'], 'position' => $c['position'], 'color' => $c['color']], $rows);
            if ($u['role'] === 'astronaut') {
                $crew = array_values(array_filter($crew, fn ($c) => $c['id'] === $u['crewId']));
            }
            json_out(['crew' => $crew]);
        }

        case 'GET measurements': {
            $u = require_user();
            $crewId = (int) ($_GET['crew'] ?? 0);
            if (!can_view_crew($u, $crewId)) {
                fail('Not allowed', 403);
            }
            $since = max(1, (int) ($_GET['since'] ?? 1));
            $sql = 'SELECT * FROM measurements WHERE crew_id = ? AND day >= ? AND measured_at <= UTC_TIMESTAMP()';
            if ($u['role'] === 'ground') {
                $sql .= " AND metric <> 'mood'"; // private to astronaut and flight surgeon
            }
            $st = db()->prepare($sql . ' ORDER BY measured_at');
            $st->execute([$crewId, $since]);
            json_out(['measurements' => array_map('measurement_json', $st->fetchAll())]);
        }

        case 'POST measurements': {
            $u = require_user();
            require_role($u, ['astronaut']);
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            if ($u['crewId'] !== $crewId) {
                fail('You can only log your own measurements', 403);
            }
            $values = is_array($b['values'] ?? null) ? $b['values'] : [];
            if (!$values) {
                fail('No values');
            }
            $source = in_array($b['source'] ?? '', ['manual', 'device', 'live', 'sim'], true) ? $b['source'] : 'manual';
            $device = mb_substr(trim((string) ($b['device'] ?? 'Manual entry')), 0, 60) ?: 'Manual entry';
            $day = mission()['day'];
            $ins = db()->prepare('INSERT INTO measurements (crew_id, metric, value, day, measured_at, source, device, entered_by) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?)');
            $ids = [];
            foreach ($values as $metric => $value) {
                if (!isset(METRICS[$metric]) || !is_numeric($value)) {
                    fail("Invalid metric: $metric");
                }
                [$lo, $hi] = METRICS[$metric];
                $v = (float) $value;
                if ($v < $lo || $v > $hi) {
                    fail("Value out of range for $metric");
                }
                $ins->execute([$crewId, $metric, $v, $day, $source, $device, $u['id']]);
                $ids[] = (int) db()->lastInsertId();
            }
            audit($u['id'], 'measurement', implode(',', array_keys($values)));
            $in = implode(',', array_fill(0, count($ids), '?'));
            $st = db()->prepare("SELECT * FROM measurements WHERE id IN ($in)");
            $st->execute($ids);
            json_out(['measurements' => array_map('measurement_json', $st->fetchAll())]);
        }

        case 'GET tasks': {
            $u = require_user();
            $crewId = (int) ($_GET['crew'] ?? 0);
            if (!can_view_crew($u, $crewId)) {
                fail('Not allowed', 403);
            }
            json_out(tasks_for($crewId, mission()['day']));
        }

        case 'POST tasks/toggle': {
            $u = require_user();
            require_role($u, ['astronaut']);
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            $taskId = (string) ($b['taskId'] ?? '');
            if ($u['crewId'] !== $crewId || !in_array($taskId, array_column(TASKS, 'id'), true)) {
                fail('Not allowed', 403);
            }
            $day = mission()['day'];
            $del = db()->prepare('DELETE FROM task_done WHERE crew_id = ? AND task_id = ? AND day = ?');
            $del->execute([$crewId, $taskId, $day]);
            if ($del->rowCount() === 0) {
                db()->prepare('INSERT INTO task_done (crew_id, task_id, day, done_at) VALUES (?, ?, ?, UTC_TIMESTAMP())')->execute([$crewId, $taskId, $day]);
            }
            json_out(tasks_for($crewId, $day));
        }

        case 'GET reports': {
            $u = require_user();
            require_role($u, ['astronaut', 'surgeon']);
            $sql = 'SELECT r.*, c.name AS crew_name, ru.name AS reviewer_name FROM reports r JOIN crew c ON c.id = r.crew_id LEFT JOIN users ru ON ru.id = r.reviewed_by';
            $args = [];
            if ($u['role'] === 'astronaut') {
                $sql .= ' WHERE r.crew_id = ?';
                $args[] = $u['crewId'];
            } elseif (!empty($_GET['crew'])) {
                $sql .= ' WHERE r.crew_id = ?';
                $args[] = (int) $_GET['crew'];
            }
            $st = db()->prepare($sql . ' ORDER BY r.created_at DESC LIMIT 100');
            $st->execute($args);
            json_out(['reports' => array_map('report_json', $st->fetchAll())]);
        }

        case 'POST reports': {
            $u = require_user();
            require_role($u, ['astronaut']);
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            if ($u['crewId'] !== $crewId || !is_array($b['summary'] ?? null)) {
                fail('Not allowed', 403);
            }
            $summary = json_encode($b['summary'], JSON_UNESCAPED_UNICODE);
            if (strlen($summary) > 20000) {
                fail('Report too large');
            }
            db()->prepare("INSERT INTO reports (crew_id, day, created_at, status, summary) VALUES (?, ?, UTC_TIMESTAMP(), 'queued', ?)")
                ->execute([$crewId, mission()['day'], $summary]);
            $id = (int) db()->lastInsertId();
            audit($u['id'], 'report_sent', "report $id");
            $st = db()->prepare('SELECT r.*, c.name AS crew_name, NULL AS reviewer_name FROM reports r JOIN crew c ON c.id = r.crew_id WHERE r.id = ?');
            $st->execute([$id]);
            json_out(['report' => report_json($st->fetch())]);
        }

        case 'POST reports/review': {
            $u = require_user();
            require_role($u, ['surgeon']);
            $b = body();
            $id = (int) ($b['id'] ?? 0);
            $note = mb_substr(trim((string) ($b['note'] ?? '')), 0, 1000);
            db()->prepare("UPDATE reports SET status = 'reviewed', review_note = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?")
                ->execute([$note, $u['id'], $id]);
            audit($u['id'], 'report_reviewed', "report $id");
            $st = db()->prepare('SELECT r.*, c.name AS crew_name, ru.name AS reviewer_name FROM reports r JOIN crew c ON c.id = r.crew_id LEFT JOIN users ru ON ru.id = r.reviewed_by WHERE r.id = ?');
            $st->execute([$id]);
            $r = $st->fetch();
            if (!$r) {
                fail('Report not found', 404);
            }
            json_out(['report' => report_json($r)]);
        }
    }

    fail('Unknown route', 404);
} catch (RuntimeException $e) {
    if ($e->getMessage() === 'not_configured') {
        fail('Database is not configured', 503);
    }
    error_log('AURA API: ' . $e->getMessage());
    fail('Server error', 500);
} catch (Throwable $e) {
    error_log('AURA API: ' . $e->getMessage());
    fail('Server error', 500);
}
