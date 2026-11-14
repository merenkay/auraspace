<?php
// Database setup and upgrades: creates/updates the tables and loads the simulated demo crew.
// Open /api/install.php?token=<install_token from aura-config.php>
//   &reset=1  wipes the demo crew data and reloads it (registered members are kept)
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

$seed = json_decode((string) @file_get_contents(__DIR__ . '/seed.json'), true);
if (!is_array($seed)) {
    http_response_code(500);
    exit("seed.json is missing or invalid in /api. Redeploy the site.\n");
}

$pdo = db();
$schema = [
    "CREATE TABLE IF NOT EXISTS mission (
        id INT PRIMARY KEY, name VARCHAR(80) NOT NULL, profile_id VARCHAR(32) NOT NULL,
        day INT NOT NULL, total_days INT NOT NULL, environment VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS crew (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, callsign VARCHAR(8) NOT NULL,
        position VARCHAR(60) NOT NULL, color VARCHAR(9) NOT NULL, streak_base INT NOT NULL DEFAULT 0,
        context VARCHAR(8) NOT NULL DEFAULT 'space', owner_user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE IF NOT EXISTS users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, username VARCHAR(40) NOT NULL UNIQUE, email VARCHAR(190) NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL, role ENUM('astronaut','surgeon','ground','member') NOT NULL,
        name VARCHAR(100) NOT NULL, title VARCHAR(120) NOT NULL, crew_id INT NULL,
        context VARCHAR(8) NOT NULL DEFAULT 'space', email_verified_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "CREATE TABLE IF NOT EXISTS email_codes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(190) NOT NULL, purpose ENUM('register','reset') NOT NULL,
        code_hash CHAR(64) NOT NULL, payload TEXT NULL, attempts INT NOT NULL DEFAULT 0, expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ip VARCHAR(45) NOT NULL DEFAULT '',
        INDEX idx_email (email, purpose), INDEX idx_ip (ip, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
];
foreach ($schema as $sql) {
    $pdo->exec($sql);
}

// Upgrades for databases created by the first version of this script.
function has_column(PDO $pdo, string $table, string $col): bool
{
    $st = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $st->execute([$table, $col]);
    return (int) $st->fetchColumn() > 0;
}
$upgrades = [
    ['users', 'email', 'ALTER TABLE users ADD COLUMN email VARCHAR(190) NULL UNIQUE AFTER username'],
    ['users', 'context', "ALTER TABLE users ADD COLUMN context VARCHAR(8) NOT NULL DEFAULT 'space'"],
    ['users', 'email_verified_at', 'ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL'],
    ['crew', 'context', "ALTER TABLE crew ADD COLUMN context VARCHAR(8) NOT NULL DEFAULT 'space'"],
    ['crew', 'owner_user_id', 'ALTER TABLE crew ADD COLUMN owner_user_id INT NULL'],
    ['crew', 'created_at', 'ALTER TABLE crew ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
];
foreach ($upgrades as [$table, $col, $sql]) {
    if (!has_column($pdo, $table, $col)) {
        $pdo->exec($sql);
        echo "Upgraded: $table.$col\n";
    }
}
$pdo->exec("ALTER TABLE users MODIFY role ENUM('astronaut','surgeon','ground','member') NOT NULL");
$pdo->exec('ALTER TABLE users MODIFY id INT NOT NULL AUTO_INCREMENT');
$pdo->exec('ALTER TABLE crew MODIFY id INT NOT NULL AUTO_INCREMENT');
// keep registered accounts clear of the fixed demo ids
$pdo->exec('ALTER TABLE users AUTO_INCREMENT = 1000');
$pdo->exec('ALTER TABLE crew AUTO_INCREMENT = 1000');

// Feature modules (schema/*.php): run their idempotent table steps.
foreach (schema_modules() as $moduleName => $module) {
    foreach (($module['tables'] ?? []) as $step) {
        if ($step instanceof Closure) {
            $step($pdo);
        } else {
            $pdo->exec((string) $step);
        }
    }
    echo "Module ready: $moduleName\n";
}
echo "Tables ready.\n";

$hasDemo = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role <> 'member'")->fetchColumn() > 0;
if ($hasDemo && empty($_GET['reset'])) {
    exit("Demo data already present — nothing else changed. Add &reset=1 to reload the demo crew.\n");
}

// Remove only the simulated demo crew and staff (owner_user_id IS NULL); registered members are untouched.
$demoCrew = $pdo->query('SELECT id FROM crew WHERE owner_user_id IS NULL')->fetchAll(PDO::FETCH_COLUMN);
if ($demoCrew) {
    $in = implode(',', array_map('intval', $demoCrew));
    foreach (['measurements', 'task_done', 'reports'] as $t) {
        $pdo->exec("DELETE FROM $t WHERE crew_id IN ($in)");
    }
    foreach ($demoCrew as $demoId) {
        purge_modules($pdo, (int) $demoId, (int) $demoId); // demo users share their crew id
    }
    $pdo->exec("DELETE FROM crew WHERE id IN ($in)");
}
$pdo->exec("DELETE FROM users WHERE role <> 'member'");
$pdo->exec('DELETE FROM mission');
$pdo->exec('DELETE FROM login_attempts');

$m = $seed['mission'];
$pdo->prepare('INSERT INTO mission (id, name, profile_id, day, total_days, environment) VALUES (1, ?, ?, ?, ?, ?)')
    ->execute([$m['name'], $m['profileId'], $m['day'], $m['totalDays'], $m['environment']]);

$hash = password_hash((string) $cfg['demo_password'], PASSWORD_DEFAULT);
$insCrew = $pdo->prepare("INSERT INTO crew (id, name, callsign, position, color, streak_base, context) VALUES (?, ?, ?, ?, ?, ?, 'space')");
$insUser = $pdo->prepare("INSERT INTO users (id, username, password_hash, role, name, title, crew_id, context) VALUES (?, ?, ?, ?, ?, ?, ?, 'space')");
foreach ($seed['crew'] as $c) {
    $insCrew->execute([$c['id'], $c['name'], $c['callsign'], $c['position'], $c['color'], $c['streak']]);
    $insUser->execute([$c['id'], $c['username'], $hash, 'astronaut', $c['name'], $c['position'] . ' · ' . $c['callsign'], $c['id']]);
}
foreach ($seed['staff'] as $s) {
    $insUser->execute([$s['id'], $s['username'], $hash, $s['role'], $s['name'], $s['title'], null]);
}

// Mission day N is "today" in the configured timezone; seed rows carry day + minute-of-day.
$start = (new DateTimeImmutable('today', tz()))->modify('-' . ((int) $m['day'] - 1) . ' days');
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
echo 'Usernames: ' . implode(', ', array_merge(array_column($seed['crew'], 'username'), array_column($seed['staff'], 'username'))) . "\n";
echo "Password for every demo account: the demo_password in aura-config.php.\n";
echo 'Email: ' . (filter_var($cfg['mail_from'] ?? '', FILTER_VALIDATE_EMAIL) ? 'configured (' . ($cfg['smtp_host'] ?: 'PHP mail()') . ")\n" : "NOT configured — sign-up codes cannot be sent until mail_from/SMTP are set.\n");
