(function () {
  'use strict';

  const C = window.PPColor;
  const { findRecipes } = window.PPRecipe;
  const DATA = window.PPPaints;

  const TYPE_LABEL = { ink: 'чернила', fluo: 'флуо', fx: 'Special FX', opaque: 'Extra Opaque' };
  const MAX_SIDE = 4096; // фото крупнее уменьшается: для подбора цвета этого хватает
  const MATCH_LIMIT = 40;
  const LOUPE = 132;
  const MAX_SCALE = 48;
  // Отступы под плавающие панели, чтобы вписанное фото под них не залезало.
  const INSET = { top: 70, right: 24, bottom: 62, left: 24 };

  const paints = DATA.items.map((p) => {
    const rgb = C.hexToRgb(p.hex);
    return { ...p, rgb, lab: C.rgbToLab(rgb), model: C.paintModel(rgb) };
  });
  const byCode = new Map(paints.map((p) => [p.code, p]));

  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('pp.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('pp.' + key, JSON.stringify(value));
      } catch {
        // без сохранения приложение всё равно работает
      }
    },
  };

  const savedOwned = store.get('owned', []);
  const state = {
    color: null,
    owned: new Set(Array.isArray(savedOwned) ? savedOwned.filter((code) => byCode.has(code)) : []),
    radius: clamp(Number(store.get('radius', 6)) || 0, 0, 40), // радиус пипетки в пикселях экрана
    mode: store.get('mode', 'avg') === 'dom' ? 'dom' : 'avg',
    tab: 'matches',
    onlyMine: false,
    pick: null, // { x, y, r } в пикселях фото
    hover: null, // { cx, cy } в пикселях экрана
  };

  // ───── Фото и вид ─────

  const stage = $('stage');
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  const src = document.createElement('canvas');
  const srcCtx = src.getContext('2d', { willReadFrequently: true });
  let pixels = null;
  let hasImage = false;
  let cw = 0;
  let ch = 0;
  let dpr = 1;
  const view = { scale: 1, x: 0, y: 0, fitted: true };

  async function loadImage(blob) {
    let bmp;
    try {
      bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      toast('Не получилось открыть этот файл как картинку');
      return;
    }
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    src.width = Math.max(1, Math.round(bmp.width * k));
    src.height = Math.max(1, Math.round(bmp.height * k));
    srcCtx.fillStyle = '#fff';
    srcCtx.fillRect(0, 0, src.width, src.height);
    srcCtx.drawImage(bmp, 0, 0, src.width, src.height);
    bmp.close();
    pixels = srcCtx.getImageData(0, 0, src.width, src.height).data;

    hasImage = true;
    state.pick = null;
    state.hover = null;
    $('empty').hidden = true;
    $('toolbar').hidden = false;
    $('zoom').hidden = false;
    $('hint').hidden = false;
    fitView();
    draw();
  }

  function fitScale() {
    const w = Math.max(40, cw - INSET.left - INSET.right);
    const h = Math.max(40, ch - INSET.top - INSET.bottom);
    return Math.min(w / src.width, h / src.height, 8);
  }

  function fitView() {
    const s = fitScale();
    view.scale = s;
    view.x = INSET.left + (cw - INSET.left - INSET.right - src.width * s) / 2;
    view.y = INSET.top + (ch - INSET.top - INSET.bottom - src.height * s) / 2;
    view.fitted = true;
    showZoom();
  }

  function zoomAt(cx, cy, factor) {
    const s = clamp(view.scale * factor, Math.min(fitScale(), 1) * 0.5, MAX_SCALE);
    const k = s / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = s;
    view.fitted = false;
    showZoom();
    draw();
  }

  function showZoom() {
    $('zoomVal').textContent = Math.round(view.scale * 100) + '%';
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cw = rect.width;
    ch = rect.height;
    canvas.width = Math.max(1, Math.round(cw * dpr));
    canvas.height = Math.max(1, Math.round(ch * dpr));
    loupeCanvas.width = LOUPE * dpr;
    loupeCanvas.height = LOUPE * dpr;
    if (hasImage && view.fitted) fitView();
    draw();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!hasImage) return;

    ctx.imageSmoothingEnabled = view.scale < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, view.x, view.y, src.width * view.scale, src.height * view.scale);

    if (state.pick) {
      const p = state.pick;
      ring(ctx, p.x * view.scale + view.x, p.y * view.scale + view.y, Math.max(p.r * view.scale, 6), 2);
    }
    if (state.hover && drag !== 'pan') {
      ring(ctx, state.hover.cx, state.hover.cy, Math.max(state.radius, 2), 1.25);
    }
  }

  function ring(c, x, y, r, width) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.lineWidth = width + 2;
    c.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    c.stroke();
    c.lineWidth = width;
    c.strokeStyle = '#fff';
    c.stroke();
  }

  // ───── Пипетка ─────

  const hist = new Int32Array(32768);

  // Цвет в круге радиуса r вокруг точки (x, y) фото. mode 'avg' — среднее по кругу,
  // 'dom' — цвет, которого в круге больше всего. Усреднение идёт в линейном свете.
  function sample(x, y, r, mode) {
    const w = src.width;
    const h = src.height;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;

    if (r < 0.75) {
      const o = (Math.floor(y) * w + Math.floor(x)) * 4;
      return [pixels[o], pixels[o + 1], pixels[o + 2]];
    }

    const lin = C.TO_LINEAR;
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(h - 1, Math.floor(y + r));
    const step = Math.max(1, Math.floor(r / 48)); // на огромных кругах берём пиксели через один и реже
    const r2 = r * r;

    let top = -1;
    if (mode === 'dom') {
      let topCount = 0;
      for (let py = y0; py <= y1; py += step) {
        for (let px = x0; px <= x1; px += step) {
          const dx = px + 0.5 - x;
          const dy = py + 0.5 - y;
          if (dx * dx + dy * dy > r2) continue;
          const o = (py * w + px) * 4;
          const bin = ((pixels[o] >> 3) << 10) | ((pixels[o + 1] >> 3) << 5) | (pixels[o + 2] >> 3);
          if (++hist[bin] > topCount) {
            topCount = hist[bin];
            top = bin;
          }
        }
      }
      hist.fill(0);
    }
    const tr = top >> 10;
    const tg = (top >> 5) & 31;
    const tb = top & 31;

    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let py = y0; py <= y1; py += step) {
      for (let px = x0; px <= x1; px += step) {
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        if (dx * dx + dy * dy > r2) continue;
        const o = (py * w + px) * 4;
        if (
          top >= 0 &&
          (Math.abs((pixels[o] >> 3) - tr) > 1 ||
            Math.abs((pixels[o + 1] >> 3) - tg) > 1 ||
            Math.abs((pixels[o + 2] >> 3) - tb) > 1)
        ) {
          continue;
        }
        sr += lin[pixels[o]];
        sg += lin[pixels[o + 1]];
        sb += lin[pixels[o + 2]];
        n++;
      }
    }
    if (!n) return sample(x, y, 0, mode);
    return [C.fromLinear(sr / n), C.fromLinear(sg / n), C.fromLinear(sb / n)];
  }

  const loupe = $('loupe');
  const loupeCanvas = $('loupeCanvas');
  const lctx = loupeCanvas.getContext('2d');

  function toImage(p) {
    return { x: (p.cx - view.x) / view.scale, y: (p.cy - view.y) / view.scale };
  }

  function updateLoupe() {
    const p = state.hover;
    if (!p || !hasImage || drag === 'pan') {
      loupe.hidden = true;
      return;
    }
    const at = toImage(p);
    const r = state.radius / view.scale;
    const rgb = sample(at.x, at.y, r, state.mode);
    if (!rgb) {
      loupe.hidden = true;
      return;
    }

    const half = Math.max(5.5, r * 2.4); // сколько пикселей фото от центра лупы до края
    const k = LOUPE / (half * 2);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.fillStyle = '#1b1c20';
    lctx.fillRect(0, 0, LOUPE, LOUPE);
    lctx.imageSmoothingEnabled = k < 3;
    lctx.drawImage(src, at.x - half, at.y - half, half * 2, half * 2, 0, 0, LOUPE, LOUPE);
    ring(lctx, LOUPE / 2, LOUPE / 2, Math.max(r, 0.5) * k, 1.5);

    const hex = C.rgbToHex(rgb);
    loupeCanvas.style.borderColor = hex;
    $('loupeHex').textContent = hex;

    // Лупа держится справа сверху от курсора и переворачивается у краёв.
    const gap = 26;
    const boxH = LOUPE + 34;
    let left = p.cx + gap;
    let top = p.cy - gap - boxH;
    if (left + LOUPE + 8 > cw) left = p.cx - gap - LOUPE;
    if (top < 8) top = p.cy + gap;
    loupe.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    loupe.hidden = false;
  }

  let drag = null; // 'pick' | 'pan'
  let panFrom = null;

  function local(e) {
    const rect = canvas.getBoundingClientRect();
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  }

  function pickAt(p, live) {
    const at = toImage(p);
    const r = state.radius / view.scale;
    const rgb = sample(at.x, at.y, r, state.mode);
    if (!rgb) return;
    state.pick = { x: at.x, y: at.y, r };
    setColor(rgb, { live });
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!hasImage) return;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 0) {
      drag = 'pick';
      state.hover = local(e);
      pickAt(state.hover, true);
      draw();
      updateLoupe();
    } else {
      e.preventDefault();
      drag = 'pan';
      panFrom = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      canvas.classList.add('panning');
      updateLoupe();
      draw();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!hasImage) return;
    if (drag === 'pan') {
      view.x = panFrom.vx + e.clientX - panFrom.x;
      view.y = panFrom.vy + e.clientY - panFrom.y;
      view.fitted = false;
      draw();
      return;
    }
    state.hover = local(e);
    if (drag === 'pick') pickAt(state.hover, true);
    draw();
    updateLoupe();
  });

  function endDrag(e) {
    if (!drag) return;
    const was = drag;
    drag = null;
    canvas.classList.remove('panning');
    if (was === 'pick') scheduleRecipe();
    if (was === 'pan') state.hover = e.type === 'pointerup' ? local(e) : null;
    draw();
    updateLoupe();
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerleave', () => {
    if (drag) return;
    state.hover = null;
    draw();
    updateLoupe();
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Средняя кнопка иначе включает автопрокрутку.
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!hasImage) return;
      e.preventDefault();
      const p = local(e);
      zoomAt(p.cx, p.cy, Math.exp(-e.deltaY * 0.0015));
      updateLoupe();
    },
    { passive: false }
  );

  $('zoomIn').addEventListener('click', () => zoomAt(cw / 2, ch / 2, 1.3));
  $('zoomOut').addEventListener('click', () => zoomAt(cw / 2, ch / 2, 1 / 1.3));
  $('zoomFit').addEventListener('click', () => {
    fitView();
    draw();
  });

  // ───── Настройки пипетки ─────

  const radiusInput = $('radius');
  radiusInput.value = state.radius;

  function showRadius() {
    $('radiusOut').textContent = state.radius ? `${state.radius * 2 + 1} px` : '1 px';
  }

  radiusInput.addEventListener('input', () => {
    state.radius = Number(radiusInput.value);
    store.set('radius', state.radius);
    showRadius();
    draw();
  });

  function showMode() {
    for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === state.mode);
  }

  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    store.set('mode', state.mode);
    showMode();
  });

  // ───── Открытие фото ─────

  const fileInput = $('file');
  $('pickFile').addEventListener('click', () => fileInput.click());
  $('openBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadImage(fileInput.files[0]);
    fileInput.value = '';
  });

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  let dragDepth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    $('dropVeil').hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('dropVeil').hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('dropVeil').hidden = true;
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')) || e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  document.addEventListener('paste', (e) => {
    const item = Array.from(e.clipboardData ? e.clipboardData.items : []).find((it) => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    loadImage(item.getAsFile());
  });

  // ───── Выбранный цвет ─────

  const hexInput = $('hexInput');

  function setColor(rgb, { live = false } = {}) {
    state.color = rgb;
    const hex = C.rgbToHex(rgb);
    const swatch = $('swatch');
    swatch.style.background = hex;
    swatch.classList.add('filled');
    if (document.activeElement !== hexInput) hexInput.value = hex;
    $('rgbText').textContent = `RGB ${rgb.join(', ')}`;
    $('copyHex').disabled = false;
    renderMatches();
    if (!live) scheduleRecipe();
  }

  hexInput.addEventListener('input', () => {
    const rgb = C.hexToRgb(hexInput.value);
    if (!rgb || hexInput.value.replace('#', '').trim().length !== 6) return;
    state.pick = null;
    setColor(rgb);
    draw();
  });

  hexInput.addEventListener('blur', () => {
    hexInput.value = state.color ? C.rgbToHex(state.color) : '';
  });

  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hexInput.blur();
  });

  $('copyHex').addEventListener('click', async () => {
    if (!state.color) return;
    const hex = C.rgbToHex(state.color);
    try {
      await navigator.clipboard.writeText(hex);
      toast(`${hex} скопирован`);
    } catch {
      toast('Не получилось скопировать');
    }
  });

  // ───── Вкладки ─────

  function showTab(tab) {
    state.tab = tab;
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
    for (const name of ['matches', 'recipe', 'mine']) $('pane-' + name).hidden = name !== tab;
    if (tab === 'recipe') runRecipe();
    if (tab === 'mine') renderMine();
  }

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  function paintMeta(p) {
    const tag = TYPE_LABEL[p.type] ? `<span class="tag">${TYPE_LABEL[p.type]}</span>` : '';
    return `<small><span class="code">${esc(p.code)}</span>${tag}</small>`;
  }

  function setOwned(code, on) {
    if (on) state.owned.add(code);
    else state.owned.delete(code);
    ownedChanged();
  }

  function ownedChanged() {
    store.set('owned', Array.from(state.owned).sort());
    $('mineCount').textContent = state.owned.size;
    if (state.tab === 'recipe') runRecipe();
  }

  // ───── Совпадения ─────

  $('matchesTitle').textContent = 'Слева нужный цвет, справа краска';

  function renderMatches() {
    const list = $('matchesList');
    if (!state.color) {
      list.innerHTML = '<p class="note block">Выбери цвет — здесь появятся ближайшие к нему краски.</p>';
      return;
    }
    const lab = C.rgbToLab(state.color);
    const target = C.rgbToHex(state.color);
    let rows = paints.map((p) => ({ p, dE: C.deltaELab(lab, p.lab) }));
    if (state.onlyMine) rows = rows.filter((row) => state.owned.has(row.p.code));
    rows.sort((a, b) => a.dE - b.dE);

    if (!rows.length) {
      list.innerHTML = '<p class="note block">Во вкладке «Мои краски» пока ничего не отмечено.</p>';
      return;
    }

    list.innerHTML = rows
      .slice(0, MATCH_LIMIT)
      .map(({ p, dE }) => {
        const pct = C.matchPercent(dE);
        const own = state.owned.has(p.code);
        return (
          `<div class="row">` +
          `<span class="chip" style="background:linear-gradient(90deg,${target} 50%,${p.hex} 50%)"></span>` +
          `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p)}</span>` +
          `<span class="pct${pct >= 95 ? ' good' : ''}">${pct}%</span>` +
          `<button class="own${own ? ' on' : ''}" type="button" data-own="${esc(p.code)}" aria-pressed="${own}" ` +
          `title="${own ? 'Есть у меня — убрать' : 'Добавить в мои краски'}">${own ? '✓' : '+'}</button>` +
          `</div>`
        );
      })
      .join('');
  }

  $('matchesList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-own]');
    if (!b) return;
    setOwned(b.dataset.own, !state.owned.has(b.dataset.own));
    renderMatches();
  });

  $('onlyMine').addEventListener('change', (e) => {
    state.onlyMine = e.target.checked;
    renderMatches();
  });

  // ───── Мои краски ─────

  function renderMine() {
    const q = $('mineSearch').value.trim().toLowerCase();
    const rows = paints.filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.includes(q));
    $('mineList').innerHTML = rows.length
      ? rows
          .map((p) => {
            const own = state.owned.has(p.code);
            return (
              `<div class="row pick" data-own="${esc(p.code)}">` +
              `<span class="chip small" style="background:${p.hex}"></span>` +
              `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p)}</span>` +
              `<span class="own${own ? ' on' : ''}" role="checkbox" aria-checked="${own}">${own ? '✓' : ''}</span>` +
              `</div>`
            );
          })
          .join('')
      : '<p class="note block">Ничего не нашлось.</p>';
  }

  $('mineList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-own]');
    if (!row) return;
    const on = !state.owned.has(row.dataset.own);
    setOwned(row.dataset.own, on);
    const box = row.querySelector('.own');
    box.classList.toggle('on', on);
    box.textContent = on ? '✓' : '';
    box.setAttribute('aria-checked', on);
  });

  $('mineSearch').addEventListener('input', renderMine);

  $('mineAll').addEventListener('click', () => {
    for (const p of paints) state.owned.add(p.code);
    ownedChanged();
    renderMine();
  });

  $('mineNone').addEventListener('click', () => {
    state.owned.clear();
    ownedChanged();
    renderMine();
  });

  // ───── Рецепт ─────

  let recipeToken = null;
  let recipeKey = null;
  let recipeTimer = 0;

  function plural(n, forms) {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return forms[0];
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return forms[1];
    return forms[2];
  }

  function scheduleRecipe() {
    clearTimeout(recipeTimer);
    if (state.tab !== 'recipe') return;
    recipeTimer = setTimeout(runRecipe, 120);
  }

  async function runRecipe() {
    const body = $('recipeBody');
    const n = state.owned.size;
    $('recipeTitle').textContent = n
      ? `Смешиваем из ${n} ${plural(n, ['твоей краски', 'твоих красок', 'твоих красок'])}`
      : 'Смешиваем из твоих красок';

    const stop = (html) => {
      if (recipeToken) recipeToken.cancelled = true;
      recipeKey = null;
      body.innerHTML = html;
    };
    if (!state.color) {
      stop('<p class="note block">Сначала выбери цвет на фото.</p>');
      return;
    }
    if (n < 2) {
      stop(
        '<p class="note block">Отметь хотя бы две краски, которые у тебя есть, — рецепт собирается только из них.' +
          '<br><button class="btn" type="button" data-goto="mine">Открыть «Мои краски»</button></p>'
      );
      return;
    }

    const mine = paints.filter((p) => state.owned.has(p.code));
    const key = C.rgbToHex(state.color) + '|' + mine.map((p) => p.code).join(',');
    if (key === recipeKey) return;
    recipeKey = key;

    if (recipeToken) recipeToken.cancelled = true;
    const token = (recipeToken = { cancelled: false });
    const target = state.color;

    body.innerHTML = '<div class="progress"><i></i></div><p class="note block">Перебираю сочетания…</p>';
    const fill = body.querySelector('.progress i');
    const result = await findRecipes(C.rgbToLab(target), mine, {
      token,
      onProgress: (v) => {
        fill.style.width = Math.round(v * 100) + '%';
      },
    });
    if (!result || token.cancelled) return;
    renderRecipes(result, target);
  }

  function renderRecipes({ recipes, bestSingle }, target) {
    const targetHex = C.rgbToHex(target);
    let html = '';

    if (bestSingle) {
      const p = bestSingle.paint;
      html +=
        `<div class="single"><span class="chip small" style="background:${p.hex}"></span>` +
        `<span>Ближайшая готовая из твоих: <b>${esc(p.name)}</b> <span class="code">${esc(p.code)}</span> — ` +
        `<b>${C.matchPercent(bestSingle.dE)}%</b></span></div>`;
    }

    if (!recipes.length) {
      html += '<p class="note block">Смешиванием из этих красок ближе, чем готовой краской, не получается.</p>';
    } else if (C.matchPercent(recipes[0].dE) < 90) {
      html += '<p class="note">Из отмеченных красок близко не выходит — вот лучшее, что получилось.</p>';
    }

    for (const r of recipes) {
      const total = r.items.reduce((sum, it) => sum + it.parts, 0);
      html +=
        `<div class="recipe"><div class="recipe-top">` +
        `<span class="compare" title="Слева нужный цвет, справа что получится">` +
        `<i style="background:${targetHex}"></i><i style="background:${C.rgbToHex(r.rgb)}"></i></span>` +
        `<span><span class="recipe-pct">${C.matchPercent(r.dE)}%</span><small>${C.rgbToHex(r.rgb)}</small></span></div>` +
        `<div class="bar">` +
        r.items.map((it) => `<i style="background:${it.paint.hex};width:${(it.parts / total) * 100}%"></i>`).join('') +
        `</div>` +
        r.items
          .map(
            (it) =>
              `<div class="part"><span class="part-n"><b>${it.parts}</b><span>${plural(it.parts, ['часть', 'части', 'частей'])}</span></span>` +
              `<span class="chip small" style="background:${it.paint.hex}"></span>` +
              `<span class="row-main"><b>${esc(it.paint.name)}</b>${paintMeta(it.paint)}</span></div>`
          )
          .join('') +
        `</div>`;
    }

    if (recipes.length) {
      html +=
        '<p class="note">Рецепт приблизительный: он считается по цвету образцов, а не по реальным пигментам. ' +
        'Смешай пару капель на пробу и подправь на глаз.</p>';
    }
    $('recipeBody').innerHTML = html;
  }

  $('recipeBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) showTab(b.dataset.goto);
  });

  // ───── Мелочи ─────

  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  new ResizeObserver(resize).observe(stage);
  showRadius();
  showMode();
  $('mineCount').textContent = state.owned.size;
  showTab('matches');
  renderMatches();
})();
