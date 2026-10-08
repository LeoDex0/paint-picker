// Раздел «Журнал»: доска проектов по стадиям и карточка проекта с фото, палитрой и заметками.
(function () {
  'use strict';

  const PP = window.PP;
  const { C, $, esc, plural, toast, STATUSES } = PP;

  const DRAG_TYPE = 'application/x-pp-project';
  const board = $('board');
  const drawer = $('drawer');
  const lightbox = $('lightbox');
  let openId = null; // проект, открытый в карточке
  let shownPhoto = null;

  const openProject = () => PP.projects.list.find((pr) => pr.id === openId);
  const day = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  // ───── Доска ─────

  function cardHtml(pr) {
    const cover = pr.photos.length
      ? `<img data-photo="${esc(pr.photos[0])}" alt="" />`
      : pr.items.length
        ? `<div class="stripes">${pr.items.slice(0, 6).map((it) => `<i style="background:${C.rgbToHex(it.rgb)}"></i>`).join('')}</div>`
        : '<div class="no-cover">нет фото</div>';
    const dots = pr.items
      .slice(0, 10)
      .map((it) => `<i style="background:${C.rgbToHex(it.rgb)}" title="${esc(it.name)}"></i>`)
      .join('');
    const bits = [];
    if (pr.photos.length) bits.push(`${pr.photos.length} фото`);
    if (pr.hasModel) bits.push('3D');
    bits.push(day(pr.updated));
    return (
      `<article class="card" draggable="true" data-id="${esc(pr.id)}">` +
      `<div class="card-cover">${cover}</div>` +
      `<div class="card-body"><b>${esc(pr.name)}</b>${dots ? `<div class="dots">${dots}</div>` : ''}` +
      `<small>${bits.join(' · ')}</small></div></article>`
    );
  }

  function renderBoard() {
    board.innerHTML = STATUSES.map((st) => {
      const list = PP.projects.list.filter((pr) => pr.status === st.id).sort((a, b) => b.updated - a.updated);
      return (
        `<div class="col" data-status="${st.id}">` +
        `<div class="col-head"><b>${st.label}</b><span class="count">${list.length}</span></div>` +
        `<div class="col-body">${list.map(cardHtml).join('') || '<p class="col-empty">Перетащи сюда проект</p>'}</div></div>`
      );
    }).join('');
    PP.fillThumbs(board);
  }

  board.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openDrawer(card.dataset.id);
  });

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.dataTransfer.setData(DRAG_TYPE, card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  const dragsProject = (e) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE);

  function markColumn(col) {
    for (const el of board.querySelectorAll('.col')) el.classList.toggle('over', el === col);
  }

  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.col');
    if (!col || !dragsProject(e)) return;
    e.preventDefault();
    markColumn(col);
  });
  board.addEventListener('dragleave', (e) => {
    if (!board.contains(e.relatedTarget)) markColumn(null);
  });
  board.addEventListener('dragend', () => markColumn(null));
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.col');
    if (!col || !dragsProject(e)) return;
    e.preventDefault();
    markColumn(null);
    setStatus(e.dataTransfer.getData(DRAG_TYPE), col.dataset.status);
  });

  function setStatus(id, status) {
    const pr = PP.projects.list.find((x) => x.id === id);
    if (!pr || pr.status === status) return;
    pr.status = status;
    PP.projectsChanged(pr);
  }

  $('journalNew').addEventListener('click', () => {
    const pr = PP.createProject('Новая фигурка');
    openDrawer(pr.id);
    $('dName').focus();
    $('dName').select();
  });

  // ───── Карточка проекта ─────

  function renderDrawer() {
    const pr = openProject();
    if (!pr) {
      closeDrawer();
      return;
    }
    if (document.activeElement !== $('dName')) $('dName').value = pr.name;
    if (document.activeElement !== $('dNotes')) $('dNotes').value = pr.notes;
    for (const b of $('dStatus').children) b.classList.toggle('on', b.dataset.status === pr.status);

    $('dPhotos').innerHTML =
      pr.photos.map((id) => `<button class="photo" type="button" data-photo-open="${esc(id)}"><img data-photo="${esc(id)}" alt="" /></button>`).join('') +
      '<button class="photo add" type="button" data-act="add-photo" title="Добавить фото">+</button>';
    PP.fillThumbs($('dPhotos'));

    if (pr.items.length) {
      const resolved = pr.items.map(PP.resolveItem);
      const need = PP.shoppingList(resolved).length;
      $('dPalette').innerHTML =
        resolved
          .map(
            ({ item, base }) =>
              `<div class="row">${PP.splitChip(C.rgbToHex(item.rgb), base.paint.hex, true)}` +
              `<span class="row-main"><b>${esc(item.name)}</b>` +
              `<small>${esc(base.paint.name)}${base.paint.code ? ` · <span class="code">${esc(base.paint.code)}</span>` : ''}</small></span>` +
              `<span class="have${PP.owned.has(base.paint.id) ? '' : ' need'}">${PP.owned.has(base.paint.id) ? 'есть' : 'нет'}</span></div>`
          )
          .join('') +
        `<p class="note">${need ? `Докупить: ${need} ${plural(need, ['краску', 'краски', 'красок'])}.` : 'Все краски уже есть.'}</p>`;
    } else {
      $('dPalette').innerHTML = '<p class="note">Палитра пустая. Цвета добавляются в разделе «Пипетка».</p>';
    }
  }

  function openDrawer(id) {
    openId = id;
    drawer.hidden = false;
    armDelete(false);
    renderDrawer();
  }

  function closeDrawer() {
    openId = null;
    drawer.hidden = true;
  }

  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) closeDrawer();
  });
  $('dClose').addEventListener('click', closeDrawer);

  $('dName').addEventListener('input', () => {
    const pr = openProject();
    const name = $('dName').value.trim().slice(0, PP.NAME_MAX);
    if (!pr || !name) return;
    pr.name = name;
    PP.projectsChanged(pr);
  });

  $('dNotes').addEventListener('input', () => {
    const pr = openProject();
    if (!pr) return;
    pr.notes = $('dNotes').value.slice(0, 4000);
    PP.saveProjects(pr);
  });

  $('dStatus').innerHTML = STATUSES.map((st) => `<button type="button" data-status="${st.id}">${st.label}</button>`).join('');
  $('dStatus').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (b) setStatus(openId, b.dataset.status);
  });

  // ───── Фото ─────

  const photoInput = $('photoFile');

  async function addPhotos(files) {
    const pr = openProject();
    if (!pr) return;
    let failed = 0;
    for (const file of files) {
      if (!(await PP.photos.add(pr, file))) failed++;
    }
    if (failed) toast(failed === files.length ? 'Это не картинка' : 'Часть файлов не удалось открыть как картинки');
  }

  photoInput.addEventListener('change', () => {
    addPhotos(Array.from(photoInput.files));
    photoInput.value = '';
  });

  $('dPhotos').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="add-photo"]')) {
      photoInput.click();
      return;
    }
    const b = e.target.closest('[data-photo-open]');
    if (b) showPhoto(b.dataset.photoOpen);
  });

  let fullUrl = '';

  async function showPhoto(id) {
    const blob = await PP.photos.blob(id);
    if (!blob) return;
    shownPhoto = id;
    URL.revokeObjectURL(fullUrl);
    fullUrl = URL.createObjectURL(blob);
    $('lightboxImg').src = fullUrl;
    lightbox.hidden = false;
  }

  function closePhoto() {
    shownPhoto = null;
    lightbox.hidden = true;
    $('lightboxImg').removeAttribute('src');
    URL.revokeObjectURL(fullUrl);
    fullUrl = '';
  }

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target.closest('[data-act="close"]')) closePhoto();
  });

  $('photoToPipette').addEventListener('click', async () => {
    const blob = shownPhoto && (await PP.photos.blob(shownPhoto));
    if (!blob) return;
    PP.selectProject(openId);
    closePhoto();
    closeDrawer();
    PP.showScreen('pipette');
    PP.pipette.loadImage(blob);
  });

  $('photoDelete').addEventListener('click', () => {
    const pr = openProject();
    if (!pr || !shownPhoto) return;
    PP.photos.remove(pr, shownPhoto);
    closePhoto();
  });

  PP.receiveFiles('journal', {
    label: () => (openProject() ? `Отпусти, чтобы добавить фото в «${openProject().name}»` : null),
    files: addPhotos,
  });

  // ───── Переходы и удаление ─────

  $('dToPipette').addEventListener('click', () => {
    PP.selectProject(openId);
    closeDrawer();
    PP.showScreen('pipette');
    PP.panel.showTab('palette');
  });

  $('dTo3d').addEventListener('click', () => {
    PP.selectProject(openId);
    closeDrawer();
    PP.showScreen('model');
  });

  let deleteArmed = false;
  function armDelete(state) {
    deleteArmed = state;
    $('dDelete').textContent = state ? 'Точно удалить?' : 'Удалить проект';
    $('dDelete').classList.toggle('danger', state);
  }

  $('dDelete').addEventListener('click', () => {
    if (!deleteArmed) {
      armDelete(true);
      return;
    }
    const id = openId;
    closeDrawer();
    PP.removeProject(id);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!lightbox.hidden) closePhoto();
    else if (!drawer.hidden) closeDrawer();
  });

  // ───── Обновления ─────

  function refresh() {
    if (PP.screen !== 'journal') return;
    renderBoard();
    if (openId) renderDrawer();
  }

  PP.on('projects', refresh);
  PP.on('owned', refresh);
  PP.on('sets', refresh);
  PP.on('screen', (name) => {
    if (name === 'journal') refresh();
    else closeDrawer();
  });
})();
