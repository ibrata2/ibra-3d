// محركات التحويل: كل محرك يستدعي Space مجاني على Hugging Face عن طريق @gradio/client
// أسماء الـ endpoints والمدخلات مأخوذة من view_api الحي لكل Space (نوفمبر 2026).

import { Client, handle_file } from '@gradio/client';

export const ENGINES = [
  {
    id: 'hunyuan21',
    name: 'Hunyuan3D 2.1',
    space: 'tencent/Hunyuan3D-2.1',
    note: 'الافتراضي — نفس المحرك اللي انسوت بيه المكتبة',
    supports: { rembg: true, textureToggle: true }
  },
  {
    id: 'trellis2',
    name: 'TRELLIS.2 (Microsoft)',
    space: 'microsoft/TRELLIS.2',
    note: 'جودة عالية، التكستشر دائماً مشمول، وأقل عدد مضلعات 100 ألف',
    supports: { rembg: true, textureToggle: false }
  },
  {
    id: 'hunyuan2',
    name: 'Hunyuan3D 2',
    space: 'tencent/Hunyuan3D-2',
    note: 'احتياط',
    supports: { rembg: true, textureToggle: true }
  }
];

export function engineById(id) {
  return ENGINES.find(e => e.id === id) || ENGINES[0];
}

export function nextEngine(id) {
  const i = ENGINES.findIndex(e => e.id === id);
  return ENGINES[(i + 1) % ENGINES.length];
}

const MAX_SEED_HY = 10_000_000;
const MAX_SEED_TR = 2_147_483_647;

function pickSeed(seed, max) {
  if (seed === null || seed === undefined || seed === '' || Number.isNaN(+seed)) {
    return { seed: Math.floor(Math.random() * max), random: true };
  }
  return { seed: Math.max(0, Math.min(max, Math.floor(+seed))), random: false };
}

/** يشغّل job ويرسل حالة التقدم، ويرجع آخر data */
async function runJob(app, endpoint, data, onStatus) {
  const job = app.submit(endpoint, data);
  let last = null;
  for await (const msg of job) {
    if (msg.type === 'status') {
      if (msg.stage === 'error') {
        const e = new Error(msg.message || 'error');
        e.original_msg = msg.message;
        e.title = msg.title;
        throw e;
      }
      onStatus?.(msg);
    } else if (msg.type === 'data') {
      last = msg.data;
    }
  }
  if (last === null) throw new Error(`المحرك ما رجّع نتيجة من ${endpoint}`);
  return last;
}

function unwrap(v) {
  if (v && typeof v === 'object' && v.__type__ === 'update') return v.value ?? null;
  if (v && typeof v === 'object' && v.value && (v.value.path || v.value.url)) return v.value;
  return v ?? null;
}

function fileUrl(fd) {
  if (!fd) return null;
  if (typeof fd === 'string') return fd;
  if (fd.value && (fd.value.url || fd.value.path)) return fileUrl(fd.value);
  return fd.url || null;
}

function filePath(fd) {
  if (!fd) return '';
  if (fd.value) return filePath(fd.value);
  return fd.path || fd.orig_name || fd.url || '';
}

