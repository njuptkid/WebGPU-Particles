#ifndef PE_UPDATER_H
#define PE_UPDATER_H
// M5 updater (Update): 3D damped-spring convergence to torus targets.
// Single fused SIMD pass: integrate + snap-to-target (in-register, mask select)
// in the 4-particle SIMD loop; lifecycle (color/opacity/death) scalar per
// particle (doesn't re-read pos/vel, so no reload waste).
#include "pool.h"

namespace pe {

struct ParticleUpdater {
    float k = 0.0f;       // spring stiffness (set at Init; zero-default => .bss)
    float c = 0.0f;       // damping

    void UpdateBatch(ParticlePool& pool, float dt, float /*t*/, uint32_t start, uint32_t end) {
        uint32_t i = start;
        const v128_t k4 = wasm_f32x4_splat(k), c4 = wasm_f32x4_splat(c), dt4 = wasm_f32x4_splat(dt);
        const v128_t snapD2 = wasm_f32x4_splat(4.0f), vZERO = wasm_f32x4_splat(0.0f);
        uint32_t simdEnd = start + ((end - start) & ~3u);
        for (; i < simdEnd; i += 4) {
            ParticleData& d = pool.data;
            if (!d.alive[i] || !d.alive[i+1] || !d.alive[i+2] || !d.alive[i+3]) {
                for (uint32_t j = i; j < i + 4; ++j) UpdateParticle(pool, j, dt);
                continue;
            }
            v128_t px=wasm_v128_load(&d.posx[i]), py=wasm_v128_load(&d.posy[i]), pz=wasm_v128_load(&d.posz[i]);
            v128_t vx=wasm_v128_load(&d.velx[i]), vy=wasm_v128_load(&d.vely[i]), vz=wasm_v128_load(&d.velz[i]);
            v128_t tx=wasm_v128_load(&d.targetx[i]), ty=wasm_v128_load(&d.targety[i]), tz=wasm_v128_load(&d.targetz[i]);
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
            // snap-to-target (fused into SIMD, in-register — no reload):
            // if |pos-target|^2 < 4 -> pos=target, vel=0
            v128_t dx=wasm_f32x4_sub(px,tx), dy=wasm_f32x4_sub(py,ty), dz=wasm_f32x4_sub(pz,tz);
            v128_t dist2 = wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(dx,dx), wasm_f32x4_mul(dy,dy)), wasm_f32x4_mul(dz,dz));
            v128_t snapM = wasm_f32x4_lt(dist2, snapD2);          // all-1s where snap
            px = wasm_v128_bitselect(tx, px, snapM);              // px = snapM ? tx : px
            py = wasm_v128_bitselect(ty, py, snapM);
            pz = wasm_v128_bitselect(tz, pz, snapM);
            vx = wasm_v128_bitselect(vZERO, vx, snapM);           // vel -> 0 where snap
            vy = wasm_v128_bitselect(vZERO, vy, snapM);
            vz = wasm_v128_bitselect(vZERO, vz, snapM);
            wasm_v128_store(&d.velx[i], vx); wasm_v128_store(&d.vely[i], vy); wasm_v128_store(&d.velz[i], vz);
            wasm_v128_store(&d.posx[i], px); wasm_v128_store(&d.posy[i], py); wasm_v128_store(&d.posz[i], pz);
            // lifecycle (color/opacity/death) — scalar per particle, no pos re-read
            LifecyclePost(pool, i, dt);   LifecyclePost(pool, i+1, dt);
            LifecyclePost(pool, i+2, dt); LifecyclePost(pool, i+3, dt);
        }
        for (; i < end; ++i) UpdateParticle(pool, i, dt);
    }

    // scalar full update (tail / dead groups): integrate + snap + lifecycle
    void UpdateParticle(ParticlePool& pool, uint32_t i, float dt) {
        ParticleData& d = pool.data;
        if (!d.alive[i]) return;
        float fx = k * (d.targetx[i] - d.posx[i]) - c * d.velx[i];
        float fy = k * (d.targety[i] - d.posy[i]) - c * d.vely[i];
        float fz = k * (d.targetz[i] - d.posz[i]) - c * d.velz[i];
        d.velx[i] += fx * dt; d.vely[i] += fy * dt; d.velz[i] += fz * dt;
        d.posx[i] += d.velx[i] * dt; d.posy[i] += d.vely[i] * dt; d.posz[i] += d.velz[i] * dt;
        // snap (scalar)
        float ex = d.posx[i]-d.targetx[i], ey = d.posy[i]-d.targety[i], ez = d.posz[i]-d.targetz[i];
        if (ex*ex + ey*ey + ez*ez < 4.0f) {
            d.posx[i]=d.targetx[i]; d.posy[i]=d.targety[i]; d.posz[i]=d.targetz[i];
            d.velx[i]=0.0f; d.vely[i]=0.0f; d.velz[i]=0.0f;
        }
        LifecyclePost(pool, i, dt);
    }

    // color lerp + opacity fade + death (snap already done by caller)
    static void LifecyclePost(ParticlePool& pool, uint32_t i, float dt) {
        ParticleData& d = pool.data;
        if (!d.alive[i]) return;
        float lt = d.lifeT[i];
        float lc = (lt > 0.0f) ? (d.activeT[i] / lt) : 1.0f;
        if (lc > 1.0f) lc = 1.0f;
        // color lerp in SIMD: RGBA = 1 f32x4 per particle (colorF[4i] is 16-byte aligned)
        v128_t cf  = wasm_v128_load(&d.colorF[4*i]);
        v128_t cs  = wasm_v128_load(&d.colorSpeed[4*i]);
        v128_t chm = wasm_f32x4_add(cf, wasm_f32x4_mul(cs, wasm_f32x4_splat(lc)));
        chm = wasm_f32x4_max(chm, wasm_f32x4_splat(0.0f));
        chm = wasm_f32x4_min(chm, wasm_f32x4_splat(255.0f));
        int r = (int)wasm_f32x4_extract_lane(chm, 0);
        int g = (int)wasm_f32x4_extract_lane(chm, 1);
        int b = (int)wasm_f32x4_extract_lane(chm, 2);
        int a = (int)wasm_f32x4_extract_lane(chm, 3);
        d.color[i] = PACK_ARGB(a, r, g, b);
        // opacity (scalar, branchy) + death
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
