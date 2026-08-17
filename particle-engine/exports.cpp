// M8 exports (C ABI). Thin wrappers over a single global ParticleSystem.
// 3D torus effect — Phase A (sim + SIMD spring, no render yet).
#include "modules/system.h"

static pe::ParticleSystem g_system;

extern "C" {

void      ck_init(uint32_t cap, uint16_t w, uint16_t h) { g_system.Init(cap, w, h); }
void      ck_reset(void)                                 { g_system.Reset(); }
uint32_t  ck_step(float dt)                              { return g_system.Step(dt); }
uint32_t  ck_active(void)                                { return g_system.ActiveCount(); }

uint32_t  ck_build_atlas(void) {
    const pe::Camera& c = g_system.camera;
    return g_system.spriteRenderer.Build(g_system.pool, c.yaw, c.pitch, c.dist, c.focal, c.S, c.cx, c.cy, c.camW, c.camH);
}
uint32_t  ck_build_vertices(void) {
    const pe::Camera& c = g_system.camera;
    return g_system.meshRenderer.Build(g_system.pool, c.yaw, c.pitch, c.dist, c.focal, c.S, c.cx, c.cy, c.camW, c.camH);  // Phase D
}

// Phase C: adjust camera (yaw/pitch orbit, dist, focal/FOV)
void ck_set_camera(float yaw, float pitch, float dist, float focal) {
    g_system.camera.yaw = yaw; g_system.camera.pitch = pitch;
    g_system.camera.dist = dist; g_system.camera.focal = focal;
}

float*     ck_atlas_rsx_ptr(void)    { return g_system.spriteRenderer.atlasRsx; }
float*     ck_atlas_tex_ptr(void)    { return g_system.spriteRenderer.atlasTex; }
uint32_t*  ck_atlas_colors_ptr(void) { return g_system.spriteRenderer.atlasCol; }
float*     ck_vert_pos_ptr(void)      { return g_system.meshRenderer.vertPos; }
float*     ck_vert_tex_ptr(void)      { return g_system.meshRenderer.vertTex; }
float*     ck_vert_colors_f_ptr(void) { return g_system.meshRenderer.vertColF; }

uint32_t  ck_max_capacity(void) { return pe::MAX_CAPACITY; }
uint32_t  ck_capacity(void)     { return g_system.pool.capacity; }
uint16_t  ck_img_size(void)     { return (uint16_t)pe::IMG; }

// TEMP (Phase A diagnostic): average |pos - target| over active particles.
// Should -> small as particles converge to the torus. Remove in Phase B.
float ck_convergence_error(void) {
    const pe::ParticleData& d = g_system.pool.data;
    uint32_t n = g_system.pool.activeCount;
    if (n == 0) return 0.0f;
    float acc = 0.0f;
    for (uint32_t i = 0; i < n; ++i) {
        float dx = d.posx[i]-d.targetx[i], dy = d.posy[i]-d.targety[i], dz = d.posz[i]-d.targetz[i];
        acc += pe::fsqrtf(dx*dx + dy*dy + dz*dz);
    }
    return acc / (float)n;
}

}
