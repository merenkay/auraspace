# AURA — Full Body Diagnostics

NASA Space Apps Challenge 2026 · *Create Health Monitoring Software for Astronauts on Space Missions*

AURA helps people assess their own health when help is far away: astronauts on a long mission, crews at a polar station, and older adults at home. It offers a 3D body map, large status-coded vital-sign tiles (manual entry, a Samsung Health import or a live sensor kit), delay-aware triage, and an offline, rule-based consultation and coach. Urgent alerts come from deterministic rules, never from a language model, and the app works fully offline in demo mode.

## Run locally

```bash
npm install
npm run dev      # demo mode: data stays in the browser, no server needed
npm test         # unit tests
```

## Setup guides
- [docs/KURULUM.md](docs/KURULUM.md) — Turkish setup guide: MySQL database, e-mail and deployment on shared hosting.
- [arduino/README.md](arduino/README.md) — the Arduino sensor station (wiring and firmware).
- [docs/DESIGN.md](docs/DESIGN.md) — the design handbook for contributors.

## Notes
- Values tagged Sample or Simulated are not real measurements.
- AURA supports self-assessment and decision making; it does not diagnose.
- Not affiliated with or endorsed by NASA.
- AI use: developed with Claude Code (Anthropic).

Sources: [NASA HRP Hazards](https://www.nasa.gov/hrp/hazards/), [NASA HRP Risks](https://www.nasa.gov/hrp/risks/), [CSA radiation monitoring](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp)

License: MIT
