<?php
// Shared helpers for the AURA API: config, database, sessions, JSON, access control and email codes.
declare(strict_types=1);

// Daily tasks per user context (kept in sync with src/lib/demoData.ts).
const TASKS = [
    'space' => [
        ['id' => 'bp', 'label' => 'Morning blood pressure', 'time' => '08:30'],
        ['id' => 'temp', 'label' => 'Body temperature', 'time' => '08:45'],
        ['id' => 'mood', 'label' => 'Mood check-in', 'time' => '09:00'],
        ['id' => 'ared', 'label' => 'ARED resistance session', 'time' => '11:00'],
        ['id' => 'vision', 'label' => 'Vision self-check', 'time' => '14:00'],
        ['id' => 'water', 'label' => 'Log water intake', 'time' => '20:00'],
    ],
    'polar' => [
        ['id' => 'bp', 'label' => 'Morning blood pressure', 'time' => '08:00'],
        ['id' => 'spo2', 'label' => 'Oxygen saturation', 'time' => '08:10'],
        ['id' => 'mood', 'label' => 'Mood check-in', 'time' => '09:00'],
        ['id' => 'light', 'label' => 'Bright-light break', 'time' => '10:00'],
        ['id' => 'exercise', 'label' => 'Exercise session', 'time' => '17:00'],
        ['id' => 'sleep', 'label' => 'Log last night’s sleep', 'time' => '21:00'],
    ],
    'home' => [
        ['id' => 'bp', 'label' => 'Morning blood pressure', 'time' => '08:30'],
        ['id' => 'water', 'label' => 'Glass of water', 'time' => '10:00'],
        ['id' => 'walk', 'label' => 'Short walk', 'time' => '11:00'],
        ['id' => 'mood', 'label' => 'How are you today?', 'time' => '12:00'],
        ['id' => 'call', 'label' => 'Call family or a friend', 'time' => '16:00'],
        ['id' => 'sleep', 'label' => 'Log last night’s sleep', 'time' => '20:00'],
    ],
];

const CONTEXTS = ['space', 'polar', 'home'];

// Allowed metrics and plausible ranges (input validation only — triage lives in the app's rules).
const METRICS = [
    'sys' => [60, 250], 'dia' => [30, 150], 'hr' => [20, 220], 'spo2' => [50, 100], 'temp' => [30, 43],
    'glucose' => [20, 500], 'sleep' => [0, 16], 'mood' => [1, 5], 'exercise' => [0, 300], 'vision' => [1, 5], 'water' => [0, 8],
];

function config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    // Preferred: one level above public_html, so it is never served or overwritten by deploys.
    $candidates = [dirname(__DIR__, 2) . '/aura-config.php', __DIR__ . '/config.local.php'];
    foreach ($candidates as $file) {
        if (is_file($file)) {
            $loaded = require $file;
            if (is_array($loaded)) {
                $cfg = $loaded + [
                    'db_host' => 'localhost', 'timezone' => 'Europe/Istanbul', 'allow_demo' => true, 'allow_signup' => true,
                    'install_token' => '', 'demo_password' => '', 'app_secret' => '',
                    'smtp_host' => '', 'smtp_port' => 465, 'smtp_user' => '', 'smtp_pass' => '', 'mail_from' => '', 'mail_from_name' => 'AURA',
                    'openai_api_key' => '', 'openai_model' => '',
                ];
                return $cfg;
            }
        }
    }
    $cfg = [];
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $c = config();
    if (empty($c['db_name']) || empty($c['db_user'])) {
        throw new RuntimeException('not_configured');
    }
    $pdo = new PDO(
        sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $c['db_host'], $c['db_name']),
        $c['db_user'],
        $c['db_pass'] ?? '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
    );
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function tz(): DateTimeZone
{
    try {
        return new DateTimeZone((string) (config()['timezone'] ?? 'UTC') ?: 'UTC');
    } catch (Throwable $e) {
        return new DateTimeZone('UTC');
    }
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): void
{
    json_out(['error' => $message], $status);
}

function body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail('Invalid JSON body');
    }
    return $data;
}

function client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('AURASESS');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}

function sign_in(int $userId): void
{
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = $userId;
}

function current_user(): ?array
{
    start_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) {
        return null;
    }
    $st = db()->prepare('SELECT id, username, email, role, name, title, crew_id, context FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    return $u ? user_json($u) : null;
}

function user_json(array $u): array
{
    return [
        'id' => (int) $u['id'], 'username' => $u['username'], 'email' => $u['email'] ?? null, 'role' => $u['role'],
        'name' => $u['name'], 'title' => $u['title'], 'crewId' => $u['crew_id'] !== null ? (int) $u['crew_id'] : null,
        'context' => $u['context'] ?? 'space',
    ];
}

function require_user(): array
{
    $u = current_user();
    if (!$u) {
        fail('Please sign in', 401);
    }
    return $u;
}

