<?php
// Copy this file to aura-config.php and upload it to Hostinger ONE LEVEL ABOVE public_html
// (the folder that contains public_html). Never commit the real file.
return [
    // hPanel → Databases → MySQL Databases
    'db_host' => 'localhost',
    'db_name' => 'u123456789_aura',
    'db_user' => 'u123456789_aura',
    'db_pass' => 'CHANGE-ME',

    // Long random string; used to open /api/install.php?token=...
    'install_token' => 'CHANGE-ME-to-a-long-random-string',

    // Another long random string; signs the email verification codes.
    'app_secret' => 'CHANGE-ME-to-another-long-random-string',

    // Password for every demo account (crew, surgeon, capcom). At least 8 characters.
    'demo_password' => 'CHANGE-ME',

    // Mission day boundaries are computed in this timezone.
    'timezone' => 'Europe/Istanbul',

    // One-click demo buttons on the login page, and public sign-up.
    'allow_demo' => true,
    'allow_signup' => true,

    // Email for sign-up / password-reset codes.
    // hPanel → Emails → create e.g. no-reply@your-domain.com, then use its password here.
    // Hostinger SMTP: smtp.hostinger.com, port 465 (SSL) or 587 (STARTTLS).
    'mail_from' => 'no-reply@your-domain.com',
    'mail_from_name' => 'AURA',
    'smtp_host' => 'smtp.hostinger.com',
    'smtp_port' => 465,
    'smtp_user' => 'no-reply@your-domain.com',
    'smtp_pass' => 'CHANGE-ME',

    // Later: AURA language model (server-side only — never in the frontend).
    'openai_api_key' => '',
    'openai_model' => '',
];
