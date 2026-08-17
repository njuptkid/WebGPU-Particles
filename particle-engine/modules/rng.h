#ifndef PE_RNG_H
#define PE_RNG_H
// M1 rng: xorshift32 (single-threaded wasm; stands in for the doc's thread_local RNG).
#include "types.h"

namespace pe {

struct RNG {
    uint32_t s = 0;                                  // zero-default => .bss (keeps wasm small)
    RNG() = default;
    explicit RNG(uint32_t seed) : s(seed ? seed : 0x9E3779B9u) {}
    uint32_t next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    float u01()   { return (next() >> 8) * (1.0f / 16777216.0f); }
    float range(float lo, float hi) { return (hi <= lo) ? lo : lo + u01() * (hi - lo); }
    // Box-Muller Gaussian, clamped to [0,255] (v2.6 fix: clamp before cast).
    float gauss255(float mean, float sigma) {
        float u1 = u01(); if (u1 < 1e-7f) u1 = 1e-7f;
        float g = fsqrtf(-2.0f * flogf(u1)) * fcos(TAU_F * u01());
        float v = mean + sigma * g;
        return v < 0.0f ? 0.0f : (v > 255.0f ? 255.0f : v);
    }
};

} // namespace pe
#endif
