// Цветовая математика: sRGB ↔ Lab, разница цветов ΔE2000 и смешивание красок
// по Кубелке — Мунку. Перевод RGB в спектр сделан как в spectral.js
// (MIT, © 2025 Ronald van Wijnen), таблицы лежат в spectra.js.
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const SP = isNode ? require('./spectra.js') : root.PPSpectra;

  const SIZE = 38;
  const BASE = {};
  for (const k of Object.keys(SP.BASE)) BASE[k] = Float64Array.from(SP.BASE[k]);
  const CMF_X = Float64Array.from(SP.CMF[0]);
  const CMF_Y = Float64Array.from(SP.CMF[1]);
  const CMF_Z = Float64Array.from(SP.CMF[2]);

  // Белая точка D65 в тех же единицах, что даёт CMF (Y белого = 1).
  const XN = 0.9504559270516716;
  const YN = 1;
  const ZN = 1.0890577507598784;

  // Матовая краска отражает хотя бы ~1% света в любой части спектра,
  // цифровые образцы вроде #000000 этого не учитывают.
  const R_MIN = 0.01;
  // Доля рассеяния, которая есть у любой краски. Остальное растёт со светлотой:
  // белила рассеивают сильнее всего, поэтому «разбеливают» остальные цвета.
  const S_BASE = 0.2;

  const TO_LINEAR = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    TO_LINEAR[i] = x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92;
  }

  function fromLinear(x) {
    const v = x > 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : x * 12.92;
    return Math.min(255, Math.max(0, Math.round(v * 255)));
  }

  function hexToRgb(hex) {
    let s = String(hex).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, (c) => c + c);
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function xyzToLab(X, Y, Z) {
    const fx = labF(X / XN);
    const fy = labF(Y / YN);
    const fz = labF(Z / ZN);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labF(t) {
    return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  }

  function xyzToRgb(X, Y, Z) {
    return [
      fromLinear(3.2409699419045226 * X - 1.537383177570094 * Y - 0.4986107602930034 * Z),
      fromLinear(-0.9692436362808796 * X + 1.8759675015077202 * Y + 0.04155505740717559 * Z),
      fromLinear(0.05563007969699366 * X - 0.20397695888897652 * Y + 1.0569715142428786 * Z),
    ];
  }

  function rgbToLab(rgb) {
    const r = TO_LINEAR[rgb[0]];
    const g = TO_LINEAR[rgb[1]];
    const b = TO_LINEAR[rgb[2]];
    return xyzToLab(
      0.41239079926595934 * r + 0.357584339383878 * g + 0.1804807884018343 * b,
      0.21263900587151027 * r + 0.715168678767756 * g + 0.07219231536073371 * b,
      0.01933081871559182 * r + 0.11919477979462598 * g + 0.9505321522496607 * b
    );
  }

  function labToRgb(L, a, b) {
    const fy = (L + 16) / 116;
    return xyzToRgb(XN * labFInv(fy + a / 500), YN * labFInv(fy), ZN * labFInv(fy - b / 200));
  }

  function labFInv(f) {
    const f3 = f * f * f;
    return f3 > 216 / 24389 ? f3 : (116 * f - 16) / (24389 / 27);
  }

  // Тень и блик для объёмной покраски: тот же оттенок, но темнее и светлее.
  // У краёв шаг по светлоте ужимается: почти чёрному некуда темнеть, почти
  // белому — светлеть. Блик заодно чуть бледнее, тень чуть насыщеннее.
  function tones(rgb) {
    const [L, a, b] = rgbToLab(rgb);
    const down = Math.max(0, Math.min(16, (L - 4) * 0.6));
    const up = Math.max(0, Math.min(15, (97 - L) * 0.7));
    return {
      shade: labToRgb(L - down, a * 1.05, b * 1.05),
      highlight: labToRgb(L + up, a * 0.85, b * 0.85),
    };
  }

  const RAD = Math.PI / 180;
  const POW25_7 = 6103515625;

  // CIEDE2000: насколько два цвета отличаются на глаз. Меньше 1 — не отличить,
  // 2–3 — видно, если положить рядом.
  function deltaE(L1, a1, b1, L2, a2, b2) {
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cb7 = Math.pow((C1 + C2) / 2, 7);
    const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + POW25_7)));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);
    let h1p = C1p === 0 ? 0 : Math.atan2(b1, a1p) / RAD;
    if (h1p < 0) h1p += 360;
    let h2p = C2p === 0 ? 0 : Math.atan2(b2, a2p) / RAD;
    if (h2p < 0) h2p += 360;

    const grey = C1p * C2p === 0;
    let dhp = 0;
    if (!grey) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * RAD) / 2);

    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p;
    if (!grey) {
      if (Math.abs(h1p - h2p) <= 180) hbp /= 2;
      else hbp = hbp < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
    }

    const T =
      1 -
      0.17 * Math.cos((hbp - 30) * RAD) +
      0.24 * Math.cos(2 * hbp * RAD) +
      0.32 * Math.cos((3 * hbp + 6) * RAD) -
      0.2 * Math.cos((4 * hbp - 63) * RAD);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Cbp7 = Math.pow(Cbp, 7);
    const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7));
    const Lm = (Lbp - 50) * (Lbp - 50);
    const SL = 1 + (0.015 * Lm) / Math.sqrt(20 + Lm);
    const SC = 1 + 0.045 * Cbp;
    const SH = 1 + 0.015 * Cbp * T;
    const RT = -Math.sin(2 * dTheta * RAD) * RC;

    const l = dLp / SL;
    const c = dCp / SC;
    const h = dHp / SH;
    return Math.sqrt(l * l + c * c + h * h + RT * c * h);
  }

  function deltaELab(lab1, lab2) {
    return deltaE(lab1[0], lab1[1], lab1[2], lab2[0], lab2[1], lab2[2]);
  }

  // Процент совпадения для интерфейса: 100 — тот же цвет, 98 — отличие едва заметно.
  function matchPercent(dE) {
    return Math.max(0, Math.round(100 - dE));
  }

  // Спектр отражения цвета: RGB раскладывается на белую, вторичные и основные
  // составляющие, каждая со своей опорной кривой.
  function reflectance(rgb) {
    let r = TO_LINEAR[rgb[0]];
    let g = TO_LINEAR[rgb[1]];
    let b = TO_LINEAR[rgb[2]];
    const w = Math.min(r, g, b);
    r -= w;
    g -= w;
    b -= w;
    const c = Math.min(g, b);
    const m = Math.min(r, b);
    const y = Math.min(r, g);
    const pr = Math.max(0, Math.min(r - b, r - g));
    const pg = Math.max(0, Math.min(g - b, g - r));
    const pb = Math.max(0, Math.min(b - g, b - r));

    const R = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
      R[i] = Math.max(
        R_MIN,
        w * BASE.W[i] + c * BASE.C[i] + m * BASE.M[i] + y * BASE.Y[i] + pr * BASE.R[i] + pg * BASE.G[i] + pb * BASE.B[i]
      );
    }
    return R;
  }

  // Модель краски для смешивания: K — поглощение по длинам волн, S — рассеяние.
  // Отношение K/S восстанавливается из цвета образца, а само S оценивается по
  // светлоте, потому что настоящих данных о пигментах нет.
  function paintModel(rgb) {
    const R = reflectance(rgb);
    let Y = 0;
    for (let i = 0; i < SIZE; i++) Y += CMF_Y[i] * R[i];
    const S = S_BASE + (1 - S_BASE) * Math.min(1, Y);
    const K = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) K[i] = (((1 - R[i]) * (1 - R[i])) / (2 * R[i])) * S;
    return { K, S };
  }

  // Смесь красок в заданных частях → XYZ. out — массив на 3 числа.
  function mixXyz(models, parts, out) {
    let S = 0;
    for (let j = 0; j < models.length; j++) S += parts[j] * models[j].S;
    let X = 0;
    let Y = 0;
    let Z = 0;
    for (let i = 0; i < SIZE; i++) {
      let k = 0;
      for (let j = 0; j < models.length; j++) k += parts[j] * models[j].K[i];
      const ks = k / S;
      const R = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
      X += CMF_X[i] * R;
      Y += CMF_Y[i] * R;
      Z += CMF_Z[i] * R;
    }
    out[0] = X;
    out[1] = Y;
    out[2] = Z;
    return out;
  }

  function mix(models, parts) {
    const xyz = mixXyz(models, parts, [0, 0, 0]);
    return { rgb: xyzToRgb(xyz[0], xyz[1], xyz[2]), lab: xyzToLab(xyz[0], xyz[1], xyz[2]) };
  }

  const api = {
    SIZE,
    CMF_X,
    CMF_Y,
    CMF_Z,
    XN,
    YN,
    ZN,
    TO_LINEAR,
    fromLinear,
    hexToRgb,
    rgbToHex,
    rgbToLab,
    xyzToLab,
    labF,
    labToRgb,
    tones,
    xyzToRgb,
    deltaE,
    deltaELab,
    matchPercent,
    paintModel,
    mix,
  };

  if (isNode) module.exports = api;
  else root.PPColor = api;
})(typeof self !== 'undefined' ? self : globalThis);
