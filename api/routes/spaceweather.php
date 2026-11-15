<?php
// Space weather from NASA CCMC DONKI and NOAA SWPC, served from one shared server cache.
//
//   GET spaceweather   no sign-in (public data); rate-limited per network (60 requests per 10 minutes)
//     -> { sources: { flr|sep|cme|gst|notifications|scales|protons:
//                     { ok, status, fetchedAt, ageSeconds, stale, error, data } },
//          window: { start, end }, serverTime }
//
// Upstream (key-less, public, no account):
//   https://ccmc.gsfc.nasa.gov/DONKI-API/get/{FLR,SEP,CME,GST,notifications}   7-day UTC window
//   https://services.swpc.noaa.gov/products/noaa-scales.json
//   https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json   (only the >=10 MeV channel is kept)
// Each feed is fetched at most once per TTL for everyone (DONKI 15 min, NOAA 5 min). A failed refresh keeps the last good
// copy, which is served with its age, and is retried after 2 minutes. Downloads are capped (3 MB, 8 s); only whitelisted
// fields are stored (the same whitelist as src/lib/spaceWeather/sanitize.ts). Nothing about the visitor is sent upstream.
declare(strict_types=1);

return (function (): array {
    $donki = 'https://ccmc.gsfc.nasa.gov/DONKI-API/get/';
    $retryAfter = 120;        // seconds before a failed feed is tried again (also the per-feed refresh lock)
    $maxDownload = 3000000;   // bytes per upstream response
    $maxStored = 600000;      // bytes of whitelisted JSON per feed
    $userAgent = 'space-weather-cache/1.0';
    $rateLimit = 60;          // requests per network per 10 minutes

    $feeds = function () use ($donki): array {
        $w = 'startDate=' . gmdate('Y-m-d', time() - 7 * 86400) . '&endDate=' . gmdate('Y-m-d');
        return [
            'flr' => ['url' => $donki . 'FLR?' . $w, 'ttl' => 900],
            'sep' => ['url' => $donki . 'SEP?' . $w, 'ttl' => 900],
            'cme' => ['url' => $donki . 'CME?' . $w . '&mostAccurateOnly=true', 'ttl' => 900],
            'gst' => ['url' => $donki . 'GST?' . $w, 'ttl' => 900],
            'notifications' => ['url' => $donki . 'notifications?' . $w . '&type=all', 'ttl' => 900],
            'scales' => ['url' => 'https://services.swpc.noaa.gov/products/noaa-scales.json', 'ttl' => 300],
            'protons' => ['url' => 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json', 'ttl' => 300],
        ];
    };

    /* ------------------------------------------------------------ whitelist */

    $S = function (int $max): array {
        return ['s', $max];
    };
    $L = function (int $max, array $of): array {
        return ['l', $max, $of];
    };
    $O = function (array $keys): array {
        return ['o', $keys];
    };
    $N = ['n'];
    $I = ['i'];
    $B = ['b'];
    $U = ['u'];
    $T = $S(25);
    $ID = $S(80);
    $instruments = $L(8, $O(['displayName' => $S(80)]));
    $linked = $L(30, $O(['activityID' => $ID]));

    $specs = [
        'flr' => $L(200, $O([
            'flrID' => $ID, 'beginTime' => $T, 'peakTime' => $T, 'endTime' => $T, 'classType' => $S(8), 'sourceLocation' => $S(12),
            'activeRegionNum' => $I, 'link' => $U, 'instruments' => $instruments, 'linkedEvents' => $linked,
        ])),
        'sep' => $L(200, $O(['sepID' => $ID, 'eventTime' => $T, 'link' => $U, 'instruments' => $instruments, 'linkedEvents' => $linked])),
        'cme' => $L(200, $O([
            'activityID' => $ID, 'startTime' => $T, 'sourceLocation' => $S(12), 'activeRegionNum' => $I, 'note' => $S(600), 'link' => $U,
            'linkedEvents' => $linked,
            'cmeAnalyses' => $L(10, $O([
                'isMostAccurate' => $B, 'time21_5' => $T, 'latitude' => $N, 'longitude' => $N, 'halfAngle' => $N, 'speed' => $N,
                'type' => $S(4), 'link' => $U,
                'enlilList' => $L(10, $O([
                    'modelCompletionTime' => $T, 'estimatedShockArrivalTime' => $T, 'isEarthGB' => $B, 'isEarthMinorImpact' => $B,
                    'kp_90' => $I, 'kp_135' => $I, 'kp_180' => $I, 'link' => $U,
                    'impactList' => $L(30, $O(['location' => $S(40), 'arrivalTime' => $T, 'isGlancingBlow' => $B])),
                ])),
            ])),
        ])),
        'gst' => $L(100, $O([
            'gstID' => $ID, 'startTime' => $T, 'link' => $U,
            'allKpIndex' => $L(60, $O(['observedTime' => $T, 'kpIndex' => $N, 'source' => $S(16)])), 'linkedEvents' => $linked,
        ])),
        'notifications' => $L(100, $O(['messageType' => $S(16), 'messageID' => $S(40), 'messageURL' => $U, 'messageIssueTime' => $T, 'messageBody' => $S(3000)])),
    ];
    $scalesDay = $O([
        'DateStamp' => $S(12), 'TimeStamp' => $S(10),
        'R' => $O(['Scale' => $S(2), 'Text' => $S(20), 'MinorProb' => $S(4), 'MajorProb' => $S(4)]),
        'S' => $O(['Scale' => $S(2), 'Text' => $S(20), 'Prob' => $S(4)]),
        'G' => $O(['Scale' => $S(2), 'Text' => $S(20)]),
    ]);
    $proton = $O(['time_tag' => $T, 'satellite' => $I, 'flux' => $N, 'energy' => $S(12)]);

    $safeUrl = function ($v): ?string {
        if (!is_string($v) || strlen($v) > 300 || preg_match('/[\s"<>\\\\]/', $v) === 1) {
            return null;
        }
        $parts = parse_url($v);
        if (!is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https') {
            return null;
        }
        $host = strtolower((string) ($parts['host'] ?? ''));
        return preg_match('/(^|\.)(nasa|noaa)\.gov$/', $host) === 1 ? $v : null;
    };

    // Works on json_decode($body, false): JSON objects are stdClass, JSON arrays are PHP arrays.
    $pick = function ($v, array $spec) use (&$pick, $safeUrl) {
        switch ($spec[0]) {
            case 's':
                if (!is_string($v)) {
                    return null;
                }
                $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $v);
                return is_string($clean) ? mb_substr($clean, 0, (int) $spec[1], 'UTF-8') : null;
            case 'n':
                return ((is_int($v) || is_float($v)) && is_finite((float) $v)) ? $v : null;
            case 'i':
                if (is_int($v)) {
                    return $v;
                }
                return (is_float($v) && is_finite($v) && floor($v) === $v && abs($v) < 2147483647) ? (int) $v : null;
            case 'b':
                return is_bool($v) ? $v : null;
            case 'u':
                return $safeUrl($v);
            case 'l':
                if (!is_array($v)) {
                    return [];
                }
                $out = [];
                foreach (array_slice(array_values($v), 0, (int) $spec[1]) as $item) {
                    $out[] = $pick($item, $spec[2]);
                }
                return $out;
            case 'o':
                if (!($v instanceof stdClass)) {
                    return null;
                }
                $vars = get_object_vars($v);
                $out = new stdClass();
                foreach ($spec[1] as $key => $sub) {
                    if (array_key_exists($key, $vars)) {
                        $out->{$key} = $pick($vars[$key], $sub);
                    }
                }
                return $out;
        }
        return null;
    };

    // Returns the whitelisted value, or null when the payload does not have the expected top-level shape.
    $sanitize = function (string $key, $data) use ($pick, $specs, $scalesDay, $proton) {
        if ($key === 'scales') {
            if (!($data instanceof stdClass)) {
                return null;
            }
            $vars = get_object_vars($data);
            $out = new stdClass();
            $n = 0;
            foreach (['-1', '0', '1', '2', '3'] as $day) {
                if (array_key_exists($day, $vars)) {
                    $out->{$day} = $pick($vars[$day], $scalesDay);
                    $n++;
                }
            }
            return $n > 0 ? $out : null;
        }
        if ($key === 'protons') {
            if (!is_array($data)) {
                return null;
            }
            $rows = [];
            foreach ($data as $r) {
                if ($r instanceof stdClass && isset($r->energy) && $r->energy === '>=10 MeV') {
                    $rows[] = $r;
                }
            }
            $out = [];
            foreach (array_slice($rows, -1500) as $r) {
                $out[] = $pick($r, $proton);
            }
            return $out;
        }
        if (!is_array($data) || !isset($specs[$key])) {
            return null;
        }
        return $pick($data, $specs[$key]);
    };

    /* ------------------------------------------------------------ HTTP (cURL if present, else PHP streams) */

    // Parallel download of $jobs (key => url). Returns key => [true, body] | [false, error code].
    $viaCurl = function (array $jobs) use ($maxDownload, $userAgent): array {
        $mh = curl_multi_init();
        $handles = [];
        $ids = [];
        $bufs = [];
        $over = [];
        foreach ($jobs as $k => $url) {
            $bufs[$k] = '';
            $over[$k] = false;
            $h = curl_init($url);
            curl_setopt_array($h, [
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => 4,
                CURLOPT_TIMEOUT => 8,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
                CURLOPT_USERAGENT => $userAgent,
                CURLOPT_ENCODING => '',
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_HEADER => false,
                CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use ($k, $maxDownload, &$bufs, &$over): int {
                    if (strlen($bufs[$k]) + strlen($chunk) > $maxDownload) {
                        $over[$k] = true;
                        return 0; // aborts this transfer
                    }
                    $bufs[$k] .= $chunk;
                    return strlen($chunk);
                },
            ]);
            curl_multi_add_handle($mh, $h);
            $handles[$k] = $h;
            $ids[is_object($h) ? spl_object_id($h) : (int) $h] = $k;
        }
        $running = 0;
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running > 0 && $status === CURLM_OK && curl_multi_select($mh, 1.0) === -1) {
                usleep(50000);
            }
        } while ($running > 0 && $status === CURLM_OK);

        // Per-transfer result codes (curl_errno() is not reliable for handles run inside a multi handle).
        $results = [];
        while (($info = curl_multi_info_read($mh)) !== false) {
            if (isset($info['handle'])) {
                $h = $info['handle'];
                $id = is_object($h) ? spl_object_id($h) : (int) $h;
                if (isset($ids[$id])) {
                    $results[$ids[$id]] = (int) ($info['result'] ?? -1);
                }
            }
        }
        $out = [];
        foreach ($handles as $k => $h) {
            $code = (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE);
            $result = $results[$k] ?? -1;
            if ($over[$k]) {
                $out[$k] = [false, 'too_large'];
            } elseif ($result === CURLE_OPERATION_TIMEDOUT) {
                $out[$k] = [false, 'timeout'];
            } elseif ($result !== CURLE_OK) {
                $out[$k] = [false, 'unreachable'];
            } elseif ($code !== 200) {
                $out[$k] = [false, 'http_' . $code];
            } else {
                $out[$k] = [true, $bufs[$k]];
            }
            curl_multi_remove_handle($mh, $h);
        }
        curl_multi_close($mh);
        return $out;
    };

    $viaStream = function (string $url) use ($maxDownload, $userAgent): array {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 6,
                'ignore_errors' => true,
                'follow_location' => 0,
                'header' => "Accept: application/json\r\nUser-Agent: " . $userAgent . "\r\n",
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $fp = @fopen($url, 'rb', false, $ctx);
        if ($fp === false) {
            return [false, 'unreachable'];
        }
        stream_set_timeout($fp, 6);
        $code = 0;
        $meta = stream_get_meta_data($fp);
        foreach (($meta['wrapper_data'] ?? []) as $line) {
            if (is_string($line) && preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $code = (int) $m[1];
            }
        }
        $body = stream_get_contents($fp, $maxDownload + 1);
        $after = stream_get_meta_data($fp);
        fclose($fp);
        if (!empty($after['timed_out'])) {
            return [false, 'timeout'];
        }
        if (!is_string($body)) {
            return [false, 'unreachable'];
        }
        if (strlen($body) > $maxDownload) {
            return [false, 'too_large'];
        }
        if ($code !== 200) {
            return [false, 'http_' . $code];
        }
        return [true, $body];
    };

    $hasCurl = function_exists('curl_multi_init') && function_exists('curl_init');
    $hasStreams = filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN) && in_array('https', stream_get_wrappers(), true);

    $download = function (array $jobs) use ($hasCurl, $hasStreams, $viaCurl, $viaStream): array {
        if (!$jobs) {
            return [];
        }
        if ($hasCurl) {
            return $viaCurl($jobs);
        }
        $out = [];
        foreach ($jobs as $k => $url) {
            $out[$k] = $hasStreams ? $viaStream($url) : [false, 'no_http_client'];
        }
        return $out;
    };

    /* ------------------------------------------------------------ rate limit (address stored only as an HMAC) */

    $throttle = function () use ($rateLimit): void {
        $c = config();
        $secret = (string) (($c['app_secret'] ?? '') ?: (($c['install_token'] ?? '') ?: 'aura-spaceweather'));
        $who = hash_hmac('sha256', client_ip(), $secret);
        $pdo = db();
        $pdo->prepare('INSERT INTO spaceweather_hits (ip_hash, minute_at, hits) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1')
            ->execute([$who, gmdate('Y-m-d H:i:00')]);
        $st = $pdo->prepare('SELECT COALESCE(SUM(hits), 0) FROM spaceweather_hits WHERE ip_hash = ? AND minute_at > (UTC_TIMESTAMP() - INTERVAL 10 MINUTE)');
        $st->execute([$who]);
        if ((int) $st->fetchColumn() > $rateLimit) {
            fail('Too many requests. Space weather changes slowly; try again in a few minutes.', 429);
        }
        if (random_int(1, 100) === 1) {
            $pdo->exec('DELETE FROM spaceweather_hits WHERE minute_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY) LIMIT 5000');
        }
    };

    return [
        'GET spaceweather' => function () use ($feeds, $throttle, $download, $sanitize, $retryAfter, $maxStored, $hasCurl): void {
            try {
                $throttle();
                $pdo = db();
                $defs = $feeds();

                $rows = [];
                foreach ($pdo->query('SELECT source, fetched_at FROM spaceweather_cache')->fetchAll() as $r) {
                    $rows[(string) $r['source']] = $r;
                }
                $ins = $pdo->prepare("INSERT IGNORE INTO spaceweather_cache (source, status, updated_at) VALUES (?, 'empty', UTC_TIMESTAMP())");
                foreach (array_keys($defs) as $k) {
                    if (!isset($rows[$k])) {
                        $ins->execute([$k]);
                    }
                }

                // Claim the feeds that are due (oldest first). The UPDATE is atomic: only one request refreshes a feed.
                $order = array_keys($defs);
                usort($order, function (string $a, string $b) use ($rows): int {
                    return strcmp((string) ($rows[$a]['fetched_at'] ?? ''), (string) ($rows[$b]['fetched_at'] ?? ''));
                });
                $maxJobs = $hasCurl ? count($defs) : 2; // without cURL the downloads run one after another
                $claim = $pdo->prepare('UPDATE spaceweather_cache SET attempt_at = UTC_TIMESTAMP()
                    WHERE source = ?
                      AND (fetched_at IS NULL OR fetched_at < (UTC_TIMESTAMP() - INTERVAL ? SECOND))
                      AND (attempt_at IS NULL OR attempt_at < (UTC_TIMESTAMP() - INTERVAL ? SECOND))');
                $jobs = [];
                foreach ($order as $k) {
                    if (count($jobs) >= $maxJobs) {
                        break;
                    }
                    $claim->execute([$k, $defs[$k]['ttl'], $retryAfter]);
                    if ($claim->rowCount() === 1) {
                        $jobs[$k] = $defs[$k]['url'];
                    }
                }

                $okSt = $pdo->prepare("UPDATE spaceweather_cache SET payload = ?, bytes = ?, status = 'ok', error = '', fetched_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE source = ?");
                $errSt = $pdo->prepare("UPDATE spaceweather_cache SET status = 'error', error = ?, updated_at = UTC_TIMESTAMP() WHERE source = ?");
                foreach ($download($jobs) as $k => $res) {
                    [$ok, $body] = $res;
                    $error = $ok ? '' : (string) $body;
                    if ($ok) {
                        $data = json_decode((string) $body, false, 64);
                        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
                            $error = 'bad_json';
                        } else {
                            $clean = $sanitize($k, $data);
                            $json = $clean === null ? false : json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
                            if ($clean === null) {
                                $error = 'bad_format';
                            } elseif (!is_string($json)) {
                                $error = 'bad_json';
                            } elseif (strlen($json) > $maxStored) {
                                $error = 'too_large';
                            } else {
                                $okSt->execute([$json, strlen($json), $k]);
                                continue;
                            }
                        }
                    }
                    error_log('AURA spaceweather: ' . $k . ' refresh failed (' . $error . ')');
                    $errSt->execute([mb_substr($error, 0, 200), $k]);
                }

                $now = time();
                $sources = [];
                foreach ($pdo->query('SELECT source, payload, status, error, fetched_at FROM spaceweather_cache')->fetchAll() as $r) {
                    $k = (string) $r['source'];
                    if (!isset($defs[$k])) {
                        continue;
                    }
                    $fetched = $r['fetched_at'] === null ? null : strtotime($r['fetched_at'] . ' UTC');
                    $age = $fetched === null || $fetched === false ? null : max(0, $now - $fetched);
                    $data = $r['payload'] === null ? null : json_decode((string) $r['payload'], false, 64);
                    $sources[$k] = [
                        'ok' => $r['status'] === 'ok' && $data !== null,
                        'status' => (string) $r['status'],
                        'fetchedAt' => $r['fetched_at'] === null ? null : iso((string) $r['fetched_at']),
                        'ageSeconds' => $age,
                        'stale' => $age === null || $age > 2 * $defs[$k]['ttl'] || $r['status'] === 'error',
                        'error' => $r['error'] === '' ? null : (string) $r['error'],
                        'data' => $data,
                    ];
                }
                json_out([
                    'sources' => (object) $sources,
                    'window' => ['start' => gmdate('Y-m-d', $now - 7 * 86400), 'end' => gmdate('Y-m-d', $now)],
                    'serverTime' => gmdate('Y-m-d\TH:i:s\Z', $now),
                    'attribution' => 'NASA CCMC DONKI (experimental research information) and NOAA SWPC (official U.S. space weather forecasts)',
                ]);
            } catch (PDOException $e) {
                // A missing table means install.php has not been re-run since this module was added.
                if (sqlstate($e) === '42S02') {
                    fail('Space weather cache is not set up on the server yet (run install.php).', 503);
                }
                throw $e;
            }
        },
    ];
})();
