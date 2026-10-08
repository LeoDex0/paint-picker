// Собирает src/paints.js из таблиц проекта miniature-paints (MIT):
// https://github.com/Arcturus5404/miniature-paints/tree/main/paints
//
// Запуск: node scripts/build-paints.js <папка с Vallejo.md, Citadel_Colour.md, Army_Painter.md, AK.md>

const fs = require('node:fs');
const path = require('node:path');

// Берём только укрывистые акриловые линейки. Смывки, контрастные краски, грунты,
// спреи и технические составы одним цветом не описать.
const SETS = [
  { id: 'vallejo-game-color', brand: 'Vallejo', range: 'Game Color', short: 'Game Color', file: 'Vallejo.md', from: ['Game Color'] },
  { id: 'vallejo-model-color', brand: 'Vallejo', range: 'Model Color', short: 'Model Color', file: 'Vallejo.md', from: ['Model Color'] },
  { id: 'vallejo-game-air', brand: 'Vallejo', range: 'Game Air', short: 'Game Air', file: 'Vallejo.md', from: ['Game Air'] },
  { id: 'vallejo-model-air', brand: 'Vallejo', range: 'Model Air', short: 'Model Air', file: 'Vallejo.md', from: ['Model Air'] },
  { id: 'citadel', brand: 'Citadel', range: 'Base и Layer', short: 'Citadel', file: 'Citadel_Colour.md', from: ['Base', 'Layer'], showLine: true },
  { id: 'army-painter-fanatic', brand: 'Army Painter', range: 'Warpaints Fanatic', short: 'AP Fanatic', file: 'Army_Painter.md', from: ['Warpaints Fanatic'] },
  { id: 'army-painter-warpaints', brand: 'Army Painter', range: 'Warpaints', short: 'AP Warpaints', file: 'Army_Painter.md', from: ['Warpaints'] },
  {
    id: 'ak-3gen',
    brand: 'AK',
    range: '3rd Gen',
    short: 'AK 3rd Gen',
    file: 'AK.md',
    from: ['Standard (3rd Gen)', 'Intense (3rd Gen)', 'Pastel (3rd Gen)', 'Metallic (3rd Gen)', 'Figures (3rd Gen)', 'AFV (3rd Gen)'],
  },
];

const METAL_WORD = /\b(gold|silver|bronze|copper|brass|steel|gun ?metal|alumini?um|chrome|metal|tin|chainmail|platinum|alloy|iron|mithril)\b/i;
// «Steel Grey» или «Gold Yellow» — обычные цвета, металл тут только в названии.
const COLOUR_WORD = /\b(grey|gray|brown|green|yellow|blue|olive|red|white|black|ochre|drab|orange|purple|violet|pink|flesh|skin|tone)\b/i;

// У Citadel металлики названы как попало, поэтому списком.
const CITADEL_METAL = new Set([
  'Auric Armour Gold', 'Balthasar Gold', 'Brass Scorpion', 'Canoptek Alloy', 'Castellax Bronze', 'Fulgurite Copper',
  'Gehenna Gold', 'Grey Knights Steel', 'Hashut Copper', 'Iron Hands Steel', 'Iron Warriors', 'Ironbreaker',
  'Leadbelcher', 'Liberator Gold', 'Retributor Armour', 'Runefang Steel', 'Runelord Brass', 'Screaming Bell',
  'Skullcrusher Brass', 'Stormhost Silver', 'Sycorax Bronze', 'Warplock Bronze',
]);

// Металлики Model Color, которых не поймать по названию («Gunmetal Blue»).
const MODEL_COLOR_METAL = new Set(['70.800', '70.801', '70.863', '70.864', '70.865', '70.878', '70.996', '70.997', '70.998', '70.999']);

function gameColorType(code) {
  const n = Number(code.split('.')[1]);
  if (code.startsWith('73.')) return 'skip'; // смывки
  if (n === 68 || (n >= 82 && n <= 94)) return 'ink';
  if (n === 103 || n === 104 || (n >= 156 && n <= 161)) return 'fluo';
  if (n >= 130 && n <= 136) return 'fx';
  if (n >= 140 && n <= 155) return 'opaque';
  return null;
}

