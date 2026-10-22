/**
 * Auto-layout search shared by scripts/auto-layout.mjs and the in-app Web Worker.
 * Seeds straight/L/U candidates, grows robots (or AMRs when full pallets wait) until the target is met,
 * then trims AMRs while it holds. Racks are fixed by the storage requirement (R-STORAGE), docks stay 1
 * (outbound). Simulation is injected (`evaluate`), so this module has no three.js dependency.
 */
import { LINE_RATE_CAP, ROBOT_RATE_ESTIMATE, buildLayout, scoreFixed, scoreLayout, seedParams, storageRequirement } from "@/domain/layout/autoLayout";
import type { LayoutCandidate, LayoutConstraints, LayoutParams, LayoutPattern, SimMetrics } from "@/domain/layout/autoLayout";

/** A candidate counts as meeting the target at >= 95 % of it. */
export const MET_RATIO = 0.95;

export type EvaluatedCandidate = {
  candidate: LayoutCandidate;
  metrics: (SimMetrics & { shipped?: number; cpuMs?: number }) | null;
  score: number;
  met: boolean;
  /** Why it was not simulated (geometry issue or loadTemplate rejection). */
  note?: string;
};
export type SearchProgress = { evaluated: number; total: number; current: string; last?: EvaluatedCandidate };
export type SearchDiagnosis = { code: "ok" | "floor-too-small" | "target-exceeds-max" | "grow-blocked"; message: string };
export type SearchResult = {
  constraints: LayoutConstraints;
  ranked: EvaluatedCandidate[];
  evaluated: number;
  diagnosis: SearchDiagnosis;
  /** Best not-met candidate (highest placed/h) when nothing meets the target. */
  closest: EvaluatedCandidate | null;
  storage: ReturnType<typeof storageRequirement>;
  cancelled: boolean;
};
export type SearchOptions = {
  evaluate: (candidate: LayoutCandidate) => Promise<SimMetrics | { error: string }> | SimMetrics | { error: string };
  patterns?: LayoutPattern[];
  top?: number;
  onProgress?: (progress: SearchProgress) => void;
  /** Checked between candidates; return true to stop early (partial results are returned). */
  cancelled?: () => boolean;
};

const robotsOf = (p: LayoutParams) => p.robotsPerLine * p.lines;

