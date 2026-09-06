/* =====================================================================
   OMNINET BLUE TEAM ENGINE v1.0  (final)
   GOAP-based defender planner + expert-system triage inference engine.
   Zero dependencies. Runs in Node (module.exports) or browser (global).

   Architecture (six layers, no machine learning):
     1. Blackboard        — belief store with confidence decay
     2. Perception        — player actions -> signals on the blackboard
     3. Sigma rules       — ATT&CK-tagged detection rules (match/execute)
     4. Triage utility    — weighted scoring + attention budget
     5. Correlation       — multi-technique chains -> incidents (kill chain)
     6. GOAP + goals      — utility-selected goals, A* action planning,
                            real-time stepwise execution with interrupts

   The "learning illusion": a case-based memory of technique usage counts.
   Nothing is learned — thresholds are crossed — but the defender appears
   to adapt. Real blue-team software (Sigma/YARA/ATT&CK mappings) is
   rule-based too; this simulates the real state of the art.
   ===================================================================== */
(function (global) {
'use strict';

/* ------------------------------------------------------------------ */
/* MITRE ATT&CK reference (subset used by the goal graph + rules)     */
/* ------------------------------------------------------------------ */
const MITRE = {
  T1046: { name: 'Network Service Discovery', tactic: 'reconnaissance' },
  T1110: { name: 'Brute Force',               tactic: 'credential-access' },
  T1566: { name: 'Phishing',                  tactic: 'initial-access' },
  T1190: { name: 'Exploit Public-Facing App', tactic: 'initial-access' },
  T1041: { name: 'Exfiltration Over C2',      tactic: 'exfiltration' },
  T1070: { name: 'Indicator Removal',         tactic: 'defense-evasion' },
  T1505: { name: 'Server Software Component', tactic: 'persistence' }
};

/* ------------------------------------------------------------------ */
/* Layer 1: Blackboard — world model with decaying confidence         */
/* ------------------------------------------------------------------ */
class Blackboard {
  constructor() { this.facts = new Map(); }
  static key(id, node) { return node ? id + '@' + node : id; }
  assert(id, node, patch) {
    const k = Blackboard.key(id, node);
    const cur = this.facts.get(k) || null;
    const f = {
      id, node: node || null, t: Date.now(),
      halfLife: (patch && patch.halfLife) || (cur && cur.halfLife) || 1800,
      value: Math.max(cur ? cur.value : 0, (patch && patch.value) || 0),
      conf: Math.max((patch && patch.conf) || 0, cur ? cur.conf * 0.6 : 0)
    };
    this.facts.set(k, f);
    return f;
  }
  get(id, node) {
    const f = this.facts.get(Blackboard.key(id, node));
    if (!f) return null;
    const age = (Date.now() - f.t) / 1000;
    f.effConf = f.conf * Math.pow(0.5, age / f.halfLife); // memory fades
    return f;
  }
  reduce(id, node, confMul, valMul) {
    const f = this.facts.get(Blackboard.key(id, node));
    if (!f) return;
    f.conf *= (confMul === undefined ? 0.3 : confMul);
    f.value *= (valMul === undefined ? 0.5 : valMul);
    if (f.conf < 0.03) this.facts.delete(Blackboard.key(id, node));
  }
  gc() { for (const k of [...this.facts.keys()]) { const at = k.indexOf('@'); if (at > -1) this.get(k.slice(0, at), k.slice(at + 1)); } }
  snapshot() { const out = []; for (const f of this.facts.values()) { const g = this.get(f.id, f.node); out.push({ id: f.id, node: f.node, value: f.value, conf: f.conf, eff: g ? g.effConf : 0 }); } return out; }
}

/* ------------------------------------------------------------------ */
/* Layer 2: Perception — player action events -> blackboard signals   */
/* stealth: 0 (noisy) .. 1 (ghost). Detection conf = (1 - stealth).   */
/* ------------------------------------------------------------------ */
function perceive(ev, bb, memory) {
  const s = ev.stealth === undefined ? 0.3 : ev.stealth;
  const c = Math.max(0.08, 1 - s);
  const node = ev.node;
  switch (ev.type) {
    case 'scan':
      bb.assert('sig.port_scan', node, { conf: c * 0.9, value: 1, halfLife: 600 });
      break;
    case 'brute':
      bb.assert('sig.auth_failures', node, { conf: c * 0.95, value: ev.attempts || 224, halfLife: 1800 });
      break;
    case 'phish':
      bb.assert('sig.mail_anomaly', node, { conf: c * 0.7, value: ev.volume || 40, halfLife: 2400 });
      break;
    case 'sqli':
      bb.assert('sig.waf_anomaly', node, { conf: c * 0.85, value: ev.requests || 12, halfLife: 1800 });
      break;
    case 'exfil':
      bb.assert('sig.netflow_spike', node, { conf: c * 0.9, value: ev.gb || 1.4, halfLife: 900 });
      break;
    case 'persistence':
      bb.assert('sig.unknown_service', node, { conf: c * 0.75, value: 1, halfLife: 3600 });
      break;
    case 'clean':
      // Tampering dampens existing signals... but absence itself is a signal (T1070)
      bb.reduce('sig.auth_failures', node, 0.35, 0.4);
      bb.reduce('sig.port_scan', node, 0.35, 0.4);
      bb.assert('sig.log_gap', node, { conf: c * 0.8, value: 1, halfLife: 2400 });
      break;
  }
  if (ev.technique && memory) {
    const k = ev.technique + '@' + node;
    memory.counts[k] = (memory.counts[k] || 0) + 1;
  }
  return ev;
}

/* ------------------------------------------------------------------ */
/* Layer 3: Sigma-style detection rules                               */
/* Each rule: test(bb, node) -> fact or null. ATT&CK-tagged.          */
/* Case memory boosts confidence on repeat techniques (the illusion). */
/* ------------------------------------------------------------------ */
const DEFAULT_SIGMA = [
  { id: 'sigma-recon-1046', name: 'External Scan Pattern', technique: 'T1046', level: 'low',
    test: (bb, n) => bb.get('sig.port_scan', n) },
  { id: 'sigma-auth-1110', name: 'Excessive Failed Authentication', technique: 'T1110', level: 'high',
    test: (bb, n) => { const f = bb.get('sig.auth_failures', n); return f && f.value >= 150 ? f : null; } },
  { id: 'sigma-mail-1566', name: 'Suspicious Mail Campaign Metrics', technique: 'T1566', level: 'medium',
    test: (bb, n) => { const f = bb.get('sig.mail_anomaly', n); return f && f.value >= 25 ? f : null; } },
  { id: 'sigma-waf-1190', name: 'WAF: Injected Query Signatures', technique: 'T1190', level: 'high',
    test: (bb, n) => { const f = bb.get('sig.waf_anomaly', n); return f && f.value >= 5 ? f : null; } },
  { id: 'sigma-flow-1041', name: 'Netflow Volume Anomaly', technique: 'T1041', level: 'critical',
    test: (bb, n) => { const f = bb.get('sig.netflow_spike', n); return f && f.value >= 0.8 ? f : null; } },
  { id: 'sigma-loggap-1070', name: 'Log Integrity Gap (Possible Tampering)', technique: 'T1070', level: 'high',
    test: (bb, n) => bb.get('sig.log_gap', n) },
  { id: 'sigma-persist-1505', name: 'Unregistered Service Persistence', technique: 'T1505', level: 'high',
    test: (bb, n) => bb.get('sig.unknown_service', n) }
];

/* ------------------------------------------------------------------ */
/* Layer 4: Triage utility scoring + attention budget                 */
/* score = base(level) * confCurve * repeatBoost * assetWeight        */
/* ------------------------------------------------------------------ */
const LEVEL_BASE = { critical: 100, high: 70, medium: 40, low: 15 };
function triageScore(alert, agent) {
  const base = LEVEL_BASE[alert.level] || 10;
  const confCurve = Math.pow(alert.conf, 1.4);            // confidence matters superlinearly
  const repeats = agent.memory.counts[alert.technique + '@' + alert.node] || 0;
  const repeatBoost = 1 + Math.min(0.6, repeats * 0.2);   // history correlates
  const asset = agent.assetWeights[alert.node] || 1;
  return base * confCurve * repeatBoost * asset;
}

/* ------------------------------------------------------------------ */
/* Layer 5: Correlation — multi-tactic alert chains become incidents  */
/* Mirrors kill-chain logic: 2+ tactics on one node = intrusion.      */
/* ------------------------------------------------------------------ */
function correlate(investigated, agent) {
  const byNode = {};
  investigated.forEach(a => { (byNode[a.node] = byNode[a.node] || []).push(a); });
  const incidents = [];
  for (const node in byNode) {
    const alerts = byNode[node];
    const tactics = [...new Set(alerts.map(a => MITRE[a.technique].tactic))];
    const avgConf = alerts.reduce((s, a) => s + a.conf, 0) / alerts.length;
    const hasCritical = alerts.some(a => a.level === 'critical');
    if ((tactics.length >= 2 && avgConf >= 0.35) || hasCritical) {
      incidents.push({
        id: 'INC-' + String(++agent.incidentSeq).padStart(3, '0'), node,
        techniques: [...new Set(alerts.map(a => a.technique))],
        tactics, conf: Math.min(0.98, avgConf * (hasCritical ? 1.5 : 1.15)),
        level: hasCritical ? 'critical' : 'high', t: Date.now(),
        title: hasCritical ? 'Suspected Data Breach' : 'Coordinated Intrusion Attempt'
      });
    }
  }
  return incidents;
}

/* ------------------------------------------------------------------ */
/* Layer 6a: GOAP planner — A* over predicate sets                    */
/* ------------------------------------------------------------------ */
function goapPlan(predicates, targetPreds, actions, maxDepth) {
  const h = st => targetPreds.filter(p => !st.has(p)).length;
  const start = new Set(predicates);
  if (h(start) === 0) return { plan: [], cost: 0, alreadyMet: true };
  const keyOf = st => [...st].sort().join('|');
  const open = [{ state: start, g: 0, acts: [], f: h(start) }];
  const seen = new Set([keyOf(start)]);
  let guard = 0;
  const depth = maxDepth || 10;
  while (open.length && guard++ < 5000) {
    open.sort((a, b) => a.f - b.f);
    const n = open.shift();
    if (h(n.state) === 0) return { plan: n.acts, cost: n.g, alreadyMet: false };
    if (n.acts.length >= depth) continue;
    for (const a of actions) {
      if (!a.pre.every(p => n.state.has(p))) continue;
      const ns = new Set(n.state);
      a.del.forEach(p => ns.delete(p));
      a.add.forEach(p => ns.add(p));
      const k = keyOf(ns);
      if (seen.has(k)) continue;
      seen.add(k);
      open.push({ state: ns, g: n.g + a.cost, acts: n.acts.concat(a), f: n.g + a.cost + h(ns) });
    }
  }
  return null; // unreachable goal
}

/* ------------------------------------------------------------------ */
/* Layer 6b: Defender action library (IR playbook, predicate-based)   */
/* Each action: cost, pre/add/del predicates, explain().              */
/* ------------------------------------------------------------------ */
const DEFENDER_ACTIONS = [
  { id: 'correlate_logs', label: 'Correlate Log Sources', phase: 'Identify', cost: 2,
    pre: ['incident_confirmed'], add: ['node_identified'], del: [],
    explain: c => `Correlating SIEM sources on ${c.node} — ${c.techniques.join(' + ')} chain (conf ${(c.conf * 100) | 0}%).` },
  { id: 'forensic_snapshot', label: 'Forensic Snapshot', phase: 'Identify', cost: 2,
    pre: ['node_identified'], add: ['evidence_preserved'], del: [],
    explain: c => `Preserving volatile evidence on ${c.node} before anything changes.` },
  { id: 'hunt_origin', label: 'Threat Hunt: Origin', phase: 'Identify', cost: 5,
    pre: ['evidence_preserved'], add: ['source_attributed'], del: [],
    explain: c => `Hunting origin on ${c.node}: proxy chains traced. Attribution achieved.` },
  { id: 'block_port', label: 'Block Egress Port', phase: 'Contain', cost: 1,
    pre: ['node_identified'], add: ['port_blocked'], del: [],
    explain: c => `Blocking egress on ${c.node} — killing the exfil channel first.` },
  { id: 'isolate_host', label: 'Isolate Host', phase: 'Contain', cost: 3,
    pre: ['node_identified'], add: ['isolated'], del: [],
    explain: c => `VLAN-quarantining ${c.node}. It goes dark for the intruder; business impact accepted.` },
  { id: 'rotate_credentials', label: 'Rotate Credentials', phase: 'Recover', cost: 2,
    pre: ['incident_confirmed'], add: ['credentials_rotated'], del: [],
    explain: c => `Rotating all credentials on ${c.node}. Any harvested access dies now.` },
  { id: 'patch_vuln', label: 'Patch Exploited Path', phase: 'Harden', cost: 3,
    pre: ['node_identified'], add: ['patched'], del: [],
    explain: c => `Patching the exploited surface on ${c.node}. That vector is gone for good.` },
  { id: 'policy_lockout', label: 'Deploy Lockout Policy', phase: 'Harden', cost: 2,
    pre: ['incident_confirmed', 'repeat_pattern'], add: ['brute_hardened'], del: [],
    explain: c => `Lockout policy live on ${c.node} — the same brute pattern won't work here again.` },
  { id: 'deploy_honeypot', label: 'Deploy Honeypot Decoy', phase: 'Deceive', cost: 4,
    pre: ['incident_confirmed', 'budget_available'], add: ['deception_deployed'], del: [],
    explain: c => `Spinning a decoy database on ${c.node}. Next time, the intruder robs a fake.` },
  { id: 'escalate_ciso', label: 'Escalate to CISO', phase: 'Govern', cost: 4,
    pre: ['source_attributed'], add: ['escalated'], del: [],
    explain: c => `Attribution package sent up the chain. This becomes a legal matter now.` }
];

/* ------------------------------------------------------------------ */
/* Layer 6c: Goal graph — defender goals keyed to attacker tactics    */
/* Utility curves select WHICH goal; GOAP plans HOW.                  */
/* ------------------------------------------------------------------ */
const GOALS = [
  { id: 'CONTAIN', label: 'Contain Breach', target: ['isolated', 'port_blocked'], ir: 'Respond',
    utility: (ctx) => 45 * ctx.incidentConf + 25 * ctx.damageRate },
  { id: 'ATTRIBUTION', label: 'Attribute Intruder', target: ['source_attributed', 'evidence_preserved'], ir: 'Identify',
    utility: (ctx) => 35 * ctx.incidentConf + 12 * ctx.curiosity + 20 * ctx.stealthSeen },
  { id: 'HARDEN', label: 'Harden Defenses', target: ['brute_hardened', 'patched'], ir: 'Mitigate',
    utility: (ctx) => 45 * ctx.repeatRate },
  { id: 'DECEIVE', label: 'Deploy Deception', target: ['deception_deployed'], ir: 'Counterintel',
    utility: (ctx) => 45 * ctx.stealthSeen + 20 * ctx.unresolvedCount },
  { id: 'RECOVER', label: 'Recover Environment', target: ['credentials_rotated', 'patched'], ir: 'Recover',
    utility: (ctx) => 30 * ctx.containedRecent + 10 * ctx.damageRate }
];

/* Per-incident predicates: containment resets, hardening persists */
const EPISODIC_PREDS = ['node_identified', 'evidence_preserved', 'source_attributed',
  'isolated', 'port_blocked', 'escalated'];

/* ------------------------------------------------------------------ */
/* The agent: orchestration + real-time execution + interrupts        */
/* ------------------------------------------------------------------ */
class BlueTeamAgent {
  constructor(opts) {
    opts = opts || {};
    this.bb = new Blackboard();
    this.sigma = opts.rules || DEFAULT_SIGMA;
    this.actions = opts.actions || DEFENDER_ACTIONS;
    this.goals = opts.goals || GOALS;
    this.assetWeights = opts.assetWeights || { apexcorp: 1.6, zenithbank: 1.4, cryptech: 1.2 };
    this.attention = opts.attention || 3;         // alerts the SOC can actively work
    this.stepInterval = opts.stepInterval || 1;   // actions executed per tick
    this.memory = { counts: {} };                 // case-based memory (the "learning")
    this.alerts = []; this.investigated = []; this.incidents = [];
    this.predicates = new Set();
    this.currentGoal = null; this.plan = []; this.planIndex = 0;
    this.planCtx = null; this.incidentSeq = 0; this.tickCount = 0;
    this.unresolved = 0; this.containedRecent = 0; this.stealthSeen = 0; this.curiosity = 0.5;
    this.onAlert = opts.onAlert || (() => {});
    this.onIncident = opts.onIncident || (() => {});
    this.onAction = opts.onAction || (() => {});  // game applies consequences here
    this.onExplain = opts.onExplain || (() => {});
    this.onGoal = opts.onGoal || (() => {});
  }

  /* Player action enters the system */
  perceive(ev) { return perceive(ev, this.bb, this.memory); }

  /* One SOC shift: detect -> triage -> correlate -> decide -> act */
  tick() {
    this.tickCount++;
    this.bb.gc();

    // --- Detection: fire Sigma rules over all known nodes ---
    const nodes = new Set([...this.bb.facts.keys()].map(k => k.split('@')[1]).filter(Boolean));
    const fired = [];
    for (const node of nodes) {
      for (const rule of this.sigma) {
        const f = rule.test(this.bb, node);
        if (!f) continue;
        const repeats = this.memory.counts[rule.technique + '@' + node] || 0;
        const conf = Math.min(0.97, f.effConf * (1 + Math.min(0.3, repeats * 0.1))); // memory boost
        fired.push({ id: rule.id + '#' + this.tickCount, rule: rule.id, name: rule.name,
          technique: rule.technique, tactic: MITRE[rule.technique].tactic, level: rule.level,
          node, conf, t: Date.now() });
      }
    }
    // Dedupe: keep the newest alert per (rule, node)
    const byRuleNode = {};
    fired.forEach(a => { byRuleNode[a.rule + '@' + a.node] = a; });
    Object.values(byRuleNode).forEach(a => {
      this.alerts.unshift(a);
      this.onAlert(a, triageScore(a, this));
    });
    if (this.alerts.length > 200) this.alerts.length = 200;

    // --- Triage: attention budget picks the top N by utility score ---
    const scored = this.alerts.map(a => ({ a, s: triageScore(a, this) }))
      .filter(x => x.s > 5).sort((x, y) => y.s - x.s);
    this.investigated = scored.slice(0, this.attention).map(x => x.a);

    // --- Correlation: chains become incidents ---
    const newIncidents = correlate(this.investigated, this);
    newIncidents.forEach(inc => {
      if (!this.incidents.some(i => i.node === inc.node && (Date.now() - i.t) < 30000)) {
        this.incidents.unshift(inc);
        this.predicates.add('incident_confirmed');
        // New intrusion episode: containment predicates reset, hardening persists
        EPISODIC_PREDS.forEach(p => this.predicates.delete(p));
        this.plan = []; this.planIndex = 0; this.currentGoal = null; // interrupt current plan
        this.onIncident(inc);
      }
    });

    // --- Predicate maintenance (case memory -> world flags) ---
    const repeatKeys = Object.keys(this.memory.counts).filter(k => this.memory.counts[k] >= 2);
    if (repeatKeys.length) this.predicates.add('repeat_pattern');
    if (this.unresolved >= 1 || repeatKeys.length >= 2) this.predicates.add('budget_available');

    // --- Goal selection (utility) — skip goals already satisfied ---
    const inc = this.incidents[0] || null;
    if (inc) {
      const ctx = {
        incidentConf: inc.conf,
        damageRate: inc.level === 'critical' ? 1 : 0.4,
        repeatRate: Math.min(1, repeatKeys.length / 3),
        stealthSeen: this.stealthSeen,
        unresolvedCount: Math.min(1, this.unresolved / 2),
        containedRecent: this.containedRecent,
        curiosity: this.curiosity
      };
      let best = null, bestU = -1;
      for (const g of this.goals) {
        if (g.target.every(p => this.predicates.has(p))) continue; // already satisfied
        const u = g.utility(ctx);
        if (u > bestU) { bestU = u; best = g; }
      }
      const planInvalid = !this.plan || this.planIndex >= this.plan.length;
      if (best && (best.id !== (this.currentGoal && this.currentGoal.id) || planInvalid)) {
        const res = goapPlan(this.predicates, best.target, this.actions);
        if (res && res.plan.length) {
          this.currentGoal = best; this.plan = res.plan; this.planIndex = 0;
          this.planCtx = { node: inc.node, techniques: inc.techniques, conf: inc.conf };
          this.onGoal(best, res);
        } else if (res === null) {
          this.unresolved++; // SOC feels stuck on this goal, tries another angle next shift
        }
      }
    }

    // --- Real-time execution: stepwise actions with explanations ---
    for (let i = 0; i < this.stepInterval && this.planIndex < this.plan.length; i++) {
      const act = this.plan[this.planIndex++];
      act.add.forEach(p => this.predicates.add(p));
      act.del.forEach(p => this.predicates.delete(p));
      if (act.id === 'isolate_host' || act.id === 'block_port') this.containedRecent = 1;
      if (act.id === 'hunt_origin') { this.curiosity = Math.max(0.2, this.curiosity - 0.2); this.unresolved = Math.max(0, this.unresolved - 1); }
      if (act.id === 'deploy_honeypot') this.stealthSeen = 0;
      this.onAction(act, this.planCtx);
      this.onExplain(act.explain(this.planCtx));
      if (this.planIndex >= this.plan.length) {
        this.incidents = this.incidents.filter(x => x !== inc);
        if (!this.incidents.length) this.predicates.delete('incident_confirmed');
        this.containedRecent *= 0.5;
      }
    }
    return this.status();
  }

  /* Feed stealth observations (call when the player evades detection) */
  noteStealth(amount) { this.stealthSeen = Math.min(1, this.stealthSeen + amount); }

  status() {
    return {
      tick: this.tickCount,
      alerts: this.alerts.slice(0, 10),
      investigated: this.investigated.map(a => a.name),
      incidents: this.incidents,
      goal: this.currentGoal ? this.currentGoal.id : null,
      plan: this.plan.slice(this.planIndex).map(a => a.label),
      predicates: [...this.predicates],
      memory: JSON.parse(JSON.stringify(this.memory.counts))
    };
  }

  /* Detection coverage report: ATT&CK techniques with no rule = blind spot */
  coverageReport() {
    const covered = new Set(this.sigma.map(r => r.technique));
    const gaps = Object.keys(MITRE).filter(t => !covered.has(t));
    return { covered: [...covered], gaps, gapNames: gaps.map(g => MITRE[g].name) };
  }
}

const BlueTeam = { MITRE, Blackboard, perceive, DEFAULT_SIGMA, DEFENDER_ACTIONS, GOALS,
  goapPlan, triageScore, correlate, BlueTeamAgent };

if (typeof module !== 'undefined' && module.exports) module.exports = BlueTeam;
global.BlueTeam = BlueTeam;

})(typeof window !== 'undefined' ? window : globalThis);