function typeOf(set, source, name, code, rgb) {
  const metalName = METAL_WORD.test(name) && !COLOUR_WORD.test(name);
  // У части металликов Vallejo в таблице стоит почти белый цвет — такие строки бесполезны.
  if (set.brand === 'Vallejo' && metalName && Math.min(...rgb) >= 180) return 'skip';

  if (set.id === 'vallejo-game-color') {
    const special = gameColorType(code);
    if (special) return special;
  }
  if (set.id === 'citadel') return CITADEL_METAL.has(name) ? 'metal' : 'base';
  if (set.id === 'vallejo-model-color' && MODEL_COLOR_METAL.has(code)) return 'metal';
  if (source.startsWith('Metallic') || metalName) return 'metal';
  return 'base';
}

const dir = process.argv[2];
if (!dir) {
  console.error('Укажи папку с таблицами красок');
  process.exit(1);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const items = [];

SETS.forEach((set, setIndex) => {
  const lines = fs.readFileSync(path.join(dir, set.file), 'utf8').split(/\r?\n/);
  const header = lines.find((l) => l.startsWith('|Name|'));
  if (!header) throw new Error(`Нет заголовка таблицы в ${set.file}`);
  const hasCode = header.split('|')[2] === 'Code';

  const seen = new Set();
  const found = [];
  for (const line of lines) {
    const cells = line.split('|').map((c) => c.trim());
    const source = cells[hasCode ? 3 : 2];
    if (cells.length < 7 || !set.from.includes(source)) continue;

    const name = cells[1];
    const rawCode = hasCode ? cells[2] : '';
    const code = rawCode && rawCode !== 'null' ? rawCode : '';
    const rgb = cells.slice(hasCode ? 4 : 3, hasCode ? 7 : 6).map(Number);
    if (!name || rgb.length !== 3 || rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new Error(`Непонятная строка в ${set.file}: ${line}`);
    }

    const type = typeOf(set, source, name, code, rgb);
    if (type === 'skip') continue;

    // Ключ краски внутри набора: код, а если его нет или он повторяется — название.
    let key = code || slug(name);
    if (seen.has(key)) key = `${key}-${slug(name)}`;
    if (seen.has(key)) continue; // точный повтор строки
    seen.add(key);

    const item = {
      s: setIndex,
      k: key,
      c: code,
      n: type === 'ink' && !/ink$/i.test(name) ? `${name} Ink` : name,
      h: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(),
    };
    if (type !== 'base') item.t = type;
    if (set.showLine) item.l = source;
    found.push(item);
  }

  found.sort((a, b) => (a.c || a.n).localeCompare(b.c || b.n));
  items.push(...found);
  console.log(`${String(found.length).padStart(4)}  ${set.brand} ${set.range}`);
});

const sets = SETS.map(({ id, brand, range, short }) => ({ id, brand, range, short }));
const out =
  `// Сгенерировано scripts/build-paints.js — руками не править.\n` +
  `// Источник цветов: miniature-paints (MIT), https://github.com/Arcturus5404/miniature-paints\n` +
  `// s — номер набора, k — ключ краски в наборе, c — код, n — название, h — цвет, t — тип, l — линейка.\n` +
  `(function (root) {\n` +
  `  const data = {\n` +
  `    sets: ${JSON.stringify(sets, null, 2).replace(/\n/g, '\n    ')},\n` +
  `    items: [\n` +
  items.map((it) => `      ${JSON.stringify(it)},\n`).join('') +
  `    ],\n` +
  `  };\n` +
  `  if (typeof module === 'object' && module.exports) module.exports = data;\n` +
  `  else root.PPPaints = data;\n` +
  `})(typeof self !== 'undefined' ? self : globalThis);\n`;

const target = path.join(__dirname, '..', 'src', 'paints.js');
fs.writeFileSync(target, out);
console.log(`${items.length} красок → ${target}`);