async function download(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`فشل تنزيل الملف (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export function isGlb(buf) {
  return buf && buf.length > 20 && buf.toString('ascii', 0, 4) === 'glTF';
}

/**
 * convert({engineId, image: Buffer, mime, opts:{rembg, texture, faces, seed}, token, onProgress})
 * يرجع { glb: Buffer, seed, engine }
 */
export async function convert({ engineId, image, mime, opts, token, onProgress, signal }) {
  const engine = engineById(engineId);
  const progress = (pct, stage, text) => onProgress?.({ pct, stage, text });
  const connectOpts = { events: ['data', 'status'] };
  if (token && /^hf_/.test(token)) connectOpts.token = token;

  progress(3, 'connecting', `يتصل بـ ${engine.name}...`);
  const app = await Client.connect(engine.space, connectOpts);
  if (signal?.aborted) throw new Error('انلغى');

  const blob = new Blob([image], { type: mime || 'image/png' });
  const statusMapper = (base, span, label) => (msg) => {
    if (msg.stage === 'pending') {
      if (msg.queue && msg.position != null) {
        progress(base, 'queue', `بالطابور على السيرفر: الدور ${msg.position + 1}${msg.size ? ' من ' + msg.size : ''}`);
      } else {
        progress(base, 'uploading', 'يرفع الصورة...');
      }
    } else if (msg.stage === 'generating') {
      let frac = null;
      const pd = msg.progress_data && msg.progress_data[0];
      if (pd && pd.length) frac = pd.index / pd.length;
      else if (pd && typeof pd.progress === 'number') frac = pd.progress;
      progress(frac != null ? base + span * frac : base + span * 0.3, 'converting', label + (pd?.desc ? ` (${pd.desc})` : ''));
    }
  };

  if (engine.id === 'trellis2') return convertTrellis2(app, blob, opts, token, progress, statusMapper, engine);
  return convertHunyuan(app, blob, opts, token, progress, statusMapper, engine);
}

async function convertHunyuan(app, blob, opts, token, progress, statusMapper, engine) {
  const { seed, random } = pickSeed(opts.seed, MAX_SEED_HY);
  const params = {
    image: handle_file(blob),
    steps: 30,
    guidance_scale: 5,
    seed,
    octree_resolution: 256,
    check_box_rembg: !!opts.rembg,
    num_chunks: 8000,
    randomize_seed: random
  };
  if (engine.id === 'hunyuan2') params.caption = null;

  const texture = !!opts.texture;
  const endpoint = texture ? '/generation_all' : '/shape_generation';
  progress(8, 'uploading', 'يرفع الصورة...');
  const out = await runJob(app, endpoint, params, statusMapper(10, 70, texture ? 'يحوّل ويلوّن المجسم' : 'يحوّل الصورة لمجسم'));
  // shape_generation -> [file, html, stats, seed]
  // generation_all   -> [file(white mesh), file(textured glb), html, stats, seed]
  // المحرك يرجع الملفات داخل غلاف gr.update: {value: FileData, __type__: 'update'}
  const meshFile = unwrap(out[0]);
  const texFile = texture ? unwrap(out[1]) : null;
  const usedSeed = unwrap(texture ? out[4] : out[3]);

  progress(82, 'converting', 'يقلل المضلعات ويصدّر GLB...');
  const faces = Math.max(1000, Math.min(1_000_000, Math.round(+opts.faces || 30000)));
  let glb = null;
  try {
    const ex = await runJob(app, '/on_export_click', {
      file_out: meshFile,
      file_out2: texFile,
      file_type: 'glb',
      reduce_face: true,
      export_texture: texture,
      target_face_num: faces
    }, () => {});
    const url = fileUrl(ex[1]);
    if (url) glb = await download(url, token);
  } catch (e) {
    // إذا فشل التصدير نرجع الملف الأصلي إذا كان GLB
    progress(88, 'converting', 'التصدير فشل، يستخدم الملف الأصلي...');
  }
  if (!isGlb(glb)) {
    const src = texFile || meshFile;
    const url = fileUrl(src);
    if (url && /\.glb($|\?)/i.test(filePath(src) + '|' + url)) glb = await download(url, token);
  }
  if (!isGlb(glb)) throw new Error('المحرك ما رجّع ملف GLB صالح');
  progress(100, 'done', 'خلص');
  return { glb, seed: usedSeed ?? seed, engine: engine.id };
}

async function convertTrellis2(app, blob, opts, token, progress, statusMapper, engine) {
  // TRELLIS.2 يخزن نتيجة image_to_3d بحالة الجلسة (gr.State) ويستخدمها extract_glb
  try { await app.predict('/start_session', {}); } catch { /* قد لا يكون ضرورياً */ }

  let imageArg = handle_file(blob);
  if (opts.rembg) {
    progress(8, 'uploading', 'يرفع الصورة ويزيل الخلفية...');
    const pre = await runJob(app, '/preprocess_image', { input: imageArg }, () => {});
    if (pre && pre[0]) imageArg = pre[0];
  } else {
    progress(8, 'uploading', 'يرفع الصورة...');
  }

  const { seed } = pickSeed(opts.seed, MAX_SEED_TR);
  await runJob(app, '/image_to_3d', {
    image: imageArg,
    seed,
    resolution: '1024',
    ss_guidance_strength: 7.5,
    ss_guidance_rescale: 0.7,
    ss_sampling_steps: 12,
    ss_rescale_t: 5,
    shape_slat_guidance_strength: 7.5,
    shape_slat_guidance_rescale: 0.5,
    shape_slat_sampling_steps: 12,
    shape_slat_rescale_t: 3,
    tex_slat_guidance_strength: 1,
    tex_slat_guidance_rescale: 0,
    tex_slat_sampling_steps: 12,
    tex_slat_rescale_t: 3
  }, statusMapper(12, 60, 'يحوّل الصورة لمجسم'));

  progress(75, 'converting', 'يستخرج ملف GLB...');
  // الـ Space يقبل من 100 ألف الى 500 ألف مضلع بس (من view_api/config)
  const faces = Math.max(100000, Math.min(500000, Math.round(+opts.faces || 30000)));
  const ex = await runJob(app, '/extract_glb', {
    decimation_target: faces,
    texture_size: 2048
  }, statusMapper(76, 20, 'يستخرج ملف GLB'));
  const url = fileUrl(ex[1]) || fileUrl(ex[0]);
  if (!url) throw new Error('المحرك ما رجّع رابط ملف GLB');
  const glb = await download(url, token);
  if (!isGlb(glb)) throw new Error('الملف الراجع مو GLB صالح');
  progress(100, 'done', 'خلص');
  return { glb, seed, engine: engine.id };
}
