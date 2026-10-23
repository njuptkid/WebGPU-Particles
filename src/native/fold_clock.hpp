#pragma once
#include <algorithm>
#include <cmath>
// Portable math only. Not a HarmonyOS / Android SDK integration.
namespace fold_particles {
struct Pose { float dissolve, time, direction; };
inline Pose pose(float angle, bool outer, bool outerArrivalLeftToRight=true) {
 const float p=std::clamp(angle/180.0f,0.0f,1.0f);
 const float t=outer?p:1.0f-p;
 return {t,1.65f*std::pow(t,.78f),outer?(outerArrivalLeftToRight?-1.0f:1.0f):-1.0f};
}
}
