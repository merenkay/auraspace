<?php
// Database setup and upgrades: creates/updates the tables and loads the simulated demo crew.
// Open /api/install.php?token=<install_token from aura-config.php>
//   &reset=1  wipes the demo crew data and reloads it (registered members are kept)
// Safe to open again at any time: every step is idempotent.
declare(strict_types=1);
require __DIR__ . '/lib.php';

ob_start(); // lets us still send an error status after some progress lines were printed
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$cfg = config();
if (!$cfg) {
    http_response_code(503);
    if (config_problem() === 'config_invalid') {
        exit(config_state()['detail'] . ". Create it again with: node tools/make-config.mjs — then upload it with Replace.\n");
    }
    exit("aura-config.php not found. Upload it next to (one level above) public_html first.\n");
}
// A half-edited copy of the example file must never be usable: its placeholder values are public.
foreach (['install_token', 'app_secret', 'demo_password', 'db_pass'] as $placeholderKey) {
    if (stripos((string) ($cfg[$placeholderKey] ?? ''), 'CHANGE-ME') !== false) {
        http_response_code(400);
        exit("aura-config.php still contains the placeholder CHANGE-ME for '$placeholderKey'. Replace it with your own value (or run: node tools/make-config.mjs).\n");
    }
}
$installToken = (string) ($cfg['install_token'] ?? '');
if (strlen($installToken) < 16 || !hash_equals($installToken, (string) ($_GET['token'] ?? ''))) {
    http_response_code(403);
    exit("Forbidden: wrong or missing token (install_token must be at least 16 characters).\n");
}
if (strlen((string) $cfg['demo_password']) < 8) {
    http_response_code(400);
    exit("Set demo_password (at least 8 characters) in aura-config.php.\n");
}

$seed = json_decode((string) @file_get_contents(__DIR__ . '/seed.json'), true);
if (!is_array($seed) || !isset($seed['mission'], $seed['crew'], $seed['staff'], $seed['measurements'])) {
    http_response_code(500);
    exit("seed.json is missing or invalid in /api. Redeploy the site.\n");
}

try {
    $pdo = db();
} catch (Throwable $e) {
    http_response_code(500);
    $prev = $e->getPrevious();
    $why = $e->getMessage() === 'not_configured' ? 'db_name or db_user is missing in aura-config.php' : ($prev ? $prev->getMessage() : $e->getMessage());
    exit("Database connection failed: $why\n");
}

function has_column(PDO $pdo, string $table, string $col): bool
{
    $st = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $st->execute([$table, $col]);
    return (int) $st->fetchColumn() > 0;
}

