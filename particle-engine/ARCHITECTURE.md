# 粒子引擎模块化设计文档

> 对应参考设计：`../graphic_graphic_2d/particle_animation_performance_redesign.md`（Rosen 粒子动画性能重构 v2.6）
> 本文档定义本 demo（C++/WASM + CanvasKit）的模块划分、接口、边界与迁移路径。

---

## 1. 背景与目标

本 demo 将文档的 SoA 粒子池架构以 **freestanding C++ → WASM** 形式实现，由 JS bridge 接入 CanvasKit 的 `drawAtlas` / `drawVertices` 渲染。

目标：
- 把当前"单文件、struct + 静态方法 + 全局状态"的代码，重构为**职责清晰的模块**。
- 对齐业界粒子系统实践（Unreal Niagara / Unity VFX Graph / ECS）的 Spawn-Update-Render 三阶段、数据所有者独占 SoA、Update 单 pass 融合。
- 在 freestanding 单线程 wasm 的硬约束下，**避免过度设计**（不做 ECS/并行/多实例）。

非目标：
- 不重写为 ECS/World。
- 不引入多线程（wasm 单线程，FFRT/ pthread 不可达）。
- 不拆分为大量编译单元（构建胶水无收益）。

---

## 2. 现状问题（review 结论）

| 问题 | 现状位置 | 类型 |
|---|---|---|
| 渲染缓冲归属越界：draw 缓冲挂在数据存储里 | `particle-engine.cpp:163` `g_pool.draw` | 边界 |
| 死缓冲：`vertColors`(uint32) / `vertIdx`(uint16) 已不被 bridge 使用 | `:171` / `:173` | 死代码 |
| `accelValue` 不随时间更新（no-op 行引用错误数组） | `:368` `+= opacitySpeed*0.0f` | 残留 |
| `visible` 屏幕剔除缺失（恒为 1，`if(visible)` 是恒真死分支） | `:309` / `:373` | 缺失（保留 hook） |
| 全局可变状态 `g_pool/g_rng/g_simTime/g_emitters` | `:183/:102/:282` | 阻多实例/并行 |
| `ck_step` 融合 Emit+Update+Sweep | `:588` | 阶段无独立接缝 |
| 命名：仿真模块带 `Render` 前缀、`Effector` 非标准 | `RSRenderParticleEmitter/Effector` | 命名 |

**约束下不可达（明确排除）**：并行化（无线程）、多实例（无需求）、ECS（规模过重）。

---

## 3. 模块划分

### 3.1 模块清单

| ID | 模块 | 职责 | 拥有（状态） | 边界（不做） |
|---|---|---|---|---|
| M0 | **types** | POD 与枚举：`Vector2f`、`ColorQuad` 打包/解包、`ParticleType`/`UpdateMode`/`DistributionType`、`RandomDataFlags` | 无 | 除打包外无逻辑 |
| M1 | **rng** | `ParticleRNG`：Uniform/Gaussian | RNG 引擎状态 | 不碰粒子数据 |
| M2 | **pool** | 数据所有者：SoA 存储 + 生命周期 | `ParticleData`、capacity、activeCount、freeList | 不做仿真、**不持渲染缓冲** |
| M3 | **field** | 力场：`ForceField` 接口 + `CurlNoiseForce` + `FieldCollection` | 场参数、ripple lifeTime | 不积分位置 |
| M4 | **emitter**（Spawn） | 发射：Acquire + InitParticleInPool（写全字段） | `EmitterConfig`、spawnNum、finished、countSoFar、idx | 不积分、不渲染 |
| M5 | **updater**（Update，单 pass） | 积分+属性+即时死亡，`[start,end)` 区间 | `SimContext`（含 infiniteLife） | 不发射、不分配、不渲染 |
| M6 | **renderer**（Render） | 建绘制缓冲 + draw | **自己的**瞬态 draw 缓冲 | 只读 Pool（const） |
| M7 | **system** | 编排：Step/Render/Reset | Pool、Emitters[]、FieldCollection、Renderer* | 不做逐粒子数学 |
| M8 | **exports** | C ABI `ck_*`，薄封装一个 System 实例 | （可选）单全局句柄 | 无业务逻辑 |

### 3.2 接口（签名级）

