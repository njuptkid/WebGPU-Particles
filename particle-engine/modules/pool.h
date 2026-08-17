#ifndef PE_POOL_H
#define PE_POOL_H
// M2 pool: data owner. 3D per-component SoA (SIMD-friendly: 4 consecutive
// particles' x load into one v128). Holds NO render buffers.
#include "types.h"

namespace pe {

constexpr uint32_t MAX_CAPACITY = 20000;

// ParticleData — 3D, per-component arrays. Lifecycle color (colorF=start
// channel, colorSpeed=delta) and opacity are dimension-agnostic (reused).
struct ParticleData {
    // L1 hot — 3D position / velocity / torus target
    float posx[MAX_CAPACITY], posy[MAX_CAPACITY], posz[MAX_CAPACITY];
    float velx[MAX_CAPACITY], vely[MAX_CAPACITY], velz[MAX_CAPACITY];
    float targetx[MAX_CAPACITY], targety[MAX_CAPACITY], targetz[MAX_CAPACITY];
    // L2 visual
    float scale[MAX_CAPACITY], opacity[MAX_CAPACITY];
    uint32_t color[MAX_CAPACITY];                 // packed ARGB (current)
    float colorF[4 * MAX_CAPACITY];               // RGBA start channel (0..255)
    float colorSpeed[4 * MAX_CAPACITY];            // RGBA delta (end - start)
    float radius[MAX_CAPACITY], lifeT[MAX_CAPACITY], activeT[MAX_CAPACITY];
    // L3 cold
    uint8_t alive[MAX_CAPACITY];
};

struct ParticlePool {
    ParticleData data;
    uint32_t capacity = 0;
    uint32_t activeCount = 0;

    void Init(uint32_t cap) {
        if (cap > MAX_CAPACITY) cap = MAX_CAPACITY;
        if (cap == 0) cap = MAX_CAPACITY;
        capacity = cap; activeCount = 0;
    }
    void Clear() {
        activeCount = 0;
        for (uint32_t i = 0; i < capacity; ++i) data.alive[i] = 0;
    }
    static constexpr uint32_t INVALID = 0xFFFFFFFFu;
    uint32_t Acquire() {
        if (activeCount >= capacity) return INVALID;
        uint32_t i = activeCount++;
        data.alive[i] = 1;
        return i;
    }
    uint32_t Compact() {
        while (activeCount > 0 && !data.alive[activeCount - 1]) {
            --activeCount; data.alive[activeCount] = 0;
        }
        uint32_t i = 0;
        while (i < activeCount) {
            if (!data.alive[i]) {
                uint32_t last = activeCount - 1;
                MoveSlot(i, last);
                data.alive[i] = 1; data.alive[last] = 0;
                --activeCount;
            } else { ++i; }
        }
        return activeCount;
    }
    void MoveSlot(uint32_t d, uint32_t s) {
        ParticleData& x = data;
        x.posx[d]=x.posx[s]; x.posy[d]=x.posy[s]; x.posz[d]=x.posz[s];
        x.velx[d]=x.velx[s]; x.vely[d]=x.vely[s]; x.velz[d]=x.velz[s];
        x.targetx[d]=x.targetx[s]; x.targety[d]=x.targety[s]; x.targetz[d]=x.targetz[s];
        x.scale[d]=x.scale[s]; x.opacity[d]=x.opacity[s]; x.color[d]=x.color[s];
        // colorF/colorSpeed are RGBA (4 contiguous floats/particle, 16-byte aligned) -> SIMD copy
        wasm_v128_store(&x.colorF[4*d], wasm_v128_load(&x.colorF[4*s]));
        wasm_v128_store(&x.colorSpeed[4*d], wasm_v128_load(&x.colorSpeed[4*s]));
        x.radius[d]=x.radius[s]; x.lifeT[d]=x.lifeT[s]; x.activeT[d]=x.activeT[s];
        x.alive[d]=x.alive[s];
    }
};

} // namespace pe
#endif
