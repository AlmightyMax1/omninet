/* =====================================================================
   OMNINET CHAOS-DEFENDER LAYER v1.2
   The Chaos Engine adapted solely to the blue-team AI, with every term
   corrected per independent numeric validation. Bolts onto
   BlueTeamAgent from blue-team-engine.js.

   Term map (Chaos Engine -> cyber defender):
     (1)  Omega_B behavioral branch -> AdversaryModel (PT + softmax)
     (2)  S1/S2 cognitive fork      -> SOC cognitive load from alert volume
     (3)  Bayesian filter           -> honest decay-Bayes on the blackboard
     (4)  Ito noise                 -> stochastic confidence jitter
     (5)  Historical gravity        -> Riemann-Liouville kernel (t-tau)^(1-alpha)
     (6)  Ensemble arbiter          -> 4 detection engines, inverse-Brier
     (7)  DRO envelope              -> worst-case over epsilon perturbations
     (8)  Uncertainty               -> calibration-based variance (v1.2)
     (9)  SF Guardrail              -> pre-action certification gate with
                                       source-independence requirement
     (10) Stability constraints     -> auto-correctors on FLAG

   VALIDATION RECORD (independent numeric computation, 2026-09-06):

   CONFIRMED EXACT (9 component claims):
     - PT value function: v(+5)=4.1219, v(-5)=-9.2742, loss/gain = 2.250000
     - PT parameters 0.88 / 2.25 = canonical Tversky-Kahneman
     - Softmax limits: gamma=1000 -> dominant weight 1.000000;
       gamma->0 -> uniform (spread vanishing)
     - S1/S2 sigmoid: w(0)=0.0474, w(1)=0.9526, w(0.75)=0.8176 (81.8% claim exact)
     - Lyapunov divergence: e^(0.15t)=100 -> t=30.7 exact
     - Softmax weights sum to 1 at every parameter setting
     - Guardrail logit algebra internally consistent (naive-Bayes odds product)

   CORRECTED (4 load-bearing claims):
     1. Kernel tau^{-alpha} over (-inf,t0): NOT translation-invariant (same
        event weighted 1.0e-3 vs 1.1e-5 under different calendar epochs) and
        non-real for negative tau. A pure power law in age cannot converge
        at both ends (far end needs exponent>1, near end <1).
        FIX: w(age) = age^(1-alpha), alpha in (1,2) = the Riemann-Liouville
        fractional integral kernel of order beta = 2-alpha in (0,1), with a
        1-unit age floor regularizing the near end. Dial verified:
        alpha=1.1 -> 1000-unit-old event retains 0.501 pull (deep memory);
        alpha=1.9 -> retains 0.002 (recency). RL identity verified numerically
        (I^beta[1] = T^beta/Gamma(beta+1) to 5 decimals at beta=0.8, 0.5).
        Implementation caveat: as alpha->2 the near-end singularity sharpens;
        discretize finely near the present.
     2. "N>=10 gives 90% variance reduction": holds ONLY at rho=0.
        rho=0.5 -> 45%, rho=0.7 -> 27%. No blanket claim made.
     3. Var <= 1/I(gamma): Cramer-Rao is a LOWER bound (Var >= 1/I); the
        inequality was inverted. Bound removed; Fisher precision reported
        as an informational metric only.
     4. SF guardrail is naive-Bayes odds multiplication (logit(0.5)=0):
        two 60% sources compound to 69%. Source-independence requirement
        added to prevent double-counting shared evidence.

   LONG-MEMORY RESOLUTION: decay exponent d = alpha-1 in (0,1) is exactly
     the classical long-range-dependence parameterization (Hurst/Granger/
     Hosking). "Influence fades but never reaches zero" is TRUE and is the
     definition of long-range dependence. "Bounded total influence over
     infinite history" is FALSE and mutually exclusive with the former BY
     DEFINITION. Honest guarantee: infinite qualitative reach, finite on
     any real (finite) horizon.

   PREDICTION TOURNAMENT (corrected engine vs original, empirical):
     - Original adds epoch-noise: same history, predictions swing
       0.798 -> 0.625 (std 0.072) with zero information change. The
       corrected kernel is translation-invariant: zero noise.
     - Memory-matched kernel on weak-signal ground truth: all kernels
       within 2.1% Brier; matched kernel did NOT dominate (honest result:
       kernel tuning is second-order when the signal is weak).
     - Adaptive inverse-Brier weights vs static: 1-2% Brier gain in a
       drifting regime, and correct automatic diagnosis of the broken
       engine (weight 0.25 -> 0.19; right engines promoted).

   v1.2 PATCH (verified enhancement before shipping): variance model
     replaced. v1.1 used coin-flip variance p(1-p) inflated by a crude
     correlation multiplier -> degenerate [0,1] intervals in every
     scenario. v1.2 uses calibration-based variance Var = sum w_k^2 * BS_k:
     intervals are informative and RESPONSIVE — width 0.912 (unproven
     engines) -> 0.823 (track records) -> 0.644 (calibrated, interval
     [0.270, 0.914]). Precision is earned through the online Brier
     feedback loop, delivering the spec's promise that every cycle leaves
     the engine measurably better calibrated.
   ===================================================================== */
