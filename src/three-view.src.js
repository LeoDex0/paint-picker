// 3D-примерка: показывает STL-модель и даёт красить её треугольники кистью и заливкой.
// Этот файл собирается в three-view.js командой `npm run build` (см. scripts/build-3d.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MeshBVH, acceleratedRaycast, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';

const UNDO_STROKES = 30;
const UNDO_TRIANGLES = 4000000; // память под отмену не бесконечная

// Цвета вершин three.js ждёт в линейном свете, а краски заданы в sRGB.
const LIN = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const x = i / 255;
  LIN[i] = Math.round((x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92) * 255);
}

export function create(container, { onStroke } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  scene.add(camera);
  // Основной свет закреплён за камерой: модель освещена с любой стороны, как её ни крути.
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(0.5, 0.7, 1);
  camera.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a52, 1.25));

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const controls = new OrbitControls(camera, canvas);
  controls.addEventListener('change', requestRender);

  const cursor = new THREE.Mesh(
    new THREE.RingGeometry(0.93, 1, 56),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  cursor.renderOrder = 10;
  cursor.visible = false;
  scene.add(cursor);

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const ndc = new THREE.Vector2();
  const sphere = new THREE.Sphere();
  const inverse = new THREE.Matrix4();
  const viewDir = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  let mesh = null;
  let geometry = null;
  let colorAttr = null;
  let triCount = 0;
  let radius = 1;
  let faceColors = null; // r, g, b, покрашен ли — по 4 байта на треугольник, цвет в sRGB
  let primer = [154, 156, 160];
  let tool = 'brush';
  let color = [200, 60, 50];
  let brushSize = 0.06; // доля от радиуса модели
  let fillAngle = 35;
  let adjacency = null;
  let faceNormals = null;

  let stamp = null; // в каком мазке треугольник уже записан в отмену
  let strokeId = 0;
  let stroke = null;
  let undoStack = [];
  let dirtyMin = Infinity;
  let dirtyMax = -1;
  let renderQueued = false;

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderer.render(scene, camera);
    });
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  function setButtons() {
    const orbit = tool === 'orbit';
    controls.mouseButtons = {
      LEFT: orbit ? THREE.MOUSE.ROTATE : null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: orbit ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
    };
  }
  setButtons();

  // ───── Модель ─────

  function disposeModel() {
    if (!mesh) return;
    scene.remove(mesh);
    geometry.boundsTree = null;
    geometry.dispose();
    mesh = geometry = colorAttr = faceColors = stamp = adjacency = faceNormals = null;
    triCount = 0;
    undoStack = [];
    cursor.visible = false;
    requestRender();
  }

  function load(buffer) {
    disposeModel();
    let parsed = new STLLoader().parse(buffer);
    if (parsed.index) parsed = parsed.toNonIndexed();
    const position = parsed.getAttribute('position');
    if (!position || position.count < 3) throw new Error('В файле нет треугольников');
    // Нормалям из файла не верим: часть программ пишет туда нули, и модель выходит чёрной.
    parsed.computeVertexNormals();
    parsed.center();
    parsed.computeBoundingSphere();

    geometry = parsed;
    triCount = position.count / 3;
    radius = geometry.boundingSphere.radius || 1;
    faceColors = new Uint8Array(triCount * 4);
    stamp = new Uint32Array(triCount);
    strokeId = 0;
    colorAttr = new THREE.BufferAttribute(new Uint8Array(triCount * 9), 3, true);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', colorAttr);
    repaintAll();

    // indirect: порядок треугольников в геометрии не меняется, номер треугольника = его место в файле.
    geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
    mesh = new THREE.Mesh(geometry, material);
    mesh.raycast = acceleratedRaycast;
    mesh.rotation.x = -Math.PI / 2; // в STL вверх смотрит Z, в three.js — Y
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    resetCamera();
    return { triangles: triCount };
  }

  function resetCamera() {
    // Запас по краям — под панели инструментов поверх окна.
    const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.3;
    camera.position.set(0.28, 0.18, 1).normalize().multiplyScalar(dist);
    camera.near = dist / 200;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    requestRender();
  }

  // ───── Цвета треугольников ─────

  function writeTri(t) {
    const o = t * 4;
    const painted = faceColors[o + 3];
    const r = LIN[painted ? faceColors[o] : primer[0]];
    const g = LIN[painted ? faceColors[o + 1] : primer[1]];
    const b = LIN[painted ? faceColors[o + 2] : primer[2]];
    const a = colorAttr.array;
    let v = t * 9;
    for (let k = 0; k < 3; k++) {
      a[v++] = r;
      a[v++] = g;
      a[v++] = b;
    }
    if (t < dirtyMin) dirtyMin = t;
    if (t > dirtyMax) dirtyMax = t;
  }

  // Отправляет в видеокарту только изменившийся кусок буфера цветов.
  function flush() {
    if (dirtyMax < dirtyMin) return;
    colorAttr.addUpdateRange(dirtyMin * 9, (dirtyMax - dirtyMin + 1) * 9);
    colorAttr.needsUpdate = true;
    dirtyMin = Infinity;
    dirtyMax = -1;
    requestRender();
  }

  function repaintAll() {
    for (let t = 0; t < triCount; t++) writeTri(t);
    dirtyMin = Infinity;
    dirtyMax = -1;
    colorAttr.clearUpdateRanges();
    colorAttr.needsUpdate = true;
    requestRender();
  }

  function setTri(t, r, g, b, a) {
    const o = t * 4;
    if (faceColors[o + 3] === a && (!a || (faceColors[o] === r && faceColors[o + 1] === g && faceColors[o + 2] === b))) return;
    if (stroke && stamp[t] !== strokeId) {
      stamp[t] = strokeId;
      stroke.tris.push(t);
      stroke.old.push(faceColors[o], faceColors[o + 1], faceColors[o + 2], faceColors[o + 3]);
    }
    faceColors[o] = r;
    faceColors[o + 1] = g;
    faceColors[o + 2] = b;
    faceColors[o + 3] = a;
    writeTri(t);
  }

  function beginStroke() {
    strokeId++;
    stroke = { tris: [], old: [] };
  }

  function endStroke() {
    const done = stroke;
    stroke = null;
    flush();
    if (!done || !done.tris.length) return;
    undoStack.push({ tris: Uint32Array.from(done.tris), old: Uint8Array.from(done.old) });
    let total = undoStack.reduce((sum, s) => sum + s.tris.length, 0);
    while (undoStack.length > UNDO_STROKES || (total > UNDO_TRIANGLES && undoStack.length > 1)) {
      total -= undoStack.shift().tris.length;
    }
    if (onStroke) onStroke();
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return false;
    for (let i = 0; i < last.tris.length; i++) {
      const t = last.tris[i];
      faceColors.set(last.old.subarray(i * 4, i * 4 + 4), t * 4);
      writeTri(t);
    }
    flush();
    if (onStroke) onStroke();
    return true;
  }

  function clear() {
    if (!mesh) return;
    beginStroke();
    for (let t = 0; t < triCount; t++) setTri(t, 0, 0, 0, 0);
    endStroke();
  }

  // ───── Кисть и заливка ─────

  function hitAt(clientX, clientY) {
    if (!mesh) return null;
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(mesh, false)[0] || null;
  }

  const inkOf = () => (tool === 'erase' ? [0, 0, 0, 0] : [color[0], color[1], color[2], 1]);

  function brushAt(hit) {
    const [r, g, b, a] = inkOf();
    inverse.copy(mesh.matrixWorld).invert();
    sphere.center.copy(hit.point).applyMatrix4(inverse);
    sphere.radius = radius * brushSize;
    const r2 = sphere.radius * sphere.radius;
    viewDir.copy(raycaster.ray.direction).transformDirection(inverse);

    geometry.boundsTree.shapecast({
      intersectsBounds: (box) => (sphere.intersectsBox(box) ? INTERSECTED : NOT_INTERSECTED),
      intersectsTriangle: (tri, index) => {
        tri.closestPointToPoint(sphere.center, closest);
        if (closest.distanceToSquared(sphere.center) > r2) return false;
        // Изнанку и стенки с обратной стороны не красим, иначе кисть «пробивает» тонкие детали насквозь.
        tri.getNormal(normal);
        if (normal.dot(viewDir) > 0.25) return false;
        setTri(index, r, g, b, a);
        return false;
      },
    });
  }

  // Соседи треугольников по общим рёбрам. Вершины в STL не общие, поэтому сначала
  // склеиваем совпадающие точки, потом ищем рёбра с одинаковой парой точек.
  function buildAdjacency() {
    const pos = geometry.getAttribute('position').array;
    const bits = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
    const vCount = pos.length / 3;

    let size = 1;
    while (size < vCount * 2) size <<= 1;
    let mask = size - 1;
    let table = new Int32Array(size).fill(-1);
    const weld = new Uint32Array(vCount);
    for (let v = 0; v < vCount; v++) {
      const x = bits[v * 3];
      const y = bits[v * 3 + 1];
      const z = bits[v * 3 + 2];
      let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
      for (;;) {
        const u = table[h];
        if (u < 0) {
          table[h] = v;
          weld[v] = v;
          break;
        }
        if (bits[u * 3] === x && bits[u * 3 + 1] === y && bits[u * 3 + 2] === z) {
          weld[v] = u;
          break;
        }
        h = (h + 1) & mask;
      }
    }

    const adj = new Int32Array(triCount * 3).fill(-1);
    size = 1;
    while (size < triCount * 6) size <<= 1;
    mask = size - 1;
    table = new Int32Array(size).fill(-1); // хранит «полуребро»: треугольник * 3 + номер ребра
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        let a = weld[t * 3 + k];
        let b = weld[t * 3 + ((k + 1) % 3)];
        if (a === b) continue;
        if (a > b) [a, b] = [b, a];
        let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & mask;
        for (;;) {
          const e = table[h];
          if (e < 0) {
            table[h] = t * 3 + k;
            break;
          }
          const et = (e / 3) | 0;
          let ea = weld[et * 3 + (e % 3)];
          let eb = weld[et * 3 + ((e + 1) % 3)];
          if (ea > eb) [ea, eb] = [eb, ea];
          if (ea === a && eb === b) {
            // третий треугольник на том же ребре (дефект сетки) остаётся без пары
            if (adj[e] < 0) {
              adj[e] = t;
              adj[t * 3 + k] = et;
            }
            break;
          }
          h = (h + 1) & mask;
        }
      }
    }
    adjacency = adj;

    faceNormals = new Float32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
      const o = t * 9;
      const ux = pos[o + 3] - pos[o];
      const uy = pos[o + 4] - pos[o + 1];
      const uz = pos[o + 5] - pos[o + 2];
      const vx = pos[o + 6] - pos[o];
      const vy = pos[o + 7] - pos[o + 1];
      const vz = pos[o + 8] - pos[o + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      faceNormals[t * 3] = nx / len;
      faceNormals[t * 3 + 1] = ny / len;
      faceNormals[t * 3 + 2] = nz / len;
    }
  }

  // Заливка расходится по соседним треугольникам того же цвета, пока поверхность
  // не переломится круче заданного угла.
  function fillFrom(start) {
    if (!adjacency) buildAdjacency();
    const [r, g, b, a] = inkOf();
    const o = start * 4;
    const sr = faceColors[o];
    const sg = faceColors[o + 1];
    const sb = faceColors[o + 2];
    const sa = faceColors[o + 3];
    const same = (t) => {
      const p = t * 4;
      return faceColors[p + 3] === sa && (!sa || (faceColors[p] === sr && faceColors[p + 1] === sg && faceColors[p + 2] === sb));
    };
    const limit = fillAngle >= 180 ? -2 : Math.cos((fillAngle * Math.PI) / 180);
    const seen = new Uint8Array(triCount);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const t = stack.pop();
      setTri(t, r, g, b, a);
      for (let k = 0; k < 3; k++) {
        const n = adjacency[t * 3 + k];
        if (n < 0 || seen[n] || !same(n)) continue;
        const dot =
          faceNormals[t * 3] * faceNormals[n * 3] +
          faceNormals[t * 3 + 1] * faceNormals[n * 3 + 1] +
          faceNormals[t * 3 + 2] * faceNormals[n * 3 + 2];
        if (dot < limit) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }

  // ───── Мышь ─────

  let painting = false;
  let last = null;

  function showCursor(hit) {
    const show = Boolean(hit) && (tool === 'brush' || tool === 'erase');
    if (show) {
      normal.copy(hit.face.normal).transformDirection(mesh.matrixWorld);
      cursor.position.copy(hit.point);
      cursor.quaternion.setFromUnitVectors(zAxis, normal);
      cursor.scale.setScalar(radius * brushSize);
    }
    if (show !== cursor.visible || show) requestRender();
    cursor.visible = show;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || tool === 'orbit' || !mesh) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (!hit) return;
    canvas.setPointerCapture(e.pointerId);
    beginStroke();
    if (tool === 'fill') {
      fillFrom(hit.faceIndex);
      endStroke();
      return;
    }
    painting = true;
    last = { x: e.clientX, y: e.clientY };
    brushAt(hit);
    flush();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!mesh) return;
    if (!painting) {
      showCursor(e.buttons ? null : hitAt(e.clientX, e.clientY));
      return;
    }
    // Быстрое движение мыши дробим на шаги, чтобы мазок не рвался на точки.
    const steps = Math.min(16, Math.max(1, Math.ceil(Math.hypot(e.clientX - last.x, e.clientY - last.y) / 5)));
    let hit = null;
    for (let i = 1; i <= steps; i++) {
      hit = hitAt(last.x + ((e.clientX - last.x) * i) / steps, last.y + ((e.clientY - last.y) * i) / steps);
      if (hit) brushAt(hit);
    }
    last = { x: e.clientX, y: e.clientY };
    showCursor(hit);
    flush();
  });

  function stopPainting() {
    if (!painting) return;
    painting = false;
    endStroke();
  }
  canvas.addEventListener('pointerup', stopPainting);
  canvas.addEventListener('pointercancel', stopPainting);
  canvas.addEventListener('pointerleave', () => {
    if (!painting) showCursor(null);
  });

  // ───── Наружу ─────

  return {
    load,
    resetCamera,
    undo,
    clear,
    get triangles() {
      return triCount;
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    colors: () => faceColors,
    setColors(saved) {
      if (!mesh || !saved || saved.length !== faceColors.length) return false;
      faceColors.set(saved);
      undoStack = [];
      repaintAll();
      return true;
    },
    setPrimer(rgb) {
      primer = rgb.slice();
      if (mesh) repaintAll();
    },
    setTool(name) {
      tool = name;
      setButtons();
      showCursor(null);
    },
    setColor(rgb) {
      color = rgb.slice();
    },
    setBrushSize(share) {
      brushSize = share;
    },
    setFillAngle(degrees) {
      fillAngle = degrees;
    },
    // Картинка текущего вида: без кольца кисти и на ровном тёмном фоне.
    snapshot() {
      const shown = cursor.visible;
      cursor.visible = false;
      scene.background = new THREE.Color(0x1b1c20);
      renderer.render(scene, camera);
      const done = new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      scene.background = null;
      cursor.visible = shown;
      requestRender();
      return done;
    },
    unload: disposeModel,
  };
}
