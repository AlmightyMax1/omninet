# OmniNet — Playable Prototype v0.1

A casual-first, visually-driven hacking game: the "visual Bitburner" vertical slice.
Single self-contained HTML file. No build step, no dependencies, no telemetry —
open it and play.

## Run It

**Browser (fastest):** double-click `index.html` — works in any modern desktop browser
(Chrome/Edge/Firefox). Autosaves to `localStorage` every 10 seconds.

**Electron (desktop shell, optional):**
```bash
npm init -y
npm install electron
npx electron .            # with index.html as the main window load target
```

## What's Implemented

### Three career paths (choose at boot)
| Path | Avg income | Coefficient of variation | Failure consequence |
|---|---|---|---|
| White Hat | $9.2k/wk | 0.24 (steady) | Professional reputation only |
| Grey Hat | $25.8k/wk | 0.46 (mixed) | Rep hit + civil settlement |
| Black Hat | $56.5k/wk | 1.36 (jackpot or zero) | 30% funds frozen, hardware seizure, strikes — 3 strikes = identity burn |

Path affects payout multipliers, trace risk, and consequence scripts. Variance
validated with descriptive statistics (mean/std-dev/CV computed per path).

### The core loop
1. **Arm a card, click a node** — six verbs: SCAN, BRUTE FORCE, PHISHING, SQL INJECT,
   EXFILTRATE, CLEAN LOGS. No typing required, ever.
2. **Heist Cam** — manual actions open a full-screen signature minigame:
   - Brute force: giant padlock, cycling digits, timed tumbler clicks, shackle-pop
     crack with hit-stop and screen shake
   - Phishing: envelope stream, the wobble is the tell, click to hook
   - SQLi: floating fragments, click `OR 1=1`, vault gate dissolves
   - Log tampering: hold to burn log lines, partial wipes allowed
3. **Evidence & trace** — every action leaves evidence (red squares on nodes);
   evidence feeds the TRACE meter; heartbeat audio above 60%; 100% = caught.
   Consequences are path-tiered (see above). Cleanup is a real skill.
4. **Black market board** — three fixers (Ghostwire / Pale_Rider / The Curator)
   with tiered mission chains, flame risk ratings, and rotating listings.
5. **Server rack** — 8U bay: RAM sticks (script slots), CPU clusters (Heist Cam
   speed), liquid cooling (trace decay), proxy farms (evidence resistance).
6. **Script recorder** — chain SCAN + root on a node manually, then record it as
   an ambient farm script. The generated code uses an `omni.*` API whose naming
   mirrors Bitburner's `ns.*` conventions (`ns.hack()`, `ns.scan()` family):
   ```js
   export async function main(omni) {
     while (true) {
       await omni.scan('noodlenet');
       await omni.bruteforce('noodlenet');
       await omni.exfiltrate('noodlenet');
       await omni.cleanlogs('noodlenet');
     }
   }
   ```
   Running scripts draw ambient beams, generate passive income, drip evidence,
   and auto-halt when a target hardens — automation is powerful but hot.

### Visual signature language
- Node damage states: blue → amber → red as security rises
- Evidence: red squares per node; rooted nodes wear a green ring
- Juice: screen shake (scaled to event), hit-stop on tumbler cracks, particle
  bursts, gold payout flashes, exfil beams with animated flow dashes
- Color priority: active action brightest; red reserved exclusively for danger

## Economy Constants (validated)

- Perk cost curve: geometric, tier *n* = $500 × 2.2^(n−1). Ten tiers total
  ≈ **$1,106,247**; tier 10 alone ≈ **$603,635**.
- Laundering fees (black hat payouts): 15% at $75k (net $63,750),
  20% at $250k (net $200,000).
- Mission payouts anchor to real underground market research: carding ~$150,
  phishing jobs ~$950, access resale ~$3.8–5.2k, broker-tier ~$36–42k.

## Controls

| Input | Action |
|---|---|
| Click card → click node | Execute action on target |
| SPACE / click (Heist Cam) | Tumbler timing / envelope hook / fragment pick |
| Hold pointer | Log tampering wipe |
| ESC | Cancel armed card / abort Heist Cam |
| RESET | Wipe save (with confirmation — consequences are real, even here) |

## Architecture Notes (Full Game)

The prototype is a single file for zero-friction playtesting. The production
architecture per the design docs:

- **Main process** (Electron): window lifecycle, file import for custom scripts
- **Renderer** (single window): PixiJS canvas map + React panels — one window,
  not multiple (each Electron window is a full renderer process)
- **Worker pool**: one worker per player-authored *script file* (not per instance);
  thread counts represented as data, capped by rack RAM — the hardware bay is
  the performance governor
- **Juice Director**: central module owning the priority queue for shake,
  hit-stop, particles, and brightness budget so effects compose correctly
- **Animation bridge**: JSON cue stacks (`EXECUTE_ANIMATION` directives) from
  workers to renderer, batched per frame

## Design Docs (companion specs)

1. Game Feel Matrix & Juice Checklist — quantified cue standards (12 QA gates)
2. Black Market Mission & Consequence System — realistic payout ladder,
   evidence-based consequences, fixer trust
3. Three-Path Career System — White/Grey/Black paths, dual meters, Trace Window
4. Real-World Punishment Alignment — 12-rung consequence ladder mapped to CFAA
   and espionage law, Prison Arc, Informant mechanic, total reset
5. Narrative Event Tree (Rungs 11–12) — State Service → Zero Hour → aftermath

## Roadmap (v0.2 candidates)

- Persisting heat per organization (world-state consequences)
- Trace Window (72h escrow countdown) for black-hat exfiltrations
- Defenders that adapt: repeated techniques on one target get countered
- Phishing psychology model (lure/pretext/target matching)
- Dual reputation meters for grey hat (Corporate Trust vs Street Cred)
- Zero Hour endgame mission (gated, all-or-nothing)
