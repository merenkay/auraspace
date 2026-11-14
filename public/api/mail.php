<?php
// Minimal mail sender: SMTP (Hostinger: smtp.hostinger.com, port 465 SSL or 587 STARTTLS) with PHP mail() fallback.
declare(strict_types=1);

function send_mail(string $to, string $subject, string $text, string $html): void
{
    $c = config();
    if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to)) {
        throw new RuntimeException('bad_recipient');
    }
    $from = (string) ($c['mail_from'] ?? '');
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('mail_not_configured');
    }
    $fromName = (string) ($c['mail_from_name'] ?? 'AURA');
    $message = build_message($from, $fromName, $to, $subject, $text, $html);

    if (!empty($c['smtp_host']) && !empty($c['smtp_user'])) {
        smtp_send($c, $from, $to, $message);
        return;
    }
    // Fallback: the server's mail() (headers and body split out of the full message).
    [$headers, $body] = explode("\r\n\r\n", $message, 2);
    $headers = preg_replace('/^(To|Subject): .*\r\n/m', '', $headers . "\r\n");
    if (!mail($to, encode_header($subject), $body, rtrim((string) $headers), '-f' . $from)) {
        throw new RuntimeException('mail_failed');
    }
}

function encode_header(string $s): string
{
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

function build_message(string $from, string $fromName, string $to, string $subject, string $text, string $html): string
{
    $b = 'aura-' . bin2hex(random_bytes(8));
    $domain = substr(strrchr($from, '@') ?: '@localhost', 1);
    $lines = [
        'Date: ' . date('r'),
        'From: ' . encode_header($fromName) . " <$from>",
        "To: <$to>",
        'Subject: ' . encode_header($subject),
        'Message-ID: <' . bin2hex(random_bytes(12)) . "@$domain>",
        'MIME-Version: 1.0',
        "Content-Type: multipart/alternative; boundary=\"$b\"",
        '',
        "--$b",
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        rtrim(chunk_split(base64_encode($text), 76, "\r\n")),
        "--$b",
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        rtrim(chunk_split(base64_encode($html), 76, "\r\n")),
        "--$b--",
    ];
    return implode("\r\n", $lines);
}

function smtp_send(array $c, string $from, string $to, string $message): void
{
    $host = (string) $c['smtp_host'];
    $port = (int) ($c['smtp_port'] ?? 465);
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $host]]);
    $fp = @stream_socket_client(($port === 465 ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        throw new RuntimeException("smtp_connect: $errstr");
    }
    stream_set_timeout($fp, 20);
    $read = function () use ($fp): string {
        $data = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $data .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return $data;
    };
    $cmd = function (?string $line, array $ok) use ($fp, $read): string {
        if ($line !== null) {
            fwrite($fp, $line . "\r\n");
        }
        $res = $read();
        if (!in_array((int) substr($res, 0, 3), $ok, true)) {
            throw new RuntimeException('smtp: ' . trim($res));
        }
        return $res;
    };
    try {
        $ehlo = 'EHLO ' . (preg_replace('/[^a-z0-9.\-]/i', '', (string) ($_SERVER['SERVER_NAME'] ?? '')) ?: 'localhost');
        $cmd(null, [220]);
        $cmd($ehlo, [250]);
        if ($port !== 465) {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('smtp_tls');
            }
            $cmd($ehlo, [250]);
        }
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode((string) $c['smtp_user']), [334]);
        $cmd(base64_encode((string) $c['smtp_pass']), [235]);
        $cmd("MAIL FROM:<$from>", [250]);
        $cmd("RCPT TO:<$to>", [250, 251]);
        $cmd('DATA', [354]);
        // Bodies are base64, so no line can start with "." — no dot-stuffing needed for them;
        // headers never start with "." either.
        $cmd($message . "\r\n.", [250]);
        $cmd('QUIT', [221]);
    } finally {
        fclose($fp);
    }
}

function code_email(string $code, string $purpose, string $name): array
{
    $what = $purpose === 'reset' ? 'reset your AURA password' : 'finish creating your AURA account';
    $hello = $name !== '' ? "Hi $name," : 'Hi,';
    $text = "$hello\n\nYour code to $what is: $code\n\nIt expires in 15 minutes. If you did not ask for this, you can ignore this email.\n\nAURA — Full Body Diagnostics\n(NASA Space Apps 2026 project; decision support, not a medical device)";
    $safeName = htmlspecialchars($hello, ENT_QUOTES, 'UTF-8');
    $html = <<<HTML
<!doctype html><html><body style="margin:0;background:#07111F;font-family:Inter,Segoe UI,Arial,sans-serif;color:#F0F7FF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#102438;border:1px solid #1E3A55;border-radius:20px">
<tr><td style="padding:28px">
<div style="font-size:20px;font-weight:700;letter-spacing:3px">AURA</div>
<div style="font-size:11px;letter-spacing:3px;color:#91A9BD">FULL BODY DIAGNOSTICS</div>
<p style="margin:24px 0 8px;font-size:15px">$safeName</p>
<p style="margin:0 0 20px;font-size:15px;color:#C9D8E5">Your code to $what:</p>
<div style="font-size:36px;font-weight:700;letter-spacing:10px;color:#53D7FF;background:#07111F;border-radius:14px;padding:16px;text-align:center">$code</div>
<p style="margin:20px 0 0;font-size:13px;color:#91A9BD">It expires in 15 minutes. If you did not ask for this, you can ignore this email.</p>
</td></tr></table>
<p style="font-size:11px;color:#91A9BD">NASA Space Apps 2026 project · decision support, not a medical device</p>
</td></tr></table></body></html>
HTML;
    return [$purpose === 'reset' ? "AURA password reset code: $code" : "AURA verification code: $code", $text, $html];
}
