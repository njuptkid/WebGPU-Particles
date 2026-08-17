#ifndef PE_UPDATER_H
#define PE_UPDATER_H
// M5 updater (Update): 3D damped-spring convergence to torus targets.
// Hot path (spring + integrate) is SIMD 4 particles/iter (per-component SoA).
// Lifecycle (color lerp / opacity fade / snap-to-target / death) is scalar.
#include "pool.h"

namespace pe {

struct ParticleUpdater {
    float k = 0.0f;       // spring stiffness (set at Init; zero-default => .bss)
    float c = 0.0f;       // damping

    void UpdateBatch(ParticlePool& pool, float dt, float /*t*/, uint32_t start, uint32_t end) {
        uint32_t i = start;
        const v128_t k4 = wasm_f32x4_splat(k), c4 = wasm_f32x4_splat(c), dt4 = wasm_f32x4_splat(dt);
        uint32_t simdEnd = start + ((end - start) & ~3u);
        for (; i < simdEnd; i += 4) {
            ParticleData& d = pool.data;
            if (!d.alive[i] || !d.alive[i+1] || !d.alive[i+2] || !d.alive[i+3]) {
                for (uint32_t j = i; j < i + 4; ++j) UpdateParticle(pool, j, dt);
                continue;
            }
            v128_t px = wasm_v128_load(&d.posx[i]), py = wasm_v128_load(&d.posy[i]), pz = wasm_v128_load(&d.posz[i]);
            v128_t vx = wasm_v128_load(&d.velx[i]), vy = wasm_v128_load(&d.vely[i]), vz = wasm_v128_load(&d.velz[i]);
            v128_t tx = wasm_v128_load(&d.targetx[i]), ty = wasm_v128_load(&d.targety[i]), tz = wasm_v128_load(&d.targetz[i]);
            // F = k*(target - pos) - c*vel
            v128_t fx = wasm_f32x4_sub(wasm_f32x4_mul(k4, wasm_f32x4_sub(tx, px)), wasm_f32x4_mul(c4, vx));
            v128_t fy = wasm_f32x4_sub(wasm_f32x4_mul(k4, wasm_f32x4_sub(ty, py)), wasm_f32x4_mul(c4, vy));
            v128_t fz = wasm_f32x4_sub(wasm_f32x4_mul(k4, wasm_f32x4_sub(tz, pz)), wasm_f32x4_mul(c4, vz));
            // vel += F*dt;  pos += vel*dt
            vx = wasm_f32x4_add(vx, wasm_f32x4_mul(fx, dt4));
            vy = wasm_f32x4_add(vy, wasm_f32x4_mul(fy, dt4));
            vz = wasm_f32x4_add(vz, wasm_f32x4_mul(fz, dt4));
            px = wasm_f32x4_add(px, wasm_f32x4_mul(vx, dt4));
            py = wasm_f32x4_add(py, wasm_f32x4_mul(vy, dt4));
            pz = wasm_f32x4_add(pz, wasm_f32x4_mul(vz, dt4));
            wasm_v128_store(&d.velx[i], vx); wasm_v128_store(&d.vely[i], vy); wasm_v128_store(&d.velz[i], vz);
            wasm_v128_store(&d.posx[i], px); wasm_v128_store(&d.posy[i], py); wasm_v128_store(&d.posz[i], pz);
            Lifecycle(pool, i, dt);   Lifecycle(pool, i+1, dt);
            Lifecycle(pool, i+2, dt); Lifecycle(pool, i+3, dt);
        }
        for (; i < end; ++i) UpdateParticle(pool, i, dt);
    }

    // scalar spring + lifecycle (tail / dead groups)
    void UpdateParticle(ParticlePool& pool, uint32_t i, float dt) {
        ParticleData& d = pool.data;
        if (!d.alive[i]) return;
        float fx = k * (d.targetx[i] - d.posx[i]) - c * d.velx[i];
        float fy = k * (d.targety[i] - d.posy[i]) - c * d.vely[i];
        float fz = k * (d.targetz[i] - d.posz[i]) - c * d.velz[i];
        d.velx[i] += fx * dt; d.vely[i] += fy * dt; d.velz[i] += fz * dt;
        d.posx[i] += d.velx[i] * dt; d.posy[i] += d.vely[i] * dt; d.posz[i] += d.velz[i] * dt;
        Lifecycle(pool, i, dt);
    }

    // snap to target once close (clean stop on ring) + color lerp + opacity + death
    static void Lifecycle(ParticlePool& pool, uint32_t i, float dt) {
        ParticleData& d = pool.data;
        if (!d.alive[i]) return;
        float ex = d.posx[i]-d.targetx[i], ey = d.posy[i]-d.targety[i], ez = d.posz[i]-d.targetz[i];
        if (ex*ex + ey*ey + ez*ez < 4.0f) {   // within 2px -> snap & stop
            d.posx[i]=d.targetx[i]; d.posy[i]=d.targety[i]; d.posz[i]=d.targetz[i];
            d.velx[i]=0.0f; d.vely[i]=0.0f; d.velz[i]=0.0f;
        }
        float lt = d.lifeT[i];
        float lc = (lt > 0.0f) ? (d.activeT[i] / lt) : 1.0f;
        if (lc > 1.0f) lc = 1.0f;
        int chm[4];
        for (int c = 0; c < 4; ++c)
            chm[c] = clamp255((int)(d.colorF[4*i + c] + d.colorSpeed[4*i + c] * lc));
        d.color[i] = PACK_ARGB(chm[3], chm[0], chm[1], chm[2]);
        float opa;
        if (lc < 0.15f) opa = lc / 0.15f;
        else if (lc > 0.75f) opa = (1.0f - lc) / 0.25f;
        else opa = 1.0f;
        d.opacity[i] = opa < 0.0f ? 0.0f : opa;
        d.activeT[i] += dt;
        if (d.activeT[i] >= d.lifeT[i]) d.alive[i] = 0;
    }
};

} // namespace pe
#endif
