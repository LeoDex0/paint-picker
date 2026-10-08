// Раздел «3D»: примерка красок на STL-модели проекта.
(function () {
  'use strict';

  const PP = window.PP;
  const { C, $, esc, toast } = PP;

  const MAX_FILE = 300 * 1024 * 1024;
  const PRIMERS = [
    { id: 'grey', label: 'Серый', rgb: [154, 156, 160] },
    { id: 'white', label: 'Белый', rgb: [236, 236, 232] },
    { id: 'black', label: 'Чёрный', rgb: [34, 34, 36] },
  ];
  const TOOLS = [
    { id: 'brush', label: 'Кисть' },
    { id: 'fill', label: 'Заливка' },
    { id: 'erase', label: 'Ластик' },
    { id: 'orbit', label: 'Вращать' },
  ];
  const ANGLE_OFF = 95; // крайнее положение ползунка — заливать всю связную часть

  let viewPromise = null;
  let view = null;
  let loadedFor = null; // проект, чья модель сейчас в окне
  let modelName = '';
  let tool = 'brush';
  let primer = 'grey';
  let ink = null; // { rgb, label } — чем красит кисть
  let saveTimer = 0;

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  function busy(text) {
    $('modelBusy').hidden = !text;
    if (text) $('modelBusyText').textContent = text;
  }

  // 3D-часть весит больше всего остального приложения, поэтому грузится при первом заходе в раздел.
  function ensureView() {
    if (!viewPromise) {
      viewPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'three-view.js';
        script.onload = () => {
          try {
            view = window.PPThree.create($('three'), { onStroke: scheduleSave });
            resolve(view);
          } catch (error) {
            reject(error);
          }
        };
        script.onerror = () => reject(new Error('script'));
        document.head.appendChild(script);
      }).catch((error) => {
        viewPromise = null;
        $('modelEmptyText').textContent = 'На этом компьютере не запустилась 3D-графика, примерка недоступна.';
        $('modelPick').hidden = true;
        throw error;
      });
    }
    return viewPromise;
  }

  // ───── Модель проекта ─────

  function showEmpty(empty) {
    $('modelEmpty').hidden = !empty;
    $('modelBar').hidden = empty;
    $('modelHint').hidden = empty;
    renderSide();
  }

  function applyTool() {
    if (!view) return;
    view.setTool(tool);
    view.setColor(ink ? ink.rgb : [200, 60, 50]);
    view.setBrushSize(Number($('brushSize').value) / 100);
    const angle = Number($('fillAngle').value);
    view.setFillAngle(angle >= ANGLE_OFF ? 180 : angle);
    view.setPrimer(PRIMERS.find((p) => p.id === primer).rgb);
  }

  async function showProjectModel() {
    const pr = PP.project();
    if (loadedFor === pr.id) return;
    try {
      await ensureView();
    } catch {
      return;
    }
    flushSave();
    loadedFor = pr.id;
    view.unload();
    modelName = '';
    primer = 'grey';
    pickDefaultInk();

    if (!pr.hasModel) {
      showEmpty(true);
      return;
    }
    busy('Загружаю модель…');
    try {
      const rec = await PP.db.get('models', pr.id);
      if (PP.project().id !== pr.id) return; // пока читали, проект сменили
      if (!rec) throw new Error('missing');
      await nextFrame();
      view.load(await rec.blob.arrayBuffer());
      modelName = rec.name || '';
      const job = await PP.db.get('paintjobs', pr.id);
      if (job) {
        if (PRIMERS.some((p) => p.id === job.primer)) primer = job.primer;
        view.setColors(job.colors);
      }
      applyTool();
      showEmpty(false);
    } catch {
      pr.hasModel = false;
      PP.projectsChanged(pr);
      showEmpty(true);
      toast('Сохранённую модель не удалось открыть');
    } finally {
      busy('');
    }
  }

  async function openFile(file) {
    if (!file) return;
    if (!/\.stl$/i.test(file.name)) {
      toast('Нужен файл в формате STL');
      return;
    }
    if (file.size > MAX_FILE) {
      toast('Файл больше 300 МБ — такую модель приложение не потянет');
      return;
    }
    try {
      await ensureView();
    } catch {
      return;
    }
    const pr = PP.project();
    flushSave();
    busy('Загружаю модель…');
    await nextFrame();
    try {
      view.load(await file.arrayBuffer());
    } catch {
      busy('');
      toast('Не получилось прочитать этот STL');
      if (!view.triangles) showEmpty(true);
      return;
    }
    loadedFor = pr.id;
    modelName = file.name;
    primer = 'grey';
    pickDefaultInk();
    applyTool();
    showEmpty(false);
    busy('');

    try {
      await PP.db.put('models', { projectId: pr.id, name: file.name, blob: file });
      await PP.db.del('paintjobs', pr.id);
      pr.hasModel = true;
      PP.projectsChanged(pr);
    } catch {
      toast('Модель открыта, но сохранить её в проект не получилось');
    }
  }

  // ───── Сохранение покраски ─────

  function save() {
    saveTimer = 0;
    if (!view || !view.triangles || !loadedFor) return;
    PP.db.put('paintjobs', { projectId: loadedFor, colors: view.colors().slice(), primer }).catch(() => {
      toast('Не получилось сохранить покраску');
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
    const undoBtn = $('modelUndo');
    if (undoBtn) undoBtn.disabled = !view.canUndo;
  }

  function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    save();
  }

  // ───── Боковая панель ─────

  function pickDefaultInk() {
    const first = PP.project().items[0];
    if (first) {
      const r = PP.resolveItem(first);
      ink = { rgb: r.base.paint.rgb, label: `${first.name} — ${r.base.paint.name}` };
    } else if (PP.color) {
      ink = { rgb: PP.color, label: `Цвет из пипетки ${C.rgbToHex(PP.color)}` };
    } else {
      ink = { rgb: [200, 60, 50], label: 'Пробный красный' };
    }
  }

  const inkButton = (rgb, label, title) =>
    `<button class="ink${ink && C.rgbToHex(ink.rgb) === C.rgbToHex(rgb) ? ' on' : ''}" type="button" style="background:${C.rgbToHex(rgb)}" ` +
    `data-ink="${rgb.join(',')}" data-label="${esc(label)}" title="${esc(title || label)}"></button>`;

  function renderSide() {
    $('modelProject').innerHTML = PP.projects.list
      .map((pr) => `<option value="${esc(pr.id)}"${pr.id === PP.projects.current ? ' selected' : ''}>${esc(pr.name)}</option>`)
      .join('');

    const hasModel = Boolean(view && view.triangles);
    const items = PP.project().items;
    let html = '';

    html += `<h3>Чем красим</h3><div class="ink-now"><span class="chip small" style="background:${C.rgbToHex(ink.rgb)}"></span><span>${esc(ink.label)}</span></div>`;

    if (items.length) {
      html += '<div class="ink-grid"><span></span><small>тень</small><small>база</small><small>блик</small>';
      for (const item of items) {
        const r = PP.resolveItem(item);
        html += `<span class="ink-name">${esc(item.name)}</span>`;
        for (const [tone, word] of [[r.shade, 'тень'], [r.base, 'база'], [r.highlight, 'блик']]) {
          html += tone ? inkButton(tone.paint.rgb, `${item.name}, ${word} — ${tone.paint.name}`) : '<span class="ink none"></span>';
        }
      }
      html += '</div>';
    } else {
      html += '<p class="note">В палитре проекта пока нет цветов. Набери их в разделе «Пипетка» — здесь появятся краски с тенью и бликом.</p>';
    }
    if (PP.color) {
      html += `<div class="ink-row">${inkButton(PP.color, `Цвет из пипетки ${C.rgbToHex(PP.color)}`)}<span>Цвет из пипетки</span></div>`;
    }

    html +=
      '<h3>Грунт</h3><div class="seg wide" id="primerSeg">' +
      PRIMERS.map((p) => `<button type="button" data-primer="${p.id}"${p.id === primer ? ' class="on"' : ''}>${p.label}</button>`).join('') +
      '</div>';

    html +=
      '<h3>Модель</h3><div class="actions">' +
      `<button class="btn" type="button" id="modelUndo"${hasModel && view.canUndo ? '' : ' disabled'}>Отменить</button>` +
      `<button class="btn" type="button" data-act="front"${hasModel ? '' : ' disabled'}>Вид спереди</button>` +
      `<button class="btn" type="button" data-act="shot"${hasModel ? '' : ' disabled'}>Снимок в журнал</button>` +
      `<button class="btn" type="button" data-act="clear"${hasModel ? '' : ' disabled'}>Смыть покраску</button>` +
      `<button class="btn" type="button" data-act="open">${hasModel ? 'Другая модель' : 'Выбрать STL'}</button>` +
      '</div>';
    if (hasModel) {
      html += `<p class="note">${esc(modelName)}${modelName ? ' · ' : ''}${view.triangles.toLocaleString('ru-RU')} треугольников. Покраска сохраняется сама.</p>`;
    }
    $('modelSide').innerHTML = html;
  }

  let clearArmed = 0;

  $('modelSide').addEventListener('click', async (e) => {
    const inkBtn = e.target.closest('[data-ink]');
    if (inkBtn) {
      ink = { rgb: inkBtn.dataset.ink.split(',').map(Number), label: inkBtn.dataset.label };
      if (tool === 'erase' || tool === 'orbit') setTool('brush');
      applyTool();
      renderSide();
      return;
    }
    const primerBtn = e.target.closest('[data-primer]');
    if (primerBtn) {
      primer = primerBtn.dataset.primer;
      applyTool();
      renderSide();
      if (view && view.triangles) scheduleSave();
      return;
    }
    if (e.target.closest('#modelUndo')) {
      view.undo();
      renderSide();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'open') $('modelFile').click();
    if (act.dataset.act === 'front') view.resetCamera();
    if (act.dataset.act === 'clear') {
      if (Date.now() - clearArmed > 4000) {
        clearArmed = Date.now();
        toast('Нажми ещё раз, чтобы смыть всю покраску');
        return;
      }
      clearArmed = 0;
      view.clear();
    }
    if (act.dataset.act === 'shot') {
      const pr = PP.project();
      const id = await PP.photos.add(pr, await view.snapshot());
      toast(id ? `Снимок добавлен в проект «${pr.name}»` : 'Не получилось сделать снимок');
    }
  });

  $('modelProject').addEventListener('change', () => PP.selectProject($('modelProject').value));

  // ───── Инструменты ─────

  $('toolSeg').innerHTML = TOOLS.map((t) => `<button type="button" data-tool="${t.id}">${t.label}</button>`).join('');

  function setTool(name) {
    tool = name;
    for (const b of $('toolSeg').children) b.classList.toggle('on', b.dataset.tool === name);
    $('brushField').hidden = name !== 'brush' && name !== 'erase';
    $('fillField').hidden = name !== 'fill';
    $('modelHint').textContent =
      name === 'orbit'
        ? 'Левая кнопка — вращать · правая — двигать · колесо — масштаб'
        : 'Левая кнопка — красить · правая — вращать · колесо — масштаб · средняя — двигать';
    applyTool();
  }

  $('toolSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  });

  function showSliders() {
    $('brushOut').textContent = $('brushSize').value + '%';
    const angle = Number($('fillAngle').value);
    $('fillOut').textContent = angle >= ANGLE_OFF ? 'вся часть' : angle + '°';
  }

  for (const id of ['brushSize', 'fillAngle']) {
    $(id).addEventListener('input', () => {
      showSliders();
      applyTool();
    });
  }

  $('modelPick').addEventListener('click', () => $('modelFile').click());
  $('modelFile').addEventListener('change', () => {
    openFile($('modelFile').files[0]);
    $('modelFile').value = '';
  });

  PP.receiveFiles('model', {
    label: () => 'Отпусти, чтобы загрузить модель',
    files: (list) => openFile(list.find((f) => /\.stl$/i.test(f.name)) || list[0]),
  });

  document.addEventListener('keydown', (e) => {
    if (PP.screen !== 'model' || !view || !(e.ctrlKey || e.metaKey) || e.code !== 'KeyZ') return;
    if (e.target.closest('input, textarea, select')) return;
    e.preventDefault();
    view.undo();
    renderSide();
  });

  // ───── Обновления ─────

  PP.on('screen', (name) => {
    if (name === 'model') showProjectModel().then(renderSide);
    else flushSave();
  });
  PP.on('project-switch', () => {
    if (PP.screen === 'model') showProjectModel();
  });
  for (const event of ['projects', 'owned', 'sets']) {
    PP.on(event, () => {
      if (PP.screen === 'model') renderSide();
    });
  }
  window.addEventListener('beforeunload', flushSave);

  pickDefaultInk();
  showSliders();
  setTool('brush');
})();
