import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addModel, suggestCode, codeExists, removeModel, readCatalog, listModels } from '../src/library.mjs';

function tmpLib(catalog) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ibralib-'));
  fs.mkdirSync(path.join(d, 'models'));
  if (catalog !== undefined) fs.writeFileSync(path.join(d, 'catalog.json'), JSON.stringify(catalog, null, 2));
  return d;
}
const glb = path.join(os.tmpdir(), 'ibra-test.glb');
fs.writeFileSync(glb, Buffer.alloc(3000, 1));

test('suggests next code and keeps existing type value', () => {
  const d = tmpLib([
    { code: 'D01', name_ar: 'سيارة', name_en: 'Car', type: 'drive', file: 'models/D01.glb', size_kb: 900 },
    { code: 'D02', name_ar: 'سيارة 2', name_en: 'Car 2', type: 'drive', file: 'models/D02.glb', size_kb: 800 }
  ]);
  assert.equal(suggestCode(d, 'D'), 'D03');
  assert.equal(suggestCode(d, 'Z'), 'Z01');
  const e = addModel(d, { code: 'D03', prefix: 'D', name_ar: 'كامري', name_en: 'Camry', srcPath: glb });
  assert.deepEqual(Object.keys(e), ['code', 'name_ar', 'name_en', 'type', 'file', 'size_kb']);
  assert.equal(e.type, 'drive');
  assert.equal(e.file, 'models/D03.glb');
  assert.equal(e.size_kb, 3);
  assert.ok(fs.existsSync(path.join(d, 'models/D03.glb')));
  assert.equal(readCatalog(d).entries.length, 3);
});

test('conflict, overwrite, remove, wrapped catalog shape', () => {
  const d = tmpLib({ version: 1, models: [{ code: 'C01', name_ar: 'زلمة', name_en: 'Man', type: 'character', file: 'models/C01.glb', size_kb: 1 }] });
  fs.writeFileSync(path.join(d, 'models/C01.glb'), 'x');
  assert.ok(codeExists(d, 'c01'));
  assert.throws(() => addModel(d, { code: 'C01', prefix: 'C', name_ar: 'a', srcPath: glb }), (e) => e.code === 'EXISTS');
  addModel(d, { code: 'C01', prefix: 'C', name_ar: 'جديد', srcPath: glb, overwrite: true });
  const raw = JSON.parse(fs.readFileSync(path.join(d, 'catalog.json'), 'utf8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.models.length, 1);
  assert.equal(raw.models[0].name_ar, 'جديد');
  removeModel(d, 'C01');
  assert.equal(listModels(d).length, 0);
});
