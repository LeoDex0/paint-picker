// Собирает src/paints.js из таблицы Vallejo.md проекта miniature-paints (MIT):
// https://github.com/Arcturus5404/miniature-paints/blob/main/paints/Vallejo.md
//
// Запуск: node scripts/build-paints.js <путь к Vallejo.md>

const fs = require('node:fs');
const path = require('node:path');

const RANGE = 'Game Color';

// Тип краски по коду. У металликов в исходной таблице цвет почти белый
// (блеск в один цвет не уложить), а смывки полупрозрачные — их пропускаем.
function typeOf(code) {
  const n = Number(code.split('.')[1]);
  if (code.startsWith('73.')) return 'skip';
  if (n >= 52 && n <= 60) return 'skip';
  if (n === 68 || (n >= 82 && n <= 94)) return 'ink';
  if (n === 103 || n === 104 || (n >= 156 && n <= 161)) return 'fluo';
  if (n >= 130 && n <= 136) return 'fx';
  if (n >= 140 && n <= 155) return 'opaque';
  return 'base';
}

const input = process.argv[2];
if (!input) {
  console.error('Укажи путь к Vallejo.md');
  process.exit(1);
}

const items = [];
for (const line of fs.readFileSync(input, 'utf8').split(/\r?\n/)) {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 8 || cells[3] !== RANGE) continue;

  const [, rawName, code, , r, g, b] = cells;
  const type = typeOf(code);
  if (type === 'skip') continue;
  if (!/^\d{2}\.\d{3}$/.test(code)) throw new Error(`Непонятный код: ${line}`);

  const rgb = [r, g, b].map(Number);
  if (rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error(`Непонятный цвет: ${line}`);

  const name = type === 'ink' && !/ink$/i.test(rawName) ? `${rawName} Ink` : rawName;
  const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  items.push({ code, name, hex, type });
}

items.sort((a, b) => a.code.localeCompare(b.code));

const out =
  `// Сгенерировано scripts/build-paints.js — руками не править.\n` +
  `// Источник цветов: miniature-paints (MIT), https://github.com/Arcturus5404/miniature-paints\n` +
  `(function (root) {\n` +
  `  const data = ${JSON.stringify({ brand: 'Vallejo', range: RANGE, items }, null, 2).replace(/\n/g, '\n  ')};\n` +
  `  if (typeof module === 'object' && module.exports) module.exports = data;\n` +
  `  else root.PPPaints = data;\n` +
  `})(typeof self !== 'undefined' ? self : globalThis);\n`;

const target = path.join(__dirname, '..', 'src', 'paints.js');
fs.writeFileSync(target, out);
console.log(`${items.length} красок → ${target}`);
