<?php
// AURA clinic API: health profile + saved consultation results.
//
//   GET  clinic/profile?crew=<id>         -> {profile: {...} | null}
//   POST clinic/profile                   {crewId, profile: {ageBand, conditions[], allergies[], medicines[], notes}} -> {profile}
//   GET  clinic/assessments?crew=<id>     -> {items: [...]} newest first (max 50)
//   POST clinic/assessments               {crewId, assessment: {context, urgency, conditionId, conditionName, strength, findings[], note}} -> {item}
//
// Privacy: astronauts and members read and write only their own record. The flight surgeon may READ the
// simulated demo crew (can_view_crew). Mission control (ground) may not read either. Allowed ids mirror
// src/data/conditions/profile.ts and src/lib/doctor/findings.ts.
declare(strict_types=1);

return (function (): array {
    $allowed = [
        'ageBand' => ['under-40', '40-64', '65-79', '80+'],
        'conditions' => ['hypertension', 'heart-disease', 'angina', 'heart-failure', 'previous-stroke', 'diabetes', 'asthma', 'copd', 'severe-allergy',
            'kidney-disease', 'kidney-stones', 'liver-disease', 'stomach-ulcer', 'bleeding-disorder', 'osteoporosis', 'falls-history', 'panic-disorder',
            'depression', 'pregnancy'],
        'allergies' => ['aspirin', 'nsaid', 'paracetamol', 'penicillin', 'nuts', 'insect-stings', 'latex'],
        'medicines' => ['anticoagulant', 'antiplatelet', 'blood-pressure', 'gtn', 'insulin', 'diabetes-tablets', 'reliever-inhaler',
            'adrenaline-autoinjector', 'antidepressant', 'steroid', 'nsaid-regular', 'diuretic'],
    ];
    $urgencies = ['selfcare', 'soon', 'urgent', 'emergency'];
    $strengths = ['strong', 'moderate', 'weak'];
    $answers = ['yes', 'no', 'unsure'];

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

    $guard = function (Closure $fn): void {
        try {
            $fn();
        } catch (PDOException $e) {
            if ((string) $e->getCode() === '42S02') {
                fail('Clinic storage is not set up on the server yet (run install.php).', 503);
            }
            throw $e;
        }
    };

    $ids = function ($list, array $ok): array {
        if (!is_array($list)) {
            return [];
        }
        $out = [];
        foreach ($list as $v) {
            if (is_string($v) && in_array($v, $ok, true) && !in_array($v, $out, true)) {
                $out[] = $v;
            }
        }
        return $out;
    };

    $profileJson = function (array $row): array {
        $d = json_decode((string) $row['data'], true);
        $d = is_array($d) ? $d : [];
        return [
            'ageBand' => $d['ageBand'] ?? null,
            'conditions' => is_array($d['conditions'] ?? null) ? $d['conditions'] : [],
            'allergies' => is_array($d['allergies'] ?? null) ? $d['allergies'] : [],
            'medicines' => is_array($d['medicines'] ?? null) ? $d['medicines'] : [],
            'notes' => (string) ($d['notes'] ?? ''),
            'updatedAt' => iso((string) $row['updated_at']),
        ];
    };

    $assessmentJson = function (array $row): array {
        $d = json_decode((string) $row['data'], true);
        $d = is_array($d) ? $d : [];
        return [
            'id' => (int) $row['id'],
            'crewId' => (int) $row['crew_id'],
            'createdAt' => iso((string) $row['created_at']),
            'context' => (string) $row['context'],
            'urgency' => (string) $row['urgency'],
            'conditionId' => $row['condition_id'] === null ? null : (string) $row['condition_id'],
            'conditionName' => (string) ($d['conditionName'] ?? ''),
            'strength' => $d['strength'] ?? null,
            'findings' => is_array($d['findings'] ?? null) ? $d['findings'] : [],
            'note' => (string) ($d['note'] ?? ''),
        ];
    };

    return [
        'GET clinic/profile' => function () use ($canRead, $guard, $profileJson): void {
            $u = require_user();
            $crewId = (int) ($_GET['crew'] ?? 0);
            if (!$canRead($u, $crewId)) {
                fail('Not allowed', 403);
            }
            $guard(function () use ($crewId, $profileJson): void {
                $st = db()->prepare('SELECT data, updated_at FROM clinic_profiles WHERE crew_id = ?');
                $st->execute([$crewId]);
                $row = $st->fetch();
                json_out(['profile' => $row ? $profileJson($row) : null]);
            });
        },

        'POST clinic/profile' => function () use ($selfOnly, $guard, $ids, $allowed, $profileJson): void {
            $u = require_user();
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            $selfOnly($u, $crewId);
            $p = is_array($b['profile'] ?? null) ? $b['profile'] : [];
            $age = $p['ageBand'] ?? null;
            $data = [
                'ageBand' => is_string($age) && in_array($age, $allowed['ageBand'], true) ? $age : null,
                'conditions' => $ids($p['conditions'] ?? null, $allowed['conditions']),
                'allergies' => $ids($p['allergies'] ?? null, $allowed['allergies']),
                'medicines' => $ids($p['medicines'] ?? null, $allowed['medicines']),
                'notes' => mb_substr(trim((string) ($p['notes'] ?? '')), 0, 300),
            ];
            $guard(function () use ($u, $crewId, $data, $profileJson): void {
                db()->prepare('INSERT INTO clinic_profiles (crew_id, data, updated_at, updated_by) VALUES (?, ?, UTC_TIMESTAMP(), ?)
                    ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)')
                    ->execute([$crewId, json_encode($data, JSON_UNESCAPED_UNICODE), $u['id']]);
                audit($u['id'], 'clinic_profile');
                $st = db()->prepare('SELECT data, updated_at FROM clinic_profiles WHERE crew_id = ?');
                $st->execute([$crewId]);
                json_out(['profile' => $profileJson($st->fetch())]);
            });
        },

        'GET clinic/assessments' => function () use ($canRead, $guard, $assessmentJson): void {
            $u = require_user();
            $crewId = (int) ($_GET['crew'] ?? 0);
            if (!$canRead($u, $crewId)) {
                fail('Not allowed', 403);
            }
            $guard(function () use ($crewId, $assessmentJson): void {
                $st = db()->prepare('SELECT * FROM clinic_assessments WHERE crew_id = ? ORDER BY created_at DESC, id DESC LIMIT 50');
                $st->execute([$crewId]);
                json_out(['items' => array_map($assessmentJson, $st->fetchAll())]);
            });
        },

        'POST clinic/assessments' => function () use ($selfOnly, $guard, $urgencies, $strengths, $answers, $assessmentJson): void {
            $u = require_user();
            $b = body();
            $crewId = (int) ($b['crewId'] ?? 0);
            $selfOnly($u, $crewId);
            $a = is_array($b['assessment'] ?? null) ? $b['assessment'] : [];
            $context = (string) ($a['context'] ?? '');
            $urgency = (string) ($a['urgency'] ?? '');
            if (!in_array($context, CONTEXTS, true) || !in_array($urgency, $urgencies, true)) {
                fail('Invalid assessment');
            }
            $cid = $a['conditionId'] ?? null;
            if ($cid !== null && (!is_string($cid) || !preg_match('/^[a-z0-9-]{1,48}$/', $cid))) {
                fail('Invalid condition');
            }
            $strength = $a['strength'] ?? null;
            if ($strength !== null && !in_array($strength, $strengths, true)) {
                $strength = null;
            }
            $findings = [];
            foreach ((is_array($a['findings'] ?? null) ? array_slice($a['findings'], 0, 60) : []) as $f) {
                $fid = is_array($f) ? ($f['id'] ?? null) : null;
                $ans = is_array($f) ? ($f['answer'] ?? null) : null;
                if (is_string($fid) && preg_match('/^[a-z0-9-]{1,40}$/', $fid) && in_array($ans, $answers, true)) {
                    $findings[] = ['id' => $fid, 'answer' => $ans];
                }
            }
            $data = [
                'conditionName' => mb_substr(trim((string) ($a['conditionName'] ?? '')), 0, 120),
                'strength' => $strength,
                'findings' => $findings,
                'note' => mb_substr(trim((string) ($a['note'] ?? '')), 0, 500),
            ];
            $guard(function () use ($u, $crewId, $context, $urgency, $cid, $data, $assessmentJson): void {
                $pdo = db();
                $st = $pdo->prepare('SELECT COUNT(*) FROM clinic_assessments WHERE crew_id = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)');
                $st->execute([$crewId]);
                if ((int) $st->fetchColumn() >= 30) {
                    fail('Too many saved assessments in the last hour. Try again later.', 429);
                }
                $pdo->prepare('INSERT INTO clinic_assessments (crew_id, created_at, context, urgency, condition_id, data, created_by) VALUES (?, UTC_TIMESTAMP(), ?, ?, ?, ?, ?)')
                    ->execute([$crewId, $context, $urgency, $cid, json_encode($data, JSON_UNESCAPED_UNICODE), $u['id']]);
                $id = (int) $pdo->lastInsertId();
                audit($u['id'], 'clinic_assessment', "assessment $id");
                $st = $pdo->prepare('SELECT * FROM clinic_assessments WHERE id = ?');
                $st->execute([$id]);
                json_out(['item' => $assessmentJson($st->fetch())]);
            });
        },
    ];
})();
