// إصلاح ملفات GLB الراجعة من المحركات:
// مجسمات Hunyuan بدون تكستشر تطلع بـ POSITION بس (بدون normals وبدون material)،
// فتظهر سوداء بـ model-viewer وبمحركات الألعاب. هنا نحسب normals ناعمة ونضيف material افتراضي.

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMP = {
  5120: { size: 1, get: 'getInt8' },
  5121: { size: 1, get: 'getUint8' },
  5122: { size: 2, get: 'getInt16' },
  5123: { size: 2, get: 'getUint16' },
  5125: { size: 4, get: 'getUint32' },
  5126: { size: 4, get: 'getFloat32' }
};
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  const total = dv.getUint32(8, true);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(Buffer.from(data).toString('utf8'));
    else if (type === CHUNK_BIN && !bin) bin = Buffer.from(data);
    off += 8 + len;
  }
  if (!json) throw new Error('GLB without JSON chunk');
  return { json, bin: bin || Buffer.alloc(0) };
}

function pad4(n) { return (n + 3) & ~3; }

export function buildGlb(json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = pad4(jsonBuf.length) - jsonBuf.length;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length, 0)]);
  const hasBin = binPadded.length > 0;
  const total = 12 + 8 + jsonBuf.length + (hasBin ? 8 + binPadded.length : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  jsonBuf.copy(out, 20);
  if (hasBin) {
    const o = 20 + jsonBuf.length;
    out.writeUInt32LE(binPadded.length, o);
    out.writeUInt32LE(CHUNK_BIN, o + 4);
    binPadded.copy(out, o + 8);
  }
  return out;
}

function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const n = NUM[acc.type];
  const c = COMP[acc.componentType];
  const out = new Float64Array(acc.count * n);
  if (acc.bufferView === undefined) return out; // كله أصفار
  const bv = json.bufferViews[acc.bufferView];
  if ((bv.buffer ?? 0) !== 0) throw new Error('external buffers not supported');
  const stride = bv.byteStride || n * c.size;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      out[i * n + k] = dv[c.get](base + i * stride + k * c.size, true);
    }
  }
  return out;
}

export function computeNormals(pos, idx) {
  const vcount = pos.length / 3;
  const nrm = new Float32Array(vcount * 3);
  const tri = idx ? idx.length / 3 : vcount / 3;
  for (let t = 0; t < tri; t++) {
    const a = idx ? idx[t * 3] : t * 3;
    const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    // حاصل الضرب الاتجاهي (غير مطبّع = موزون بمساحة المثلث)
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      nrm[v * 3] += nx; nrm[v * 3 + 1] += ny; nrm[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < vcount; v++) {
    const x = nrm[v * 3], y = nrm[v * 3 + 1], z = nrm[v * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l > 0) { nrm[v * 3] = x / l; nrm[v * 3 + 1] = y / l; nrm[v * 3 + 2] = z / l; }
    else { nrm[v * 3 + 1] = 1; }
  }
  return nrm;
}

/**
 * يرجع { glb, changed, addedNormals, addedMaterial }
 * إذا الملف سليم يرجعه مثل ما هو.
 */
export function fixGlb(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const { json, bin } = parseGlb(buf);
  let extra = [];
  let extraLen = bin.length;
  let addedNormals = 0;
  let addedMaterial = false;
  json.accessors = json.accessors || [];
  json.bufferViews = json.bufferViews || [];

  const append = (data) => {
    const start = pad4(extraLen);
    if (start > extraLen) extra.push(Buffer.alloc(start - extraLen));
    extra.push(data);
    extraLen = start + data.length;
    return start;
  };

  let defaultMat = null;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) continue; // مثلثات بس
      if (prim.attributes.POSITION === undefined) continue;
      if (prim.attributes.NORMAL === undefined) {
        const pos = readAccessor(json, bin, prim.attributes.POSITION);
        const idx = prim.indices !== undefined ? readAccessor(json, bin, prim.indices) : null;
        const nrm = computeNormals(pos, idx);
        const data = Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength);
        const offset = append(data);
        json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target: 34962 });
        json.accessors.push({
          bufferView: json.bufferViews.length - 1,
          componentType: 5126,
          count: nrm.length / 3,
          type: 'VEC3'
        });
        prim.attributes.NORMAL = json.accessors.length - 1;
        addedNormals++;
      }
      if (prim.material === undefined && prim.attributes.COLOR_0 === undefined) {
        if (defaultMat === null) {
          json.materials = json.materials || [];
          json.materials.push({
            name: 'IBRA_default',
            pbrMetallicRoughness: { baseColorFactor: [0.82, 0.8, 0.76, 1], metallicFactor: 0, roughnessFactor: 0.7 },
            doubleSided: true
          });
          defaultMat = json.materials.length - 1;
          addedMaterial = true;
        }
        prim.material = defaultMat;
      }
    }
  }

  if (!addedNormals && !addedMaterial) return { glb: buf, changed: false, addedNormals, addedMaterial };

  const newBin = Buffer.concat([bin, ...extra]);
  if (newBin.length) {
    json.buffers = json.buffers && json.buffers.length ? json.buffers : [{}];
    json.buffers[0].byteLength = newBin.length;
    delete json.buffers[0].uri;
  }
  json.asset = json.asset || { version: '2.0' };
  return { glb: buildGlb(json, newBin), changed: true, addedNormals, addedMaterial };
}

/** إحصائيات سريعة للتحقق */
export function glbStats(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const { json } = parseGlb(buf);
  let triangles = 0, vertices = 0, withNormals = 0, prims = 0;
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    prims++;
    const pc = json.accessors[p.attributes.POSITION]?.count || 0;
    vertices += pc;
    triangles += p.indices !== undefined ? json.accessors[p.indices].count / 3 : pc / 3;
    if (p.attributes.NORMAL !== undefined) withNormals++;
  }
  return { triangles, vertices, primitives: prims, withNormals, materials: (json.materials || []).length, textures: (json.images || []).length };
}