/** Lower-cased COLUMN_TYPE + EXTRA of a column, e.g. "int(11) auto_increment" or "enum('a','b') ". */
function column_info(PDO $pdo, string $table, string $col): string
{
    $st = $pdo->prepare('SELECT CONCAT(COLUMN_TYPE, \' \', EXTRA) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $st->execute([$table, $col]);
    return strtolower((string) $st->fetchColumn());
}

$step = 'core tables';
try {
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
    $step = 'upgrades';
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
    if (strpos(column_info($pdo, 'users', 'role'), "'member'") === false) {
        $pdo->exec("ALTER TABLE users MODIFY role ENUM('astronaut','surgeon','ground','member') NOT NULL");
        echo "Upgraded: users.role\n";
    }
    foreach (['users', 'crew'] as $table) {
        if (strpos(column_info($pdo, $table, 'id'), 'auto_increment') === false) {
            $pdo->exec("ALTER TABLE $table MODIFY id INT NOT NULL AUTO_INCREMENT");
            echo "Upgraded: $table.id\n";
        }
        // keep registered accounts clear of the fixed demo ids (InnoDB silently uses max(id)+1 if that is higher)
        $pdo->exec("ALTER TABLE $table AUTO_INCREMENT = 1000");
    }

    // Feature modules (schema/*.php): run their idempotent table steps.
    foreach (schema_modules() as $moduleName => $module) {
        $step = "module $moduleName";
        foreach (($module['tables'] ?? []) as $tableStep) {
            if ($tableStep instanceof Closure) {
                $tableStep($pdo);
            } else {
                $pdo->exec((string) $tableStep);
            }
        }
        echo "Module ready: $moduleName\n";
    }
    echo "Tables ready.\n";

    $step = 'demo data check';
    $hasDemo = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role <> 'member'")->fetchColumn() > 0;
    if ($hasDemo && empty($_GET['reset'])) {
        exit("Demo data already present — nothing else changed. Add &reset=1 to reload the demo crew.\n");
    }

    // Prepare the demo rows before touching the database. Mission day N is "today" in the configured timezone;
    // seed rows carry day + minute-of-day, and rows later than now are skipped (not measured yet).
    $m = $seed['mission'];
    $start = (new DateTimeImmutable('today', tz()))->modify('-' . ((int) $m['day'] - 1) . ' days');
    $nowTs = time();
    $rows = [];
    foreach ($seed['measurements'] as $r) {
        $ts = $start->getTimestamp() + ((int) $r['d'] - 1) * 86400 + (int) $r['t'] * 60;
        if ($ts > $nowTs) {
            continue;
        }
        $rows[] = [(int) $r['c'], (string) $r['m'], (float) $r['v'], (int) $r['d'], gmdate('Y-m-d H:i:s', $ts), (string) $r['s'], (string) $r['dev']];
    }
    $hash = password_hash((string) $cfg['demo_password'], PASSWORD_DEFAULT);

    // One transaction (plain DML only, no DDL): either the whole demo crew is replaced or nothing changes.
    $step = 'demo reset';
    $pdo->beginTransaction();

    // Remove only the simulated demo crew and staff (owner_user_id IS NULL); registered members are untouched.
    $demoCrew = array_map('intval', $pdo->query('SELECT id FROM crew WHERE owner_user_id IS NULL')->fetchAll(PDO::FETCH_COLUMN));
    if ($demoCrew) {
        $in = implode(',', $demoCrew);
        foreach (['measurements', 'task_done', 'reports'] as $t) {
            $pdo->exec("DELETE FROM $t WHERE crew_id IN ($in)");
        }
        foreach ($demoCrew as $demoId) {
            purge_modules($pdo, $demoId, $demoId); // demo users share their crew id
        }
        $pdo->exec("DELETE FROM crew WHERE id IN ($in)");
    }
    $pdo->exec("DELETE FROM users WHERE role <> 'member'");
    $pdo->exec('DELETE FROM mission');
    $pdo->exec('DELETE FROM login_attempts');

    $step = 'demo seed';
    $pdo->prepare('INSERT INTO mission (id, name, profile_id, day, total_days, environment) VALUES (1, ?, ?, ?, ?, ?)')
        ->execute([(string) $m['name'], (string) $m['profileId'], (int) $m['day'], (int) $m['totalDays'], (string) $m['environment']]);

    $insCrew = $pdo->prepare("INSERT INTO crew (id, name, callsign, position, color, streak_base, context) VALUES (?, ?, ?, ?, ?, ?, 'space')");
    $insUser = $pdo->prepare("INSERT INTO users (id, username, password_hash, role, name, title, crew_id, context) VALUES (?, ?, ?, ?, ?, ?, ?, 'space')");
    foreach ($seed['crew'] as $c) {
        $insCrew->execute([(int) $c['id'], $c['name'], $c['callsign'], $c['position'], $c['color'], (int) $c['streak']]);
        $insUser->execute([(int) $c['id'], $c['username'], $hash, 'astronaut', $c['name'], $c['position'] . ' · ' . $c['callsign'], (int) $c['id']]);
    }
    foreach ($seed['staff'] as $s) {
        $insUser->execute([(int) $s['id'], $s['username'], $hash, $s['role'], $s['name'], $s['title'], null]);
    }

    foreach (array_chunk($rows, 400) as $chunk) {
        $ph = implode(',', array_fill(0, count($chunk), '(?,?,?,?,?,?,?)'));
        $pdo->prepare("INSERT INTO measurements (crew_id, metric, value, day, measured_at, source, device) VALUES $ph")
            ->execute(array_merge(...$chunk));
    }
    $insTask = $pdo->prepare('INSERT INTO task_done (crew_id, task_id, day, done_at) VALUES (?, ?, ?, UTC_TIMESTAMP())');
    foreach ($seed['crew'] as $c) {
        foreach ($c['doneTasks'] as $t) {
            $insTask->execute([(int) $c['id'], (string) $t, (int) $m['day']]);
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo "\nINSTALL FAILED during: $step\n" . get_class($e) . ': ' . $e->getMessage() . "\n";
    echo "The demo data was not changed by the failed step. Fix the cause and open this address again (it is safe to re-run).\n";
    exit;
}

audit(null, 'install', 'demo data loaded');
printf("Loaded %d crew, %d staff accounts and %d measurements.\n", count($seed['crew']), count($seed['staff']), count($rows));
echo 'Usernames: ' . implode(', ', array_merge(array_column($seed['crew'], 'username'), array_column($seed['staff'], 'username'))) . "\n";
echo "Password for every demo account: the demo_password in aura-config.php.\n";
$smtpUsed = !empty($cfg['smtp_host']) && !empty($cfg['smtp_user']);
echo 'Email: ' . (filter_var($cfg['mail_from'] ?? '', FILTER_VALIDATE_EMAIL) ? 'configured (' . ($smtpUsed ? (string) $cfg['smtp_host'] : 'PHP mail()') . ")\n" : "NOT configured — sign-up codes cannot be sent until mail_from/SMTP are set.\n");
