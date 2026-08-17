# 3D 甜甜圈粒子 demo 设计

> 扩展 `particle-engine` 的 2D 架构到 2.5D：3D 仿真 + 2D 投影绘制。
> 目标：粒子从远处汇聚到立体甜甜圈（torus）曲面，camera/transform 可调产生 3D 视角。

---

## 1. 核心策略：2.5D billboard

CanvasKit 是 2D 画布（`drawAtlas`/`drawVertices` 无 3D 管线、无深度缓冲、无 mesh）。
→ 真正的 3D 渲染不可能。采用业界标准 **2.5D billboard**：
- C++ 里做 **3D 仿真**（pos/vel 含 z + 收敛力）；
- renderer 里做 **3D→2D 投影**（旋转 + 透视），输出屏幕坐标 + 深度；
- 按深度算 **size/alpha**，画 2D sprite。
- bridge 与 CanvasKit 调用**零改动**——3D 投影是 renderer 内部细节，模块边界天然吸收。

---

## 2. 数学（全部 freestanding 可实现，仅需 +,*,/ 与已修好的 fsin/fcos）

### 2.1 Torus 目标点（每粒子固定 (u,v)）
```
target.x = (R + r·cos v)·cos u
target.y = (R + r·cos v)·sin u
target.z = r·sin v
```
- 环在 XY 平面，管延伸到 Z；从 +Z 看是圆环，pitch 转动看立体。
- R=主半径（环中心到管中心），r=管半径。
- (u,v) 在发射时随机分配（或分层采样使分布均匀）。

### 2.2 收敛动力学（阻尼弹簧）
```
F = k·(target - pos) - c·vel       // 弹簧拉向 target + 阻尼
vel += F·dt
pos += vel·dt
```
- 过阻尼（c 大）平滑汇聚；欠阻尼（c 小）带抖动收尾。
- 可选 ring drift：`u += driftRate·dt` → 重算 target，粒子沿环滑动，环"活"。

### 2.3 世界→相机（轨道相机，等价于旋转 torus）
```
Rx(pitch) = [[1,0,0],[0,cos p,-sin p],[0,sin p,cos p]]
Ry(yaw)   = [[cos y,0,sin y],[0,1,0],[-sin y,0,cos y]]
R = Ry(yaw)·Rx(pitch)
p_rot = R · p
```
- yaw/pitch 是相机轨道角；dist 是相机沿 Z 离原点距离。

### 2.4 透视投影（+ 深度）
```
depth = p_rot.z + dist                      // 相机空间 z；dist > torus 尺度 ⇒ depth>0
sx = cx + (p_rot.x · f / depth) · S         // 屏幕中心 cx + 透视
sy = cy - (p_rot.y · f / depth) · S         // y 翻转
spriteScreenSize = f · (particleRadius·scale) · S / depth   // 近大远小
```
- f=焦距（FOV），S=屏幕缩放，cx,cy=画布中心。
- depth 防 0：`if (depth < eps) depth = eps;`（dist 取大即可规避）。
- 备选正交（无除法）：`sx = cx + p_rot.x·S`，立体感稍弱但无分母风险。

---

## 3. 数据布局扩展（`pool.h` ParticleData）

| 字段 | 现 | 改 |
|---|---|---|
| `pos` | `[2N]` x,y | **`[3N]`** x,y,z |
| `vel` | `[2N]` | **`[3N]`** |
| `target` | — | **新增 `[3N]`**（torus 目标点，发射时算一次） |
| `tu, tv` | — | （可选）`[N]` 存 u,v，drift 时重算 target |
| `color/colorF/colorSpeed/opacity/scale/spin/lifeT/activeT/alive/visible` | — | 维度无关，**保留不变** |
| 2D 专用 `bounce`、`emitW/H` | — | **删除**（3D 内向汇聚，不碰画布边） |

> SoA 结构本身不限维度；只是把 stride 2→3 + 加 target 数组。MAX_CAPACITY 不变（20000）。

---

## 4. 模块改动

### M4 emitter（`emitter.h`）
- `EmitterConfig` 改 3D：`R, r, spawnRadius`（远场起点球半径）、`k, c`（弹簧/阻尼）、`driftRate`；删 `emitW/H/velAng*`。
- `InitParticleInPool`：
  - 起点：球面随机 `pos = randomDirection() · spawnRadius`（远离 torus）。
  - 速度：小随机或 0（靠弹簧拉过去）。
  - target：分配 `(u,v)` → 算 `target.xyz`（torus 公式）。
  - 颜色：生命周期 lerp（不变），可按 `u` 或 `v` 上色让环有层次。
  - life：随机（已支持）。

