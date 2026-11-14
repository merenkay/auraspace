# AURA — shared brief for parallel agents

Read this first. Several agents are editing this repository **at the same time**. The rules below keep you from colliding.

## What this is
**AURA — Full Body Diagnostics**: a self-monitoring health web app built for NASA Space Apps 2026, challenge "Create Health Monitoring Software for Astronauts on Space Missions". Deadline: 15 Nov 2026, 23:59 (Istanbul). The jury scores **Impact, Creativity, Validity, Relevance, Presentation**. The team (3 students, Turkish speakers) demos it with an Omron blood-pressure cuff, a Galaxy Watch 6 and a small Arduino kit.

Three user contexts share one tool: `space` (astronauts), `polar` (remote/Antarctic stations), `home` (older adults in home care). Roles: `astronaut` (simulated demo crew, ids 1–4), `member` (people who registered by email), `surgeon`, `ground` (staff see only the simulated demo crew, never registered people; `ground` never sees mood).

## Non-negotiable content rules
- UI text is **English** (jury). Plain language; do not assume medical knowledge.
- **Validity**: every medical or scientific claim shown to users needs a real source (organization + URL, and a short supporting quote where feasible) that you actually fetched. Never fill numbers from memory. Thresholds that are our own demo choices must say so.
- Simulated/sample data is always labelled as such. Never present an estimate as a measurement.
- AURA is decision support: it never claims a definitive diagnosis, never hides uncertainty, never treats missing data as normal. Urgent alerts come from deterministic rules, not from a language model. No NASA logo; "Not affiliated with NASA".
- The app must work fully **offline / without the server** (demo mode) — see "Data access".

## Stack and commands
- Vite 8 + React 19 + TypeScript 7 + Tailwind 4 (`@theme` tokens in `src/index.css`), `react-router` v8 (import from `'react-router'`), `motion` (import from `'motion/react'`), `recharts` 3, `three` + `@react-three/fiber` + `@react-three/drei`, `fflate`, `lucide-react`, `vitest` (`npx vitest run <file>`).
- Windows + Git Bash. Node: `export PATH="/c/Program Files/nodejs:$PATH"`.
- Backend: plain PHP 8 + MySQL on Hostinger shared hosting, served from `public/api/`. **PHP is not installed on this machine and must not be downloaded** — you cannot run it, so write conservative, carefully re-read PHP.

## Rules for working in parallel
1. **Edit only the files your task lists as yours** (and new files inside the folders you own). Everything else is read-only. If you need a change elsewhere, do not make it — describe it under "Requests for the coordinator" in your final report.
2. **No git writes**: no commit, push, stash, checkout, reset, restore, clean. The coordinator commits.
3. **No dependency changes**: do not run `npm install` / edit `package.json` / lockfile. Use what is listed above.
4. **Type-check with `npx tsc --noEmit`**. Other agents are mid-edit, so errors in files you do not own can be transient: ignore them (mention them if they persist). Your own files must be clean.
5. **Do not run `npm run build`** (shared `dist/`). If you really need a production build: `npx vite build --outDir "$TEMP/aura-build-<yourname>" --emptyOutDir`.
6. A dev server is **already running at http://localhost:5173** (HMR). Do not start another one on that port and do not stop it. Local dev is always demo mode (no PHP).
7. Keep exported names and props of existing modules backward compatible unless your task says otherwise — other agents import them.
8. Do not create stray files at the repo root. Temporary files go in your own folder under `$TEMP`.

## Looking at the app (screenshots, clicks)
`tools/shot.mjs` drives headless Edge (WebGL works). Read its header for all steps. Use a private output folder:

```bash
node tools/shot.mjs "$TEMP/aura-shots-<yourname>" 1440 900 login:astronaut:1 goto:http://localhost:5173/ shot:overview+
node tools/shot.mjs "$TEMP/aura-shots-<yourname>" 390 844 login:home goto:http://localhost:5173/ shot:home-mobile+
```
`login:` accepts `astronaut:1..4`, `surgeon`, `ground`, `home`, `polar`, `spacemember`. Then view the PNG with your image-reading tool. Demo crew stories: 1 Okafor (rising blood pressure), 2 Reyes (very short sleep, low mood), 3 Tanaka (healthy), 4 Brandt (low water and exercise). The `member` logins start with no measurements.

