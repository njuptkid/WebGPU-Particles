const assert=require('node:assert/strict'),{pose}=require('../src/fold-clock.js');
for(const a of [0,10,45,90,135,180]){
 const i=pose(a,'inner'),o=pose(a,'outer');assert(Math.abs(i.dissolve+o.dissolve-1)<1e-6);assert.equal(i.direction,-1);assert.equal(o.direction,-1);assert.equal(pose(a,'outer',false).direction,1);
 assert.deepEqual(pose(a,'inner'),pose(a,'inner'));assert(i.time>=0&&i.time<=1.65);
}
assert.equal(pose(0,'outer').dissolve,0);assert.equal(pose(180,'inner').dissolve,0);
assert.equal(pose(180,'outer').dissolve,1);assert.equal(pose(0,'inner').dissolve,1);
for(let a=1;a<=180;a++)assert(pose(a,'outer').time>=pose(a-1,'outer').time);
console.log('PASS: endpoints, directions, complementary progress, deterministic reversal, monotonic clock');
