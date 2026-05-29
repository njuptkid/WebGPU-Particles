const STRUCT_GRID_SIZE = `
struct GridSize {
  w : f32,
  h : f32,
  d : f32,
  dx : f32,
  rdx : f32,
  _pad1 : f32,
  _pad2 : f32,
  _pad3 : f32,
}`

// Skip boundary cells (interior only)
const COMPUTE_START = `
var pos = vec3<f32>(global_id.xyz);

if (pos.x == 0 || pos.y == 0 || pos.z == 0 ||
    pos.x >= uGrid.w - 1 || pos.y >= uGrid.h - 1 || pos.z >= uGrid.d - 1) {
    return;
}

let index = ID(pos.x, pos.y, pos.z);`

// Target all cells
const COMPUTE_START_ALL = `
var pos = vec3<f32>(global_id.xyz);

if (pos.x >= uGrid.w || pos.y >= uGrid.h || pos.z >= uGrid.d) {
    return;
}

let index = ID(pos.x, pos.y, pos.z);`

/// VELOCITY INJECT SHADER (stride-3) ///

const velocityInjectShader = /* wgsl */`
${STRUCT_GRID_SIZE}

struct Mouse {
  pos: vec2<f32>,
  vel: vec2<f32>,
}
@group(0) @binding(0) var<storage, read> vel_in : array<f32>;
@group(0) @binding(1) var<storage, read_write> vel_out : array<f32>;
@group(0) @binding(2) var<uniform> uGrid : GridSize;
@group(0) @binding(3) var<uniform> uMouse : Mouse;
@group(0) @binding(4) var<uniform> uForce : f32;
@group(0) @binding(5) var<uniform> uRadius : f32;
@group(0) @binding(6) var<uniform> uDiffusion : f32;
@group(0) @binding(7) var<uniform> uDt : f32;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

fn createSplat3D(pos : vec3<f32>, splatPos : vec3<f32>, vel : vec3<f32>, radius : f32) -> vec3<f32> {
  var p = pos - splatPos;
  p.x *= uGrid.w / uGrid.h;
  var v = vel;
  v.x *= uGrid.w / uGrid.h;
  let splat = exp(-dot(p.xz, p.xz) / radius - dot(p.yz, p.yz) / radius * 0.1) * v;
  return splat;
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

    ${COMPUTE_START}

    var p = pos / vec3(uGrid.w, uGrid.h, uGrid.d);

    var m = uMouse.pos;
    var v = uMouse.vel * 2.;
    let splatPos = vec3(m.x, m.y, 0.5);
    let splatVel = vec3(v.x, v.y, 0.0);
    var splat = createSplat3D(p, splatPos, splatVel, uRadius);
    splat *= uForce * uDt * 200.;

    let base = index * 3u;
    vel_out[base]       = vel_in[base]       * uDiffusion + splat.x;
    vel_out[base + 1u]  = vel_in[base + 1u]  * uDiffusion + splat.y;
    vel_out[base + 2u]  = vel_in[base + 2u]  * uDiffusion + splat.z;
}`

/// ADVECT SHADER (self-advection, stride-3) ///

const advectShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> vel_in : array<f32>;
@group(0) @binding(1) var<storage, read_write> vel_out : array<f32>;
@group(0) @binding(2) var<uniform> uGrid : GridSize;
@group(0) @binding(3) var<uniform> uDt : f32;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

fn loadVel(idx : u32) -> vec3<f32> {
  let b = idx * 3u;
  return vec3(vel_in[b], vel_in[b + 1u], vel_in[b + 2u]);
}

