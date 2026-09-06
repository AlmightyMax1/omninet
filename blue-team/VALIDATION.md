# Chaos-Defender Layer — Validation Record
OmniNet / blue-team — 2026-09-06

This document is the validation record for `chaos-defender.js`, the cyber-defense
adaptation of the Chaos Engine. Every claim below was tested by independent
numeric computation (not by the process that built the engine), and every test
is reproducible from the snippets described. The record includes confirmations,
corrections, and two corrections of the validator's own pre-written claims —
that is what a real validation record looks like.

## 1. Confirmed Exact (9 component claims)

| Claim | Verified value | Result |
|---|---|---|
| PT value v(+5), v(−5) | 4.1219 / −9.2742 | Exact |
| PT loss/gain ratio | 2.250000 | Exact (canonical TK) |
| Softmax γ=1000 dominant weight | 1.000000 | Exact |
| Softmax γ→0 flattening | spread → 0 | Exact |
| Softmax weights sum | 1.0 at all settings | Exact |
| S1/S2 sigmoid w(0), w(1) | 0.0474 / 0.9526 | Exact, symmetric |
| S1/S2 sigmoid w(0.75) | 0.8176 (81.8% claim) | Exact |
| Lyapunov 99% divergence at λ=0.15 | t = 30.7 | Exact |
| Guardrail logit algebra | internally consistent | Exact |

## 2. Corrections (4 load-bearing claims)

### 2.1 The memory kernel
Original: ∫τ^{−α}Y(τ)dτ over (−∞, t₀), α∈(1,2), claimed convergent.

Findings:
- **Not translation-invariant.** The same event weighted under three calendar
  epochs: 1.0×10⁻³, 2.4×10⁻³, 1.1×10⁻⁵. A memory kernel must depend on age
  (t₀−τ), never the arbitrary clock zero. Also τ^{−α} is non-real for τ<0.
- **A pure power law in age cannot converge at both ends.** Far end needs
  decay exponent >1; near end needs <1. Partial tail masses grow without
  bound at every q∈(0,1). "Infinite reach AND bounded total mass" is jointly
  impossible.
- **The claimed mass 63.18 is not kernel mass.** Pure kernel mass at α=1.5
  is exactly 1/(α−1) = 2.00. The figure embeds Y magnitudes or a finite range
  (on which everything converges trivially).
- **The 461× near/far ratio is a window artifact.** Power laws are scale-free;
  the true invariant is 3.16× per decade at α=1.5, at every scale.

Fix (implemented): `w(age) = age^(1−α)`, α∈(1,2), with a 1-unit age floor.
This is the **Riemann-Liouville fractional integral kernel of order
β = 2−α ∈ (0,1)** — see §3. Dial verified: α=1.1 → a 1000-unit-old event
retains 0.501 pull (deep memory); α=1.9 → 0.002 (recency).
Implementation caveat: as α→2 the near-end singularity sharpens; discretize
finely near the present (verified: midpoint rule misses by 3.6% at β=0.2).

Note: the v1.0 port used (t−τ)^{α−2}, which inverted the dial — caught and
corrected in v1.1.

### 2.2 Ensemble variance reduction
"N≥10 gives 90%": holds ONLY at ρ=0. ρ=0.5 → 45%; ρ=0.7 → 27%. Detection
engines on shared telemetry are correlated; no blanket claim is made.

### 2.3 Cramér-Rao bound direction
Var(W_new) ≤ 1/I(γ) inverts the Cramér-Rao inequality (Var ≥ 1/I, a lower
bound). The spec's words stated it correctly; the formula's sign was flipped.
Bound removed; Fisher precision is informational only.

### 2.4 Guardrail is naive-Bayes odds multiplication
logit(0.5)=0 makes the fusion a log-odds sum: two 60% sources compound to
69%. Kept, with a source-independence requirement to prevent double-counting.

Also: 139,968 "operating modes" = 2⁶ × 3⁷ — a parameter-grid count, not a
certification.

