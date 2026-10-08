// Подбор рецепта: какие из имеющихся красок и в каких частях смешать,
// чтобы получить нужный цвет. Перебираются все пары и лучшие тройки.
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const C = isNode ? require('./color.js') : root.PPColor;

  const MAX_PARTS = 10; // больше десяти капель на рецепт неудобно отмерять
  const TRIPLE_POOL = 40; // тройки собираются из красок, лучше всего показавших себя в парах
  const MIN_GAIN = 0.3; // лишняя краска в рецепте должна заметно улучшать совпадение
  const MAX_RESULTS = 6;
  const SLICE_MS = 14;

  function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
  }

  const PAIR_RATIOS = [];
  const TRIPLE_RATIOS = [];
  for (let a = 1; a < MAX_PARTS; a++) {
    for (let b = 1; a + b <= MAX_PARTS; b++) {
      if (gcd(a, b) === 1) PAIR_RATIOS.push([a, b]);
      for (let c = 1; a + b + c <= MAX_PARTS; c++) {
        if (gcd(gcd(a, b), c) === 1) TRIPLE_RATIOS.push([a, b, c]);
      }
    }
  }
  // Сильные разбавления для бледных оттенков: много одной краски и капля другой.
  for (const many of [12, 15, 20]) PAIR_RATIOS.push([many, 1], [1, many]);

  // ΔE между целью и смесью до трёх красок. Двойная смесь — третья с нулём частей.
  function makeScorer(targetLab) {
    const tL = targetLab[0];
    const ta = targetLab[1];
    const tb = targetLab[2];
    const { SIZE, CMF_X, CMF_Y, CMF_Z, XN, YN, ZN, labF, deltaE } = C;

    return function score(m0, p0, m1, p1, m2, p2) {
      const K0 = m0.K;
      const K1 = m1.K;
      const K2 = m2.K;
      const invS = 1 / (p0 * m0.S + p1 * m1.S + p2 * m2.S);
      let X = 0;
      let Y = 0;
      let Z = 0;
      for (let i = 0; i < SIZE; i++) {
        const ks = (p0 * K0[i] + p1 * K1[i] + p2 * K2[i]) * invS;
        const R = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
        X += CMF_X[i] * R;
        Y += CMF_Y[i] * R;
        Z += CMF_Z[i] * R;
      }
      const fx = labF(X / XN);
      const fy = labF(Y / YN);
      const fz = labF(Z / ZN);
      return deltaE(tL, ta, tb, 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz));
    };
  }

  const now = () => performance.now();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

  // paints: [{ lab, model, ... }]. token.cancelled = true прерывает поиск (вернётся null).
  async function findRecipes(targetLab, paints, { onProgress, token } = {}) {
    const n = paints.length;
    const single = paints.map((p) => C.deltaELab(targetLab, p.lab));

    let bestSingle = null;
    for (let i = 0; i < n; i++) {
      if (!bestSingle || single[i] < bestSingle.dE) bestSingle = { paint: paints[i], dE: single[i] };
    }
    if (n < 2) return { recipes: [], bestSingle };

    const score = makeScorer(targetLab);
    const found = [];
    const pairDE = new Float64Array(n * n).fill(Infinity);
    const paintBest = new Float64Array(n).fill(Infinity);

    const pool = Math.min(n, TRIPLE_POOL);
    const pairWork = ((n * (n - 1)) / 2) * PAIR_RATIOS.length;
    const tripleWork = ((pool * (pool - 1) * (pool - 2)) / 6) * TRIPLE_RATIOS.length;
    const total = pairWork + tripleWork;
    let done = 0;
    let sliceStart = now();

    async function breathe() {
      if (now() - sliceStart < SLICE_MS) return true;
      if (onProgress) onProgress(done / total);
      await pause();
      sliceStart = now();
      return !(token && token.cancelled);
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const mi = paints[i].model;
        const mj = paints[j].model;
        let best = Infinity;
        let ratio = null;
        for (const r of PAIR_RATIOS) {
          const d = score(mi, r[0], mj, r[1], mi, 0);
          if (d < best) {
            best = d;
            ratio = r;
          }
        }
        pairDE[i * n + j] = best;
        if (best < paintBest[i]) paintBest[i] = best;
        if (best < paintBest[j]) paintBest[j] = best;
        if (best < Math.min(single[i], single[j]) - MIN_GAIN) {
          found.push({ idx: [i, j], parts: ratio, dE: best });
        }
        done += PAIR_RATIOS.length;
        if (!(await breathe())) return null;
      }
    }

    const order = Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => paintBest[a] - paintBest[b])
      .slice(0, pool)
      .sort((a, b) => a - b);

    for (let x = 0; x < pool; x++) {
      for (let y = x + 1; y < pool; y++) {
        for (let z = y + 1; z < pool; z++) {
          const i = order[x];
          const j = order[y];
          const k = order[z];
          const mi = paints[i].model;
          const mj = paints[j].model;
          const mk = paints[k].model;
          let best = Infinity;
          let ratio = null;
          for (const r of TRIPLE_RATIOS) {
            const d = score(mi, r[0], mj, r[1], mk, r[2]);
            if (d < best) {
              best = d;
              ratio = r;
            }
          }
          const simpler = Math.min(pairDE[i * n + j], pairDE[i * n + k], pairDE[j * n + k]);
          if (best < simpler - MIN_GAIN) found.push({ idx: [i, j, k], parts: ratio, dE: best });
          done += TRIPLE_RATIOS.length;
          if (!(await breathe())) return null;
        }
      }
    }

    // При близком совпадении выигрывает рецепт попроще.
    const rank = (f) => f.dE + 0.25 * (f.idx.length - 2) + 0.01 * f.parts.reduce((a, b) => a + b, 0);
    found.sort((a, b) => rank(a) - rank(b));

    // Краски с одинаковым цветом (белила, чернила того же тона) дают одинаковые
    // рецепты — оставляем первый. Заметно худшие варианты не показываем вовсе.
    const picked = [];
    const seen = new Set();
    for (const f of found) {
      if (picked.length === MAX_RESULTS) break;
      if (picked.length && f.dE > Math.max(picked[0].dE + 3, 5)) continue;
      const sig = f.idx
        .map((index, pos) => `${paints[index].hex}×${f.parts[pos]}`)
        .sort()
        .join('+');
      if (seen.has(sig)) continue;
      seen.add(sig);
      picked.push(f);
    }

    const recipes = picked.map((f) => {
      const items = f.idx
        .map((index, pos) => ({ paint: paints[index], parts: f.parts[pos] }))
        .sort((a, b) => b.parts - a.parts);
      const mixed = C.mix(
        items.map((it) => it.paint.model),
        items.map((it) => it.parts)
      );
      return { items, rgb: mixed.rgb, dE: f.dE };
    });

    if (onProgress) onProgress(1);
    return { recipes, bestSingle };
  }

  const api = { findRecipes, MAX_PARTS, PAIR_RATIOS, TRIPLE_RATIOS };

  if (isNode) module.exports = api;
  else root.PPRecipe = api;
})(typeof self !== 'undefined' ? self : globalThis);