function require_role(array $u, array $roles): void
{
    if (!in_array($u['role'], $roles, true)) {
        fail('Not allowed for your role', 403);
    }
}

function is_self_user(array $u): bool
{
    return $u['role'] === 'astronaut' || $u['role'] === 'member';
}

/** Self users see only their own record; staff see only the simulated demo crew, never registered people. */
function can_view_crew(array $u, int $crewId): bool
{
    if (is_self_user($u)) {
        return $u['crewId'] === $crewId;
    }
    $st = db()->prepare('SELECT owner_user_id FROM crew WHERE id = ?');
    $st->execute([$crewId]);
    $row = $st->fetch();
    return $row !== false && $row['owner_user_id'] === null;
}

function audit(?int $userId, string $action, string $detail = ''): void
{
    try {
        db()->prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)')
            ->execute([$userId, $action, mb_substr($detail, 0, 250), client_ip()]);
    } catch (Throwable $e) {
        // auditing must never break the request
    }
}

function mission(): array
{
    $m = db()->query('SELECT name, profile_id, day, total_days, environment FROM mission WHERE id = 1')->fetch();
    if (!$m) {
        fail('Mission not initialised', 500);
    }
    return [
        'name' => $m['name'], 'profileId' => $m['profile_id'], 'day' => (int) $m['day'], 'totalDays' => (int) $m['total_days'],
        'environment' => $m['environment'], 'context' => 'space',
    ];
}

/** The demo crew share the simulated mission; registered members get a personal timeline. */
function mission_for(array $u): array
{
    if ($u['role'] !== 'member' || $u['crewId'] === null) {
        return mission();
    }
    $st = db()->prepare('SELECT created_at, context FROM crew WHERE id = ?');
    $st->execute([$u['crewId']]);
    $c = $st->fetch();
    $ctx = $c['context'] ?? 'home';
    $start = (new DateTimeImmutable(($c['created_at'] ?? 'now') . ' UTC'))->setTimezone(tz())->setTime(0, 0);
    $day = (int) $start->diff(new DateTimeImmutable('today', tz()))->days + 1;
    $names = ['space' => ['Personal space log', 'Spacecraft', 'iss'], 'polar' => ['Polar station', 'Remote station', 'polar'], 'home' => ['Home care', 'Home', 'home']];
    [$name, $env, $profile] = $names[$ctx] ?? $names['home'];
    return ['name' => $name, 'profileId' => $profile, 'day' => $day, 'totalDays' => null, 'environment' => $env, 'context' => $ctx];
}

function iso(string $utc): string
{
    return str_replace(' ', 'T', $utc) . 'Z';
}

function measurement_json(array $r): array
{
    return [
        'id' => (int) $r['id'], 'crewId' => (int) $r['crew_id'], 'metric' => $r['metric'], 'value' => (float) $r['value'],
        'day' => (int) $r['day'], 'at' => iso($r['measured_at']), 'source' => $r['source'], 'device' => $r['device'],
    ];
}

function report_json(array $r): array
{
    return [
        'id' => (int) $r['id'], 'crewId' => (int) $r['crew_id'], 'crewName' => $r['crew_name'], 'day' => (int) $r['day'],
        'createdAt' => iso($r['created_at']), 'status' => $r['status'], 'summary' => json_decode($r['summary'], true),
        'reviewNote' => $r['review_note'], 'reviewedBy' => $r['reviewer_name'] ?? null,
    ];
}

function crew_context(int $crewId): string
{
    $st = db()->prepare('SELECT context FROM crew WHERE id = ?');
    $st->execute([$crewId]);
    $ctx = (string) ($st->fetchColumn() ?: 'space');
    return in_array($ctx, CONTEXTS, true) ? $ctx : 'space';
}

function tasks_for(int $crewId, int $day): array
{
    $list = TASKS[crew_context($crewId)];
    $st = db()->prepare('SELECT task_id FROM task_done WHERE crew_id = ? AND day = ?');
    $st->execute([$crewId, $day]);
    $done = array_column($st->fetchAll(), 'task_id');
    $tasks = array_map(fn ($t) => $t + ['done' => in_array($t['id'], $done, true)], $list);
    $base = db()->prepare('SELECT streak_base FROM crew WHERE id = ?');
    $base->execute([$crewId]);
    $streak = (int) ($base->fetchColumn() ?: 0);
    $all = count(array_filter($tasks, fn ($t) => $t['done'])) === count($tasks);
    return ['tasks' => $tasks, 'streak' => $streak + ($all ? 1 : 0)];
}

function day_for_crew(array $u, int $crewId): int
{
    return mission_for($u)['day'];
}

/* ------------------------------------------------------------- email codes */

function code_hash(string $email, string $purpose, string $code): string
{
    $c = config();
    $secret = (string) ($c['app_secret'] ?: $c['install_token'] ?: 'aura');
    return hash_hmac('sha256', strtolower($email) . '|' . $purpose . '|' . $code, $secret);
}

