// Общее для всех разделов: краски и наборы, «мои краски», проекты, хранилище.
(function () {
  'use strict';

  const C = window.PPColor;
  const DATA = window.PPPaints;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function plural(n, forms) {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return forms[0];
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return forms[1];
    return forms[2];
  }

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

  const handlers = {};
  function on(name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
  }
  function emit(name, payload) {
    for (const fn of handlers[name] || []) fn(payload);
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  // ───── Краски и наборы ─────

  const TYPE_LABEL = { ink: 'чернила', fluo: 'флуо', fx: 'Special FX', opaque: 'Extra Opaque', metal: 'металлик' };
  const DEFAULT_SET = 'vallejo-game-color';

  const sets = DATA.sets;
  const paints = DATA.items.map((it) => {
    const set = sets[it.s];
    const rgb = C.hexToRgb(it.h);
    let model = null;
    return {
      id: `${set.id}:${it.k}`,
      set,
      code: it.c || it.l || '',
      name: it.n,
      hex: it.h,
      type: it.t || 'base',
      rgb,
      lab: C.rgbToLab(rgb),
      // Модель для смешивания нужна только краскам из «моих», считаем по требованию.
      get model() {
        return model || (model = C.paintModel(rgb));
      },
    };
  });
  const byId = new Map(paints.map((p) => [p.id, p]));

  const savedSets = store.get('sets', [DEFAULT_SET]);
  const enabled = new Set((Array.isArray(savedSets) ? savedSets : []).filter((id) => sets.some((s) => s.id === id)));
  if (!enabled.size) enabled.add(DEFAULT_SET);

  let active = null;
  function activePaints() {
    return active || (active = paints.filter((p) => enabled.has(p.set.id)));
  }

  // Хотя бы один набор всегда остаётся включённым.
  function setEnabled(id, state) {
    if (state) enabled.add(id);
    else if (enabled.size > 1) enabled.delete(id);
    else return false;
    active = null;
    store.set('sets', Array.from(enabled));
    emit('sets');
    return true;
  }

  const owned = new Set();
  for (const raw of [].concat(store.get('owned', []))) {
    // В версии 1.0 хранились голые коды Game Color.
    const id = /^\d\d\.\d\d\d$/.test(raw) ? `${DEFAULT_SET}:${raw}` : raw;
    if (byId.has(id)) owned.add(id);
  }

  function setOwned(ids, state) {
    for (const id of [].concat(ids)) {
      if (state) owned.add(id);
      else owned.delete(id);
    }
    store.set('owned', Array.from(owned).sort());
    emit('owned');
  }

  // Подпись под названием краски. Набор показываем, только когда их включено несколько.
  function paintMeta(p, withSet = enabled.size > 1) {
    const parts = [];
    if (withSet) parts.push(esc(p.set.short));
    if (p.code) parts.push(`<span class="code">${esc(p.code)}</span>`);
    const tag = TYPE_LABEL[p.type] ? `<span class="tag">${TYPE_LABEL[p.type]}</span>` : '';
    return `<small>${parts.join(' · ')}${tag}</small>`;
  }

  function splitChip(leftHex, rightHex, small) {
    return `<span class="chip${small ? ' small' : ''}" style="background:linear-gradient(90deg,${leftHex} 50%,${rightHex} 50%)"></span>`;
  }

  function rank(rgb, list) {
    const lab = C.rgbToLab(rgb);
    return list.map((paint) => ({ paint, dE: C.deltaELab(lab, paint.lab) })).sort((a, b) => a.dE - b.dE);
  }

  const TONE_GAP = 5; // краска для тени или блика должна заметно отличаться по светлоте от основного цвета

  // Ближайшие краски для тени и блика. null — в наборе нет ничего темнее или светлее.
  function tonePaints(rgb, list = activePaints()) {
    const baseL = C.rgbToLab(rgb)[0];
    const targets = C.tones(rgb);
    const nearest = (target, dir) => {
      const lab = C.rgbToLab(target);
      let best = null;
      for (const paint of list) {
        if (paint.type === 'metal' || (paint.lab[0] - baseL) * dir < TONE_GAP) continue;
        const dE = C.deltaELab(lab, paint.lab);
        if (!best || dE < best.dE) best = { paint, dE, target };
      }
      return best;
    };
    return { shade: nearest(targets.shade, -1), highlight: nearest(targets.highlight, 1) };
  }

  // ───── Текущий цвет ─────

  let color = null;
  // live — цвет ещё меняется (кнопку мыши не отпустили), тяжёлые пересчёты подождут.
  function setColor(rgb, { live = false } = {}) {
    color = rgb;
    emit('color', { live });
  }

  // ───── Проекты ─────

  const STATUSES = [
    { id: 'queue', label: 'В очереди' },
    { id: 'printed', label: 'Напечатано' },
    { id: 'primed', label: 'Загрунтовано' },
    { id: 'painted', label: 'Покрашено' },
  ];
  const NAME_MAX = 60;

  function blankProject(name) {
    const now = Date.now();
    return { id: newId(), name, status: 'queue', notes: '', created: now, updated: now, items: [], photos: [], hasModel: false };
  }

  // Сохранённое могло побиться или прийти из другой версии, поэтому собираем заново по полям.
  function loadProjects() {
    const raw = store.get('projects', null);
    const list = [];
    for (const src of raw && Array.isArray(raw.list) ? raw.list : []) {
      if (!src || typeof src !== 'object') continue;
      const pr = blankProject(String(src.name || '').slice(0, NAME_MAX) || 'Без названия');
      if (src.id) pr.id = String(src.id);
      if (STATUSES.some((s) => s.id === src.status)) pr.status = src.status;
      pr.notes = String(src.notes || '').slice(0, 4000);
      if (Number.isFinite(src.created)) pr.created = src.created;
      if (Number.isFinite(src.updated)) pr.updated = src.updated;
      pr.hasModel = Boolean(src.hasModel);
      pr.photos = (Array.isArray(src.photos) ? src.photos : []).filter((id) => typeof id === 'string');
      for (const it of Array.isArray(src.items) ? src.items : []) {
        const rgb = it && Array.isArray(it.rgb) && it.rgb.length === 3 ? it.rgb.map(Number) : null;
        if (!rgb || rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) continue;
        pr.items.push({
          id: String(it.id || newId()),
          name: String(it.name || '').slice(0, NAME_MAX),
          rgb,
          paint: byId.has(it.paint) ? it.paint : null,
        });
      }
      list.push(pr);
    }
    if (!list.length) list.push(blankProject('Моя фигурка'));
    const current = raw && list.some((pr) => pr.id === raw.current) ? raw.current : list[0].id;
    return { list, current, withTones: Boolean(raw && raw.withTones) };
  }

  const projects = loadProjects();
  const project = () => projects.list.find((pr) => pr.id === projects.current);

  // Тихое сохранение — для правок прямо в поле ввода, когда перерисовка сбила бы фокус.
  function saveProjects(pr) {
    if (pr) pr.updated = Date.now();
    store.set('projects', projects);
  }

  // Любое другое изменение проектов: сохраняем и просим разделы перерисоваться.
  function projectsChanged(pr) {
    saveProjects(pr);
    emit('projects');
  }

  function selectProject(id) {
    if (id === projects.current || !projects.list.some((pr) => pr.id === id)) return;
    projects.current = id;
    projectsChanged();
    emit('project-switch');
  }

  function createProject(name) {
    const pr = blankProject(name);
    projects.list.push(pr);
    projects.current = pr.id;
    projectsChanged();
    emit('project-switch');
    return pr;
  }

  function removeProject(id) {
    const pr = projects.list.find((x) => x.id === id);
    if (!pr) return;
    for (const photoId of pr.photos) photos.drop(photoId);
    db.del('models', id).catch(() => {});
    db.del('paintjobs', id).catch(() => {});
    projects.list = projects.list.filter((x) => x.id !== id);
    if (!projects.list.length) projects.list.push(blankProject('Моя фигурка'));
    const switched = projects.current === id;
    if (switched) projects.current = projects.list[0].id;
    projectsChanged();
    if (switched) emit('project-switch');
  }

  const OPTION_COUNT = 8;

  // Чем красить цвет из палитры: основная краска (выбранная руками или ближайшая),
  // варианты на замену, тень и блик.
  function resolveItem(item) {
    const ranked = rank(item.rgb, activePaints());
    const options = ranked.slice(0, OPTION_COUNT);
    let base = options[0];
    const pinned = item.paint && byId.get(item.paint);
    if (pinned) {
      base = ranked.find((r) => r.paint === pinned) || { paint: pinned, dE: C.deltaELab(C.rgbToLab(item.rgb), pinned.lab) };
      if (!options.includes(base)) options.push(base);
    }
    return { item, base, options, ...tonePaints(item.rgb) };
  }

  // Краски палитры, которых нет в «моих».
  function shoppingList(resolved) {
    const need = new Map();
    for (const r of resolved) {
      const picks = projects.withTones ? [r.base, r.shade, r.highlight] : [r.base];
      for (const pick of picks) {
        if (pick && !owned.has(pick.paint.id)) need.set(pick.paint.id, pick.paint);
      }
    }
    return Array.from(need.values()).sort((a, b) => a.set.short.localeCompare(b.set.short) || (a.code || a.name).localeCompare(b.code || b.name));
  }

  // ───── Файлы проектов: фото и 3D-модели лежат в IndexedDB ─────

  const db = (() => {
    let opening = null;
    function open() {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          const req = indexedDB.open('paint-picker', 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore('photos', { keyPath: 'id' });
            req.result.createObjectStore('models', { keyPath: 'projectId' });
            req.result.createObjectStore('paintjobs', { keyPath: 'projectId' });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return opening;
    }
    async function run(name, mode, action) {
      const base = await open();
      return new Promise((resolve, reject) => {
        const tx = base.transaction(name, mode);
        const req = action(tx.objectStore(name));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    return {
      get: (name, key) => run(name, 'readonly', (s) => s.get(key)),
      put: (name, value) => run(name, 'readwrite', (s) => s.put(value)),
      del: (name, key) => run(name, 'readwrite', (s) => s.delete(key)),
    };
  })();

  const PHOTO_KEEP_BYTES = 6 * 1024 * 1024; // файлы легче хранятся как есть, без пережатия
  const PHOTO_MAX_SIDE = 2400;
  const THUMB_SIDE = 420;

  async function shrink(source, maxSide, quality) {
    const k = Math.min(1, maxSide / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * k));
    canvas.height = Math.max(1, Math.round(source.height * k));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  const thumbUrls = new Map();

  const photos = {
    // Добавляет картинку в проект. Возвращает id фото или null, если файл не картинка.
    async add(pr, blob) {
      let bmp;
      try {
        bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch {
        return null;
      }
      const keep = blob.size <= PHOTO_KEEP_BYTES && Math.max(bmp.width, bmp.height) <= PHOTO_MAX_SIDE * 2;
      const full = keep ? blob : await shrink(bmp, PHOTO_MAX_SIDE, 0.92);
      const thumb = await shrink(bmp, THUMB_SIDE, 0.82);
      bmp.close();
      const id = newId();
      await db.put('photos', { id, projectId: pr.id, blob: full, thumb, created: Date.now() });
      pr.photos.push(id);
      projectsChanged(pr);
      return id;
    },
    async blob(id) {
      const rec = await db.get('photos', id);
      return rec ? rec.blob : null;
    },
    // Адрес миниатюры для <img>. Создаётся один раз и живёт, пока фото не удалят.
    async thumbUrl(id) {
      if (!thumbUrls.has(id)) {
        const rec = await db.get('photos', id);
        if (!rec) return '';
        thumbUrls.set(id, URL.createObjectURL(rec.thumb || rec.blob));
      }
      return thumbUrls.get(id);
    },
    drop(id) {
      if (thumbUrls.has(id)) URL.revokeObjectURL(thumbUrls.get(id));
      thumbUrls.delete(id);
      db.del('photos', id).catch(() => {});
    },
    remove(pr, id) {
      pr.photos = pr.photos.filter((x) => x !== id);
      photos.drop(id);
      projectsChanged(pr);
    },
  };

  // Подставляет миниатюры во все <img data-photo="id"> внутри контейнера.
  function fillThumbs(container) {
    for (const img of container.querySelectorAll('img[data-photo]')) {
      photos.thumbUrl(img.dataset.photo).then((url) => {
        if (url) img.src = url;
      });
    }
  }

  // ───── Разделы ─────

  let screen = 'pipette';
  function showScreen(name) {
    screen = name;
    for (const b of $('rail').querySelectorAll('[data-screen]')) b.classList.toggle('on', b.dataset.screen === name);
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== 'screen-' + name;
    emit('screen', name);
  }

  $('rail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-screen]');
    if (b && b.dataset.screen !== screen) showScreen(b.dataset.screen);
  });

  // Перетаскивание файлов и вставка из буфера: каждый раздел сам решает, что с ними делать.
  // Приёмник: { label() — подпись на затемнении или null, если сейчас файлы не нужны; files(list) }.
  const receivers = {};
  function receiveFiles(screenName, receiver) {
    receivers[screenName] = receiver;
  }

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  let dragDepth = 0;

  function hideVeil() {
    dragDepth = 0;
    $('dropVeil').hidden = true;
  }

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const label = receivers[screen] && receivers[screen].label();
    if (!label) return;
    dragDepth++;
    $('dropText').textContent = label;
    $('dropVeil').hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hideVeil();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hideVeil();
    const receiver = receivers[screen];
    if (receiver && receiver.label()) receiver.files(Array.from(e.dataTransfer.files));
  });

  document.addEventListener('paste', (e) => {
    const images = Array.from(e.clipboardData ? e.clipboardData.items : [])
      .filter((it) => it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    const receiver = receivers[screen];
    if (!images.length || !receiver || !receiver.label()) return;
    e.preventDefault();
    receiver.files(images);
  });

  window.PP = {
    C,
    $,
    clamp,
    esc,
    newId,
    plural,
    store,
    on,
    emit,
    toast,
    TYPE_LABEL,
    sets,
    paints,
    byId,
    enabled,
    activePaints,
    setEnabled,
    owned,
    setOwned,
    paintMeta,
    splitChip,
    rank,
    tonePaints,
    get color() {
      return color;
    },
    setColor,
    STATUSES,
    NAME_MAX,
    projects,
    project,
    saveProjects,
    projectsChanged,
    selectProject,
    createProject,
    removeProject,
    resolveItem,
    shoppingList,
    db,
    photos,
    fillThumbs,
    get screen() {
      return screen;
    },
    showScreen,
    receiveFiles,
  };
})();
