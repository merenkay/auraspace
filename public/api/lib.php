<?php
// Shared helpers for the AURA API: config, database, sessions, JSON and access control.
declare(strict_types=1);

const TASKS = [
    ['id' => 'bp', 'label' => 'Morning blood pressure', 'time' => '08:30'],
    ['id' => 'temp', 'label' => 'Body temperature', 'time' => '08:45'],
    ['id' => 'mood', 'label' => 'Mood check-in', 'time' => '09:00'],
    ['id' => 'ared', 'label' => 'ARED resistance session', 'time' => '11:00'],
    ['id' => 'vision', 'label' => 'Vision self-check', 'time' => '14:00'],
    ['id' => 'water', 'label' => 'Log water intake', 'time' => '20:00'],
];

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
                    'db_host' => 'localhost', 'timezone' => 'Europe/Istanbul', 'allow_demo' => true,
                    'install_token' => '', 'demo_password' => '', 'openai_api_key' => '', 'openai_model' => '',
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

function current_user(): ?array
{
    start_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) {
        return null;
    }
    $st = db()->prepare('SELECT id, username, role, name, title, crew_id FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    return $u ? user_json($u) : null;
}

function user_json(array $u): array
{
    return [
        'id' => (int) $u['id'], 'username' => $u['username'], 'role' => $u['role'], 'name' => $u['name'],
        'title' => $u['title'], 'crewId' => $u['crew_id'] !== null ? (int) $u['crew_id'] : null,
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

function can_view_crew(array $u, int $crewId): bool
{
    return $u['role'] !== 'astronaut' || $u['crewId'] === $crewId;
}

function audit(?int $userId, string $action, string $detail = ''): void
{
    try {
        db()->prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)')
            ->execute([$userId, $action, mb_substr($detail, 0, 250), $_SERVER['REMOTE_ADDR'] ?? '']);
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
    return ['name' => $m['name'], 'profileId' => $m['profile_id'], 'day' => (int) $m['day'], 'totalDays' => (int) $m['total_days'], 'environment' => $m['environment']];
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

function tasks_for(int $crewId, int $day): array
{
    $st = db()->prepare('SELECT task_id FROM task_done WHERE crew_id = ? AND day = ?');
    $st->execute([$crewId, $day]);
    $done = array_column($st->fetchAll(), 'task_id');
    $tasks = array_map(fn ($t) => $t + ['done' => in_array($t['id'], $done, true)], TASKS);
    $base = db()->prepare('SELECT streak_base FROM crew WHERE id = ?');
    $base->execute([$crewId]);
    $streak = (int) ($base->fetchColumn() ?: 0);
    $all = count(array_filter($tasks, fn ($t) => $t['done'])) === count($tasks);
    return ['tasks' => $tasks, 'streak' => $streak + ($all ? 1 : 0)];
}
