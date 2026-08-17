#ifndef PE_FIELD_H
#define PE_FIELD_H
// M3 field: ForceField + FieldCollection (curl-ish swirl).
#include "types.h"

namespace pe {

struct ForceField {
    float fx, fy, freq, phase, amp, strength;
    bool enabled;
    void Apply(float x, float y, float t, float& ofx, float& ofy) const {
        ofx = (fcos(y * freq + t * phase + fx) * amp) * strength;
        ofy = (fsin(x * freq + t * phase + fy) * amp) * strength;
    }
};
struct FieldCollection {
    ForceField fields[3];
    void UpdateAll(float /*dt*/) {}                  // ripple lifeTime hook
    void ApplyAll(float x, float y, float t, float& ofx, float& ofy) const {
        ofx = 0.0f; ofy = 0.0f;
        for (int k = 0; k < 3; ++k) {
            if (!fields[k].enabled) continue;
            float fx, fy; fields[k].Apply(x, y, t, fx, fy);
            ofx += fx; ofy += fy;
        }
    }
};

} // namespace pe
#endif