### M5 updater（`updater.h`）
- `UpdateParticle` 改 3D：
  - 弹簧 `F = k·(target-pos) - c·vel`；`vel += F·dt; pos += vel·dt`。
  - 可选 ring drift：`u += driftRate·dt; 重算 target`。
  - **删 2D bounce 与 center-pull**。
  - 生命周期颜色 lerp / opacity 淡入淡出：**维度无关，复用**。
  - 死亡检测：复用 lifeT。
- `UpdateBatch` 签名去掉 `cw,ch`（无画布边界），保留 `[start,end)`。

### M6 renderer（`renderer.h`）— 关键改动
- 新增 camera 状态（System 持有，传给 Build）：`yaw, pitch, dist, focal, S, cx, cy`。
- `QuadParamsOf` 改：输入 3D `pos` + `target`（或只 pos）→ 旋转 → 投影 → 屏幕坐标 + depth + size + alpha。
- 输出格式**不变**：仍是 2D `atlasRsx`（screen x,y + size）+ `vertPos`（2D 四角）。
- **深度处理**：
  - size = `focal·radius·S/depth`；
  - alpha = `clamp((depthMax-depth)/(depthMax-depthMin))`（近亮远暗）或恒定 + 加性。
  - **加性混合**（`BlendMode.Plus`/`SrcOver` 亮色）：免排序，发光甜甜圈最省事；或按 depth 排序后画（painter，O(N log N)）。

### M7 system（`system.h`）
- 加 `Camera{ yaw, pitch, dist, focal }` 成员；`Init` 设默认（pitch 略仰视看立体）。
- `Step`：去掉 cw/ch；`UpdateBatch` 改 3D 签名。
- `Render`/Build 传入 camera。

### M8 exports（`exports.cpp`）— 新增可调接口
```
ck_set_camera(float yaw, float pitch, float dist, float focal)
ck_set_torus(float R, float r)
ck_set_dynamics(float k, float c, float driftRate)
```
- bridge 可加滑条/鼠标拖动调 camera（yaw/pitch）。

---

## 5. 每帧管线（3D）

```
Step(dt):
  for e: emitter.Emit(pool, rng, dt)            // 3D 远场起点 + torus target
  updater.UpdateBatch(pool, dt, t, 0, N)         // 弹簧收敛 + 生命周期色/透明度
  pool.Compact()
Build(camera):
  for i in active:
    p_rot = R(yaw,pitch) · pos[i]
    depth = p_rot.z + dist
    sx,sy = project(p_rot, depth)
    size = focal·radius·scale·S/depth
    alpha = byDepth(depth)  (或恒定)
    → 填 atlasRsx/atlasCol (2D)   [加性混合免排序]
Draw(bridge 不变):
  drawAtlas / drawVertices on 2D buffers
```

---

## 6. 深度与混合决策

| 方案 | 排序 | 效果 | 成本 |
|---|---|---|---|
| **加性混合（推荐 v1）** | 不需要 | 发光能量环，立体感强 | 最低 |
| depth 排序 + SrcOver | O(N log N)/帧 | 实体遮挡、可叠色 | 中（N=5000 没问题） |

→ v1 用加性（`BlendMode.Plus`），简单且最像"甜甜圈能量场"；要实体感再加排序。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 透视除 depth≈0 爆炸 | `dist > torus 尺度`；clamp `depth≥eps`；或正交 |
| drawVertices WebGL >1000 单 draw 失效 | 沿用现有分批；或用 drawAtlas（可零拷贝，更稳） |
| MakeVertices 不接受 Malloc positions | drawVertices 走普通 view；优先 drawAtlas |
| 3D 旋转使 fsin/fcos 参数变大 | 已修完整 modulo 归约，任意大参数正确 |
| ring drift 重新算 target 开销 | 每帧 N 次 cos/sin，N=5000 OK；或预存 target、只漂移 u（环转，target 绕 Y 旋转） |
| 粒子穿透 camera（在 camera 后） | depth<0 时剔除或 clamp |

---

## 8. 分阶段实施

