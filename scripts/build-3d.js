// Собирает src/three-view.src.js вместе с three.js в один обычный скрипт src/three-view.js.
// Модули по file:// браузер не грузит, поэтому 3D-часть подключается готовым файлом.
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

esbuild
  .build({
    entryPoints: [path.join(root, 'src', 'three-view.src.js')],
    outfile: path.join(root, 'src', 'three-view.js'),
    bundle: true,
    format: 'iife',
    globalName: 'PPThree',
    minify: true,
    target: 'chrome120',
    legalComments: 'inline',
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
