<?php
// AURA report read markers: when the crew member opened the flight surgeon's reply, plus when that reply was written.
//
//   GET  reportread/list[?crew=<id>]  -> {items: [{reportId, reviewedAt, readAt}]}  newest first (max 100, like GET reports)
//   POST reportread/mark  {ids: [int, ...]} (max 100) -> {ok: true, marked: <n>}
//
// Privacy mirrors GET reports in index.php: self users (astronaut, member) see and mark only their own reports; the
// flight surgeon sees the read state of the simulated crew's reports only (crew.owner_user_id IS NULL); ground has no
// access. Only a report that has a reply (status 'reviewed') can be marked read. If the surgeon later changes the
// reply, reviewed_at moves past read_at and the client shows the reply as unread again.
declare(strict_types=1);

return (function (): array {
    // A missing table/column (install.php not re-run after a deploy) answers with the same 503 as the rest of the API.
    $guard = function (Closure $fn): void {
        try {
            $fn();
        } catch (PDOException $e) {
            if (in_array(sqlstate($e), ['42S02', '42S22'], true)) {
                error_log('AURA reportread: ' . $e->getMessage());
                fail('Feature tables are not installed yet — re-run the installer (api/install.php).', 503);
            }
            throw $e;
        }
    };

    $isoOrNull = function ($v): ?string {
        return $v === null ? null : iso((string) $v);
    };

    return [
        'GET reportread/list' => function () use ($guard, $isoOrNull): void {
            $u = require_user();
            require_role($u, ['astronaut', 'member', 'surgeon']);
            $args = [];
            if (is_self_user($u)) {
                if ($u['crewId'] === null) {
                    fail('Not allowed', 403);
                }
                $where = ' WHERE r.crew_id = ?';
                $args[] = (int) $u['crewId'];
            } else {
                $where = ' WHERE c.owner_user_id IS NULL';
                if (!empty($_GET['crew'])) {
                    $where .= ' AND r.crew_id = ?';
                    $args[] = (int) $_GET['crew'];
                }
            }
            $guard(function () use ($where, $args, $isoOrNull): void {
                $st = db()->prepare('SELECT r.id, r.reviewed_at, rr.read_at FROM reports r JOIN crew c ON c.id = r.crew_id LEFT JOIN report_reads rr ON rr.report_id = r.id'
                    . $where . ' ORDER BY r.created_at DESC LIMIT 100');
                $st->execute($args);
                $items = [];
                foreach ($st->fetchAll() as $row) {
                    $items[] = [
                        'reportId' => (int) $row['id'],
                        'reviewedAt' => $isoOrNull($row['reviewed_at']),
                        'readAt' => $isoOrNull($row['read_at']),
                    ];
                }
                json_out(['items' => $items]);
            });
        },

        'POST reportread/mark' => function () use ($guard): void {
            $u = require_user();
            require_role($u, ['astronaut', 'member']);
            if ($u['crewId'] === null) {
                fail('Not allowed', 403);
            }
            $b = body();
            $list = $b['ids'] ?? null;
            if (!is_array($list) || count($list) > 100) {
                fail('Invalid ids');
            }
            $ids = [];
            foreach ($list as $v) {
                if (is_int($v) && $v > 0 && !in_array($v, $ids, true)) {
                    $ids[] = $v;
                }
            }
            if (!$ids) {
                json_out(['ok' => true, 'marked' => 0]);
            }
            $crewId = (int) $u['crewId'];
            $userId = (int) $u['id'];
            $guard(function () use ($ids, $crewId, $userId): void {
                $pdo = db();
                // Own report with a reply only; anything else is skipped silently (no information about other ids).
                $own = $pdo->prepare("SELECT id FROM reports WHERE id = ? AND crew_id = ? AND status = 'reviewed'");
                $put = $pdo->prepare('INSERT INTO report_reads (report_id, crew_id, user_id, read_at) VALUES (?, ?, ?, UTC_TIMESTAMP())
                    ON DUPLICATE KEY UPDATE read_at = UTC_TIMESTAMP(), user_id = ?');
                $n = 0;
                foreach ($ids as $id) {
                    $own->execute([$id, $crewId]);
                    $found = $own->fetchColumn();
                    $own->closeCursor();
                    if ($found === false) {
                        continue;
                    }
                    $put->execute([$id, $crewId, $userId, $userId]);
                    $n++;
                }
                if ($n > 0) {
                    audit($userId, 'report_reply_read', 'reports ' . substr(implode(',', $ids), 0, 200));
                }
                json_out(['ok' => true, 'marked' => $n]);
            });
        },
    ];
})();
