// Раздел «Пипетка», правая панель: выбранный цвет, совпадения, рецепт, палитра, мои краски.
(function () {
  'use strict';

  const PP = window.PP;
  const { C, $, esc, plural, toast, paintMeta, splitChip, owned } = PP;
  const { findRecipes } = window.PPRecipe;

  const MATCH_LIMIT = 40;
  const MINE_LIMIT = 400;

  let tab = 'matches';
  let onlyMine = false;

  const pct = (dE) => C.matchPercent(dE);
  const ownButton = (p) => {
    const own = owned.has(p.id);
    return (
      `<button class="own${own ? ' on' : ''}" type="button" data-own="${esc(p.id)}" aria-pressed="${own}" ` +
      `title="${own ? 'Есть у меня — убрать' : 'Добавить в мои краски'}">${own ? '✓' : '+'}</button>`
    );
  };
  const haveTag = (p) => (owned.has(p.id) ? '<span class="have">есть</span>' : '<span class="have need">нет</span>');

  // ───── Выбранный цвет ─────

  const hexInput = $('hexInput');

  function showColor() {
    const rgb = PP.color;
    if (!rgb) return;
    const hex = C.rgbToHex(rgb);
    const swatch = $('swatch');
    swatch.style.background = hex;
    swatch.classList.add('filled');
    if (document.activeElement !== hexInput) hexInput.value = hex;
    $('rgbText').textContent = `RGB ${rgb.join(', ')}`;
    $('copyHex').disabled = false;
    $('addToPalette').hidden = false;
  }

  hexInput.addEventListener('input', () => {
    const rgb = C.hexToRgb(hexInput.value);
    if (!rgb || hexInput.value.replace('#', '').trim().length !== 6) return;
    PP.pipette.clearPick();
    PP.setColor(rgb);
  });

  hexInput.addEventListener('blur', () => {
    hexInput.value = PP.color ? C.rgbToHex(PP.color) : '';
  });

  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hexInput.blur();
  });

  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast('Не получилось скопировать');
    }
  }

  $('copyHex').addEventListener('click', () => {
    if (PP.color) copyText(C.rgbToHex(PP.color), `${C.rgbToHex(PP.color)} скопирован`);
  });

  // ───── Вкладки ─────

  function refresh() {
    if (tab === 'matches') renderMatches();
    else if (tab === 'recipe') runRecipe();
    else if (tab === 'palette') renderPalette();
    else renderMine();
  }

  function showTab(name) {
    tab = name;
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === name);
    for (const id of ['matches', 'recipe', 'palette', 'mine']) $('pane-' + id).hidden = id !== name;
    closeSets();
    refresh();
  }

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  // ───── Наборы красок ─────

  const setsPop = $('setsPop');

  function showSetsButton() {
    const on = PP.sets.filter((s) => PP.enabled.has(s.id));
    $('setsBtn').textContent = on.length === 1 ? `Набор: ${on[0].brand} ${on[0].range}` : `Наборы: ${on.length}`;
  }

  function renderSets() {
    let html = '';
    let brand = '';
    for (const s of PP.sets) {
      if (s.brand !== brand) {
        brand = s.brand;
        html += `<div class="pop-title">${esc(brand)}</div>`;
      }
      const count = PP.paints.filter((p) => p.set === s).length;
      html +=
        `<label class="check"><input type="checkbox" data-set="${esc(s.id)}"${PP.enabled.has(s.id) ? ' checked' : ''} />` +
        `<span>${esc(s.range)}</span><small>${count}</small></label>`;
    }
    setsPop.innerHTML = html;
  }

  function closeSets() {
    setsPop.hidden = true;
  }

  $('setsBtn').addEventListener('click', () => {
    if (setsPop.hidden) renderSets();
    setsPop.hidden = !setsPop.hidden;
  });

  setsPop.addEventListener('change', (e) => {
    const box = e.target.closest('[data-set]');
    if (!box) return;
    if (!PP.setEnabled(box.dataset.set, box.checked)) {
      box.checked = true;
      toast('Хотя бы один набор должен остаться');
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!setsPop.hidden && !e.target.closest('#setsPop, #setsBtn')) closeSets();
  });

  // ───── Совпадения, тень и блик ─────

  function toneCard(label, tone, none) {
    if (!tone) return `<div class="tone-card"><small>${label}</small><p>${none}</p></div>`;
    const p = tone.paint;
    return (
      `<div class="tone-card pick" data-paint="${esc(p.id)}" title="Слева нужный тон, справа краска">` +
      `<small>${label}${owned.has(p.id) ? ' · есть у тебя' : ''}</small>` +
      `<div class="tone-row">${splitChip(C.rgbToHex(tone.target), p.hex, true)}` +
      `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p)}</span></div></div>`
    );
  }

  function renderMatches() {
    const list = $('matchesList');
    const tones = $('tones');
    if (!PP.color) {
      tones.hidden = true;
      list.innerHTML = '<p class="note block">Выбери цвет — здесь появятся ближайшие к нему краски, тень и блик.</p>';
      return;
    }

    const t = PP.tonePaints(PP.color);
    tones.hidden = false;
    tones.innerHTML =
      toneCard('Тень', t.shade, 'Темнее в наборе ничего нет') + toneCard('Блик', t.highlight, 'Светлее в наборе ничего нет');

    const target = C.rgbToHex(PP.color);
    let rows = PP.rank(PP.color, PP.activePaints());
    if (onlyMine) rows = rows.filter((r) => owned.has(r.paint.id));
    if (!rows.length) {
      list.innerHTML = '<p class="note block">Из включённых наборов во вкладке «Мои краски» пока ничего не отмечено.</p>';
      return;
    }

    list.innerHTML = rows
      .slice(0, MATCH_LIMIT)
      .map(({ paint: p, dE }) => {
        const match = pct(dE);
        return (
          `<div class="row pick" data-paint="${esc(p.id)}" title="Слева нужный цвет, справа краска. Нажми — покажу аналоги в других наборах">` +
          splitChip(target, p.hex) +
          `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p)}</span>` +
          `<span class="pct${match >= 95 ? ' good' : ''}">${match}%</span>` +
          ownButton(p) +
          `</div>`
        );
      })
      .join('');
  }

  // Клик по кнопке «есть/нет» меняет мои краски, клик по самой краске открывает аналоги.
  function paintClick(e) {
    const ownBtn = e.target.closest('[data-own]');
    if (ownBtn) {
      PP.setOwned(ownBtn.dataset.own, !owned.has(ownBtn.dataset.own));
      return;
    }
    const row = e.target.closest('[data-paint]');
    if (row) showAnalogs(PP.byId.get(row.dataset.paint));
  }

  $('matchesList').addEventListener('click', paintClick);
  $('tones').addEventListener('click', paintClick);

  $('onlyMine').addEventListener('change', (e) => {
    onlyMine = e.target.checked;
    renderMatches();
  });

  // ───── Аналоги в других наборах ─────

  const analogs = $('analogs');
  let analogsFor = null;

  function showAnalogs(paint) {
    if (!paint) return;
    analogsFor = paint;
    $('analogsHead').innerHTML =
      `<span class="chip" style="background:${paint.hex}"></span>` +
      `<span class="row-main"><b>${esc(paint.name)}</b>${paintMeta(paint, true)}</span>`;

    $('analogsList').innerHTML = PP.sets
      .filter((s) => s !== paint.set)
      .map((s) => {
        const best = PP.rank(
          paint.rgb,
          PP.paints.filter((p) => p.set === s && (p.type === 'metal') === (paint.type === 'metal'))
        )[0];
        return best ? { set: s, ...best } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.dE - b.dE)
      .map(({ paint: p, dE }) => {
        const match = pct(dE);
        return (
          `<div class="row">${splitChip(paint.hex, p.hex)}` +
          `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p, true)}</span>` +
          `<span class="pct${match >= 95 ? ' good' : ''}">${match}%</span>${ownButton(p)}</div>`
        );
      })
      .join('');
    if (!analogs.open) analogs.showModal();
  }

  $('analogsList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-own]');
    if (b) PP.setOwned(b.dataset.own, !owned.has(b.dataset.own));
  });
  $('analogsClose').addEventListener('click', () => analogs.close());
  // Клик по затемнению вокруг окна закрывает его.
  analogs.addEventListener('click', (e) => {
    if (e.target === analogs) analogs.close();
  });
  analogs.addEventListener('close', () => {
    analogsFor = null;
  });

  // ───── Мои краски ─────

  let mineQuiet = false; // список сам поправил строку, полная перерисовка не нужна

  function mineRows() {
    const q = $('mineSearch').value.trim().toLowerCase();
    const setId = $('mineSet').value;
    return PP.paints.filter(
      (p) => (setId === 'all' || p.set.id === setId) && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    );
  }

  function renderMineSets() {
    const sel = $('mineSet');
    const keep = sel.value || PP.sets.find((s) => PP.enabled.has(s.id)).id;
    sel.innerHTML =
      PP.sets
        .map((s) => {
          const all = PP.paints.filter((p) => p.set === s);
          const have = all.filter((p) => owned.has(p.id)).length;
          return `<option value="${esc(s.id)}">${esc(s.brand)} ${esc(s.range)} — ${have} из ${all.length}</option>`;
        })
        .join('') + `<option value="all">Все наборы — ${owned.size} из ${PP.paints.length}</option>`;
    sel.value = keep;
  }

  function renderMine() {
    renderMineSets();
    const rows = mineRows();
    const withSet = $('mineSet').value === 'all';
    let html = rows
      .slice(0, MINE_LIMIT)
      .map((p) => {
        const own = owned.has(p.id);
        return (
          `<div class="row pick" data-own="${esc(p.id)}">` +
          `<span class="chip small" style="background:${p.hex}"></span>` +
          `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p, withSet)}</span>` +
          `<button class="mini" type="button" data-analog="${esc(p.id)}" title="Аналоги в других наборах">≈</button>` +
          `<span class="own${own ? ' on' : ''}" role="checkbox" aria-checked="${own}">${own ? '✓' : ''}</span>` +
          `</div>`
        );
      })
      .join('');
    if (rows.length > MINE_LIMIT) html += `<p class="note block">Показаны первые ${MINE_LIMIT}. Уточни поиск, чтобы увидеть остальные.</p>`;
    $('mineList').innerHTML = html || '<p class="note block">Ничего не нашлось.</p>';
  }

  $('mineList').addEventListener('click', (e) => {
    const analog = e.target.closest('[data-analog]');
    if (analog) {
      showAnalogs(PP.byId.get(analog.dataset.analog));
      return;
    }
    const row = e.target.closest('[data-own]');
    if (!row) return;
    const state = !owned.has(row.dataset.own);
    mineQuiet = true;
    PP.setOwned(row.dataset.own, state);
    mineQuiet = false;
    const box = row.querySelector('.own');
    box.classList.toggle('on', state);
    box.textContent = state ? '✓' : '';
    box.setAttribute('aria-checked', state);
    renderMineSets();
  });

  $('mineSearch').addEventListener('input', renderMine);
  $('mineSet').addEventListener('change', renderMine);
  $('mineAll').addEventListener('click', () => PP.setOwned(mineRows().map((p) => p.id), true));
  $('mineNone').addEventListener('click', () => PP.setOwned(mineRows().map((p) => p.id), false));

  // ───── Рецепт ─────

  let recipeToken = null;
  let recipeKey = null;
  let recipeTimer = 0;

  function scheduleRecipe() {
    clearTimeout(recipeTimer);
    if (tab === 'recipe') recipeTimer = setTimeout(runRecipe, 120);
  }

  async function runRecipe() {
    const body = $('recipeBody');
    const mine = PP.paints.filter((p) => owned.has(p.id) && p.type !== 'metal');
    const metals = owned.size - mine.length;
    const n = mine.length;
    $('recipeTitle').textContent = n
      ? `Смешиваем из ${n} ${plural(n, ['твоей краски', 'твоих красок', 'твоих красок'])}` + (metals ? ' (металлики не в счёт)' : '')
      : 'Смешиваем из твоих красок';

    const stop = (html) => {
      if (recipeToken) recipeToken.cancelled = true;
      recipeKey = null;
      body.innerHTML = html;
    };
    if (!PP.color) {
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

    const key = C.rgbToHex(PP.color) + '|' + mine.map((p) => p.id).join(',');
    if (key === recipeKey) return;
    recipeKey = key;

    if (recipeToken) recipeToken.cancelled = true;
    const token = (recipeToken = { cancelled: false });
    const target = PP.color;

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
        `<b>${pct(bestSingle.dE)}%</b></span></div>`;
    }

    if (!recipes.length) {
      html += '<p class="note block">Смешиванием из этих красок ближе, чем готовой краской, не получается.</p>';
    } else if (pct(recipes[0].dE) < 90) {
      html += '<p class="note">Из отмеченных красок близко не выходит — вот лучшее, что получилось.</p>';
    }

    for (const r of recipes) {
      const total = r.items.reduce((sum, it) => sum + it.parts, 0);
      html +=
        `<div class="recipe"><div class="recipe-top">` +
        `<span class="compare" title="Слева нужный цвет, справа что получится">` +
        `<i style="background:${targetHex}"></i><i style="background:${C.rgbToHex(r.rgb)}"></i></span>` +
        `<span><span class="recipe-pct">${pct(r.dE)}%</span><small>${C.rgbToHex(r.rgb)}</small></span></div>` +
        `<div class="bar">` +
        r.items.map((it) => `<i style="background:${it.paint.hex};width:${(it.parts / total) * 100}%"></i>`).join('') +
        `</div>` +
        r.items
          .map(
            (it) =>
              `<div class="part"><span class="part-n"><b>${it.parts}</b><span>${plural(it.parts, ['часть', 'части', 'частей'])}</span></span>` +
              `<span class="chip small" style="background:${it.paint.hex}"></span>` +
              `<span class="row-main"><b>${esc(it.paint.name)}</b>${paintMeta(it.paint, true)}</span></div>`
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

  // ───── Палитра проекта ─────

  const projSelect = $('projSelect');
  const projName = $('projName');

  function showProjects() {
    projSelect.innerHTML = PP.projects.list
      .map((pr) => `<option value="${esc(pr.id)}"${pr.id === PP.projects.current ? ' selected' : ''}>${esc(pr.name)}</option>`)
      .join('');
    $('paletteCount').textContent = PP.project().items.length;
  }

  projSelect.addEventListener('change', () => PP.selectProject(projSelect.value));

  function startRename() {
    projName.value = PP.project().name;
    projSelect.hidden = true;
    projName.hidden = false;
    projName.focus();
    projName.select();
  }

  function endRename(save) {
    if (projName.hidden) return;
    const name = projName.value.trim();
    projName.hidden = true;
    projSelect.hidden = false;
    if (save && name && name !== PP.project().name) {
      PP.project().name = name;
      PP.projectsChanged(PP.project());
    }
  }

  $('projRename').addEventListener('click', startRename);
  projName.addEventListener('blur', () => endRename(true));
  projName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') endRename(true);
    if (e.key === 'Escape') endRename(false);
  });

  $('projNew').addEventListener('click', () => {
    PP.createProject('Новая фигурка');
    startRename();
  });

  let deleteArmed = 0;
  $('projDelete').addEventListener('click', () => {
    const pr = PP.project();
    const empty = !pr.items.length && !pr.photos.length && !pr.hasModel;
    if (!empty && Date.now() - deleteArmed > 4000) {
      deleteArmed = Date.now();
      toast(`Нажми ещё раз, чтобы удалить «${pr.name}» вместе с фото и моделью`);
      return;
    }
    deleteArmed = 0;
    PP.removeProject(pr.id);
  });

  $('addToPalette').addEventListener('click', () => {
    if (!PP.color) return;
    const pr = PP.project();
    const hex = C.rgbToHex(PP.color);
    if (pr.items.some((it) => C.rgbToHex(it.rgb) === hex)) {
      toast('Этот цвет уже есть в палитре');
      return;
    }
    pr.items.push({ id: PP.newId(), name: `Цвет ${pr.items.length + 1}`, rgb: PP.color.slice(), paint: null });
    PP.projectsChanged(pr);
    if (tab !== 'palette') toast(`Добавлено в палитру «${pr.name}»`);
  });

  function toneLine(label, tone, none) {
    if (!tone) return `<div class="tone"><span class="tone-label">${label}</span><span class="tone-none">${none}</span></div>`;
    const p = tone.paint;
    return (
      `<div class="tone"><span class="tone-label">${label}</span>${splitChip(C.rgbToHex(tone.target), p.hex, true)}` +
      `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p)}</span>${haveTag(p)}</div>`
    );
  }

  function renderPalette() {
    const pr = PP.project();
    const body = $('paletteBody');
    if (!pr.items.length) {
      body.innerHTML =
        '<p class="note block">В палитре пока пусто. Возьми цвет пипеткой и нажми «+ В палитру» — так собирается список красок на всю фигурку.</p>';
      return;
    }

    const resolved = pr.items.map(PP.resolveItem);
    let html = resolved
      .map(({ item, base, options, shade, highlight }) => {
        const hex = C.rgbToHex(item.rgb);
        const opts = options
          .map(
            (o) =>
              `<option value="${esc(o.paint.id)}"${o === base ? ' selected' : ''}>` +
              `${esc(o.paint.name)} · ${esc(o.paint.code || o.paint.set.short)} · ${pct(o.dE)}%${owned.has(o.paint.id) ? ' ✓' : ''}</option>`
          )
          .join('');
        return (
          `<div class="entry" data-id="${esc(item.id)}">` +
          `<div class="entry-top">` +
          `<button class="entry-swatch" type="button" data-act="load" style="background:${hex}" title="Сделать текущим цветом"></button>` +
          `<span class="entry-name"><input data-act="name" value="${esc(item.name)}" maxlength="${PP.NAME_MAX}" spellcheck="false" />` +
          `<small class="code">${hex}</small></span>` +
          `<button class="own" type="button" data-act="remove" title="Убрать из палитры">×</button></div>` +
          `<div class="tone"><span class="tone-label">База</span>${splitChip(hex, base.paint.hex, true)}` +
          `<select data-act="paint" title="Какой краской красить этот цвет">${opts}</select>${haveTag(base.paint)}</div>` +
          toneLine('Тень', shade, 'темнее в наборе нет') +
          toneLine('Блик', highlight, 'светлее в наборе нет') +
          `</div>`
        );
      })
      .join('');

    const need = PP.shoppingList(resolved);
    html +=
      `<div class="shop"><div class="shop-head"><b>Докупить</b><span class="count">${need.length}</span>` +
      `<label class="check"><input type="checkbox" data-act="tones"${PP.projects.withTones ? ' checked' : ''} /> с тенями и бликами</label></div>`;
    if (need.length) {
      html +=
        need
          .map(
            (p) =>
              `<div class="row"><span class="chip small" style="background:${p.hex}"></span>` +
              `<span class="row-main"><b>${esc(p.name)}</b>${paintMeta(p, true)}</span>${ownButton(p)}</div>`
          )
          .join('') + `<button class="btn" type="button" data-act="copy">Скопировать список</button>`;
    } else {
      html += '<p class="note">Все краски для этой палитры у тебя уже есть.</p>';
    }
    body.innerHTML = html + '</div>';
  }

  function shoppingText() {
    const pr = PP.project();
    const need = PP.shoppingList(pr.items.map(PP.resolveItem));
    return (
      `Докупить для «${pr.name}»:\n` +
      need.map((p) => `${p.set.brand} ${p.set.range} — ${p.code ? p.code + ' ' : ''}${p.name}`).join('\n')
    );
  }

  const paletteBody = $('paletteBody');
  const entryOf = (el) => {
    const entry = el.closest('.entry');
    return entry && PP.project().items.find((it) => it.id === entry.dataset.id);
  };

  paletteBody.addEventListener('click', (e) => {
    const ownBtn = e.target.closest('[data-own]');
    if (ownBtn) {
      PP.setOwned(ownBtn.dataset.own, !owned.has(ownBtn.dataset.own));
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const pr = PP.project();
    const item = entryOf(act);
    if (act.dataset.act === 'copy') {
      copyText(shoppingText(), 'Список скопирован');
    } else if (act.dataset.act === 'load' && item) {
      PP.pipette.clearPick();
      PP.setColor(item.rgb.slice());
    } else if (act.dataset.act === 'remove' && item) {
      pr.items = pr.items.filter((it) => it !== item);
      PP.projectsChanged(pr);
    }
  });

  paletteBody.addEventListener('change', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'tones') {
      PP.projects.withTones = act.checked;
      PP.projectsChanged();
    } else if (act.dataset.act === 'paint') {
      const item = entryOf(act);
      if (!item) return;
      item.paint = act.value;
      PP.projectsChanged(PP.project());
    }
  });

  paletteBody.addEventListener('input', (e) => {
    if (e.target.dataset.act !== 'name') return;
    const item = entryOf(e.target);
    if (!item) return;
    item.name = e.target.value.slice(0, PP.NAME_MAX);
    PP.saveProjects(PP.project());
  });

  // ───── Связь с остальным приложением ─────

  PP.on('color', ({ live }) => {
    showColor();
    if (tab === 'matches') renderMatches();
    if (!live) scheduleRecipe();
  });

  PP.on('owned', () => {
    $('mineCount').textContent = owned.size;
    if (analogsFor) showAnalogs(analogsFor);
    if (tab !== 'mine' || !mineQuiet) refresh();
  });

  PP.on('sets', () => {
    showSetsButton();
    refresh();
  });

  PP.on('projects', () => {
    showProjects();
    if (tab === 'palette') renderPalette();
  });

  PP.panel = { showTab };

  showSetsButton();
  showProjects();
  $('mineCount').textContent = owned.size;
  showTab('matches');
})();
