#ifndef PE_RENDERER_H
#define PE_RENDERER_H
// M6 renderer (Render). 3D->2D projection (SIMD 4 particles/iter) fills the 2D
// drawAtlas buffers; bridge/CanvasKit calls unchanged.
//   p_rot = R(yaw,pitch)·pos;  depth = p_rot.z + dist;
//   sx = cx + p_rot.x·focal/depth·S;  sy = cy - p_rot.y·focal/depth·S;
//   screenRadius = focal·radius·scale·S/depth;  alpha ∝ dist/depth (near bright).
#include "pool.h"

namespace pe {

constexpr float DEF = 32.0f, IMG = DEF * 2.0f;

static inline uint32_t applyOpacity(uint32_t col, float opa) {
    int a = clamp255((int)(((col >> 24) & 0xFF) * opa));
    return (col & 0x00FFFFFFu) | ((uint32_t)a << 24);
}

// precomputed rotation R = Ry(yaw)·Rx(pitch) rows (camera orbit)
struct Rot {
    float r0x, r0y, r0z;   // row0 = (cy, sy·sp, sy·cp)
    float r1y, r1z;        // row1 = (0, cp, -sp)
    float r2x, r2y, r2z;   // row2 = (-sy, cy·sp, cy·cp)
};
static inline Rot MakeRot(float yaw, float pitch) {
    float cY = fcos(yaw), sY = fsin(yaw), cP = fcos(pitch), sP = fsin(pitch);
    return { cY, sY * sP, sY * cP,  cP, -sP,  -sY, cY * sP, cY * cP };
}

struct SpriteRenderer {
    float    atlasRsx[4 * MAX_CAPACITY];   // scos,ssin,tx,ty
    float    atlasTex[4 * MAX_CAPACITY];   // LTRB
    uint32_t atlasCol[MAX_CAPACITY];        // ColorQuad

    // scalar per-particle projection + writeback (tail / dead groups)
    inline void ProjectOne(const ParticleData& d, uint32_t k, uint32_t& out,
                          const Rot& R, float dist, float focal, float S,
                          float scx, float scy, float camW, float camH) {
        if (!d.alive[k]) return;
        float px = d.posx[k], py = d.posy[k], pz = d.posz[k];
        float rx = R.r0x*px + R.r0y*py + R.r0z*pz;
        float ry = R.r1y*py + R.r1z*pz;
        float rz = R.r2x*px + R.r2y*py + R.r2z*pz;
        float depth = rz + dist; if (depth < 1.0f) depth = 1.0f;
        float inv = focal / depth;
        float sx = scx + rx * inv * S;
        float sy = scy - ry * inv * S;
        float screenR = d.radius[k] * d.scale[k] * inv * S;
        if (sx < -screenR-64.0f || sx > camW+screenR+64.0f ||
            sy < -screenR-64.0f || sy > camH+screenR+64.0f) return;   // screen cull
        float sc = screenR / DEF;
        float da = dist / depth; if (da > 1.0f) da = 1.0f;
        float alpha = d.opacity[k] * da;
        atlasRsx[4*out]=sc; atlasRsx[4*out+1]=0.0f;
        atlasRsx[4*out+2]=sx-screenR; atlasRsx[4*out+3]=sy-screenR;
        atlasTex[4*out]=0.0f; atlasTex[4*out+1]=0.0f; atlasTex[4*out+2]=IMG; atlasTex[4*out+3]=IMG;
        atlasCol[out] = applyOpacity(d.color[k], alpha);
        ++out;
    }

