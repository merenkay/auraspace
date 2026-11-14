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

const REPORT_SELECT = 'SELECT r.*, c.name AS crew_name, ru.name AS reviewer_name FROM reports r JOIN crew c ON c.id = r.crew_id LEFT JOIN users ru ON ru.id = r.reviewed_by';

try {
    if ($route === 'health') {
        try {
            $n = (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
            $c = config();
            json_out(['ok' => true, 'db' => $n > 0, 'signup' => !empty($c['allow_signup']), 'mail' => filter_var($c['mail_from'] ?? '', FILTER_VALIDATE_EMAIL) !== false]);
        } catch (Throwable $e) {
            json_out(['ok' => true, 'db' => false]);
        }
    }

    switch ("$method $route") {
        /* ------------------------------------------------------------ auth */
        case 'GET auth/me':
            json_out(['user' => current_user()]);

        case 'POST auth/login': {
            $b = body();
            $ip = client_ip();
            $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at > (UTC_TIMESTAMP() - INTERVAL 15 MINUTE)');
            $st->execute([$ip]);
            if ((int) $st->fetchColumn() >= 10) {
                fail('Too many attempts. Try again in 15 minutes.', 429);
            }
            $id = strtolower(trim((string) ($b['username'] ?? '')));
            $st = db()->prepare('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1');
            $st->execute([$id, $id]);
            $u = $st->fetch();
            if (!$u || !password_verify((string) ($b['password'] ?? ''), $u['password_hash'])) {
                db()->prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, UTC_TIMESTAMP())')->execute([$ip]);
                fail('Unknown user or wrong password.', 401);
            }
            sign_in((int) $u['id']);
            audit((int) $u['id'], 'login');
            json_out(['user' => user_json($u)]);
        }

        case 'POST auth/demo': {
            if (empty(config()['allow_demo'])) {
                fail('Demo access is disabled', 403);
            }
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
            sign_in((int) $u['id']);
            audit((int) $u['id'], 'demo_login');
            json_out(['user' => user_json($u)]);
        }

        case 'POST auth/logout':
            start_session();
            $_SESSION = [];
            session_destroy();
            json_out(['ok' => true]);

        case 'POST auth/register': {
            if (empty(config()['allow_signup'])) {
                fail('Sign-up is closed', 403);
            }
            $b = body();
            $email = valid_email((string) ($b['email'] ?? ''));
            $name = trim(preg_replace('/\s+/', ' ', (string) ($b['name'] ?? '')) ?? '');
            if (mb_strlen($name) < 2 || mb_strlen($name) > 80) {
                fail('Please enter your name (2–80 characters).');
            }
            $context = (string) ($b['context'] ?? '');
            if (!in_array($context, CONTEXTS, true)) {
                fail('Choose a profile type.');
            }
            if (empty($b['consent'])) {
                fail('Please accept the terms to continue.');
            }
            $pw = valid_password((string) ($b['password'] ?? ''));
            $st = db()->prepare('SELECT id FROM users WHERE email = ?');
            $st->execute([$email]);
            if ($st->fetch()) {
                fail('This email is already registered. Sign in or reset your password.', 409);
            }
            issue_code($email, 'register', ['name' => $name, 'hash' => password_hash($pw, PASSWORD_DEFAULT), 'context' => $context], $name);
            json_out(['ok' => true, 'email' => $email, 'expiresIn' => 900]);
        }

        case 'POST auth/verify': {
            $b = body();
            $email = valid_email((string) ($b['email'] ?? ''));
            $payload = check_code($email, 'register', trim((string) ($b['code'] ?? '')));
            if (empty($payload['hash']) || empty($payload['name']) || !in_array($payload['context'] ?? '', CONTEXTS, true)) {
                fail('Registration expired. Please sign up again.', 410);
            }
            $u = create_member($email, $payload['name'], $payload['hash'], $payload['context']);
            sign_in((int) $u['id']);
            audit((int) $u['id'], 'register', $payload['context']);
            json_out(['user' => user_json($u)]);
        }

        case 'POST auth/resend': {
            $b = body();
            $email = valid_email((string) ($b['email'] ?? ''));
            $purpose = ($b['purpose'] ?? '') === 'reset' ? 'reset' : 'register';
            $st = db()->prepare('SELECT payload FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1');
            $st->execute([$email, $purpose]);
            $row = $st->fetch();
            if (!$row) {
                // nothing pending: answer the same way so addresses cannot be probed
                json_out(['ok' => true, 'expiresIn' => 900]);
            }
            $payload = $row['payload'] ? (json_decode($row['payload'], true) ?: null) : null;
            issue_code($email, $purpose, $payload, (string) ($payload['name'] ?? ''));
            json_out(['ok' => true, 'expiresIn' => 900]);
        }

        case 'POST auth/forgot': {
            $b = body();
            $email = valid_email((string) ($b['email'] ?? ''));
            $st = db()->prepare('SELECT name FROM users WHERE email = ?');
            $st->execute([$email]);
            $u = $st->fetch();
            if ($u) {
                issue_code($email, 'reset', null, (string) $u['name']);
            }
            json_out(['ok' => true, 'expiresIn' => 900]);
        }

        case 'POST auth/reset': {
            $b = body();
            $email = valid_email((string) ($b['email'] ?? ''));
            $pw = valid_password((string) ($b['password'] ?? ''));
            check_code($email, 'reset', trim((string) ($b['code'] ?? '')));
            $st = db()->prepare('SELECT * FROM users WHERE email = ?');
            $st->execute([$email]);
            $u = $st->fetch();
            if (!$u) {
                fail('Account not found', 404);
            }
            db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
            sign_in((int) $u['id']);
            audit((int) $u['id'], 'password_reset');
            json_out(['user' => user_json($u)]);
        }

        case 'POST auth/delete': {
            $u = require_user();
            require_role($u, ['member']);
            $b = body();
            $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
            $st->execute([$u['id']]);
            if (!password_verify((string) ($b['password'] ?? ''), (string) $st->fetchColumn())) {
                fail('Wrong password', 401);
            }
            $pdo = db();
            $pdo->beginTransaction();
            foreach (['measurements', 'task_done', 'reports'] as $t) {
                $pdo->prepare("DELETE FROM $t WHERE crew_id = ?")->execute([$u['crewId']]);
            }
            $pdo->prepare('DELETE FROM crew WHERE id = ?')->execute([$u['crewId']]);
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$u['id']]);
            $pdo->commit();
            audit(null, 'account_deleted', 'user ' . $u['id']);
            start_session();
            $_SESSION = [];
            session_destroy();
            json_out(['ok' => true]);
        }

        /* ------------------------------------------------------------ data */
        case 'GET mission':
            json_out(['mission' => mission_for(require_user())]);

        case 'GET crew': {
            $u = require_user();
            if (is_self_user($u)) {
                $st = db()->prepare('SELECT id, name, callsign, position, color, context FROM crew WHERE id = ?');
                $st->execute([$u['crewId']]);
            } else {
                $st = db()->query('SELECT id, name, callsign, position, color, context FROM crew WHERE owner_user_id IS NULL ORDER BY id');
            }
            $crew = array_map(fn ($c) => ['id' => (int) $c['id'], 'name' => $c['name'], 'callsign' => $c['callsign'], 'position' => $c['position'], 'color' => $c['color'], 'context' => $c['context']], $st->fetchAll());
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
                $sql .= " AND metric <> 'mood'"; // private to the person and the flight surgeon
            }
            $st = db()->prepare($sql . ' ORDER BY measured_at');
            $st->execute([$crewId, $since]);
            json_out(['measurements' => array_map('measurement_json', $st->fetchAll())]);
        }

        case 'POST measurements': {
            $u = require_user();
            require_role($u, ['astronaut', 'member']);
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            if ($u['crewId'] !== $crewId) {
                fail('You can only log your own measurements', 403);
            }
            $values = is_array($b['values'] ?? null) ? $b['values'] : [];
            if (!$values || count($values) > 12) {
                fail('No values');
            }
            $source = in_array($b['source'] ?? '', ['manual', 'device', 'live', 'sim'], true) ? $b['source'] : 'manual';
            $device = mb_substr(trim((string) ($b['device'] ?? 'Manual entry')), 0, 60) ?: 'Manual entry';
            $day = mission_for($u)['day'];
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
            json_out(tasks_for($crewId, is_self_user($u) ? mission_for($u)['day'] : mission()['day']));
        }

        case 'POST tasks/toggle': {
            $u = require_user();
            require_role($u, ['astronaut', 'member']);
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            $taskId = (string) ($b['taskId'] ?? '');
            if ($u['crewId'] !== $crewId || !in_array($taskId, array_column(TASKS[crew_context($crewId)], 'id'), true)) {
                fail('Not allowed', 403);
            }
            $day = mission_for($u)['day'];
            $del = db()->prepare('DELETE FROM task_done WHERE crew_id = ? AND task_id = ? AND day = ?');
            $del->execute([$crewId, $taskId, $day]);
            if ($del->rowCount() === 0) {
                db()->prepare('INSERT INTO task_done (crew_id, task_id, day, done_at) VALUES (?, ?, ?, UTC_TIMESTAMP())')->execute([$crewId, $taskId, $day]);
            }
            json_out(tasks_for($crewId, $day));
        }

        case 'GET reports': {
            $u = require_user();
            require_role($u, ['astronaut', 'member', 'surgeon']);
            $args = [];
            if (is_self_user($u)) {
                $where = ' WHERE r.crew_id = ?';
                $args[] = $u['crewId'];
            } else {
                $where = ' WHERE c.owner_user_id IS NULL';
                if (!empty($_GET['crew'])) {
                    $where .= ' AND r.crew_id = ?';
                    $args[] = (int) $_GET['crew'];
                }
            }
            $st = db()->prepare(REPORT_SELECT . $where . ' ORDER BY r.created_at DESC LIMIT 100');
            $st->execute($args);
            json_out(['reports' => array_map('report_json', $st->fetchAll())]);
        }

        case 'POST reports': {
            $u = require_user();
            require_role($u, ['astronaut', 'member']);
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
                ->execute([$crewId, mission_for($u)['day'], $summary]);
            $id = (int) db()->lastInsertId();
            audit($u['id'], 'report_sent', "report $id");
            $st = db()->prepare(REPORT_SELECT . ' WHERE r.id = ?');
            $st->execute([$id]);
            json_out(['report' => report_json($st->fetch())]);
        }

        case 'POST reports/review': {
            $u = require_user();
            require_role($u, ['surgeon']);
            $b = body();
            $id = (int) ($b['id'] ?? 0);
            $note = mb_substr(trim((string) ($b['note'] ?? '')), 0, 1000);
            db()->prepare("UPDATE reports r JOIN crew c ON c.id = r.crew_id SET r.status = 'reviewed', r.review_note = ?, r.reviewed_by = ?, r.reviewed_at = UTC_TIMESTAMP() WHERE r.id = ? AND c.owner_user_id IS NULL")
                ->execute([$note, $u['id'], $id]);
            audit($u['id'], 'report_reviewed', "report $id");
            $st = db()->prepare(REPORT_SELECT . ' WHERE r.id = ? AND c.owner_user_id IS NULL');
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