```
M2 pool:     Acquire()->idx | Compact()->count | MoveSlot(d,s) | Grow(min) | Clear()
             Data()->ParticleData& | ActiveCount() | Capacity()
M3 field:    ForceField.Apply(pos,t)->force | Update(dt)
             FieldCollection.Add(f) | ApplyAll(pos,t)->force | UpdateAll(dt)
M4 emitter:  Emit(pool, rng, dt)
M5 updater:  UpdateBatch(pool, fields, cfg, dt, start, end)
             UpdateParticle(pool, idx, cfg, fields, dt, t)   // 单 pass 融合
M6 renderer: ParticleRenderer.Render(canvas, pool, atlasImg, paint)
             QuadBuilder.BuildQuad(...)                      // 共享 SoA→四角顶点/RSXform 变换
             ├ SpriteRenderer  (drawAtlas + Malloc 零拷贝)
             └ MeshRenderer           (drawVertices + 普通 view, 批量)
M7 system:   Step(dt) | Render(canvas) | Reset() | ActiveCount() | IsFinished()
M8 exports:  ck_init / ck_step / ck_reset / ck_build_atlas / ck_build_vertices / ptr getters
```

### 3.3 依赖 DAG（无环）

```
types ◀── rng, pool, field
              ├── emitter(pool, rng)        ┐
              ├── updater(pool, field)      ├─ system ── exports
              └── renderer(pool)            ┘
```

**sim（emitter/updater）与 renderer 互不依赖**，都只向下依赖 pool+types。可独立编译与单测。

---

## 4. 数据归属

| 数据 | 归属 | 现状 | 修正 |
|---|---|---|---|
| 粒子 SoA（pos/vel/color…） | **pool** | ✅ | — |
| 绘制缓冲（atlasRsx/vertPos…） | **renderer** | ❌ 现挂 `g_pool.draw`（`:163`） | **移出 pool，归 renderer 私有** |
| 死缓冲 vertColors/vertIdx | — | `:171`/`:173` | 删（renderer 用 vertColorsF + bridge 的 JS idxPattern） |

> **关键边界修正**：渲染缓冲当前住在数据存储里，违反"pool 不持渲染态"。模块化后必须归 renderer。

---

## 5. 每帧管线

```
Step(dt):
  for e in emitters: e.Emit(pool, rng, dt)              // Spawn
  fields.UpdateAll(dt)                                   // 场状态（ripple 等，串行）
  updater.UpdateBatch(pool, fields, cfg, dt, 0, N)       // Update（单 pass；[start,end) 留并行接缝）
  pool.Compact()                                       // Compact（尾部修剪 + swap-and-pop）

Render(canvas):
  renderer.Render(canvas, pool, atlas, paint)           // 建缓冲 + draw
```

> Update 保持**单 pass 融合**（积分+属性+死亡同一粒子一次读写），对齐 Niagara Update 模块栈/VFX Graph Block。不拆为多趟循环（会回归 cache 局部性）。

---

## 6. 文件布局

```
particle-engine/
  types.h          rng.h
  pool.h / pool.cpp
  field.h / field.cpp
  emitter.h / emitter.cpp
  updater.h / updater.cpp
  renderer.h / renderer.cpp     (接口 + QuadBuilder + SpriteAtlas/Mesh 两实现)
  system.h / system.cpp
  exports.cpp                   (ck_*)
  particle-bridge.js           (不变)
  build.sh
```

---

## 7. 命名规范

| 概念 | 旧 | 新 | 理由 |
|---|---|---|---|
| 生成 | `RSRenderParticleEmitter` | `ParticleEmitter` | 去误导性 `Render` 前缀（仿真非渲染） |
| 更新 | `RSRenderParticleEffector` | `ParticleUpdater` | `Effector` 非标准且语义偏窄 |
| 力场 | (内联) | `ForceField` / `CurlNoiseForce` | 提为一等（接口 seam 保留异质场扩展点） |
| 渲染 | `RSParticlesDrawable` | `ParticleRenderer` + `SpriteRenderer`/`MeshRenderer` | render-type 为一等可插拔轴 |
| 引用 | `ParticleSoARef` | `ParticleRange` | 语义更准 |
| 池 | `SweepDead` | `Compact` | 业界亦用 Compact/ReapDead |

### 7.1 业界对照（命名合理性）

| 命名 | 业界对应 | 状态 |
|---|---|---|
| `ParticleEmitter` / `Emit` | Niagara `UNiagaraEmitter`、Unity/Godot `Emitter` | ✅ 一致 |
| `ParticleSystem` | Niagara `UNiagaraSystem`、Unity `ParticleSystem` | ✅ 一致 |
| `ParticleRenderer` + `SpriteRenderer`/`MeshRenderer` | Niagara `UNiagaraRendererSprite/Mesh` | ✅ 一致 |
| `ForceField` / `CurlNoiseForce` | Unity Shuriken `ForceField`、Niagara `Curl Noise Force` | ✅ 一致 |
| Spawn / Update / Render 三阶段 | Niagara/VFX Graph 通用 | ✅ 一致 |
| `ParticleRange` | ECS `EntityRange`/Niagara 索引区 | ✅ 一致 |
| `ParticlePool` / `Acquire` | 对象池通用术语（Unity `ObjectPool`） | ✅ 可接受 |
| `ParticleData`（旧 `ParticleSoA`） | Niagara 不把布局写进类型名 | ✅ 已修正（避免 SoA 泄漏到类型名） |

