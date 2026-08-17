#ifndef PE_SYSTEM_H
#define PE_SYSTEM_H
// M7 system (orchestrator): 3D torus convergence effect. Owns pool + emitters
// + updater + renderers + camera. Single global instance for the C ABI.
#include "pool.h"
#include "rng.h"
#include "emitter.h"
#include "updater.h"
#include "renderer.h"

namespace pe {

constexpr uint32_t MAX_EMITTERS = 8;

struct Camera {
    // zero-default NSDMI => g_system stays .bss (small wasm); set in Init.
    float yaw = 0.0f, pitch = 0.0f, dist = 0.0f, focal = 0.0f;
    float S = 0.0f, cx = 0.0f, cy = 0.0f;
    float camW = 0.0f, camH = 0.0f;     // for screen culling
};

struct ParticleSystem {
    ParticlePool    pool;
    RNG             rng;
    Emitter         emitters[MAX_EMITTERS];
    uint32_t        emitterCount = 0;
    SpriteRenderer  spriteRenderer;
    MeshRenderer    meshRenderer;
    ParticleUpdater updater;
    float           simTime = 0.0f;
    Camera          camera;

    void Init(uint32_t cap, uint16_t w, uint16_t h) {
        pool.Init(cap); pool.Clear();
        simTime = 0.0f; emitterCount = 0;
        rng = RNG(0xC0FFEE11u);
        camera.cx = w * 0.5f; camera.cy = h * 0.5f;
        camera.camW = w; camera.camH = h;
        camera.yaw = 0.6f; camera.pitch = 0.5f; camera.dist = 600.0f;
        camera.focal = 400.0f; camera.S = 1.0f;
        SetupEmitters(w, h);
    }
    void Reset() {
        pool.Clear();
        for (uint32_t e=0; e<emitterCount; ++e) {
            emitters[e].spawnNum=0.0f; emitters[e].finished=false; emitters[e].countSoFar=0.0f;
        }
        simTime = 0.0f;
    }
    uint32_t Step(float dt) {
        if (dt > CLAMP_DT_S) dt = CLAMP_DT_S;
        for (uint32_t e=0; e<emitterCount; ++e) emitters[e].Emit(pool, rng, dt);
        updater.UpdateBatch(pool, dt, simTime, 0, pool.activeCount);
        simTime += dt;
        return pool.Compact();
    }
    uint32_t ActiveCount() const { return pool.activeCount; }

    void SetupEmitters(uint16_t /*w*/, uint16_t /*h*/) {
        auto base = [&](EmitterConfig& e, int r0,int g0,int b0, int r1,int g1,int b1, float rate) {
            e.R=180.0f; e.r=60.0f; e.spawnRadius=700.0f;
            e.k=12.0f; e.c=7.0f; e.driftRate=0.0f;        // ~critical (2√12≈6.9) + snap
            e.scaleMin=0.5f; e.scaleMax=1.0f; e.lifeMin=4.0f; e.lifeMax=8.0f; e.particleRadius=2.0f;
            e.colR0=r0; e.colG0=g0; e.colB0=b0; e.colA0=255;  // start
            e.colR1=r1; e.colG1=g1; e.colB1=b1; e.colA1=255;  // end
            e.emitRate=rate;
        };
        EmitterConfig e0; base(e0, 255,40,200,  40,200,255, 220.0f);  // magenta -> cyan
        emitters[0] = {e0, 0.0f, 0u, false, 0.0f};
        EmitterConfig e1; base(e1, 255,220,40, 180,40,255, 220.0f);  // yellow -> purple
        emitters[1] = {e1, 0.0f, 1u, false, 0.0f};
        EmitterConfig e2; base(e2, 80,255,120, 255,140,40, 220.0f);  // green -> orange
        emitters[2] = {e2, 0.0f, 2u, false, 0.0f};
        emitterCount = 3;
        updater.k = 12.0f; updater.c = 7.0f;
    }
};

} // namespace pe
#endif