export async function searchLayouts(constraints: LayoutConstraints, options: SearchOptions): Promise<SearchResult> {
  if (constraints.mode === "fixed") return searchFixed(constraints, options);
  const patterns = options.patterns ?? ["straight", "L", "U"];
  const maxRobots = constraints.maxRobots ?? 24, maxAmrs = constraints.maxAmrs ?? 6;
  const target = constraints.targetPerHour;
  const seeds = seedParams(constraints).filter((p) => patterns.includes(p.pattern));
  const needRobots = Math.min(maxRobots, Math.ceil(target / ROBOT_RATE_ESTIMATE));
  const estimate = (seed: LayoutParams) => 2 + Math.max(0, Math.ceil((needRobots - robotsOf(seed)) / seed.lines));
  let remaining = seeds.reduce((sum, seed) => sum + estimate(seed), 0);
  const evaluated = new Map<string, EvaluatedCandidate>();
  let growBlockedByMax = false, growBlockedByGeometry = false;

  const evaluate = async (params: LayoutParams) => {
    const key = JSON.stringify(params);
    const hit = evaluated.get(key);
    if (hit) return hit;
    const candidate = buildLayout(constraints, params);
    options.onProgress?.({ evaluated: evaluated.size, total: Math.max(evaluated.size + remaining, evaluated.size + 1), current: candidate.template.name });
    let result: EvaluatedCandidate;
    if (candidate.issues.length) result = { candidate, metrics: null, score: Infinity, met: false, note: candidate.issues[0] };
    else {
      const metrics = await options.evaluate(candidate);
      result = "error" in metrics
        ? { candidate, metrics: null, score: Infinity, met: false, note: metrics.error }
        : { candidate, metrics, score: scoreLayout(candidate, metrics, target), met: metrics.placedPerHour >= target * MET_RATIO };
    }
    evaluated.set(key, result);
    remaining = Math.max(0, remaining - 1);
    options.onProgress?.({ evaluated: evaluated.size, total: evaluated.size + remaining, current: candidate.template.name, last: result });
    return result;
  };

  for (const seed of seeds) {
    if (options.cancelled?.()) break;
    let params = { ...seed }, current = await evaluate(params);
    for (let step = 0; step < 14 && !current.met && current.metrics; step++) {
      if (options.cancelled?.()) break;
      const m = current.metrics;
      const add = params.lines;
      let next: LayoutParams;
      if (m.palletWaitShare > 0.1 && params.amrs < maxAmrs) next = { ...params, amrs: params.amrs + 1 };
      else if (robotsOf(params) + add <= maxRobots) next = { ...params, robotsPerLine: params.robotsPerLine + 1 };
      else if (params.amrs < maxAmrs) next = { ...params, amrs: params.amrs + 1 };
      else { growBlockedByMax = true; break; }
      remaining++;
      const result = await evaluate(next);
      if (!result.metrics) { growBlockedByGeometry = true; break; }
      // Inlet-limited: one more robot on the same belts adds nothing (each line's inlet caps its rate); stop growing.
      if (next.robotsPerLine > params.robotsPerLine && result.metrics.placedPerHour <= current.metrics!.placedPerHour * 1.01) { growBlockedByMax = true; break; }
      params = next; current = result;
    }
    if (!current.met) continue;
    while (params.amrs > 1 && !options.cancelled?.()) {
      const next = { ...params, amrs: params.amrs - 1 };
      remaining++;
      const result = await evaluate(next);
      if (!result.met) break;
      params = next;
    }
    remaining = Math.max(0, remaining - estimate(seed));
  }

  const all = [...evaluated.values()];
  const simulated = all.filter((r) => r.metrics);
  const ranked = simulated.sort((a, b) => a.score - b.score).slice(0, options.top ?? 5);
  const anyMet = simulated.some((r) => r.met);
  const closest = anyMet ? null : [...simulated].sort((a, b) => b.metrics!.placedPerHour - a.metrics!.placedPerHour)[0] ?? null;
  let diagnosis: SearchDiagnosis = { code: "ok", message: "목표를 만족하는 배치를 찾았습니다." };
  if (!simulated.length) {
    const smallest = all.map((r) => r.candidate.usedArea).sort((a, b) => a - b)[0];
    diagnosis = { code: "floor-too-small", message: `공장(${constraints.width}×${constraints.depth}m)에 들어가는 배치가 없습니다.${smallest ? ` 가장 작은 후보도 약 ${smallest.toFixed(1)}m²의 직사각형 영역이 필요합니다.` : ""} 공장 크기나 보관 시간(랙 수)을 조정하세요.` };
  } else if (!anyMet) {
    const best = closest?.metrics?.placedPerHour ?? 0;
    diagnosis = growBlockedByMax
      ? { code: "target-exceeds-max", message: `목표 ${target}박스/h는 최대 로봇 ${maxRobots}대·AMR ${maxAmrs}대로 도달할 수 없습니다 (최대 ${best}박스/h). 장비 한도를 늘리거나 목표를 낮추세요.` }
      : { code: "grow-blocked", message: `로봇을 더 늘린 배치가 공장에 들어가지 않습니다 (최대 ${best}박스/h). 공장을 넓히거나 목표를 낮추세요.` };
    void growBlockedByGeometry;
  }
  return { constraints, ranked, evaluated: evaluated.size, diagnosis, closest, storage: storageRequirement(constraints), cancelled: !!options.cancelled?.() };
}

/** Fixed mode: geometric candidates kept for simulation (keeps a run to a handful of sims). */
export const FIXED_SIM_BUDGET = 8;
type Geo = { params: LayoutParams; candidate: LayoutCandidate; estimate: number; pre: number };

/**
 * Fixed-equipment mode: place the given robots/AMRs/racks/docks (dropping robots only when the floor can't hold
 * them; racks are never dropped while any robot fits) and pick the arrangement with the most throughput.
 * 1) Geometry only: every pattern x line count x stack x rack placement, robots reduced line-evenly until it fits;
 *    pre-scored by estimated rate (robots x 220/h, capped per line inlet) and AMR distances.
 * 2) Simulate the best FIXED_SIM_BUDGET distinct arrangements and rank by scoreFixed.
 */
