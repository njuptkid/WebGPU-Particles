#ifndef PE_EMITTER_H
#define PE_EMITTER_H
// M4 emitter (Spawn): 3D radial spawn (along target direction) + torus target.
// Radial spawn => convergence path does not cross the torus hole.
#include "pool.h"
#include "rng.h"

namespace pe {

struct EmitterConfig {
    float R, r;              // torus major / minor radius
    float spawnRadius;      // far-field spawn sphere radius
    float k, c, driftRate;  // spring k, damping c, ring drift (rad/s)
    float scaleMin, scaleMax, lifeMin, lifeMax, particleRadius;
    int   colR0, colG0, colB0, colA0;   // start color
    int   colR1, colG1, colB1, colA1;   // end color (lifecycle lerp)
    float emitRate;
};

struct Emitter {
    EmitterConfig cfg;
    float   spawnNum = 0.0f;
    uint32_t idx = 0;
    bool    finished = false;
    float   countSoFar = 0.0f;

    void Emit(ParticlePool& pool, RNG& rng, float dt) {
        if (finished) return;
        spawnNum += cfg.emitRate * dt;
        while (spawnNum >= 1.0f) {
            if (countSoFar + 1.0f >= (float)pool.capacity) { spawnNum = 0.0f; finished = true; break; }
            uint32_t i = pool.Acquire();
            if (i == ParticlePool::INVALID) { spawnNum = 0.0f; break; }
            InitParticleInPool(pool, i, cfg, idx, rng);
            spawnNum -= 1.0f;
            countSoFar += 1.0f;
        }
    }
    static void InitParticleInPool(ParticlePool& pool, uint32_t i,
                                   const EmitterConfig& c, uint32_t emIdx, RNG& rng) {
        ParticleData& d = pool.data;
        // torus target: P(u,v) = ((R + r cos v) cos u, (R + r cos v) sin u, r sin v)
        float u  = rng.range(0.0f, TAU_F);
        float v  = rng.range(0.0f, TAU_F);
        float cv = fcos(v), sv = fsin(v), cu = fcos(u), su = fsin(u);
        float Rcr = c.R + c.r * cv;
        d.targetx[i] = Rcr * cu;
        d.targety[i] = Rcr * su;
        d.targetz[i] = c.r * sv;
        // spawn radially outward along the target direction (far) -> the
        // convergence path is radial inward to the ring point (no hole crossing).
        float tl2 = d.targetx[i]*d.targetx[i] + d.targety[i]*d.targety[i] + d.targetz[i]*d.targetz[i];
        float tinv = (tl2 > 1e-6f) ? (1.0f / fsqrtf(tl2)) : 0.0f;
        d.posx[i] = d.targetx[i] * tinv * c.spawnRadius;
        d.posy[i] = d.targety[i] * tinv * c.spawnRadius;
        d.posz[i] = d.targetz[i] * tinv * c.spawnRadius;
        d.velx[i] = 0.0f; d.vely[i] = 0.0f; d.velz[i] = 0.0f;
        // visual
        d.scale[i]   = rng.range(c.scaleMin, c.scaleMax);
        d.opacity[i] = 1.0f;
        d.radius[i]  = c.particleRadius;
        d.lifeT[i]   = rng.range(c.lifeMin, c.lifeMax);
        d.activeT[i] = 0.0f;
        d.emitterIdx[i] = emIdx;
        d.visible[i] = 1;
        d.alive[i]   = 1;
        // lifecycle color: colorF = start channel, colorSpeed = end - start
        int R0=clamp255(c.colR0), G0=clamp255(c.colG0), B0=clamp255(c.colB0), A0=clamp255(c.colA0);
        int R1=clamp255(c.colR1), G1=clamp255(c.colG1), B1=clamp255(c.colB1), A1=clamp255(c.colA1);
        d.colorF[4*i+0]=(float)R0; d.colorF[4*i+1]=(float)G0; d.colorF[4*i+2]=(float)B0; d.colorF[4*i+3]=(float)A0;
        d.colorSpeed[4*i+0]=(float)(R1-R0); d.colorSpeed[4*i+1]=(float)(G1-G0);
        d.colorSpeed[4*i+2]=(float)(B1-B0); d.colorSpeed[4*i+3]=(float)(A1-A0);
        d.color[i] = PACK_ARGB(A0, R0, G0, B0);
    }
};

} // namespace pe
#endif
