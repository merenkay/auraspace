<?php
// Copy this file to aura-config.php and upload it to Hostinger ONE LEVEL ABOVE public_html
// (the folder that contains public_html). Never commit the real file.
return [
    // hPanel → Databases → MySQL Databases
    'db_host' => 'localhost',
    'db_name' => 'u123456789_aura',
    'db_user' => 'u123456789_aura',
    'db_pass' => 'CHANGE-ME',

    // Long random string; used once to open /api/install.php?token=...
    'install_token' => 'CHANGE-ME-to-a-long-random-string',

    // Password for every demo account (crew, surgeon, capcom). At least 8 characters.
    'demo_password' => 'CHANGE-ME',

    // Mission day boundaries are computed in this timezone.
    'timezone' => 'Europe/Istanbul',

    // Lets judges use the one-click demo buttons on the login page.
    'allow_demo' => true,

    // Later: AURA language model (server-side only — never in the frontend).
    'openai_api_key' => '',
    'openai_model' => '',
];
