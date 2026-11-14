#!/usr/bin/env node
// Creates aura-config.php (the secret server settings for Hostinger) so nobody has to hand-edit PHP.
//
//   node tools/make-config.mjs            asks the questions in Turkish (VS Code terminal)
//   node tools/make-config.mjs --help     every flag / environment variable
//
// Writes <project root>/aura-config.php, which is git-ignored. It refuses to write a file that git
// would track, anything inside public/, dist/ or a public_html folder, and any sub-folder of the project.
// It never prints the database or SMTP password. No dependencies (Node 18+). Guide: docs/KURULUM.md
import { spawnSync } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE_NAME = 'aura-config.php'
const DEFAULT_SITE = 'https://auraspace.space'
const DEMO_USERS = 'okafor, reyes, tanaka, brandt, surgeon, capcom'

/* ------------------------------------------------------------------ output */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const bold = paint('1')
const dim = paint('2')
const green = paint('32')
const yellow = paint('33')
const red = paint('31')
const cyan = paint('36')
const say = (s = '') => process.stdout.write(s + '\n')
const warn = (s) => say(yellow('  ! ' + s))

class Stop extends Error {
  constructor(message, code = 1) {
    super(message)
    this.code = code
  }
}

/* ------------------------------------------------------------------- flags */

const HELP = `
AURA — aura-config.php oluşturucu

Kullanım (VS Code terminali, proje klasöründe):
  node tools/make-config.mjs              soruları Türkçe sorar (önerilen)

Soru sormadan çalıştırmak için (test/otomasyon): --yes ile birlikte bayrak veya ortam değişkeni ver.
Şifreleri bayrakla vermek terminal geçmişine yazar; ortam değişkeni ya da etkileşimli mod daha güvenli.

  Bayrak                    Ortam değişkeni        Anlamı
  --db-name <ad>            AURA_DB_NAME           veritabanı adı (ör. u123456789_aura)
  --db-user <ad>            AURA_DB_USER           veritabanı kullanıcısı (ör. u123456789_aura)
  --db-pass <şifre>         AURA_DB_PASS           veritabanı şifresi
  --db-host <sunucu>        AURA_DB_HOST           varsayılan: localhost (Hostinger'da hep localhost)
  --mail <adres>            AURA_MAIL              posta kutusu (ör. no-reply@alanadiniz.com); "-" = e-posta yok
  --mail-pass <şifre>       AURA_MAIL_PASS         posta kutusunun şifresi
  --smtp-host <sunucu>      AURA_SMTP_HOST         varsayılan: smtp.hostinger.com
  --smtp-port <465|587>     AURA_SMTP_PORT         varsayılan: 465
  --site <adres>            AURA_SITE_URL          sitenin adresi (yalnızca ekrana yazılan bağlantılar için)
  --demo-password <şifre>   AURA_DEMO_PASSWORD     6 demo hesabın şifresi (en az 8); "auto" = üret
  --timezone <bölge>        AURA_TIMEZONE          varsayılan: Europe/Istanbul
  --no-demo / --demo                               giriş sayfasındaki tek tık demo düğmeleri kapalı / açık
  --no-signup / --signup                           e-postayla yeni kayıt kapalı / açık
  --new-secrets                                    install_token ve app_secret'ı yeniden üret
  --out-dir <klasör>        AURA_OUT_DIR           varsayılan: proje kök klasörü
  --yes, -y                 AURA_NONINTERACTIVE=1  soru sorma
  --force                                          var olan aura-config.php'nin üzerine sormadan yaz
  --dry-run                                        her şeyi kontrol et ama dosya yazma
  --help, -h                                       bu yardım

Var olan bir aura-config.php varsa değerleri varsayılan olarak kullanılır (Enter = aynı kalsın).
Rehber: docs/KURULUM.md
`

const VALUE_FLAGS = {
  '--db-name': 'dbName', '--db-user': 'dbUser', '--db-pass': 'dbPass', '--db-host': 'dbHost',
  '--mail': 'mail', '--mail-pass': 'mailPass', '--smtp-host': 'smtpHost', '--smtp-port': 'smtpPort',
  '--site': 'site', '--demo-password': 'demoPassword', '--timezone': 'timezone', '--out-dir': 'outDir',
}
const ENV = {
  dbName: 'AURA_DB_NAME', dbUser: 'AURA_DB_USER', dbPass: 'AURA_DB_PASS', dbHost: 'AURA_DB_HOST', mail: 'AURA_MAIL',
  mailPass: 'AURA_MAIL_PASS', smtpHost: 'AURA_SMTP_HOST', smtpPort: 'AURA_SMTP_PORT', site: 'AURA_SITE_URL',
  demoPassword: 'AURA_DEMO_PASSWORD', timezone: 'AURA_TIMEZONE', outDir: 'AURA_OUT_DIR',
}