async function searchFixed(constraints: LayoutConstraints, options: SearchOptions): Promise<SearchResult> {
  const fixed = constraints.fixed ?? { robots: 6, amrs: 2, racks: 4, docks: 1 };
  const want = Math.max(1, Math.round(fixed.robots)), racks = Math.max(0, Math.round(fixed.racks));
  const amrs = Math.max(1, Math.round(fixed.amrs)), docks = Math.max(1, Math.round(fixed.docks));
  const patterns = options.patterns ?? ["straight", "L", "U"];
  // Feed matched to the capacity being placed; storage requirement follows that rate.
  const rate = Math.round(Math.min(want * ROBOT_RATE_ESTIMATE, 40 * LINE_RATE_CAP));
  const sized: LayoutConstraints = { ...constraints, targetPerHour: Math.max(1, rate) };
  const minPer = { straight: 1, L: 2, U: 3 } as const;
  const geos: Geo[] = [];
  let maxFit = 0;
  for (const pattern of patterns) {
    if (options.cancelled?.()) break;
    for (let lines = 1; lines <= Math.min(want, 12); lines++) {
      if (want < lines * minPer[pattern] && lines > 1) break;
      if (Math.ceil(want / lines) > 12) continue;
      const units = Math.ceil(lines / (pattern === "straight" ? 2 : 1));
      for (const stack of [1, 2, 3].filter((n) => n <= units))
        for (const rackPlacement of ["lineEnd", "row"] as const) {
          let robots = want, candidate: LayoutCandidate | null = null, params: LayoutParams | null = null;
          while (robots >= lines) {
            const perLine = Math.ceil(robots / lines);
            const lineRate = Math.min(LINE_RATE_CAP, perLine * ROBOT_RATE_ESTIMATE * 1.1);
            params = { pattern, lines, robotsPerLine: perLine, robots, amrs, docks, racks, stack, rackPlacement, spawnInterval: +(3600 / lineRate).toFixed(3) };
            candidate = buildLayout(sized, params);
            if (!candidate.issues.length) break;
            candidate = null;
            robots -= lines;
          }
          if (!candidate || !params) continue;
          const perLine = Math.ceil(robots / lines);
          const estimate = Math.min(robots * ROBOT_RATE_ESTIMATE, lines * Math.min(LINE_RATE_CAP, perLine * ROBOT_RATE_ESTIMATE));
          maxFit = Math.max(maxFit, robots);
          geos.push({ params, candidate, estimate, pre: -estimate + candidate.rackDistance * 15 + candidate.travel * 4 + candidate.crossings * 15 + candidate.usedArea * 0.01 });
        }
    }
  }
  // Prefer placing every robot that fits anywhere, then the pre-score; keep one entry per pattern x lines first
  // so the budget covers different topologies, then fill with the next best.
  const ordered = geos.filter((g) => g.candidate.counts.robots === maxFit).sort((a, b) => a.pre - b.pre);
  const picked: Geo[] = [], seen = new Set<string>();
  for (const g of ordered) { const k = `${g.params.pattern}-${g.params.lines}`; if (!seen.has(k) && picked.length < FIXED_SIM_BUDGET) { seen.add(k); picked.push(g); } }
  for (const g of ordered) if (picked.length < FIXED_SIM_BUDGET && !picked.includes(g)) picked.push(g);

  const results: EvaluatedCandidate[] = [];
  for (const g of picked) {
    if (options.cancelled?.()) break;
    options.onProgress?.({ evaluated: results.length, total: picked.length, current: g.candidate.template.name });
    const metrics = await options.evaluate(g.candidate);
    const result: EvaluatedCandidate = "error" in metrics
      ? { candidate: g.candidate, metrics: null, score: Infinity, met: false, note: metrics.error }
      : { candidate: g.candidate, metrics, score: scoreFixed(g.candidate, metrics), met: true };
    results.push(result);
    options.onProgress?.({ evaluated: results.length, total: picked.length, current: g.candidate.template.name, last: result });
  }
  const ranked = results.filter((r) => r.metrics).sort((a, b) => a.score - b.score).slice(0, options.top ?? 5);
  let diagnosis: SearchDiagnosis = maxFit === want
    ? { code: "ok", message: `로봇 ${want}대·AMR ${amrs}대·랙 ${racks}대·도크 ${docks}대를 모두 배치했습니다.` }
    : { code: "ok", message: `공장에 로봇 ${maxFit}/${want}대까지만 들어갑니다. 나머지 장비(AMR ${amrs}·랙 ${racks}·도크 ${docks})는 모두 배치했습니다.` };
  if (!geos.length) diagnosis = { code: "floor-too-small", message: `공장(${constraints.width}×${constraints.depth}m)에 랙 ${racks}대와 로봇 1대 이상을 함께 놓을 수 없습니다. 공장을 넓히거나 랙 수를 줄이세요.` };
  return { constraints: sized, ranked, evaluated: results.length, diagnosis, closest: null, storage: storageRequirement(sized), cancelled: !!options.cancelled?.() };
}
