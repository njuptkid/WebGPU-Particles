// CanvasKit Particle Engine bridge.
// C++/WASM engine does simulation + draw-buffer building; this bridge feeds
// those buffers to CanvasKit's drawAtlas / drawVertices.
//
// Zero-copy note (benchmark + correctness verified):
//  - drawAtlas: pass CanvasKit.Malloc-backed subarray views -> the Embind
//    binding recognizes them as already-in-CK-heap and skips the per-element
//    copy. Real win at scale (~17x on the JS->CK seam for the atlas payload).
//  - drawVertices: MakeVertices does NOT correctly accept a MallocObj for the
//    positions/indices params in CanvasKit 0.41.1 (renders nothing — verified),
//    so it stays on plain typed-array views (Embind copies them). To stay
//    under the WebGL single-drawVertices limit observed past ~1000 particles,
//    it draws in fixed-size batches.

let CanvasKit, pe, surface, atlas, paintAtlas, paintVerts, paintFlat;
let M = null;                  // persistent Malloc buffers (drawAtlas path)
let mode = 'atlas';
let last = 0, acc = 0, n = 0;
// 3D camera state (orbit): auto-orbit when not dragging, mouse-drag to look around.
let camYaw = 0.6, camPitch = 0.5, camDist = 600, camFocal = 400;
let dragging = false, dragX = 0, dragY = 0;

const $ = (id) => document.getElementById(id);
function setErr(e) { $('err').textContent = String(e && e.stack ? e.stack : e); }

async function main() {
  // 1. CanvasKit
  CanvasKit = await CanvasKitInit({ locateFile: (f) => '/build/' + f });

  // 2. Particle engine wasm (freestanding, zero imports)
  const r = await fetch('/particle-engine/particle-engine.wasm');
  pe = (await WebAssembly.instantiate(await r.arrayBuffer(), {})).instance.exports;
  if (!pe.ck_step) throw new Error('particle wasm missing exports');

  // 3. Surface (auto GPU/WebGL, else software)
  const canvas = $('c');
  surface = CanvasKit.MakeCanvasSurface(canvas.id);
  if (!surface) throw new Error('MakeCanvasSurface failed');
  $('be').textContent =
    (navigator.gpu ? 'WebGPU?' : '') + 'WebGL2/WebGL (host)';

  // 4. Procedural atlas: soft radial-gradient disc (white core -> transparent
  //    edge). No hard edge => no visible quad/square outline.
  const sz = 64, half = sz / 2;
  const tmp = CanvasKit.MakeSurface(sz, sz);
  const tc = tmp.getCanvas();
  tc.clear(CanvasKit.TRANSPARENT);
  const grad = CanvasKit.Shader.MakeRadialGradient(
    [half, half], half - 1,
    [CanvasKit.WHITE, CanvasKit.TRANSPARENT], [0.0, 1.0],
    CanvasKit.TileMode.Clamp);
  const gp = new CanvasKit.Paint();
  gp.setShader(grad);
  tc.drawRect(CanvasKit.LTRBRect(0, 0, sz, sz), gp);
  atlas = tmp.makeImageSnapshot();
  gp.delete();
  tmp.delete();

  // 5. Paints
  paintAtlas = new CanvasKit.Paint();
  paintAtlas.setAntiAlias(true);
  paintVerts = new CanvasKit.Paint();
  paintVerts.setAntiAlias(true);
  paintVerts.setShader(atlas.makeShaderCubic(
    CanvasKit.TileMode.Clamp, CanvasKit.TileMode.Clamp, 1 / 3, 1 / 3));
  paintFlat = new CanvasKit.Paint();
  paintFlat.setAntiAlias(true);
  paintFlat.setColor(CanvasKit.Color(1, 1, 1, 1));

  // 6. Init the C++ engine; allocate persistent Malloc buffers for the
  //    drawAtlas path (drawAtlas accepts MallocObj for all its array params).
  pe.ck_init(pe.ck_max_capacity(), canvas.width, canvas.height);
  const MAX = pe.ck_max_capacity();
  M = {
    atlasRsx: CanvasKit.Malloc(Float32Array, 4 * MAX),
    atlasTex: CanvasKit.Malloc(Float32Array, 4 * MAX),
    atlasCol: CanvasKit.Malloc(Uint32Array, MAX),
  };

  // 7. UI
  $('b1').onclick = () => { mode = 'atlas';      $('m').textContent = 'drawAtlas'; };
  $('b2').onclick = () => { mode = 'verts';      $('m').textContent = 'drawVertices'; };
  $('b4').onclick = () => { mode = 'verts-flat'; $('m').textContent = 'verts-flat'; };
  $('b3').onclick = () => pe.ck_reset();

  // 3D camera: mouse-drag = orbit (yaw/pitch); auto-orbit yaw when idle.
  canvas.addEventListener('mousedown', (e) => { dragging = true; dragX = e.clientX; dragY = e.clientY; });
  window.addEventListener('mouseup',   () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camYaw   += (e.clientX - dragX) * 0.01;
    camPitch  = Math.max(-1.4, Math.min(1.4, camPitch + (e.clientY - dragY) * 0.01));
    dragX = e.clientX; dragY = e.clientY;
  });
  // wheel = zoom (camera distance)
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); camDist = Math.max(250, Math.min(1500, camDist + e.deltaY * 0.5)); }, {passive:false});

  // 8. rAF loop
  last = performance.now();
  surface.requestAnimationFrame(frame);
}

