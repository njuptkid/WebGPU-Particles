#ifndef PE_TYPES_H
#define PE_TYPES_H
// M0 types: POD, constants, freestanding math, enums. (3D, SIMD-enabled.)
#include <stdint.h>
#include <wasm_simd128.h>   // wasm SIMD intrinsics (-msimd128)

namespace pe {

constexpr float  PI_F       = 3.14159265358979323846f;
constexpr float  TAU_F      = 6.28318530717958647692f;
constexpr float  DEG2RAD    = PI_F / 180.0f;
constexpr float  CLAMP_DT_S = 0.0333333f;          // v2.4 dt clamp (>=30fps)

constexpr uint32_t PACK_ARGB(int a, int r, int g, int b) {
    return ((uint32_t)(a & 0xFF) << 24) | ((uint32_t)(r & 0xFF) << 16) |
           ((uint32_t)(g & 0xFF) << 8)  |  (uint32_t)(b & 0xFF);
}
inline int   clamp255(int v)                       { return v < 0 ? 0 : (v > 255 ? 255 : v); }
inline float clampf(float v, float lo, float hi)   { return v < lo ? lo : (v > hi ? hi : v); }
inline float fabsf_(float x)                       { return x < 0.0f ? -x : x; }

// freestanding math: sin/cos polynomial with FULL modulo-TAU range reduction
// (field args grow with t; a single +/-TAU shift is not enough).
inline float fsin(float x) {
    const float B = 1.27323954474f, C = 0.40528473456f, P = 0.225f;
    float r = x - TAU_F * (float)(int)(x * (1.0f / TAU_F));   // [-TAU, TAU]
    if (r > PI_F)  r -= TAU_F;
    if (r < -PI_F) r += TAU_F;                                // [-PI, PI]
    float y = B * r - C * r * fabsf_(r);
    y = P * (y * fabsf_(y) - y) + y;
    return y;
}
inline float fcos(float x) { return fsin(x + PI_F * 0.5f); }
inline float flogf(float x) {                                  // Box-Muller only
    union { float f; uint32_t u; } u; u.f = x;
    int e = (int)((u.u >> 23) & 0xFF) - 127;
    u.u = (u.u & 0x007FFFFF) | 0x3F800000u;
    float m = u.f - 1.0f;
    return (float)e * 0.693147180559945f +
           (m - m * m * 0.5f + m * m * m * 0.3333333f - m * m * m * m * 0.25f);
}
inline float fsqrtf(float x) { return __builtin_sqrtf(x); }

enum ParticleType : uint8_t { TYPE_POINTS = 0, TYPE_IMAGES = 1 };

} // namespace pe
#endif