/** Creates a 6-digit code, stores only its HMAC, and emails it. Enforces cooldown and per-IP limits. */
function issue_code(string $email, string $purpose, ?array $payload, string $name): void
{
    $pdo = db();
    $st = $pdo->prepare('SELECT COUNT(*) FROM email_codes WHERE ip = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)');
    $st->execute([client_ip()]);
    if ((int) $st->fetchColumn() >= 12) {
        fail('Too many codes requested from this network. Try again later.', 429);
    }
    $st = $pdo->prepare('SELECT created_at FROM email_codes WHERE email = ? AND purpose = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 60 SECOND)');
    $st->execute([$email, $purpose]);
    if ($st->fetch()) {
        fail('Please wait a minute before asking for another code.', 429);
    }
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $pdo->prepare('DELETE FROM email_codes WHERE email = ? AND purpose = ?')->execute([$email, $purpose]);
    $pdo->prepare('INSERT INTO email_codes (email, purpose, code_hash, payload, expires_at, ip) VALUES (?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL 15 MINUTE, ?)')
        ->execute([$email, $purpose, code_hash($email, $purpose, $code), $payload ? json_encode($payload) : null, client_ip()]);
    $id = (int) $pdo->lastInsertId();

    require_once __DIR__ . '/mail.php';
    [$subject, $text, $html] = code_email($code, $purpose, $name);
    try {
        send_mail($email, $subject, $text, $html);
    } catch (Throwable $e) {
        $pdo->prepare('DELETE FROM email_codes WHERE id = ?')->execute([$id]);
        error_log('AURA mail: ' . $e->getMessage());
        fail($e->getMessage() === 'mail_not_configured' ? 'Email sending is not set up on the server yet.' : 'We could not send the email. Check the address and try again.', 502);
    }
}

/** Verifies a code; returns the stored payload (or []) on success, otherwise fails the request. */
function check_code(string $email, string $purpose, string $code): array
{
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1');
    $st->execute([$email, $purpose]);
    $row = $st->fetch();
    if (!$row || strtotime($row['expires_at'] . ' UTC') < time()) {
        fail('This code has expired. Ask for a new one.', 410);
    }
    if ((int) $row['attempts'] >= 5) {
        fail('Too many wrong codes. Ask for a new one.', 429);
    }
    if (!preg_match('/^\d{6}$/', $code) || !hash_equals($row['code_hash'], code_hash($email, $purpose, $code))) {
        $pdo->prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?')->execute([$row['id']]);
        $left = 4 - (int) $row['attempts'];
        fail($left > 0 ? "Wrong code. $left tries left." : 'Too many wrong codes. Ask for a new one.', 400);
    }
    $pdo->prepare('DELETE FROM email_codes WHERE email = ? AND purpose = ?')->execute([$email, $purpose]);
    return $row['payload'] ? (json_decode($row['payload'], true) ?: []) : [];
}

function valid_email(string $email): string
{
    $email = strtolower(trim($email));
    if (strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('Please enter a valid email address.');
    }
    return $email;
}

function valid_password(string $pw): string
{
    if (strlen($pw) < 8 || strlen($pw) > 200) {
        fail('Use a password with at least 8 characters.');
    }
    return $pw;
}

/** Creates the user and their personal monitored record in one transaction. */
function create_member(string $email, string $name, string $passwordHash, string $context): array
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT id FROM users WHERE email = ? FOR UPDATE');
        $st->execute([$email]);
        if ($st->fetch()) {
            $pdo->rollBack();
            fail('This email is already registered. Sign in or reset your password.', 409);
        }
        $positions = ['space' => 'Space crew', 'polar' => 'Polar station', 'home' => 'Home care'];
        $initials = strtoupper(implode('', array_map(fn ($w) => mb_substr($w, 0, 1), array_slice(preg_split('/\s+/', trim($name)) ?: ['A'], 0, 2))));
        $colors = ['#53D7FF', '#B49CFF', '#35D399', '#F6BD60', '#FF8FA3', '#7DD3FC'];
        $pdo->prepare('INSERT INTO crew (name, callsign, position, color, streak_base, context) VALUES (?, ?, ?, ?, 0, ?)')
            ->execute([$name, mb_substr($initials ?: 'A', 0, 3), $positions[$context], $colors[random_int(0, count($colors) - 1)], $context]);
        $crewId = (int) $pdo->lastInsertId();
        $username = 'u' . bin2hex(random_bytes(5));
        $pdo->prepare("INSERT INTO users (username, email, password_hash, role, name, title, crew_id, context, email_verified_at) VALUES (?, ?, ?, 'member', ?, ?, ?, ?, UTC_TIMESTAMP())")
            ->execute([$username, $email, $passwordHash, $name, $positions[$context], $crewId, $context]);
        $userId = (int) $pdo->lastInsertId();
        $pdo->prepare('UPDATE crew SET owner_user_id = ? WHERE id = ?')->execute([$userId, $crewId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
    $st = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$userId]);
    return $st->fetch();
}
