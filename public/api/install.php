<?php
// One-time database setup: creates the tables and loads the simulated demo crew.
// Open /api/install.php?token=<install_token from aura-config.php>   (add &reset=1 to wipe and reload)
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$cfg = config();
if (!$cfg) {
    http_response_code(503);
    exit("aura-config.php not found. Upload it next to (one level above) public_html first.\n");
}
if (empty($cfg['install_token']) || strlen($cfg['install_token']) < 16 || !hash_equals($cfg['install_token'], (string) ($_GET['token'] ?? ''))) {
    http_response_code(403);
    exit("Forbidden: wrong or missing token (install_token must be at least 16 characters).\n");
}
if (strlen((string) $cfg['demo_password']) < 8) {
    http_response_code(400);
    exit("Set demo_password (at least 8 characters) in aura-config.php.\n");
}

$seedFile = __DIR__ . '/seed.json';
if (!is_file($seedFile)) {
    http_response_code(500);
    exit("seed.json is missing from /api. Redeploy the site.\n");
}
$seed = json_decode((string) file_get_contents($seedFile), true);
if (!is_array($seed)) {
    http_response_code(500);
    exit("seed.json is not valid JSON.\n");
}

$pdo = db();
$schema = [
    "CREATE TABLE IF NOT EXISTS mission (
        id INT PRIMARY KEY, name VARCHAR(80) NOT NULL, profile_id VARCHAR(32) NOT NULL,
        day INT NOT NULL, total_days INT NOT NULL, environment VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS crew (
        id INT PRIMARY KEY, name VARCHAR(100) NOT NULL, callsign VARCHAR(8) NOT NULL,
        position VARCHAR(60) NOT NULL, color VARCHAR(9) NOT NULL, streak_base INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY, username VARCHAR(40) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
        role ENUM('astronaut','surgeon','ground') NOT NULL, name VARCHAR(100) NOT NULL, title VARCHAR(120) NOT NULL,
        crew_id INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS measurements (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, crew_id INT NOT NULL, metric VARCHAR(16) NOT NULL,
        value DECIMAL(8,2) NOT NULL, day INT NOT NULL, measured_at DATETIME NOT NULL,
        source VARCHAR(16) NOT NULL, device VARCHAR(60) NOT NULL, entered_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_crew_metric_day (crew_id, metric, day), INDEX idx_crew_time (crew_id, measured_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS task_done (
        crew_id INT NOT NULL, task_id VARCHAR(16) NOT NULL, day INT NOT NULL, done_at DATETIME NOT NULL,
        PRIMARY KEY (crew_id, task_id, day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS reports (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, crew_id INT NOT NULL, day INT NOT NULL, created_at DATETIME NOT NULL,
        status ENUM('queued','delivered','reviewed') NOT NULL DEFAULT 'queued', summary MEDIUMTEXT NOT NULL,
        review_note TEXT NULL, reviewed_by INT NULL, reviewed_at DATETIME NULL, INDEX idx_crew (crew_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS audit_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL, action VARCHAR(40) NOT NULL,
        detail VARCHAR(255) NOT NULL DEFAULT '', ip VARCHAR(45) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS login_attempts (
        ip VARCHAR(45) NOT NULL, attempted_at DATETIME NOT NULL, INDEX idx_ip_time (ip, attempted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
];
foreach ($schema as $sql) {
    $pdo->exec($sql);
}
echo "Tables ready.\n";

$hasData = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0;
if ($hasData && empty($_GET['reset'])) {
    exit("Data already present — nothing changed. Add &reset=1 to wipe and reload the demo data.\n");
}

foreach (['measurements', 'task_done', 'reports', 'users', 'crew', 'mission', 'login_attempts'] as $t) {
    $pdo->exec("DELETE FROM $t");
}

$m = $seed['mission'];
$pdo->prepare('INSERT INTO mission (id, name, profile_id, day, total_days, environment) VALUES (1, ?, ?, ?, ?, ?)')
    ->execute([$m['name'], $m['profileId'], $m['day'], $m['totalDays'], $m['environment']]);

$hash = password_hash((string) $cfg['demo_password'], PASSWORD_DEFAULT);
$insCrew = $pdo->prepare('INSERT INTO crew (id, name, callsign, position, color, streak_base) VALUES (?, ?, ?, ?, ?, ?)');
$insUser = $pdo->prepare('INSERT INTO users (id, username, password_hash, role, name, title, crew_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
foreach ($seed['crew'] as $c) {
    $insCrew->execute([$c['id'], $c['name'], $c['callsign'], $c['position'], $c['color'], $c['streak']]);
    $insUser->execute([$c['id'], $c['username'], $hash, 'astronaut', $c['name'], $c['position'] . ' · ' . $c['callsign'], $c['id']]);
}
foreach ($seed['staff'] as $s) {
    $insUser->execute([$s['id'], $s['username'], $hash, $s['role'], $s['name'], $s['title'], null]);
}

// Mission day N is "today" in the configured timezone; seed rows carry day + minute-of-day.
$tz = new DateTimeZone($cfg['timezone'] ?: 'UTC');
$start = (new DateTimeImmutable('today', $tz))->modify('-' . ((int) $m['day'] - 1) . ' days');
$nowTs = time();
$rows = [];
foreach ($seed['measurements'] as $r) {
    $ts = $start->getTimestamp() + ((int) $r['d'] - 1) * 86400 + (int) $r['t'] * 60;
    if ($ts > $nowTs) {
        continue; // later today: not measured yet
    }
    $rows[] = [(int) $r['c'], $r['m'], (float) $r['v'], (int) $r['d'], gmdate('Y-m-d H:i:s', $ts), $r['s'], $r['dev']];
}
$pdo->beginTransaction();
foreach (array_chunk($rows, 400) as $chunk) {
    $ph = implode(',', array_fill(0, count($chunk), '(?,?,?,?,?,?,?)'));
    $pdo->prepare("INSERT INTO measurements (crew_id, metric, value, day, measured_at, source, device) VALUES $ph")
        ->execute(array_merge(...$chunk));
}
$insTask = $pdo->prepare('INSERT INTO task_done (crew_id, task_id, day, done_at) VALUES (?, ?, ?, UTC_TIMESTAMP())');
foreach ($seed['crew'] as $c) {
    foreach ($c['doneTasks'] as $t) {
        $insTask->execute([$c['id'], $t, $m['day']]);
    }
}
$pdo->commit();

audit(null, 'install', 'demo data loaded');
printf("Loaded %d crew, %d staff accounts and %d measurements.\n", count($seed['crew']), count($seed['staff']), count($rows));
echo "Usernames: " . implode(', ', array_merge(array_column($seed['crew'], 'username'), array_column($seed['staff'], 'username'))) . "\n";
echo "Password for every account: the demo_password in aura-config.php.\n";