| 阶段 | 内容 | 验证 |
|---|---|---|
| A | 数据层 3D（pos/vel/target 3N）+ emitter 远场起点/torus target + updater 弹簧收敛 | Node 读 pos，断言 `\|pos-target\|→0`（粒子汇聚成形） |
| B | renderer 加 camera 旋转 + 透视投影 + depth size/alpha；加性混合 | 浏览器看到立体环，yaw/pitch 转动有 3D |
| C | exports `ck_set_camera/torus/dynamics` + bridge 滑条/拖动调相机；ring drift；调色 | 可交互旋转、环自转 |
| D（可选） | depth 排序 + SrcOver 实体感；多 torus / 粒子拖尾 | 视觉打磨 |

---

## 9. 起步参数（建议）

```
torus: R=180, r=60
particles: ~4000（3 发射器各 ~1300，或单发射器 4000）
spawnRadius: 700（远场起点）
spring: k=8, c=4（稍欠阻尼，带轻微抖动收尾）
driftRate: 0.2 rad/s（环缓慢自转）
camera: yaw=0.6, pitch=0.5, dist=600, focal=400, S=1
blend: additive (Plus)
life: 4-8s（收敛后维持，靠 drift 保持动感；或长寿命让环稳定）
color: 按 v 上色（管截面渐变）或按 u（环周渐变）→ 立体层次
```

---

## 10. 架构契合度结论

- 数据层升 3D（stride 改 + 加 target）：✅ SoA 不限维。
- updater 换收敛力、删 2D bounce：✅ 单 pass 融合不变。
- **renderer 内嵌 3D→2D 投影**：✅ 输出仍是 2D 缓冲，bridge/CanvasKit 零改动——这是架构的正确扩展点。
- camera/torus/dynamics 经新 exports 暴露：✅ ABI 增量。
- freestanding 可实现：3D 数学仅需 +,*,/ 与已修 fsin/fcos，无新 libm。✅

唯一天花板：真 3D mesh（CanvasKit 不支持）——但甜甜圈用 sprite + 投影完全够。

---

## 11. 渲染路径决策：CPU 投影（保留 CanvasKit）

**决策**：3D→2D 投影在 **CPU**（C++/wasm renderer 的 `Build` 步骤）每帧做，**渲染层保留 CanvasKit**（`drawAtlas`/`drawVertices` 只画 2D sprite）。不走 GPU 投影。

### 11.1 为什么 CanvasKit 做不了 GPU 投影
- CanvasKit 对 JS 暴露的是**固定绘制操作**，无可编程顶点阶段、无 instancing（`drawArraysInstanced`）/自定义顶点着色器注入。
- `drawVertices` 的顶点位置即给定的 2D 坐标（已投影），GPU 不再做 3D 变换。
- `RuntimeEffect` 是 **SkSL 片元着色器**（per-pixel），非顶点着色器，且 uniform 有大小限制，喂不下数千粒子的 3D 数据 → 逐粒子投影无法移到 GPU。

### 11.2 GPU 投影的唯一路径与本方案不取
- 要 GPU 投影必须**绕过 CanvasKit**：C++/wasm 只仿真，渲染层换裸 WebGL2/WebGPU 自写顶点着色器（实例化点精灵 / SSBO，投影+size+color 在顶点着色器并行）。可扩展到 10w+，但失去 CK 的 atlas/AA/混合便利，且实现量大。
- 第三条路（自建带 `DrawInstanced` 的 CanvasKit/Skia WASM）需构建 Skia，不现实。
- **本方案明确不取**：要求是用 CanvasKit。

### 11.3 CPU 投影成本确认（非瓶颈）
- 每帧：旋转矩阵 `R` 由 yaw/pitch 算 1 次（camera 全局，非每粒子）。
- 每粒子：`R·p`（~9 乘 6 加）+ 1 透视除 + size/alpha（~20 浮点）。
- N=5000 → ~10w 浮点/帧，wasm 微秒级，**远非瓶颈**。
- 真正开销仍是 JS→CK 数据搬运（drawAtlas 用 `CanvasKit.Malloc` 零拷贝；drawVertices 受 `MakeVertices` 不接受 Malloc positions 限制走普通 view + 分批）。

### 11.4 何时再评估 GPU
当粒子量到 **5w~10w+**，或要做复杂逐顶点效果时，再开裸 WebGL2/WebGPU 渲染分支（仿真留 C++/wasm 或也移 GPU compute）。当前规模不触发。

### 11.5 阶段 A 起步即按 CPU 投影实施
- 阶段 A/B（见 §8）：renderer 的 `Build*` 内嵌 `R·p` + 透视除 + depth size/alpha，输出 2D 缓冲；bridge 与 CanvasKit 调用零改动。