function parseArgs(argv) {
  const o = { flags: {} }
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    let inline
    const eq = a.indexOf('=')
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1)
      a = a.slice(0, eq)
    }
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--yes' || a === '-y') o.yes = true
    else if (a === '--force') o.force = true
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--new-secrets') o.newSecrets = true
    else if (a === '--no-demo') o.allowDemo = false
    else if (a === '--demo') o.allowDemo = true
    else if (a === '--no-signup') o.allowSignup = false
    else if (a === '--signup') o.allowSignup = true
    else if (VALUE_FLAGS[a]) {
      const v = inline !== undefined ? inline : argv[++i]
      if (v === undefined) throw new Stop(`${a} bir değer bekliyor.`)
      o.flags[VALUE_FLAGS[a]] = v
    } else throw new Stop(`Bilinmeyen seçenek: ${argv[i]}  (yardım için: node tools/make-config.mjs --help)`)
  }
  return o
}

/** flag > environment variable; undefined when neither is given. */
function given(opts, key) {
  if (opts.flags[key] !== undefined) return opts.flags[key]
  const env = process.env[ENV[key]]
  return env !== undefined && env !== '' ? env : undefined
}

/* ------------------------------------------------------- PHP read / write */

/** A PHP single-quoted string literal: only \ and ' need escaping. */
function phpString(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

function phpValue(v) {
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (v === null) return 'null'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return phpString(v)
}

/**
 * Reads the simple `'key' => value` pairs of a config file (strings, numbers, true/false/null).
 * Comments are skipped. Returns { values, unreadable: [keys whose value is not a plain literal] }.
 */
function parsePhpConfig(src) {
  const values = {}
  const unreadable = []
  const start = src.indexOf('<?php')
  if (start < 0) return { values, unreadable }
  const tokens = []
  const re = {
    space: /\s+/y,
    lineComment: /(?:\/\/|#(?!\[))[^\n]*/y,
    blockComment: /\/\*[\s\S]*?(?:\*\/|$)/y,
    single: /'((?:[^'\\]|\\[\s\S])*)'/y,
    double: /"((?:[^"\\]|\\[\s\S])*)"/y,
    word: /-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*/y,
  }
  const at = (r, i) => {
    r.lastIndex = i
    return r.exec(src)
  }
  let i = start + 5
  while (i < src.length) {
    let m
    if ((m = at(re.space, i)) || (m = at(re.blockComment, i)) || (m = at(re.lineComment, i))) {
      i += m[0].length
    } else if ((m = at(re.single, i))) {
      tokens.push({ t: 'str', v: m[1].replace(/\\([\\'])/g, '$1') })
      i += m[0].length
    } else if ((m = at(re.double, i))) {
      const raw = m[1]
      if (/(^|[^\\])\$/.test(raw) || /\\[^\\"$ntr]/.test(raw)) tokens.push({ t: 'complex' })
      else tokens.push({ t: 'str', v: raw.replace(/\\([\\"$ntr])/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c) })
      i += m[0].length
    } else if (src.startsWith('=>', i)) {
      tokens.push({ t: 'arrow' })
      i += 2
    } else if ((m = at(re.word, i))) {
      tokens.push({ t: 'word', v: m[0] })
      i += m[0].length
    } else {
      tokens.push({ t: 'punct', v: src[i] })
      i += 1
    }
  }
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].t !== 'str' || tokens[k + 1]?.t !== 'arrow') continue
    const key = tokens[k].v
    const val = tokens[k + 2]
    const after = tokens[k + 3]
    const ends = after && after.t === 'punct' && (after.v === ',' || after.v === ']')
    if (!val || !ends) {
      unreadable.push(key)
      continue
    }
    if (val.t === 'str') values[key] = val.v
    else if (val.t === 'word') {
      const w = val.v.toLowerCase()
      if (w === 'true') values[key] = true
      else if (w === 'false') values[key] = false
      else if (w === 'null') values[key] = null
      else if (/^-?\d+(\.\d+)?$/.test(w)) values[key] = Number(w)
      else unreadable.push(key)
    } else unreadable.push(key)
  }
  return { values, unreadable }
}

const KNOWN_KEYS = [
  'db_host', 'db_name', 'db_user', 'db_pass', 'install_token', 'app_secret', 'demo_password', 'timezone',
  'allow_demo', 'allow_signup', 'mail_from', 'mail_from_name', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass',
  'openai_api_key', 'openai_model', 'site_url',
]

function buildPhp(cfg, extras) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const kv = (key) => `    ${phpString(key)} => ${phpValue(cfg[key])},`
  const lines = [
    '<?php',
    `// AURA sunucu ayarları — tools/make-config.mjs ile oluşturuldu (${stamp}).`,
    '// GİZLİ DOSYA: GitHub\'a yükleme, public_html\'in İÇİNE koyma, sohbete/ekran görüntüsüne koyma.',
    '// Hostinger\'da public_html klasörünü İÇEREN klasöre yükle (public_html ile yan yana). Rehber: docs/KURULUM.md',
    '// Değiştirmek için elle düzenleme yerine aracı tekrar çalıştır: node tools/make-config.mjs',
    'return [',
    '    // Veritabanı (hPanel → Databases → MySQL Databases)',
    kv('db_host'), kv('db_name'), kv('db_user'), kv('db_pass'),
    '',
    '    // Kurulum anahtarı: /api/install.php?token=... adresini yalnızca bunu bilen açabilir.',
    kv('install_token'),
    '    // E-posta doğrulama kodlarını imzalayan gizli anahtar (kimsenin bilmesi gerekmez).',
    kv('app_secret'),
    '    // 6 demo hesabın ortak şifresi. Değiştirirsen kurulumu &reset=1 ile bir kez çalıştır.',
    kv('demo_password'),
    '',
    kv('timezone'),
    '    // Giriş sayfasındaki tek tık demo düğmeleri ve e-postayla yeni kayıt.',
    kv('allow_demo'), kv('allow_signup'),
    '',
    '    // E-posta (kayıt / şifre sıfırlama kodları). mail_from boşsa e-posta kapalıdır.',
    kv('mail_from'), kv('mail_from_name'), kv('smtp_host'), kv('smtp_port'), kv('smtp_user'), kv('smtp_pass'),
    '',
    '    // İleride: AURA dil modeli (yalnızca sunucuda).',
    kv('openai_api_key'), kv('openai_model'),
    '',
    '    // Yalnızca bilgi amaçlı (bu aracın ekrana yazdığı bağlantılar için).',
    kv('site_url'),
  ]
  const extraKeys = Object.keys(extras)
  if (extraKeys.length) {
    lines.push('', '    // Önceki dosyadan korunan diğer ayarlar.')
    for (const k of extraKeys) lines.push(`    ${phpString(k)} => ${phpValue(extras[k])},`)
  }
  lines.push('];', '')
  return lines.join('\n')
}

/* ------------------------------------------------------------- validation */

const CONTROL = /[\u0000-\u001f\u007f]/
const isEmail = (v) => /^[^\s@'"\\<>,;]+@[^\s@'"\\<>,;]+\.[A-Za-z]{2,}$/.test(v) && v.length <= 190

function checkDbIdent(v, what) {
  if (!v) return { error: `${what} boş olamaz.` }
  if (/[\s'"`;=\\]/.test(v) || CONTROL.test(v)) return { error: `${what} boşluk, tırnak, ; veya = içeremez. hPanel'deki adı aynen kopyala.` }
  if (v.length > 64) return { error: `${what} çok uzun (en fazla 64 karakter).` }
  if (/^u123456789_/.test(v)) return { error: 'u123456789 rehberdeki örnek numara. hPanel\'de gördüğün kendi numaranı yaz.' }
  if (!/^u\d+_[A-Za-z0-9_]+$/.test(v)) return { warning: `Hostinger'da ${what.toLowerCase()} genelde u123456789_ ile başlar (ör. u123456789_aura). Baştaki kısmı unutmadığından emin ol.` }
  return {}
}

function checkSecretText(v, what) {
  if (!v) return { error: `${what} boş olamaz.` }
  if (CONTROL.test(v)) return { error: `${what} satır sonu ya da görünmez karakter içeremez.` }
  if (v.length > 200) return { error: `${what} çok uzun (en fazla 200 karakter).` }
  return {}
}

function checkDemoPassword(v, dbPass) {
  const base = checkSecretText(v, 'Demo şifresi')
  if (base.error) return base
  if (v.length < 8) return { error: 'Demo şifresi en az 8 karakter olmalı.' }
  if (dbPass && v === dbPass) return { error: 'Demo şifresi veritabanı şifresiyle aynı olmasın (demo şifresi jüriye verilebilir).' }
  return {}
}

function checkMail(v) {
  if (!isEmail(v)) return { error: 'Geçerli bir e-posta adresi yaz (ör. no-reply@alanadiniz.com).' }
  if (/\.hostingersite\.com$/i.test(v)) return { warning: 'Geçici hostingersite.com alan adında posta kutusu açılabildiğini doğrulayamadık; gerçek alan adınızı kullanın.' }
  return {}
}

function checkPort(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { error: 'Port bir sayı olmalı: 465 (önerilen) ya da 587.' }
  if (n !== 465 && n !== 587) return { warning: 'Hostinger SMTP yalnızca 465 ve 587 portlarını kullanır.' }
  return {}
}

function normalizeSite(v) {
  let s = String(v || '').trim()
  if (!s) return { error: 'Site adresi boş olamaz.' }
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  let u
  try {
    u = new URL(s)
  } catch {
    return { error: 'Bu bir web adresine benzemiyor. Örnek: https://auraspace.space' }
  }
  if (!u.hostname.includes('.')) return { error: 'Alan adı eksik görünüyor (ör. alanadiniz.com).' }
  const out = { value: u.origin }
  if (u.protocol === 'http:') out.warning = 'http:// yerine https:// kullanın (Hostinger ücretsiz SSL verir).'
  return out
}

function checkTimezone(v) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v })
    return {}
  } catch {
    return { error: `Bilinmeyen saat dilimi: ${v} (ör. Europe/Istanbul).` }
  }
}

/** Trims a password; returns the cleaned value and whether whitespace was removed. */
function cleanPassword(v) {
  const t = String(v ?? '').trim()
  return { value: t, trimmed: t !== String(v ?? '') }
}

function makeToken(bytes) {
  return randomBytes(bytes).toString('hex')
}

function makeDemoPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/l/I
  for (;;) {
    let s = ''
    for (let i = 0; i < 12; i++) s += alphabet[randomInt(alphabet.length)]
    if (/[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
  }
}

/* ----------------------------------------------------- where to write safely */

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.error) return { missing: true }
  return { status: r.status, out: (r.stdout || '').trim() }
}

function findGitDir(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) return null
  }
}

/** Throws Stop(…, 2) unless writing <outDir>/aura-config.php cannot end up in git or on the website. */
function assertSafeLocation(outDir) {
  const abs = path.resolve(outDir)
  const file = path.join(abs, FILE_NAME)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Stop(`Klasör bulunamadı: ${abs}`, 2)
  const segments = abs.split(/[\\/]+/).map((s) => s.toLowerCase())
  if (segments.includes('public_html')) throw new Stop('public_html içine yazmıyorum: oradaki her şey internette herkese açıktır.', 2)
  const rel = path.relative(ROOT, abs)
  const insideProject = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  if (insideProject && rel !== '') {
    throw new Stop(`Proje içinde yalnızca kök klasöre yazılır (${ROOT}). "${rel}" altına yazmak dosyayı siteye ya da GitHub'a taşıyabilir.`, 2)
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Stop(`${file} bir kısayol (symlink); güvenlik için yazmıyorum.`, 2)

  const top = git(['rev-parse', '--show-toplevel'], abs)
  if (top.missing) {
    // git is not installed: fall back to reading .gitignore of the enclosing repository
    const repo = findGitDir(abs)
    if (!repo) return 'git deposu dışında'
    const ignore = fs.existsSync(path.join(repo, '.gitignore')) ? fs.readFileSync(path.join(repo, '.gitignore'), 'utf8') : ''
    const listed = ignore.split(/\r?\n/).some((l) => /^\s*(\/|\*\*\/)?aura-config\.php\s*$/.test(l))
    if (!listed) throw new Stop(`${path.join(repo, '.gitignore')} içinde "aura-config.php" satırı yok; dosya GitHub'a gidebilir. Yazmıyorum.`, 2)
    return '.gitignore içinde (git komutu bulunamadı, .gitignore okunarak kontrol edildi)'
  }
  if (top.status !== 0) return 'git deposu dışında'
  if (git(['ls-files', '--error-unmatch', '--', FILE_NAME], abs).status === 0) {
    throw new Stop(`${file} git tarafından TAKİP EDİLİYOR (GitHub'a gider). Koordinatöre haber verin; yazmıyorum.`, 2)
  }
  if (git(['check-ignore', '-q', '--', FILE_NAME], abs).status !== 0) {
    throw new Stop(`${file} .gitignore ile dışlanmamış; GitHub'a gidebilir. Yazmıyorum.`, 2)
  }
  return 'git tarafından yok sayılıyor (.gitignore) — GitHub\'a gitmez'
}

/* ------------------------------------------------------------ interaction */

class Prompter {
  constructor() {
    this.muted = false
    this.terminal = !!(process.stdin.isTTY && process.stdout.isTTY)
    const self = this
    const out = new Writable({
      write(chunk, enc, cb) {
        if (!self.muted) process.stdout.write(chunk)
        cb()
      },
    })
    Object.defineProperty(out, 'columns', { get: () => process.stdout.columns })
    this.rl = readline.createInterface({ input: process.stdin, output: out, terminal: this.terminal, historySize: 0 })
    this.queue = []
    this.waiting = []
    this.closed = false
    this.rl.on('line', (line) => {
      const w = this.waiting.shift()
      if (w) w.resolve(line)
      else this.queue.push(line)
    })
    this.rl.on('close', () => {
      this.closed = true
      for (const w of this.waiting.splice(0)) w.reject(new Stop('Girdi bitti; hiçbir dosya yazılmadı.'))
    })
    this.rl.on('SIGINT', () => {
      this.muted = false
      process.stdout.write('\n' + yellow('İptal edildi — hiçbir dosya yazılmadı.') + '\n')
      process.exit(130)
    })
  }

  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift())
    if (this.closed) return Promise.reject(new Stop('Girdi bitti; hiçbir dosya yazılmadı.'))
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }))
  }

  async ask(prompt = '  > ', hidden = false) {
    this.rl.setPrompt(prompt)
    this.rl.prompt()
    if (hidden) this.muted = true
    try {
      return await this.next()
    } finally {
      this.muted = false
      if (hidden || !this.terminal) process.stdout.write('\n')
    }
  }

  /** Asks until check() passes; prints its error/warning. Returns the accepted value. */
  async until(prompt, check, hidden = false) {
    for (;;) {
      const v = await this.ask(prompt, hidden)
      const r = check(v)
      if (r.error) {
        say(red('  ✗ ' + r.error))
        continue
      }
      if (r.warning) warn(r.warning)
      return r.value !== undefined ? r.value : v
    }
  }

  async yesNo(question, def) {
    for (;;) {
      const v = (await this.ask(`  ${question} ${def ? '[E/h]' : '[e/H]'} `)).trim().toLowerCase()
      if (!v) return def
      if (['e', 'evet', 'y', 'yes'].includes(v)) return true
      if (['h', 'hayır', 'hayir', 'n', 'no'].includes(v)) return false
      say(red('  ✗ "e" (evet) ya da "h" (hayır) yaz.'))
    }
  }

  /** Hidden password with confirmation. keep = existing value (Enter keeps it). */
  async password(what, keep) {
    for (let attempt = 0; ; attempt++) {
      const first = await this.ask(`  > ${dim('(yazdıkların görünmez, bu normal; yapıştırabilirsin)')} `, true)
      if (!first && keep) {
        say(green('  ✓ mevcut şifre korunuyor'))
        return keep
      }
      const a = cleanPassword(first)
      const r = checkSecretText(a.value, what)
      if (r.error) {
        say(red('  ✗ ' + r.error))
        continue
      }
      const second = cleanPassword(await this.ask(`  > ${dim('kontrol için bir kez daha:')} `, true))
      if (second.value !== a.value) {
        say(red('  ✗ İki giriş aynı değil. Tekrar deneyelim.'))
        if (attempt >= 4) throw new Stop('Şifre eşleşmedi; hiçbir dosya yazılmadı.')
        continue
      }
      if (a.trimmed) warn('Başındaki/sonundaki boşlukları sildim (kopyalarken gelmiş olabilir).')
      say(green(`  ✓ alındı (${a.value.length} karakter)`))
      return a.value
    }
  }

  close() {
    if (this.done) return
    this.done = true
    this.rl.close()
  }
}