fn trilerp(x0 : f32, y0 : f32, z0 : f32) -> vec3<f32> {
  let x1 = floor(x0); let x2 = x1 + 1.0;
  let y1 = floor(y0); let y2 = y1 + 1.0;
  let z1 = floor(z0); let z2 = z1 + 1.0;

  let c000 = loadVel(ID(x1, y1, z1));
  let c100 = loadVel(ID(x2, y1, z1));
  let c010 = loadVel(ID(x1, y2, z1));
  let c110 = loadVel(ID(x2, y2, z1));
  let c001 = loadVel(ID(x1, y1, z2));
  let c101 = loadVel(ID(x2, y1, z2));
  let c011 = loadVel(ID(x1, y2, z2));
  let c111 = loadVel(ID(x2, y2, z2));

  let tx = fract(x0); let ty = fract(y0); let tz = fract(z0);
  let c00 = mix(c000, c100, tx);
  let c01 = mix(c001, c101, tx);
  let c10 = mix(c010, c110, tx);
  let c11 = mix(c011, c111, tx);
  let c0 = mix(c00, c10, ty);
  let c1 = mix(c01, c11, ty);
  return mix(c0, c1, tz);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

    ${COMPUTE_START}

    let vel = loadVel(index);

    var bx = pos.x - uDt * uGrid.rdx * vel.x;
    var by = pos.y - uDt * uGrid.rdx * vel.y;
    var bz = pos.z - uDt * uGrid.rdx * vel.z;

    bx = clamp(bx, 0.0, uGrid.w - 1.0);
    by = clamp(by, 0.0, uGrid.h - 1.0);
    bz = clamp(bz, 0.0, uGrid.d - 1.0);

    let result = trilerp(bx, by, bz);

    let base = index * 3u;
    vel_out[base]       = result.x;
    vel_out[base + 1u]  = result.y;
    vel_out[base + 2u]  = result.z;
}`

/// DIVERGENCE SHADER (stride-3 velocity) ///

const divergenceShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> vel : array<f32>;
@group(0) @binding(1) var<storage, read_write> div : array<f32>;
@group(0) @binding(2) var<uniform> uGrid : GridSize;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

fn loadVel(idx : u32) -> vec3<f32> {
  let b = idx * 3u;
  return vec3(vel[b], vel[b + 1u], vel[b + 2u]);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START}

  let L = loadVel(ID(pos.x - 1, pos.y, pos.z));
  let R = loadVel(ID(pos.x + 1, pos.y, pos.z));
  let B = loadVel(ID(pos.x, pos.y - 1, pos.z));
  let T = loadVel(ID(pos.x, pos.y + 1, pos.z));
  let F = loadVel(ID(pos.x, pos.y, pos.z - 1));
  let Bk = loadVel(ID(pos.x, pos.y, pos.z + 1));

  div[index] = 0.5 * uGrid.rdx * ((R.x - L.x) + (T.y - B.y) + (Bk.z - F.z));
}`

/// PRESSURE SHADER (3D Jacobi) — scalar, unchanged ///

const pressureShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> pres_in : array<f32>;
@group(0) @binding(1) var<storage, read> div : array<f32>;
@group(0) @binding(2) var<storage, read_write> pres_out : array<f32>;
@group(0) @binding(3) var<uniform> uGrid : GridSize;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START}

  let Lx = pres_in[ID(pos.x - 1, pos.y, pos.z)];
  let Rx = pres_in[ID(pos.x + 1, pos.y, pos.z)];
  let Bx = pres_in[ID(pos.x, pos.y - 1, pos.z)];
  let Tx = pres_in[ID(pos.x, pos.y + 1, pos.z)];
  let Fx = pres_in[ID(pos.x, pos.y, pos.z - 1)];
  let Bkx = pres_in[ID(pos.x, pos.y, pos.z + 1)];

  let bC = div[index];
  let alpha = -(uGrid.dx * uGrid.dx);
  let rBeta = 1.0 / 6.0;

  pres_out[index] = (Lx + Rx + Bx + Tx + Fx + Bkx + alpha * bC) * rBeta;
}`

/// GRADIENT SUBTRACT SHADER (stride-3 velocity) ///

const gradientSubtractShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> pressure : array<f32>;
@group(0) @binding(1) var<storage, read> vel_in : array<f32>;
@group(0) @binding(2) var<storage, read_write> vel_out : array<f32>;
@group(0) @binding(3) var<uniform> uGrid : GridSize;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}
fn pres(x : f32, y : f32, z : f32) -> f32 {
  return pressure[ID(x, y, z)];
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START}

  let xL = pres(pos.x - 1, pos.y, pos.z);
  let xR = pres(pos.x + 1, pos.y, pos.z);
  let yB = pres(pos.x, pos.y - 1, pos.z);
  let yT = pres(pos.x, pos.y + 1, pos.z);
  let zF = pres(pos.x, pos.y, pos.z - 1);
  let zBk = pres(pos.x, pos.y, pos.z + 1);

  let halfRdx = 0.5 * uGrid.rdx;
  let base = index * 3u;
  vel_out[base]       = vel_in[base]       - halfRdx * (xR - xL);
  vel_out[base + 1u]  = vel_in[base + 1u]  - halfRdx * (yT - yB);
  vel_out[base + 2u]  = vel_in[base + 2u]  - halfRdx * (zBk - zF);
}`

/// BOUNDARY SHADER (stride-3 velocity) ///

const boundaryShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> vel_in : array<f32>;
@group(0) @binding(1) var<storage, read_write> vel_out : array<f32>;
@group(0) @binding(2) var<uniform> uGrid : GridSize;
@group(0) @binding(3) var<uniform> containFluid : f32;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START_ALL}

  var srcPos = pos;
  var scaleX = 1.0;
  var scaleY = 1.0;
  var scaleZ = 1.0;

  if (pos.x == 0) { srcPos.x += 1; scaleX = -1; }
  else if (pos.x == uGrid.w - 1) { srcPos.x -= 1; scaleX = -1; }
  if (pos.y == 0) { srcPos.y += 1; scaleY = -1; }
  else if (pos.y == uGrid.h - 1) { srcPos.y -= 1; scaleY = -1; }
  if (pos.z == 0) { srcPos.z += 1; scaleZ = -1; }
  else if (pos.z == uGrid.d - 1) { srcPos.z -= 1; scaleZ = -1; }

  if (containFluid == 0.) {
    scaleX = 1; scaleY = 1; scaleZ = 1;
  }

  let srcBase = ID(srcPos.x, srcPos.y, srcPos.z) * 3u;
  let dstBase = index * 3u;
  vel_out[dstBase]       = vel_in[srcBase]       * scaleX;
  vel_out[dstBase + 1u]  = vel_in[srcBase + 1u]  * scaleY;
  vel_out[dstBase + 2u]  = vel_in[srcBase + 2u]  * scaleZ;
}`

/// BOUNDARY PRESSURE SHADER — scalar, unchanged ///

const boundaryPressureShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> x_in : array<f32>;
@group(0) @binding(1) var<storage, read_write> x_out : array<f32>;
@group(0) @binding(2) var<uniform> uGrid : GridSize;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START_ALL}

  if (pos.x == 0) { pos.x += 1; }
  else if (pos.x == uGrid.w - 1) { pos.x -= 1; }
  if (pos.y == 0) { pos.y += 1; }
  else if (pos.y == uGrid.h - 1) { pos.y -= 1; }
  if (pos.z == 0) { pos.z += 1; }
  else if (pos.z == uGrid.d - 1) { pos.z -= 1; }

  x_out[index] = x_in[ID(pos.x, pos.y, pos.z)];
}`

/// CLEAR PRESSURE SHADER — scalar, unchanged ///

const clearPressureShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> x_in : array<f32>;
@group(0) @binding(1) var<storage, read_write> x_out : array<f32>;
@group(0) @binding(2) var<uniform> uGrid : GridSize;
@group(0) @binding(3) var<uniform> uVisc : f32;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START_ALL}

  x_out[index] = x_in[index] * uVisc;
}`

/// VORTICITY SHADER (stride-3) ///

const vorticityShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> vel : array<f32>;
@group(0) @binding(1) var<storage, read_write> vort : array<f32>;
@group(0) @binding(2) var<uniform> uGrid : GridSize;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

fn loadVel(idx : u32) -> vec3<f32> {
  let b = idx * 3u;
  return vec3(vel[b], vel[b + 1u], vel[b + 2u]);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START}

  let halfRdx = 0.5 * uGrid.rdx;

  let dVy_dz = (loadVel(ID(pos.x, pos.y, pos.z + 1)).y - loadVel(ID(pos.x, pos.y, pos.z - 1)).y) * halfRdx;
  let dVz_dy = (loadVel(ID(pos.x, pos.y + 1, pos.z)).z - loadVel(ID(pos.x, pos.y - 1, pos.z)).z) * halfRdx;
  let dVx_dz = (loadVel(ID(pos.x, pos.y, pos.z + 1)).x - loadVel(ID(pos.x, pos.y, pos.z - 1)).x) * halfRdx;
  let dVz_dx = (loadVel(ID(pos.x + 1, pos.y, pos.z)).z - loadVel(ID(pos.x - 1, pos.y, pos.z)).z) * halfRdx;
  let dVy_dx = (loadVel(ID(pos.x + 1, pos.y, pos.z)).y - loadVel(ID(pos.x - 1, pos.y, pos.z)).y) * halfRdx;
  let dVx_dy = (loadVel(ID(pos.x, pos.y + 1, pos.z)).x - loadVel(ID(pos.x, pos.y - 1, pos.z)).x) * halfRdx;

  let base = index * 3u;
  vort[base]       = dVz_dy - dVy_dz;
  vort[base + 1u]  = dVx_dz - dVz_dx;
  vort[base + 2u]  = dVy_dx - dVx_dy;
}`

/// VORTICITY CONFINEMENT SHADER (stride-3) ///

const vorticityConfinementShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> vel_in : array<f32>;
@group(0) @binding(1) var<storage, read> vort : array<f32>;
@group(0) @binding(2) var<storage, read_write> vel_out : array<f32>;
@group(0) @binding(3) var<uniform> uGrid : GridSize;
@group(0) @binding(4) var<uniform> uDt : f32;
@group(0) @binding(5) var<uniform> uVorticity : f32;