## Code map
```
src/data/vitals.ts        vital definitions + rule thresholds (single source of truth), STATUS_COLOR/LABEL
src/data/systems.ts       body systems (brain, eyes, heart, lungs, metabolism, immune, bones, renal, radiation) with sourced text
src/data/contexts.ts      space/polar/home config, per-context threshold overrides, impactOf()
src/data/contexts-kb.json sourced WHO/NHS/ESA/CDC facts for polar + home
src/data/kb/*             NASA/CSA knowledge base (risks, environment values, exercise) with quotes
src/data/missions.ts      mission profiles (dose rate, delay), CABIN_LIMITS, CAREER_LIMIT_MSV
src/lib/api.ts            Backend interface; server implementation (PHP) + in-browser demo store; getBackend(), apiCall()
src/lib/session.tsx       SessionProvider/useSession (user, mission, crew, backend), useCrewData(crewId)
src/lib/health.ts         evaluate(): latest values, statuses, alerts, score (deterministic rules)
src/lib/triage.ts         actionFor(status, delay, context)
src/lib/aura.ts           AURA "explain a measurement" answers
src/lib/demoData.ts       deterministic simulated crew + generator (also seeds MySQL)
src/components/ui.tsx     shared primitives (Panel, Reveal, StatusPill, CountUp, ScoreRing, Sparkline, Spinner, Logo)
src/components/AppShell.tsx  header + tabs + page transitions; pages render in its <Outlet>
src/components/BodyViewer.tsx + three/Body3D.tsx   3D anatomy (public/models/body.glb) with SVG fallback (BodyMap.tsx)
src/pages/*               Login, Register, Forgot, Overview, Diagnostics, Aura, Coach, History, Environment, Roster, Reports
public/api/index.php      router  (?r=<route>), core routes
public/api/lib.php        helpers: db(), config(), json_out(), fail(), body(), require_user(), require_role(),
                          is_self_user(), can_view_crew(), mission_for(), audit(), client_ip(), tz()
public/api/install.php    schema + demo seed (token protected)
public/api/routes/*.php   FEATURE ROUTE MODULES (see below)
public/api/schema/*.php   FEATURE SCHEMA MODULES (see below)
tools/shot.mjs            screenshot/click helper
```

## Data access pattern for new features
Do **not** edit `src/lib/api.ts` (unless it is listed as yours). Write your own small client module:

```ts
import { apiCall, getBackend } from '../lib/api'

export async function loadThing(crewId: number) {
  const b = await getBackend()
  if (b.mode === 'server') return apiCall<{ items: Thing[] }>('myfeature/list', { query: { crew: crewId } }).then((d) => d.items)
  return readLocal()          // demo mode: localStorage under your own key, e.g. 'aura.myfeature.v1', wrapped in try/catch
}
```
`apiCall(route, { method?: 'POST', body?, query? })` sends JSON to `/api/index.php?r=<route>` and throws `ApiError` (`.status`). Every feature must behave sensibly in demo mode.

## Backend modules (no edits to index.php / lib.php / install.php)
**Routes** — `public/api/routes/<feature>.php` returns closures keyed by `"METHOD route"`. `lib.php` is already loaded; each closure must end with `json_out()` or `fail()` (both exit).

```php
<?php
declare(strict_types=1);

return [
    'GET myfeature/list' => function (): void {
        $u = require_user();
        $crewId = (int) ($_GET['crew'] ?? 0);
        if (!can_view_crew($u, $crewId)) { fail('Not allowed', 403); }
        $st = db()->prepare('SELECT id, value FROM my_table WHERE crew_id = ? ORDER BY id DESC LIMIT 200');
        $st->execute([$crewId]);
        json_out(['items' => $st->fetchAll()]);
    },
    'POST myfeature/add' => function (): void {
        $u = require_user();
        require_role($u, ['astronaut', 'member']);
        $b = body();
        // validate every field, bound sizes, use prepared statements only
        json_out(['ok' => true]);
    },
];
```
POST bodies must be JSON (the router enforces `Content-Type: application/json`). Sessions are cookie based. Timestamps are stored in UTC (`UTC_TIMESTAMP()`), returned as ISO strings via `iso()`.

**Schema** — `public/api/schema/<feature>.php`:

```php
<?php
declare(strict_types=1);

return [
    'tables' => [
        "CREATE TABLE IF NOT EXISTS my_table (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, crew_id INT NOT NULL, value DECIMAL(8,2) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_crew (crew_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        // a Closure(PDO $pdo) is also allowed for conditional upgrades
    ],
    // called when a member deletes their account and when the demo crew is reset
    'purge' => function (PDO $pdo, int $crewId, int $userId): void {
        $pdo->prepare('DELETE FROM my_table WHERE crew_id = ?')->execute([$crewId]);
    },
];
```
`install.php` runs every module's `tables` on each install/upgrade run, so they must be idempotent. Privacy rule: self users (`astronaut`, `member`) read/write only their own `crewId`; staff read only crew rows whose `crew.owner_user_id IS NULL` (that is what `can_view_crew()` checks).

## Final report (your last message)
1. What you built/changed (files).
2. How you verified it (commands, screenshots you looked at) — and what you could **not** verify.
3. Sources used (URLs) for any user-facing claims.
4. Requests for the coordinator (changes needed in files you do not own).
5. Known limitations.