function frame() {
  try {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 1 / 60;

    // 3D camera: auto-orbit when idle, apply user yaw/pitch/dist.
    if (!dragging) camYaw += 0.003;
    pe.ck_set_camera(camYaw, camPitch, camDist, camFocal);

    pe.ck_step(dt);

    const c = surface.getCanvas();
    c.clear(CanvasKit.Color(0.02, 0.025, 0.06, 1));

    if (mode === 'atlas') drawAtlas(c);
    else if (mode === 'verts-flat') drawVertices(c, paintFlat);
    else drawVertices(c, paintVerts);

    surface.requestAnimationFrame(frame);

    acc += dt; n++;
    if (acc >= 0.5) {
      $('f').textContent = (n / acc).toFixed(0);
      $('a').textContent = pe.ck_active();
      acc = 0; n = 0;
    }
  } catch (e) {
    setErr(e);
  }
}

// --- drawAtlas path (zero-copy via MallocObj.subarray) -------------------
function drawAtlas(c) {
  const k = pe.ck_build_atlas();
  if (!k) return;
  const mem = pe.memory.buffer;
  // one real memcpy per buffer (.set) into CK's heap
  M.atlasTex.toTypedArray().set(new Float32Array(mem, pe.ck_atlas_tex_ptr(), 4 * k));
  M.atlasRsx.toTypedArray().set(new Float32Array(mem, pe.ck_atlas_rsx_ptr(), 4 * k));
  M.atlasCol.toTypedArray().set(new Uint32Array(mem, pe.ck_atlas_colors_ptr(), k));
  // zero-copy subarrays (binding sees CK-heap-resident, skips copy)
  c.drawAtlas(atlas,
    M.atlasTex.subarray(0, 4 * k), M.atlasRsx.subarray(0, 4 * k),
    paintAtlas, CanvasKit.BlendMode.Plus, M.atlasCol.subarray(0, k),   // additive glow
    { filter: CanvasKit.FilterMode.Linear });
}

// --- drawVertices path (plain views, batched) ----------------------------
// Color4f (Float32 RGBA) vertex colors — ColorInt renders nothing on WebGL.
// Batched (256/draw) to stay under the WebGL single-drawVertices limit.
const VCHUNK = 256;
const idxPattern = (() => {
  const a = new Uint16Array(VCHUNK * 6);
  for (let p = 0; p < VCHUNK; ++p) {
    const b = p * 4, o = p * 6;
    a[o] = b; a[o + 1] = b + 1; a[o + 2] = b + 2;
    a[o + 3] = b; a[o + 4] = b + 2; a[o + 5] = b + 3;
  }
  return a;
})();
function drawVertices(c, paint) {
  const k = pe.ck_build_vertices();
  if (!k) return;
  const mem = pe.memory.buffer;
  const posPtr = pe.ck_vert_pos_ptr();
  const texPtr = pe.ck_vert_tex_ptr();
  const colPtr = pe.ck_vert_colors_f_ptr();
  for (let s = 0; s < k; s += VCHUNK) {
    const m = Math.min(VCHUNK, k - s);
    const positions = new Float32Array(mem, posPtr + 8 * s * 4, 8 * m);
    const texCoords = new Float32Array(mem, texPtr + 8 * s * 4, 8 * m);
    const colorsF  = new Float32Array(mem, colPtr + 16 * s * 4, 16 * m);
    const indices  = idxPattern.subarray(0, 6 * m);
    const verts = CanvasKit.MakeVertices(CanvasKit.VertexMode.Triangles,
      positions, texCoords, colorsF, indices, false);
    if (!verts) continue;
    c.drawVertices(verts, CanvasKit.BlendMode.SrcOver, paint);
    verts.delete();
  }
}

main().catch(setErr);