**Rosen-ism（偏离业界，demo 内保留）**：`ParticleType{POINTS, IMAGES}` 每粒子类型枚举。业界（Niagara）做法是渲染类型由 **renderer 模块**决定（Sprite/Ribbon/Mesh），图片选择是每粒子 `imageIndex` + atlas slot，而非 POINTS/IMAGES 枚举。本设计已把 render-type 提到 `ParticleRenderer` 接口层（对齐），故该枚举语义与 renderer 重叠——demo 范围保留，未来 IMAGES 应改为"每粒子 imageIndex + SpriteRenderer atlas slot"。

---

## 8. 渲染可插拔

`system` 持 `ParticleRenderer*`，运行期可换：
- `SpriteRenderer`：`drawAtlas` + `CanvasKit.Malloc` 零拷贝（**快路径**，已实测有效）。
- `MeshRenderer`：`drawVertices` + 普通 typed-array view，分批提交（受 CanvasKit 0.41.1 `MakeVertices` 不接受 MallocObj positions 的限制）。

两条路径**共同变换数学**（SoA→四角顶点 / RSXform / color）抽到 `QuadBuilder` 复用，避免重复（解 review R3）。

---

## 9. 约束与取舍

**freestanding 单线程 wasm** 决定以下取舍：
- 无 libc → 自实现 `fsin/fcos`，`sqrtf/floorf` 走 LLVM 原生。
- 无线程 → `[start,end)` 接缝保留但不启用并行（为未来真机 Rosen 预留）。
- 单全局 System → 不做 handle/多实例 ABI（YAGNI）。
- 数据跨 wasm 实例 → drawAtlas 走 `Malloc` 零拷贝；drawVertices 受 `MakeVertices` 限制走普通 view（结构性较慢，已实测）。

**明确排除（防过度设计）**：
- ECS/World/Registry。
- 细 sim 模块栈各自循环（违反单 pass 融合）。
- renderer 多类无共享（用 QuadBuilder 复用）。
- 多文件过度拆分（控制在 9 个文件内）。

---

## 10. 迁移清单（现有 → 模块）

| 现有代码 | 迁至 | 备注 |
|---|---|---|
| `PACK_ARGB`/`clamp255`/`clampf` (`:38-45`) | M0 types | — |
| `RNG` (`:82-102`) | M1 rng | — |
| `ParticleData` (`:136-160`) | M2 pool | 数据定义 |
| `RSParticlePool` Acquire/SweepDead/MoveSlot (`:188-248`) | M2 pool 方法 | 去静态、操作实例 |
| `g_pool` (`:183`) | M7 system 成员 | 去全局 |
| `Field`/`ApplyField` (`:254-266`) | M3 field | 提接口 + CurlNoiseForce |
| `Emitter`/`InitParticleInPool`/`EmitParticle` (`:271-358`) | M4 emitter | 去自由函数、升方法 |
| `UpdateParticleSoA`/`UpdateBatch`(`:363`) | M5 updater | 保留单 pass；删 `:368` no-op |
| `BuildAtlasBuffers`/`BuildVerticesBuffers` (`:437-513`) | M6 renderer | **DrawBuffers 从 pool 移入 renderer**；删死缓冲 vertColors/vertIdx |
| `SetupDefaultEmitters` (`:518`) | M7 system | 配置数据 |
| `ck_*` exports (`:564-619`) | M8 exports | 调 system；`ck_step` 内部仍可融合三阶段（ABI 不变） |

**ABI 决策**：保留现有 `ck_*` 签名（bridge 零改动），模块化为**内部重构**。仅当未来需多实例时才引入 `ck_create_system()` 句柄 API。

**新增跨模块接口**：
- `ParticleRenderer::Render(canvas, pool, atlas, paint)` —— system→renderer。
- `ParticleUpdater::UpdateBatch(pool, fields, cfg, start, end)` —— system→updater（保留并行 seam）。
- `ForceField::Apply/Update` —— updater→field（解耦力场）。

---

## 11. 验收标准

- [ ] pool 不再持有渲染缓冲（`DrawBuffers` 移入 renderer）。
- [ ] 删除死缓冲 `vertColors` / `vertIdx` 及其导出 `ck_vert_colors_ptr` / `ck_vert_idx_ptr`。
- [ ] 删除 `:368` no-op 行，加速度常量化并注释。
- [ ] 仿真模块无 `Render` 前缀；`Effector`→`Updater`。
- [ ] `ParticleRenderer` 接口 + 两实现，共享 `QuadBuilder`。
- [ ] bridge 零改动，渲染行为不变（drawAtlas 8384 墨水像素基线、drawVertices 分批渲染不变）。
- [ ] 依赖无环：sim ↔ renderer 互不依赖。
