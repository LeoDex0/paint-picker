// Раздел «Пипетка», левая часть: фото, масштаб и сама пипетка с лупой.
(function () {
  'use strict';

  const PP = window.PP;
  const { C, $, clamp, store, toast } = PP;

  const MAX_SIDE = 4096; // фото крупнее уменьшается: для подбора цвета этого хватает
  const LOUPE = 132;
  const MAX_SCALE = 48;
  // Отступы под плавающие панели, чтобы вписанное фото под них не залезало.
  const INSET = { top: 70, right: 24, bottom: 62, left: 24 };

  const state = {
    radius: clamp(Number(store.get('radius', 6)) || 0, 0, 40), // радиус пипетки в пикселях экрана
    mode: store.get('mode', 'avg') === 'dom' ? 'dom' : 'avg',
    pick: null, // { x, y, r } в пикселях фото
    hover: null, // { cx, cy } в пикселях экрана
  };

  // ───── Фото и вид ─────

  const stage = $('stage');
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  const src = document.createElement('canvas');
  const srcCtx = src.getContext('2d', { willReadFrequently: true });
  const loupe = $('loupe');
  const loupeCanvas = $('loupeCanvas');
  const lctx = loupeCanvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0, fitted: true };
  let pixels = null;
  let hasImage = false;
  let sourceBlob = null; // исходный файл — чтобы сохранить его в проект
  let cw = 0;
  let ch = 0;
  let dpr = 1;
  let drag = null; // 'pick' | 'pan'
  let panFrom = null;

  async function loadImage(blob) {
    let bmp;
    try {
      bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      toast('Не получилось открыть этот файл как картинку');
      return false;
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
    sourceBlob = blob;
    state.pick = null;
    state.hover = null;
    $('empty').hidden = true;
    $('toolbar').hidden = false;
    $('zoom').hidden = false;
    $('hint').hidden = false;
    fitView();
    draw();
    return true;
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
    if (!rect.width || !rect.height) return; // раздел скрыт
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

  function local(e) {
    const rect = canvas.getBoundingClientRect();
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  }

  function pickAt(p) {
    const at = toImage(p);
    const r = state.radius / view.scale;
    const rgb = sample(at.x, at.y, r, state.mode);
    if (!rgb) return;
    state.pick = { x: at.x, y: at.y, r };
    PP.setColor(rgb, { live: true });
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!hasImage) return;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 0) {
      drag = 'pick';
      state.hover = local(e);
      pickAt(state.hover);
    } else {
      e.preventDefault();
      drag = 'pan';
      panFrom = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      canvas.classList.add('panning');
    }
    draw();
    updateLoupe();
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
    if (drag === 'pick') pickAt(state.hover);
    draw();
    updateLoupe();
  });

  function endDrag(e) {
    if (!drag) return;
    const was = drag;
    drag = null;
    canvas.classList.remove('panning');
    // Кнопку отпустили — цвет окончательный, можно считать рецепт.
    if (was === 'pick' && PP.color) PP.setColor(PP.color);
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

  // ───── Открытие и сохранение фото ─────

  const fileInput = $('file');
  $('pickFile').addEventListener('click', () => fileInput.click());
  $('openBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadImage(fileInput.files[0]);
    fileInput.value = '';
  });

  PP.receiveFiles('pipette', {
    label: () => 'Отпусти, чтобы открыть фото',
    files: (list) => loadImage(list.find((f) => f.type.startsWith('image/')) || list[0]),
  });

  $('savePhoto').addEventListener('click', async () => {
    if (!sourceBlob) return;
    const pr = PP.project();
    const id = await PP.photos.add(pr, sourceBlob);
    toast(id ? `Фото сохранено в проект «${pr.name}»` : 'Не получилось сохранить фото');
  });

  new ResizeObserver(resize).observe(stage);
  showRadius();
  showMode();

  PP.pipette = {
    loadImage,
    // Цвет задали не с фото (вписали HEX, взяли из палитры) — отметка на фото больше не к месту.
    clearPick() {
      state.pick = null;
      draw();
    },
  };
})();