## 3. Fractional Calculus Identification

The corrected kernel is literally the Riemann-Liouville fractional integral
kernel: (I^β Y)(t) = (1/Γ(β))∫(t−τ)^{β−1}Y(τ)dτ with β = 2−α ∈ (0,1).
The α dial is the order of fractional integration: α→1 gives β→1 (ordinary
integral, full accumulation); α→2 gives β→0 (identity, no accumulation).

Verified numerically: for Y≡1, I^β[1] = T^β/Γ(β+1) matched to 5 decimals at
β=0.8 and within 0.02% at β=0.5. Γ(1.5) = √π/2 = 0.8862269255 (cross-checked
across two engines). Duality confirmed: d/dx[x^β] = βx^{β−1} — the memory
kernel is the derivative of the memory accumulation.

## 4. Long-Memory Resolution

Decay exponent d = α−1 ∈ (0,1) is exactly the classical long-range-dependence
parameterization (Hurst/Granger/Hosking). Consequences:
- "Influence fades but never reaches zero" is TRUE — it is the definition of
  long-range dependence.
- "Bounded total influence over infinite history" is FALSE and mutually
  exclusive with the former BY DEFINITION (bounded mass = summable = short
  memory).
- Honest guarantee: infinite qualitative reach, finite on any real horizon.
- α=2 is the logarithmic boundary (still non-summable); α>2 converges (short
  memory — not the design intent).

## 5. Prediction Tournament (corrected vs original)

- **Reproducibility (categorical win):** the original kernel's predictions
  swing 0.798 → 0.625 (std 0.072) for identical information under epoch
  shifts — an irreducible noise floor. The corrected kernel is
  translation-invariant: zero noise.
- **Memory-matching (honest negative):** on weak-signal long-memory ground
  truth, all five kernels tested landed within 2.1% Brier, and the matched
  kernel did NOT dominate (α=1.9 scored 0.2413 vs matched 0.2443). Conclusion:
  kernel tuning is second-order when the signal is weak. The validator's
  pre-written verdict line ("matched kernel wins") was wrong and is corrected
  here.
- **Adaptive weighting (modest, real):** inverse-Brier weights beat static
  equal weights by 2.2%/1.4% across a regime shift, and correctly diagnosed
  the broken engine (weight 0.25 → 0.19), promoting the engines right for the
  new regime. The validator's pre-written "double digits" claim was wrong and
  is corrected here.
- **Calibration (categorical):** honest intervals replace an inverted
  precision bound.

## 6. v1.2 Patch: Earned Variance (verified enhancement before shipping)

v1.1's variance model (coin-flip p(1−p) inflated by a crude correlation
multiplier) produced degenerate [0, 1] intervals in every scenario and never
responded to calibration. v1.2 uses Var = Σω²·BS_k:

| Engine state | v1.1 interval width | v1.2 interval width |
|---|---|---|
| Unproven (Brier ~0.25) | 1.000 (degenerate) | 0.912 |
| Track records (0.14–0.25) | 1.000 (degenerate) | 0.823 |
| Calibrated (~0.10) | 1.000 (degenerate) | 0.644 → [0.270, 0.914] |

Precision is earned through the online Brier feedback loop — delivering the
spec's promise that every cycle leaves the engine measurably better calibrated.

## 7. Standing Boundaries (unchanged, now empirically illustrated)

- The engine counts; it does not learn in any ML sense.
- Its accuracy ceiling is the quality of the causal graph and calibration
  data (demonstrated: on weak-signal data, even a perfect memory model gains
  ~nothing).
- Guardrail thresholds (1.5 / 0.15 / 0.60) are hand-tuned heuristics.

## 8. Reproducing

- `node chaos-defender.js` — self-test: kernel dial, earned-variance
  tightening, adversary ranking, guardrail verdicts, certified forecast.
- All numeric tests above are 5–40 line Python snippets (statistics
  calculator) and 1-line CAS/engine checks; numbers are deterministic where
  seeded.