/* ------------------------------------------------------------------ main */

/** Non-interactive check: stop on error (naming the flag to fix), print a warning otherwise. */
function fail(r, flagHint) {
  if (r.error) throw new Stop(`${r.error}  [${flagHint}]`)
  if (r.warning) warn(r.warning)
}

// Values copied from aura-config.example.php are public (the repository is public): never reuse them.
const PLACEHOLDER = /CHANGE-ME|your-domain\.com|^u123456789_/i

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    say(HELP)
    return
  }
  const interactive = !opts.yes && process.env.AURA_NONINTERACTIVE !== '1'
  const outDir = path.resolve(given(opts, 'outDir') ?? ROOT)
  const target = path.join(outDir, FILE_NAME)

  say('')
  say(bold('AURA — sunucu ayar dosyası (aura-config.php) oluşturucu'))
  const safety = assertSafeLocation(outDir)
  say(dim(`  Hedef: ${target}`))
  say(dim(`  Güvenlik kontrolü: ${safety}`))

  // Existing file: its values become the defaults, and its secrets are kept unless asked otherwise.
  let old = {}
  let unreadable = []
  const exists = fs.existsSync(target)
  if (exists) {
    const parsed = parsePhpConfig(fs.readFileSync(target, 'utf8'))
    old = parsed.values
    unreadable = parsed.unreadable
    if (!interactive && !opts.force && !opts.dryRun) {
      throw new Stop(`${target} zaten var. Üzerine yazmak için --force ekle (eski değerler varsayılan olarak kullanılır).`, 3)
    }
  }
  const oldStr = (k) => (typeof old[k] === 'string' && !PLACEHOLDER.test(old[k]) ? old[k] : '')

  const p = interactive ? new Prompter() : null
  try {
    if (interactive) {
      say('')
      say('  Birkaç soru soracağım. Şifreler yazarken ekranda görünmez — bu normal.')
      say('  Vazgeçmek için Ctrl+C (hiçbir dosya yazılmaz).')
      if (exists) {
        say('')
        say(yellow('  Bu klasörde zaten bir aura-config.php var. Sorularda Enter\'a basarsan mevcut değer aynen kalır.'))
      }
    }

    /* 1-2: database name and user */
    const askIdent = async (n, key, flagKey, title, hint) => {
      const fromFlag = given(opts, flagKey)
      if (fromFlag !== undefined || !interactive) {
        const v = String(fromFlag ?? oldStr(key)).trim()
        const flag = Object.keys(VALUE_FLAGS).find((f) => VALUE_FLAGS[f] === flagKey)
        fail(checkDbIdent(v, title), `${flag} / ${ENV[flagKey]}`)
        return v
      }
      say('')
      say(bold(`  [${n}] ${title}`))
      say(dim(`      ${hint}`))
      const def = oldStr(key)
      if (def) say(dim(`      Enter = mevcut: ${def}`))
      return p.until('  > ', (raw) => {
        const v = raw.trim() || def
        const r = checkDbIdent(v, title)
        return { ...r, value: v }
      })
    }
    const dbName = await askIdent('1/6', 'db_name', 'dbName', 'Veritabanı adı',
      'hPanel → Databases → MySQL Databases listesindeki tam ad. Örnek: u123456789_aura')
    const dbUser = await askIdent('2/6', 'db_user', 'dbUser', 'Veritabanı kullanıcı adı',
      'Aynı listedeki "user" (kullanıcı). Örnek: u123456789_aura — baştaki u123456789_ kısmı dahil.')
    const prefix = (s) => (/^(u\d+)_/.exec(s) || [])[1]
    if (prefix(dbName) && prefix(dbUser) && prefix(dbName) !== prefix(dbUser)) {
      warn(`Adın başı (${prefix(dbName)}) ile kullanıcının başı (${prefix(dbUser)}) farklı. Aynı hesaptaysa ikisi de aynı u-numarasıyla başlamalı.`)
    }

    /* 3: database password */
    let dbPass
    if (given(opts, 'dbPass') !== undefined || !interactive) {
      const c = cleanPassword(given(opts, 'dbPass') ?? oldStr('db_pass'))
      fail(checkSecretText(c.value, 'Veritabanı şifresi'), '--db-pass / AURA_DB_PASS')
      if (c.trimmed) warn('Veritabanı şifresinin başındaki/sonundaki boşlukları sildim.')
      dbPass = c.value
    } else {
      say('')
      say(bold('  [3/6] Veritabanı şifresi'))
      say(dim('      Veritabanını oluştururken belirlediğin şifre (hPanel bunu sonradan göstermez; unuttuysan'))
      say(dim('      Databases → MySQL Users → Change Password ile yenisini koy).'))
      if (oldStr('db_pass')) say(dim('      Enter = mevcut şifre kalsın'))
      dbPass = await p.password('Veritabanı şifresi', oldStr('db_pass'))
    }

    /* 4: demo password */
    let demoPassword
    const demoGiven = given(opts, 'demoPassword')
    if (demoGiven !== undefined || !interactive) {
      if (demoGiven === undefined && oldStr('demo_password')) demoPassword = oldStr('demo_password')
      else if (demoGiven === undefined || demoGiven === 'auto') demoPassword = makeDemoPassword()
      else demoPassword = demoGiven.trim()
      fail(checkDemoPassword(demoPassword, dbPass), '--demo-password / AURA_DEMO_PASSWORD')
    } else {
      say('')
      say(bold('  [4/6] Demo hesap şifresi'))
      say(dim(`      6 demo hesabın (${DEMO_USERS}) ortak şifresi. En az 8 karakter.`))
      const def = oldStr('demo_password')
      say(dim(def ? `      Enter = mevcut şifre kalsın (${def}) · "yeni" yaz = yeni şifre üret` : '      Enter = benim için güçlü bir şifre üret'))
      demoPassword = await p.until('  > ', (raw) => {
        const v = raw.trim()
        const value = !v ? def || makeDemoPassword() : v.toLowerCase() === 'yeni' ? makeDemoPassword() : v
        return { ...checkDemoPassword(value, dbPass), value }
      })
      say(green(`  ✓ demo şifresi: ${bold(demoPassword)}`))
    }

    /* 5: email (optional) */
    let mail = ''
    let mailPass = ''
    let smtpPort = Number(old.smtp_port) || 465
    const smtpHost = String(given(opts, 'smtpHost') ?? (oldStr('smtp_host') || 'smtp.hostinger.com')).trim()
    const mailGiven = given(opts, 'mail')
    if (mailGiven !== undefined || !interactive) {
      mail = mailGiven !== undefined ? (mailGiven.trim() === '-' ? '' : mailGiven.trim()) : oldStr('mail_from')
      if (mail) {
        fail(checkMail(mail), '--mail / AURA_MAIL')
        const c = cleanPassword(given(opts, 'mailPass') ?? (mail === oldStr('smtp_user') ? oldStr('smtp_pass') : ''))
        fail(checkSecretText(c.value, 'Posta kutusu şifresi'), '--mail-pass / AURA_MAIL_PASS')
        mailPass = c.value
        const portGiven = given(opts, 'smtpPort')
        if (portGiven !== undefined) {
          fail(checkPort(portGiven), '--smtp-port / AURA_SMTP_PORT')
          smtpPort = Number(portGiven)
        }
      }
    } else {
      say('')
      say(bold('  [5/6] E-posta (kayıt ve şifre sıfırlama kodları) — isteğe bağlı'))
      say(dim('      hPanel → Emails\'te oluşturduğun posta kutusu. Örnek: no-reply@alanadiniz.com'))
      const def = oldStr('mail_from')
      say(dim(def ? `      Enter = mevcut: ${def} · "-" yaz = e-postayı kapat` : '      Boş bırak (Enter) = şimdilik e-posta yok; sonra bu aracı tekrar çalıştırırsın.'))
      mail = await p.until('  > ', (raw) => {
        const v = raw.trim()
        if (v === '-') return { value: '' }
        if (!v) return { value: def }
        return { ...checkMail(v), value: v }
      })
      if (mail) {
        say('')
        say(bold('      Posta kutusunun şifresi'))
        say(dim('      Posta kutusunu oluştururken koyduğun şifre (Hostinger hesabının şifresi DEĞİL).'))
        const keep = mail === oldStr('smtp_user') ? oldStr('smtp_pass') : ''
        if (keep) say(dim('      Enter = mevcut şifre kalsın'))
        mailPass = await p.password('Posta kutusu şifresi', keep)
        say(dim(`      SMTP portu: Enter = ${smtpPort} (önerilen 465; e-posta gitmezse 587 dene)`))
        smtpPort = Number(await p.until('  > ', (raw) => {
          const v = raw.trim() || String(smtpPort)
          return { ...checkPort(v), value: v }
        }))
      } else {
        say(dim('      E-posta kapalı: kayıt kodları gönderilemez (demo düğmeleri ve demo hesaplar çalışır).'))
      }
    }

    if (mail && mailPass === demoPassword) {
      throw new Stop('Demo şifresi posta kutusu şifresiyle aynı olamaz (demo şifresi jüriye verilebilir). Aracı tekrar çalıştır ve farklı bir demo şifresi seç.')
    }

    /* 6: site address */
    let site
    const siteGiven = given(opts, 'site')
    if (siteGiven !== undefined || !interactive) {
      const r = normalizeSite(siteGiven ?? (oldStr('site_url') || DEFAULT_SITE))
      fail(r, '--site / AURA_SITE_URL')
      site = r.value
    } else {
      say('')
      say(bold('  [6/6] Sitenin adresi'))
      say(dim('      Tarayıcıda siteyi açtığın adres. Yalnızca sonda vereceğim bağlantılar için.'))
      const def = oldStr('site_url') || DEFAULT_SITE
      say(dim(`      Enter = ${def}`))
      site = await p.until('  > ', (raw) => normalizeSite(raw.trim() || def))
    }

    /* other settings */
    const dbHost = String(given(opts, 'dbHost') ?? (oldStr('db_host') || 'localhost')).trim()
    if (!dbHost || /[\s;'"\\=]/.test(dbHost)) throw new Stop('db_host geçersiz (Hostinger\'da: localhost).')
    if (dbHost !== 'localhost') warn(`db_host "${dbHost}" — Hostinger'da PHP için doğru değer localhost.`)
    const timezone = String(given(opts, 'timezone') ?? (oldStr('timezone') || 'Europe/Istanbul')).trim()
    fail(checkTimezone(timezone), '--timezone / AURA_TIMEZONE')
    if (!/^[A-Za-z0-9.\-]+$/.test(smtpHost)) throw new Stop('SMTP sunucusu geçersiz (Hostinger: smtp.hostinger.com).')

    const keepSecrets = !opts.newSecrets
    let installToken = keepSecrets && oldStr('install_token').length >= 16 ? oldStr('install_token') : ''
    let appSecret = keepSecrets && oldStr('app_secret').length >= 16 ? oldStr('app_secret') : ''
    if (interactive && (installToken || appSecret)) {
      say('')
      say(bold('  Gizli anahtarlar'))
      say(dim('      install_token (kurulum adresindeki anahtar) ve app_secret mevcut dosyada var.'))
      if (!(await p.yesNo('Aynı kalsınlar mı? (sızdıysa "h" de, yenileri üretilir)', true))) {
        installToken = ''
        appSecret = ''
      }
    }
    const newToken = !installToken
    if (!installToken) installToken = makeToken(24)
    if (!appSecret) appSecret = makeToken(32)

    const cfg = {
      db_host: dbHost,
      db_name: dbName,
      db_user: dbUser,
      db_pass: dbPass,
      install_token: installToken,
      app_secret: appSecret,
      demo_password: demoPassword,
      timezone,
      allow_demo: opts.allowDemo ?? (typeof old.allow_demo === 'boolean' ? old.allow_demo : true),
      allow_signup: opts.allowSignup ?? (typeof old.allow_signup === 'boolean' ? old.allow_signup : true),
      mail_from: mail,
      mail_from_name: oldStr('mail_from_name') || 'AURA',
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_user: mail,
      smtp_pass: mail ? mailPass : '',
      openai_api_key: oldStr('openai_api_key'),
      openai_model: oldStr('openai_model'),
      site_url: site,
    }
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === 'string' && CONTROL.test(v)) throw new Stop(`${k} görünmez karakter içeriyor.`)
    }
    const extras = {}
    for (const [k, v] of Object.entries(old)) if (!KNOWN_KEYS.includes(k)) extras[k] = v
    if (unreadable.length) warn(`Eski dosyadaki şu ayarlar okunamadı ve yeni dosyaya taşınmayacak: ${unreadable.join(', ')}`)

    const demoChanged = exists && oldStr('demo_password') !== '' && oldStr('demo_password') !== demoPassword
    const mailChanged = exists && (oldStr('mail_from') !== mail || (mail && oldStr('smtp_pass') !== mailPass))

    if (interactive) {
      say('')
      say(`  Yazılacak: ${bold(target)}${exists ? yellow(' (mevcut dosyanın ÜZERİNE)') : ''}`)
      if (!(await p.yesNo('Devam edilsin mi?', true))) throw new Stop('Vazgeçildi; hiçbir dosya yazılmadı.', 0)
    }
    p?.close()

    const php = buildPhp(cfg, extras)
    if (opts.dryRun) {
      say('')
      say(green('  ✓ Kontroller tamam (--dry-run: dosya yazılmadı).'))
      return
    }

    fs.writeFileSync(target, php, { encoding: 'utf8', mode: 0o600 })
    // Self-check: read the file back and make sure every value round-trips exactly.
    const back = parsePhpConfig(fs.readFileSync(target, 'utf8')).values
    const bad = Object.keys(cfg).filter((k) => back[k] !== cfg[k])
    if (bad.length) {
      fs.rmSync(target, { force: true })
      throw new Stop(`İç kontrol başarısız (${bad.join(', ')}); dosya silindi. Bu bir hata — koordinatöre bildirin.`)
    }

    /* summary + next steps (never prints the database or SMTP password) */
    const installUrl = `${site}/api/install.php?token=${encodeURIComponent(installToken)}`
    const healthUrl = `${site}/api/index.php?r=health`
    say('')
    say(green(bold(`✓ Yazıldı: ${target}`)))
    if (/gitignore/.test(safety)) say(dim('  (VS Code\'da gri görünür: .gitignore\'da olduğu için GitHub\'a gitmez.)'))
    say('')
    say(bold('Özet') + dim(' — şifreler ekrana yazılmaz'))
    say(`  Veritabanı        : ${dbName}  (kullanıcı: ${dbUser}, sunucu: ${dbHost})`)
    say(`  Veritabanı şifresi: ${dim('(gizli)')}`)
    say(`  E-posta           : ${mail ? `${mail} → ${smtpHost}:${smtpPort}, şifre ${dim('(gizli)')}` : yellow('ayarlanmadı — kayıt kodları gönderilemez')}`)
    say(`  Demo şifresi      : ${bold(demoPassword)}   ← not alın; hesaplar: ${DEMO_USERS}`)
    say(`  Demo düğmeleri    : ${cfg.allow_demo ? 'açık' : 'kapalı'} · Yeni kayıt: ${cfg.allow_signup ? 'açık' : 'kapalı'}`)
    say(`  install_token     : ${newToken ? 'yeni üretildi' : 'aynı kaldı'}`)
    say('')
    say(bold('SONRAKİ ADIMLAR'))
    say(` 1) hPanel → Websites → (site) → Files → File Manager'ı aç.`)
    say(`    Açılan klasörde ${bold('public_html')} klasörünü (yanında belki DO_NOT_UPLOAD_HERE) görüyorsan doğru yerdesin.`)
    say(`    Upload → Upload files → bu aura-config.php. Aynı adlı dosya varsa ${bold('Replace')} seç ("Keep both" DEĞİL).`)
    say(`    ${red('public_html\'in İÇİNE koyma. GitHub\'a yükleme. Sohbete yapıştırma.')}`)
    say(` 2) Kurulumu bir kez çalıştır — bu adresi tarayıcıda aç:`)
    say(`    ${cyan(installUrl)}`)
    say(`    İlk kurulumda beklenen: "Tables ready." ve "Loaded 4 crew, 2 staff accounts and … measurements."`)
    say(`    Daha önce kurulduysa: "Demo data already present — nothing else changed. …" (bu da başarı demektir).`)
    if (demoChanged) {
      say(yellow(`    Demo şifresi değişti: yeni şifrenin geçmesi için adresi bir kez de &reset=1 ile aç`))
      say(yellow(`    (yalnızca demo ekibini yeniler, kayıtlı üyeler silinmez): ${installUrl}&reset=1`))
    }
    if (mailChanged) say(`    E-posta ayarı değişti: bunun için kurulumu açmak gerekmez (açmak da zararsızdır); dosyayı yüklemen yeter, 3. adımdaki "mail" değerine bak.`)
    say(` 3) Kontrol et: ${cyan(healthUrl)}`)
    say(`    Beklenen: {"ok":true,"db":true,"signup":${cfg.allow_signup},"mail":${!!mail}}`)
    say(` 4) ${site}/login sayfasını Ctrl+F5 ile yenile; altta "● Connected to the mission database" yazmalı.`)
    say('')
    say(dim('Kurulum adresi bir anahtardır: kimseyle paylaşma. Ayrıntılı rehber: docs/KURULUM.md'))
    say('')
  } finally {
    p?.close()
  }
}

main().catch((e) => {
  if (e instanceof Stop) {
    if (e.code === 0) {
      say(yellow(e.message))
      process.exit(0)
    }
    say(red(`✗ ${e.message}`))
    process.exit(e.code)
  }
  say(red(`✗ Beklenmeyen hata: ${e && e.message ? e.message : e}`))
  process.exit(1)
})