    uint32_t Build(const ParticlePool& pool, float yaw, float pitch,
                   float dist, float focal, float S, float scx, float scy,
                   float camW, float camH) {
        const ParticleData& d = pool.data;
        uint32_t n = pool.activeCount;
        Rot R = MakeRot(yaw, pitch);
        uint32_t out = 0;
        v128_t r0x=wasm_f32x4_splat(R.r0x), r0y=wasm_f32x4_splat(R.r0y), r0z=wasm_f32x4_splat(R.r0z);
        v128_t r1y=wasm_f32x4_splat(R.r1y), r1z=wasm_f32x4_splat(R.r1z);
        v128_t r2x=wasm_f32x4_splat(R.r2x), r2y=wasm_f32x4_splat(R.r2y), r2z=wasm_f32x4_splat(R.r2z);
        v128_t vDist=wasm_f32x4_splat(dist), vFocal=wasm_f32x4_splat(focal), vS=wasm_f32x4_splat(S);
        v128_t vscx=wasm_f32x4_splat(scx), vscy=wasm_f32x4_splat(scy);
        v128_t vDEF=wasm_f32x4_splat(DEF), vEPS=wasm_f32x4_splat(1.0f), vONE=wasm_f32x4_splat(1.0f);
        uint32_t i = 0, simdEnd = n & ~3u;
        for (; i < simdEnd; i += 4) {
            if (!d.alive[i] || !d.alive[i+1] || !d.alive[i+2] || !d.alive[i+3]) {
                for (int j = 0; j < 4; ++j) ProjectOne(d, i+j, out, R, dist, focal, S, scx, scy, camW, camH);
                continue;
            }
            v128_t px=wasm_v128_load(&d.posx[i]), py=wasm_v128_load(&d.posy[i]), pz=wasm_v128_load(&d.posz[i]);
            v128_t rad=wasm_v128_load(&d.radius[i]), scl=wasm_v128_load(&d.scale[i]);
            v128_t rx = wasm_f32x4_add(wasm_f32x4_mul(r0x,px), wasm_f32x4_add(wasm_f32x4_mul(r0y,py), wasm_f32x4_mul(r0z,pz)));
            v128_t ry = wasm_f32x4_add(wasm_f32x4_mul(r1y,py), wasm_f32x4_mul(r1z,pz));
            v128_t rz = wasm_f32x4_add(wasm_f32x4_mul(r2x,px), wasm_f32x4_add(wasm_f32x4_mul(r2y,py), wasm_f32x4_mul(r2z,pz)));
            v128_t depth = wasm_f32x4_max(wasm_f32x4_add(rz, vDist), vEPS);
            v128_t inv = wasm_f32x4_div(vFocal, depth);
            v128_t vsx = wasm_f32x4_add(vscx, wasm_f32x4_mul(rx, wasm_f32x4_mul(inv, vS)));
            v128_t vsy = wasm_f32x4_sub(vscy, wasm_f32x4_mul(ry, wasm_f32x4_mul(inv, vS)));
            v128_t vrad = wasm_f32x4_mul(wasm_f32x4_mul(wasm_f32x4_mul(rad, scl), inv), vS);
            v128_t vsc  = wasm_f32x4_div(vrad, vDEF);
            v128_t vda  = wasm_f32x4_min(wasm_f32x4_div(vDist, depth), vONE);
            alignas(16) float sx[4], sy[4], sc[4], da[4];
            wasm_v128_store(sx, vsx); wasm_v128_store(sy, vsy);
            wasm_v128_store(sc, vsc); wasm_v128_store(da, vda);
            for (int lane = 0; lane < 4; ++lane) {
                uint32_t k = i + lane;
                float screenR = sc[lane] * DEF;
                if (sx[lane] < -screenR-64.0f || sx[lane] > camW+screenR+64.0f ||
                    sy[lane] < -screenR-64.0f || sy[lane] > camH+screenR+64.0f) continue;
                atlasRsx[4*out]=sc[lane]; atlasRsx[4*out+1]=0.0f;
                atlasRsx[4*out+2]=sx[lane]-screenR; atlasRsx[4*out+3]=sy[lane]-screenR;
                atlasTex[4*out]=0.0f; atlasTex[4*out+1]=0.0f; atlasTex[4*out+2]=IMG; atlasTex[4*out+3]=IMG;
                atlasCol[out] = applyOpacity(d.color[k], d.opacity[k] * da[lane]);
                ++out;
            }
        }
        for (; i < n; ++i) ProjectOne(d, i, out, R, dist, focal, S, scx, scy, camW, camH);
        return out;
    }
};

struct MeshRenderer {
    float vertPos[8 * MAX_CAPACITY];
    float vertTex[8 * MAX_CAPACITY];
    float vertColF[16 * MAX_CAPACITY];
    uint32_t Build(const ParticlePool&, float, float, float, float, float, float, float, float, float) {
        return 0;   // Phase D (drawVertices 3D projection)
    }
};

} // namespace pe
#endif