fn ID(x : f32, y : f32, z : f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

fn loadVort(idx : u32) -> vec3<f32> {
  let b = idx * 3u;
  return vec3(vort[b], vort[b + 1u], vort[b + 2u]);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

  ${COMPUTE_START}

  let L = length(loadVort(ID(pos.x - 1, pos.y, pos.z)));
  let R = length(loadVort(ID(pos.x + 1, pos.y, pos.z)));
  let B = length(loadVort(ID(pos.x, pos.y - 1, pos.z)));
  let T = length(loadVort(ID(pos.x, pos.y + 1, pos.z)));
  let F = length(loadVort(ID(pos.x, pos.y, pos.z - 1)));
  let Bk = length(loadVort(ID(pos.x, pos.y, pos.z + 1)));

  let halfRdx = 0.5 * uGrid.rdx;
  var eta = vec3((R - L) * halfRdx, (T - B) * halfRdx, (Bk - F) * halfRdx);

  let epsilon = 2.4414e-4;
  let magSqr = max(epsilon, dot(eta, eta));
  eta = eta / sqrt(magSqr);

  let curl = loadVort(index);
  let force = uGrid.dx * uVorticity * uDt * cross(eta, curl);

  let base = index * 3u;
  vel_out[base]       = vel_in[base]       + force.x;
  vel_out[base + 1u]  = vel_in[base + 1u]  + force.y;
  vel_out[base + 2u]  = vel_in[base + 2u]  + force.z;
}`

/// PARTICLE INIT SHADER (stride-3 positions) ///

const particleInitShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read_write> pos_out : array<f32>;
@group(0) @binding(1) var<storage, read_write> life : array<f32>;
@group(0) @binding(2) var<storage, read_write> color_out : array<f32>;
@group(0) @binding(3) var<uniform> uSpawnPos : vec2<f32>;
@group(0) @binding(4) var<uniform> uRadius : f32;
@group(0) @binding(5) var<uniform> uMaxLife : f32;
@group(0) @binding(6) var<uniform> uSeed : f32;

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x + global_id.y * 100u;
    if (index >= 30000u) { return; }

    let randX = hash(vec2(f32(global_id.x) + uSeed, f32(global_id.y)));
    let randY = hash(vec2(f32(global_id.x), f32(global_id.y) + uSeed));
    let randZ = hash(vec2(f32(global_id.x) + uSeed * 0.7, f32(global_id.y) + uSeed * 1.3));

    let layer = index / 10000u; // 分为 0, 1, 2 三层
    let layerZ = 0.48 + f32(layer) * 0.02; // 保持紧凑的受力层
    
    // 为不同层提供 X, Y 方向的初始位置偏移量，模拟“重影”般的层级感
    var layerOffset = vec2<f32>(0.0);
    if (layer == 0u) {
        layerOffset = vec2<f32>(-0.005, -0.005); // 底层偏左下
    } else if (layer == 2u) {
        layerOffset = vec2<f32>(0.005, 0.005);   // 顶层偏右上
    }

    let base = index * 3u;
    pos_out[base]       = uSpawnPos.x + (randX - 0.5) * uRadius * 2.0 + layerOffset.x;
    pos_out[base + 1u]  = uSpawnPos.y + (randY - 0.5) * uRadius * 2.0 + layerOffset.y;
    pos_out[base + 2u]  = layerZ + (randZ - 0.5) * 0.02;
    life[index] = uMaxLife;

    // 基础渐变色计算
    let colorLeft = vec3<f32>(1.0, 0.5, 0.0); // 橙色
    let colorRight = vec3<f32>(0.1, 0.5, 1.0); // 蓝色
    var birthColor = mix(colorLeft, colorRight, randX);

    // 强化基于 Z 轴层的色散偏移 (Chromatic Aberration Effect)
    if (layer == 0u) {
        birthColor += vec3<f32>(-0.12, 0.0, 0.2); // 底层更明显的冷色偏移
    } else if (layer == 2u) {
        birthColor += vec3<f32>(0.2, 0.0, -0.12); // 顶层更明显的暖色偏移
    }
    
    color_out[base]      = birthColor.r;
    color_out[base + 1u] = birthColor.g;
    color_out[base + 2u] = birthColor.b;
}
`

/// PARTICLE UPDATE SHADER (stride-3) ///

const particleUpdateShader = /* wgsl */`
${STRUCT_GRID_SIZE}

@group(0) @binding(0) var<storage, read> pos_in : array<f32>;
@group(0) @binding(1) var<storage, read_write> pos_out : array<f32>;
@group(0) @binding(2) var<storage, read_write> life : array<f32>;
@group(0) @binding(3) var<storage, read> vel : array<f32>;
@group(0) @binding(4) var<uniform> uGrid : GridSize;
@group(0) @binding(5) var<uniform> uDt : f32;
@group(0) @binding(6) var<uniform> uSpeed : f32;

fn ID(x: f32, y: f32, z: f32) -> u32 {
  return u32(x + y * uGrid.w + z * uGrid.w * uGrid.h);
}

fn loadVel(idx: u32) -> vec3<f32> {
  let b = idx * 3u;
  return vec3(vel[b], vel[b + 1u], vel[b + 2u]);
}

fn trilerpVel(px: f32, py: f32, pz: f32) -> vec3<f32> {
  var x = px * uGrid.w;
  var y = py * uGrid.h;
  var z = pz * uGrid.d;

  x = clamp(x, 0.0, uGrid.w - 1.001);
  y = clamp(y, 0.0, uGrid.h - 1.001);
  z = clamp(z, 0.0, uGrid.d - 1.001);

  let x1 = floor(x); let x2 = x1 + 1.0;
  let y1 = floor(y); let y2 = y1 + 1.0;
  let z1 = floor(z); let z2 = z1 + 1.0;

  let tx = fract(x); let ty = fract(y); let tz = fract(z);

  let c000 = loadVel(ID(x1, y1, z1));
  let c100 = loadVel(ID(x2, y1, z1));
  let c010 = loadVel(ID(x1, y2, z1));
  let c110 = loadVel(ID(x2, y2, z1));
  let c001 = loadVel(ID(x1, y1, z2));
  let c101 = loadVel(ID(x2, y1, z2));
  let c011 = loadVel(ID(x1, y2, z2));
  let c111 = loadVel(ID(x2, y2, z2));

  let c00 = mix(c000, c100, tx);
  let c01 = mix(c001, c101, tx);
  let c10 = mix(c010, c110, tx);
  let c11 = mix(c011, c111, tx);
  let c0 = mix(c00, c10, ty);
  let c1 = mix(c01, c11, ty);

  return mix(c0, c1, tz);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x + global_id.y * 100u;
    if (index >= 30000u) { return; }

    let currentLife = life[index];
    let base = index * 3u;

    if (currentLife <= 0.0) {
        pos_out[base]      = pos_in[base];
        pos_out[base + 1u] = pos_in[base + 1u];
        pos_out[base + 2u] = pos_in[base + 2u];
        life[index] = -1.0;
        return;
    }

    let px = pos_in[base];
    let py = pos_in[base + 1u];
    let pz = pos_in[base + 2u];
    let v = trilerpVel(px, py, pz);

    var newX = px + v.x * uDt * uGrid.rdx * uSpeed;
    var newY = py + v.y * uDt * uGrid.rdx * uSpeed;
    var newZ = pz + v.z * uDt * uGrid.rdx * uSpeed;

    newX = clamp(newX, 0.0, 1.0);
    newY = clamp(newY, 0.0, 1.0);
    newZ = clamp(newZ, 0.0, 1.0);

    pos_out[base]      = newX;
    pos_out[base + 1u] = newY;
    pos_out[base + 2u] = newZ;
    life[index] = currentLife - uDt;
}
`

/// PARTICLE RENDER SHADER (stride-3 positions) ///

const particleRenderShader = /* wgsl */`
struct ParticleVertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) uv : vec2<f32>,
  @location(2) depth : f32,
}

struct FragmentOutput {
  @location(0) color : vec4<f32>,
  @location(1) depth : f32,
}

struct Uniforms {
  mvp : mat4x4<f32>,
  particleSize : f32,
  maxLife : f32,
  screenWidth : f32,
  screenHeight : f32,
  baseAlpha : f32,
  projectionScale : f32,
  dofEnabled : f32,
  dofFocalDepth : f32,
  dofFocalRange : f32,
  dofMaxBlurRadius : f32,
  pad1 : f32,
  pad2 : f32,
}

@group(0) @binding(0) var<storage, read> positions : array<f32>;
@group(0) @binding(1) var<storage, read> life : array<f32>;
@group(0) @binding(2) var<storage, read> colors : array<f32>;
@group(0) @binding(3) var<uniform> uUniforms : Uniforms;

@vertex
fn vertex_main(
  @location(0) vertexOffset : vec2<f32>,
  @builtin(instance_index) instanceIndex : u32
) -> ParticleVertexOut {
    let base = instanceIndex * 3u;
    let x = positions[base];
    let y = positions[base + 1u];
    let z = positions[base + 2u];
    let l = life[instanceIndex];

    var out: ParticleVertexOut;

    if (l <= 0.0) {
        out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
        out.color = vec4<f32>(0.0);
        out.uv = vec2<f32>(0.0);
        out.depth = 1.0;
        return out;
    }

    let pos = vec3<f32>(x, y, z);
    let mvp_pos = uUniforms.mvp * vec4<f32>(pos, 1.0);

    // Calculate aspect ratio and projection scales
    let aspect = uUniforms.screenWidth / uUniforms.screenHeight;
    let proj_0_0 = uUniforms.projectionScale / aspect;
    let proj_1_1 = uUniforms.projectionScale;
    
    // -- Vertex Scale DoF (Sprite-based DoF) --
    let normDepth = mvp_pos.w / 10.0;
    var coc = 0.0;
    if (uUniforms.dofEnabled > 0.0 && uUniforms.dofMaxBlurRadius > 0.0) {
        coc = clamp(abs(normDepth - uUniforms.dofFocalDepth) / uUniforms.dofFocalRange, 0.0, 1.0);
    }
    
    // Calculate the physical screen size of the particle in NDC before blur
    let ndc_size_y = (uUniforms.particleSize * proj_1_1) / max(mvp_pos.w, 0.0001);
    // Convert blur radius (pixels) to NDC blur radius
    let ndc_blur_radius_y = (coc * uUniforms.dofMaxBlurRadius * 2.0) / uUniforms.screenHeight;
    // Scale factor to accommodate the blur radius
    let blurScale = 1.0 + (ndc_blur_radius_y / max(ndc_size_y, 0.0001));

    // Add billboard offset scaled by the projection parameters to respect FOV and aspect ratio.
    // The GPU automatically divides out.position by out.position.w (mvp_pos.w) during perspective division.
    out.position = mvp_pos + vec4<f32>(
        vertexOffset.x * uUniforms.particleSize * proj_0_0 * blurScale,
        vertexOffset.y * uUniforms.particleSize * proj_1_1 * blurScale,
        0.0,
        0.0
    );

    // 自动尺寸不透明度补偿
    let sizeCompensation = min(0.02 / max(uUniforms.particleSize, 0.001), 1.0);
    let lifeRatio = l / uUniforms.maxLife;
    let baseAlpha = clamp(pow(lifeRatio, 2.0) * uUniforms.baseAlpha * sizeCompensation, 0.0, 1.0);
    
    // 能量守恒：防止过度衰减导致 8-bit 颜色缓冲区发生精度截断偏色
    // 改为较温和的线性衰减，让散景既能保留颜色，又具备更强的发光感
    let alpha = baseAlpha / max(blurScale * 0.8, 1.0);
    
    // 从持久化颜色缓冲区读取出生颜色
    let birthColor = vec3<f32>(colors[base], colors[base + 1u], colors[base + 2u]);
    out.color = vec4<f32>(birthColor, alpha);
    out.uv = vertexOffset;
    out.depth = mvp_pos.w / 10.0; // 归一化深度值

    return out;
}

@fragment
fn fragment_main(fragData : ParticleVertexOut) -> FragmentOutput {
    let dist = length(fragData.uv);

    if (dist > 1.0) {
        discard;
    }

    let distAlpha = 1.0 - smoothstep(0.7, 1.0, dist);
    let finalAlpha = fragData.color.a * distAlpha;
    
    var output : FragmentOutput;
    output.color = vec4<f32>(fragData.color.rgb * finalAlpha, finalAlpha);
    
    // 将深度写入范围从 0.5 扩大到 0.9，使深度边缘与粒子的实际视觉边缘高度贴合，
    // 从而彻底消除因边缘像素被误判为背景而产生的黑边（景深光晕空洞）。
    if (dist <= 0.9) {
        output.depth = fragData.depth;
    } else {
        output.depth = 1.0;
    }
    
    return output;
}
`