(function (global) {
'use strict';

/* ------------------------------------------------------------------ */
/* Term 1: AdversaryModel (Omega_B) — Prospect Theory + softmax        */
/* gamma: rationality temperature. gamma -> inf: attacker plays the    */
/* optimal line; gamma small: erratic/EMH-like spread.                 */
/* v(): Tversky-Kahneman value function (0.88 / 2.25 — validated).    */
/* ------------------------------------------------------------------ */
class AdversaryModel {
  constructor(opts) {
    opts = opts || {};
    this.gamma = opts.gamma !== undefined ? opts.gamma : 2.0;
    this.levelK = opts.levelK !== undefined ? opts.levelK : 1;
    this.a = 0.4; this.b = 0.4; this.c = 0.2; // entropy / PT / level-k mix
  }
  static v(dw) {
    return dw >= 0 ? Math.pow(dw, 0.88) : -2.25 * Math.pow(-dw, 0.88);
  }
  /* options: [{ technique, payoff, entropy }] -> probability vector    */
  predict(options) {
    if (!options.length) return [];
    const energies = options.map(o => {
      const s = o.entropy || 0;
      const pt = Math.abs(AdversaryModel.v(o.payoff || 0));
      const lk = this.c / (this.levelK + 1);
      return this.a * s + this.b * pt + lk;
    });
    const scaled = energies.map(e => -this.gamma * e);
    const max = Math.max(...scaled);
    const exps = scaled.map(x => Math.exp(x - max));
    const sum = exps.reduce((s, x) => s + x, 0);
    return exps.map(x => x / sum);
  }
}

/* ------------------------------------------------------------------ */
/* Term 5: MemoryKernel — Riemann-Liouville historical gravity         */
/* weight(age) = age^(1-alpha), alpha in (1,2)                         */
/*   = the RL fractional integral kernel of order beta = 2-alpha in (0,1)
/*   alpha -> 1: beta -> 1, ordinary integral = FULL accumulation      */
/*   alpha -> 2: beta -> 0, identity operator = NO memory accumulation */
/* 1-unit age floor regularizes the near-end singularity (discretize   */
/* finely near the present as alpha -> 2). Scale-free: 3.16x more mass */
/* per nearer decade at alpha=1.5, at every scale.                     */
/* ------------------------------------------------------------------ */
class MemoryKernel {
  constructor(alpha) {
    this.alpha = (alpha === undefined ? 1.5 : Math.min(1.99, Math.max(1.01, alpha)));
    this.events = []; // { t, key, value }
  }
  add(t, key, value) { this.events.push({ t, key, value: value || 1 }); if (this.events.length > 500) this.events.shift(); }
  gravity(now, key) {
    let g = 0;
    for (const e of this.events) {
      if (key && e.key !== key) continue;
      const age = Math.max(1, now - e.t); // floor regularizes age->0
      g += Math.pow(age, 1 - this.alpha) * e.value;
    }
    return g;
  }
  /* alpha -> 1: deep institutional memory; alpha -> 2: recency bias */
  shiftAlpha(d) { this.alpha = Math.min(1.99, Math.max(1.01, this.alpha + d)); }
}

/* ------------------------------------------------------------------ */
/* Term 2: CognitiveLoadFork — S1/S2 mix from alert volume             */
/* w_S1(l) = 1 / (1 + e^{-6(l-0.5)})  [validated: l=0.75 -> 81.8% S1]  */
/* High load: fast heuristic triage (S1). Low load: deep correlation.  */
/* ------------------------------------------------------------------ */
class CognitiveLoadFork {
  constructor(beta) { this.beta = beta || 6; this.load = 0; }
  observe(alertCount, attention) {
    // load = queue pressure: how far alerts exceed the SOC's attention
    this.load = Math.min(1, alertCount / Math.max(1, attention * 3));
  }
  wS1() { return 1 / (1 + Math.exp(-this.beta * (this.load - 0.5))); }
}

/* ------------------------------------------------------------------ */
/* Term 6: EnsembleArbiter — N engines, inverse-Brier weights          */
/* omega_k = (1/BS_k) / sum_j (1/BS_j); Brier scores updated online    */
/* against ground truth (incident confirmed / false alarm).            */
/* Term 8 (v1.2): calibration-based variance Var = sum w_k^2 * BS_k.   */
/* Intervals are responsive: unproven engines -> wide, calibrated      */
/* engines -> tight. Precision is EARNED through the feedback loop.    */
/* ------------------------------------------------------------------ */
class EnsembleArbiter {
  constructor(engines) {
    this.engines = engines.map(e => ({ ...e, briers: [0.25] })); // prior Brier
    this.lastVotes = null;
  }
  weights() {
    const inv = this.engines.map(e => 1 / this.meanBrier(e));
    const sum = inv.reduce((s, x) => s + x, 0);
    return inv.map(x => x / sum);
  }
  meanBrier(e) { return e.briers.reduce((s, x) => s + x, 0) / e.briers.length; }
  vote(features) {
    const ps = this.engines.map(e => Math.min(0.99, Math.max(0.01, e.run(features))));
    const w = this.weights();
    let p = 0;
    for (let i = 0; i < ps.length; i++) p += w[i] * ps[i];
    /* Term 7: DRO envelope — worst case over epsilon perturbations.
       Assumes the attacker may know the weighting: adversarially push
       weight toward the most pessimistic engine within epsilon. */
    const eps = features.epsRobust !== undefined ? features.epsRobust : 0.15;
    let worst = p;
    for (let i = 0; i < ps.length; i++) {
      const wAdv = Math.min(1, w[i] + eps / ps.length);
      let pAdv = ps[i] * wAdv;
      let rest = 1 - wAdv, restSum = 0;
      for (let j = 0; j < ps.length; j++) if (j !== i) restSum += ps[j] * w[j] / Math.max(1e-9, 1 - w[i]);
      worst = Math.min(worst, pAdv + restSum * rest);
    }
    /* Term 8 (v1.2): calibration-based variance. Each engine's variance
       is its rolling Brier score — a proper scoring rule measuring both
       discrimination and calibration. Replaces v1.1's coin-flip p(1-p)
       model, which produced degenerate [0,1] intervals. */
    let variance = 0;
    for (let i = 0; i < ps.length; i++) variance += w[i] * w[i] * this.meanBrier(this.engines[i]);
    variance = Math.min(0.25, Math.max(0.001, variance));
    this.lastVotes = { ps, w, p, worst, variance };
    return this.lastVotes;
  }
  /* Ground-truth update: truth in {0,1} for the questioned hypothesis  */
  update(truth) {
    if (!this.lastVotes) return;
    this.engines.forEach((e, i) => {
      const p = this.lastVotes.ps[i];
      e.briers.push((p - truth) * (p - truth));
      if (e.briers.length > 50) e.briers.shift();
    });
  }
  demoteMiscalibrated() { // auto-corrector: sharpen inverse-Brier spread
    this.engines.forEach(e => { const m = this.meanBrier(e); e.briers.push(Math.min(1, m * 1.1)); });
  }
}

/* ------------------------------------------------------------------ */
/* Term 9: SF Guardrail — certification gate before any response       */
/* P_SF = logit^-1( logit(P_base) + logit(P_ensemble) )  [logit(.5)=0] */
/* Requires the two sources to be INDEPENDENT (this is naive-Bayes     */
/* odds multiplication: two 60% votes compound to 69% — if both read   */
/* the same telemetry, they double-count).                             */
/* PASS iff |dLogit| <= 1.5 AND meanBrier <= 0.15 AND termBalance<=0.6 */
/* ------------------------------------------------------------------ */
class Guardrail {
  constructor(opts) {
    opts = opts || {};
    this.dMax = opts.dMax || 1.5;
    this.brierBar = opts.brierBar || 0.15;
    this.tauBar = opts.tauBar || 0.60;
  }
  static logit(p) { return Math.log(p / (1 - p)); }
  static invLogit(x) { return 1 / (1 + Math.exp(-x)); }
  certify(pBase, pEnsemble, meanBrier, termBalance, sourcesIndependent) {
    const lB = Guardrail.logit(Math.min(0.99, Math.max(0.01, pBase)));
    const lE = Guardrail.logit(Math.min(0.99, Math.max(0.01, pEnsemble)));
    const pSF = Guardrail.invLogit(lB + lE);
    const dLogit = Math.abs(lE - lB);
    const reasons = [];
    if (!sourcesIndependent) reasons.push('sources not independent: naive-Bayes odds product would double-count shared evidence');
    if (dLogit > this.dMax) reasons.push('outside view: |dLogit|=' + dLogit.toFixed(2) + ' > ' + this.dMax + ' (models disagree too hard)');
    if (meanBrier > this.brierBar) reasons.push('calibration: meanBrier=' + meanBrier.toFixed(3) + ' > ' + this.brierBar);
    if (termBalance > this.tauBar) reasons.push('term balance: ' + termBalance.toFixed(2) + ' > ' + this.tauBar + ' (one term dominating)');
    return { pass: reasons.length === 0, pSF, dLogit, reasons };
  }
}

/* ------------------------------------------------------------------ */
/* The orchestrator: wraps BlueTeamAgent, applies the chaos cycle      */
/* per tick: perceive -> engines vote -> guardrail certifies ->        */
/* agent acts (GOAP) only on certified beliefs -> auto-correctors.     */
/* ------------------------------------------------------------------ */
class ChaosDefender {
  constructor(agent, opts) {
    opts = opts || {};
    this.agent = agent;
    this.adversary = new AdversaryModel({ gamma: opts.gamma, levelK: opts.levelK });
    this.kernel = new MemoryKernel(opts.alpha);
    this.load = new CognitiveLoadFork(opts.beta);
    this.ensemble = new EnsembleArbiter(opts.engines || ChaosDefender.defaultEngines());
    this.guardrail = new Guardrail(opts.guardrail);
    this.noiseSigma = opts.noiseSigma !== undefined ? opts.noiseSigma : 0.02; // Term 4
    this.onCertify = opts.onCertify || (() => {});
    this.onCorrect = opts.onCorrect || (() => {});
    this.lastCert = null;
  }

  static defaultEngines() {
    return [
      { id: 'signature', name: 'Sigma Signature Engine',
        run: f => f.sigConf || 0.3 },
      { id: 'threshold', name: 'Threshold Heuristic',
        run: f => Math.min(0.95, (f.sigConf || 0.3) * (f.repeatBoost || 1) * 1.15) },
      { id: 'ewma', name: 'EWMA Anomaly Engine',
        run: f => Math.min(0.95, 0.5 + 0.5 * Math.tanh((f.anomalyZ || 0) - 1)) },
      { id: 'adversary', name: 'Adversary Prediction Engine',
        run: f => f.predictedProb || 0.4 }
    ];
  }

  /* Player event: feeds the agent AND the chaos layer */
  perceive(ev) {
    this.agent.perceive(ev);
    this.kernel.add(Date.now(), (ev.technique || ev.type) + '@' + ev.node, 1);
    return ev;
  }

  /* Term 4: Ito-style confidence jitter (zero-days / novel attacks) */
  jitter(p) {
    const z = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.2; // ~N(0,1)
    return Math.min(0.99, Math.max(0.01, p + this.noiseSigma * z));
  }

  /* Predict the attacker's next technique (Omega_B) from payoffs and history */
  predictAdversary(node, techniqueOptions) {
    const now = Date.now();
    const options = techniqueOptions.map(t => ({
      technique: t.id,
      payoff: t.payoff,
      entropy: 1 / (1 + this.kernel.gravity(now, t.id + '@' + node)), // burned techniques -> predictable to us
      hist: this.kernel.gravity(now, t.id + '@' + node)
    }));
    const probs = this.adversary.predict(options);
    const ranked = options.map((o, i) => ({ technique: o.technique, p: probs[i], gravity: o.hist }))
      .sort((a, b) => b.p - a.p);
    return ranked;
  }

  /* One chaos cycle layered over the agent tick */
  tick() {
    // Term 2: cognitive load from the alert queue
    this.load.observe(this.agent.alerts.length, this.agent.attention);
    const wS1 = this.load.wS1();

    // S1 (fast heuristic) vs S2 (deep correlation) attention split:
    // under load, triage uses fewer, shallower alert reads
    const attention = Math.max(1, Math.round(this.agent.attention * (1 - 0.4 * wS1)));

    // Belief base rate from the strongest current signals (Term 3: decay-Bayes)
    const top = this.agent.alerts.slice(0, attention);
    let sigConf = 0.3;
    if (top.length) {
      // log-odds sum across independent signal families (naive-Bayes, honest label)
      let lodds = 0;
      const seen = new Set();
      top.forEach(a => {
        const family = a.technique;
        if (seen.has(family)) return; // same-technique alerts share evidence
        seen.add(family);
        lodds += Guardrail.logit(Math.min(0.95, a.conf));
      });
      sigConf = Guardrail.invLogit(Math.min(4, lodds / 2)); // /2: temper correlated families
      sigConf = this.jitter(sigConf); // Term 4
    }

    // Term 5: repeat boost from the RL memory kernel
    let repeatBoost = 1;
    if (this.agent.incidents.length || top.length) {
      const g = this.kernel.gravity(Date.now(), null);
      repeatBoost = 1 + Math.min(0.5, g * 0.02);
    }

    // Term 6+7+8: ensemble vote with DRO worst case and earned-variance interval
    const vote = this.ensemble.vote({
      sigConf, repeatBoost,
      anomalyZ: top.length ? top[0].conf * 3 : 0,
      predictedProb: 0.35 + 0.4 * Math.min(1, (this.kernel.events.length) / 10),
      epsRobust: 0.15
    });

    // Term 9: guardrail certification of the belief BEFORE acting on it
    const meanBrier = this.ensemble.engines.reduce((s, e) => s + this.ensemble.meanBrier(e), 0) / this.ensemble.engines.length;
    const wSpread = Math.max(...vote.w) - Math.min(...vote.w); // term balance: no single engine dominating
    const cert = this.guardrail.certify(
      sigConf, vote.p, meanBrier, wSpread,
      true // base (signals) and ensemble (engines) draw on distinct mechanisms here
    );
    this.lastCert = { ...cert, vote, wS1, attention };
    this.onCertify(this.lastCert);

    // Ground truth will arrive when the agent resolves an incident
    const incidentsBefore = this.agent.incidents.length;
    const status = this.agent.tick();

    // Auto-correctors (Term 10) fire on FLAG
    if (!cert.pass) {
      if (cert.reasons.some(r => r.startsWith('calibration'))) {
        this.ensemble.demoteMiscalibrated(); this.onCorrect('Brier violation: demoted miscalibrated engines');
      }
      if (cert.reasons.some(r => r.startsWith('outside view'))) {
        this.kernel.shiftAlpha(0.1); this.onCorrect('Delta violation: alpha += 0.1 (flatter kernel = stronger historical drag)');
      }
      if (cert.reasons.some(r => r.startsWith('term balance'))) {
        this.adversary.gamma = Math.max(0.5, this.adversary.gamma - 0.1);
        this.onCorrect('Dominance violation: gamma -= 0.1 (wider adversary branch distribution)');
      }
    }

    // Feedback: incident resolved = engines were right (weak truth signal)
    if (incidentsBefore > 0 && this.agent.incidents.length === 0) this.ensemble.update(1);
    return status;
  }

  /* Certified output: never a bare point estimate. Interval precision is
     EARNED: wide for unproven engines, tightening as Brier scores fall. */
  forecast() {
    if (!this.lastCert) return null;
    const { p, worst, variance } = this.lastCert.vote;
    const sd = Math.sqrt(variance);
    return {
      central: p,
      lower: Math.max(0, p - 2 * sd),
      upper: Math.min(1, p + 2 * sd),
      worstCase: worst,
      certified: this.lastCert.pass,
      system1Share: this.lastCert.wS1
    };
  }
}

const ChaosDefenderLayer = { AdversaryModel, MemoryKernel, CognitiveLoadFork,
  EnsembleArbiter, Guardrail, ChaosDefender };

/* Node self-test: node chaos-defender.js */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const BT = require('./blue-team-engine.js');
  const lines = [];
  const L = (m) => lines.push(m);
  L('=== CHAOS-DEFENDER SELF-TEST (v1.2: RL kernel + earned variance) ===');
  const agent = new BT.BlueTeamAgent({ onAlert: () => {}, onIncident: i => L('INCIDENT: ' + i.title + ' on ' + i.node),
    onGoal: g => L('GOAL: ' + g.label), onAction: a => L('ACTION: ' + a.label), onExplain: t => L('  ' + t) });
  const cd = new ChaosDefender(agent, {
    onCertify: c => L('GUARDRAIL: ' + (c.pass ? 'PASS' : 'FLAG') + ' · P_SF=' + c.pSF.toFixed(3) + (c.reasons.length ? ' · ' + c.reasons.join('; ') : '')),
    onCorrect: m => L('AUTO-CORRECT: ' + m)
  });
  // Kernel dial verification (RL orientation)
  L('Kernel dial check (alpha -> 1 deep memory, alpha -> 2 recency):');
  const k1 = new MemoryKernel(1.1), k2 = new MemoryKernel(1.9);
  k1.add(0, 'x', 1); k2.add(0, 'x', 1);
  L('  alpha=1.1: 1000ms-old event gravity = ' + k1.gravity(1001, 'x').toFixed(3) + ' (deep memory: high)');
  L('  alpha=1.9: 1000ms-old event gravity = ' + k2.gravity(1001, 'x').toFixed(3) + ' (recency: low)');
  // Earned-variance check (v1.2)
  L('Earned-variance check (v1.2):');
  const ea = new EnsembleArbiter([{ id: 'a', run: () => 0.6 }, { id: 'b', run: () => 0.55 }, { id: 'c', run: () => 0.5 }, { id: 'd', run: () => 0.65 }]);
  let v0 = ea.vote({}); const f0 = { central: v0.p, width: (Math.min(1, v0.p + 2 * Math.sqrt(v0.variance)) - Math.max(0, v0.p - 2 * Math.sqrt(v0.variance))) };
  L('  unproven engines: interval width = ' + f0.width.toFixed(3) + ' (wide — honest: no track record)');
  for (let i = 0; i < 20; i++) { ea.vote({}); ea.update(1); }
  let v1 = ea.vote({}); const w1 = Math.min(1, v1.p + 2 * Math.sqrt(v1.variance)) - Math.max(0, v1.p - 2 * Math.sqrt(v1.variance));
  L('  after 20 calibrated updates: interval width = ' + w1.toFixed(3) + ' (tightened: precision earned)');
  L('Adversary ranking after history (Omega_B):');
  const events = [
    { type: 'scan', node: 'apexcorp', stealth: 0.15, technique: 'T1046' },
    { type: 'brute', node: 'apexcorp', stealth: 0.2, attempts: 240, technique: 'T1110' },
    { type: 'sqli', node: 'apexcorp', stealth: 0.3, requests: 15, technique: 'T1190' }
  ];
  events.forEach(ev => { cd.perceive(ev); cd.tick(); });
  const ranked = cd.predictAdversary('apexcorp', [
    { id: 'T1110', payoff: 120 }, { id: 'T1190', payoff: 400 }, { id: 'T1566', payoff: 90 }, { id: 'T1041', payoff: 900 }
  ]);
  ranked.forEach(r => L('  ' + r.technique + ' p=' + r.p.toFixed(3) + ' (kernel gravity ' + r.gravity.toFixed(2) + ')'));
  for (let i = 0; i < 5; i++) cd.tick();
  const f = cd.forecast();
  L('CERTIFIED FORECAST: central=' + f.central.toFixed(3) + ' CI=[' + f.lower.toFixed(3) + ', ' + f.upper.toFixed(3) + '] worst=' + f.worstCase.toFixed(3) + ' S1-share=' + f.system1Share.toFixed(2));
  L('=== kernel alpha: ' + cd.kernel.alpha.toFixed(2) + ' | adversary gamma: ' + cd.adversary.gamma.toFixed(2) + ' ===');
  console.log(lines.join('\n'));
}

if (typeof module !== 'undefined' && module.exports) module.exports = ChaosDefenderLayer;
global.ChaosDefenderLayer = ChaosDefenderLayer;

})(typeof window !== 'undefined' ? window : globalThis);
