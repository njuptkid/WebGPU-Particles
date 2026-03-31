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
@group(0) @binding(2) var<uniform> uSpawnPos : vec2<f32>;
@group(0) @binding(3) var<uniform> uRadius : f32;
@group(0) @binding(4) var<uniform> uMaxLife : f32;
@group(0) @binding(5) var<uniform> uSeed : f32;

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x + global_id.y * 100u;
    if (index >= 10000u) { return; }

    let randX = hash(vec2(f32(global_id.x) + uSeed, f32(global_id.y)));
    let randY = hash(vec2(f32(global_id.x), f32(global_id.y) + uSeed));
    let randZ = hash(vec2(f32(global_id.x) + uSeed * 0.7, f32(global_id.y) + uSeed * 1.3));

    let base = index * 3u;
    pos_out[base]       = uSpawnPos.x + (randX - 0.5) * uRadius * 2.0;
    pos_out[base + 1u]  = uSpawnPos.y + (randY - 0.5) * uRadius * 2.0;
    pos_out[base + 2u]  = 0.5 + (randZ - 0.5) * uRadius * 2.0;
    life[index] = uMaxLife;
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
    if (index >= 10000u) { return; }

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
}

struct Uniforms {
  mvp : mat4x4<f32>,
  particleSize : f32,
  maxLife : f32,
  screenWidth : f32,
  screenHeight : f32,
}

@group(0) @binding(0) var<storage, read> positions : array<f32>;
@group(0) @binding(1) var<storage, read> life : array<f32>;
@group(0) @binding(2) var<uniform> uUniforms : Uniforms;

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
        return out;
    }

    let worldPos = vec4<f32>(x - 0.5, y - 0.5, z - 0.5, 1.0);
    let clipPos = uUniforms.mvp * worldPos;
    let w = clipPos.w;
    let screenSize = uUniforms.particleSize * 200.0 / max(w, 0.001);
    let offset = vertexOffset * screenSize / vec2(uUniforms.screenWidth, uUniforms.screenHeight) * 2.0;
    out.position = vec4<f32>(clipPos.x / w + offset.x, clipPos.y / w + offset.y, clipPos.z / w, 1.0);

    let lifeRatio = l / uUniforms.maxLife;
    out.color = vec4<f32>(1.0 - lifeRatio, lifeRatio, 0.0, lifeRatio * 0.8);
    out.uv = vertexOffset;

    return out;
}

@fragment
fn fragment_main(fragData : ParticleVertexOut) -> @location(0) vec4<f32> {
    let dist = length(fragData.uv);

    if (dist > 1.0) {
        discard;
    }

    let alpha = 1.0 - smoothstep(0.7, 1.0, dist);
    return vec4<f32>(fragData.color.rgb, fragData.color.a * alpha);
}
`
