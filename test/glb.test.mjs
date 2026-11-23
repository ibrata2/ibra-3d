import test from 'node:test';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
import { buildGlb, fixGlb, glbStats, parseGlb } from '../src/glb.mjs';

// مجسم بنفس شكل مخرجات Hunyuan (trimesh): POSITION + indices uint32 بس
function trimeshLikeCube() {
  const p = new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]);
  const i = new Uint32Array([0,2,1,0,3,2, 4,5,6,4,6,7, 0,1,5,0,5,4, 2,3,7,2,7,6, 1,2,6,1,6,5, 0,4,7,0,7,3]);
  const bin = Buffer.concat([Buffer.from(i.buffer), Buffer.from(p.buffer)]);
  const json = {
    asset: { version: '2.0', generator: 'https://github.com/mikedh/trimesh' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5125, count: 36, type: 'SCALAR', max: [7], min: [0] },
      { bufferView: 1, componentType: 5126, count: 8, type: 'VEC3', max: [1,1,1], min: [-1,-1,-1] }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: i.byteLength, target: 34963 },
      { buffer: 0, byteOffset: i.byteLength, byteLength: p.byteLength, target: 34962 }
    ],
    buffers: [{ byteLength: bin.length }]
  };
  return buildGlb(json, bin);
}

test('fixGlb adds normals + material and stays valid glTF', async () => {
  const src = trimeshLikeCube();
  const r0 = await validator.validateBytes(new Uint8Array(src));
  assert.equal(r0.issues.numErrors, 0);

  const { glb, changed, addedNormals, addedMaterial } = fixGlb(src);
  assert.ok(changed); assert.equal(addedNormals, 1); assert.ok(addedMaterial);
  const r = await validator.validateBytes(new Uint8Array(glb));
  assert.equal(r.issues.numErrors, 0, JSON.stringify(r.issues.messages.filter(m => m.severity === 0)));

  const s = glbStats(glb);
  assert.equal(s.triangles, 12);
  assert.equal(s.withNormals, 1);
  // normals مطبّعة
  const { json, bin } = parseGlb(glb);
  const acc = json.accessors[json.meshes[0].primitives[0].attributes.NORMAL];
  const bv = json.bufferViews[acc.bufferView];
  const n = new Float32Array(bin.buffer.slice(bin.byteOffset + bv.byteOffset, bin.byteOffset + bv.byteOffset + bv.byteLength));
  for (let v = 0; v < 8; v++) assert.ok(Math.abs(Math.hypot(n[v*3], n[v*3+1], n[v*3+2]) - 1) < 1e-5);
  // زاوية المكعب (1,1,1) normal يأشر لبرّا
  assert.ok(n[6*3] > 0 && n[6*3+1] > 0 && n[6*3+2] > 0);
});

test('fixGlb leaves a complete GLB untouched', () => {
  const { glb } = fixGlb(trimeshLikeCube());
  const again = fixGlb(glb);
  assert.equal(again.changed, false);
  assert.equal(again.glb, glb);
});
