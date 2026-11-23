/* IBRA 3D — واجهة التطبيق */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG_RE = /\.(png|jpe?g|webp)$/i;

const STATUS = {
  wait: 'بالانتظار',
  up: 'يرفع',
  conv: 'يحوّل',
  done: 'خلص',
  fail: 'فشل'
};

const state = {
  engines: [],
  types: [],
  settings: {},
  queue: [],      // {id, path, name, url, engineId, opts, status, pct, text, result, error}
  running: false,
  paused: null,   // {engineId, info}
  selected: null,
  lib: { dir: '', models: [], filter: 'all', q: '' }
};

let uid = 0;

// ---------------- تهيئة ----------------
async function init() {
  state.engines = await ibra.engines();
  state.types = await ibra.libTypes();
  state.settings = await ibra.getSettings();

  const sel = $('#opt-engine');
  sel.innerHTML = state.engines.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  const s = state.settings;
  sel.value = s.engine;
  $('#opt-rembg').checked = s.rembg;
  $('#opt-texture').checked = s.texture;
  $('#opt-faces').value = s.faces;
  $('#opt-seed').value = s.seed;
  updateEngineUI();
  markFacePreset();

  $('#sv-type').innerHTML = state.types.map(t => `<option value="${t.prefix}">${t.prefix} — ${esc(t.ar)}</option>`).join('');

  bindTabs();
  bindConvert();
  bindLibrary();
  bindSettings();
  $$('[data-url]').forEach(b => b.addEventListener('click', () => ibra.openExternal(b.dataset.url)));
  $('#version').textContent = 'الإصدار 1.0.0';

  ibra.onProgress(onProgress);
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function engineName(id) {
  return state.engines.find(e => e.id === id)?.name || id;
}

function bindTabs() {
  $$('#tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
}

function showView(v) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + v));
  if (v === 'library') loadLibrary();
  if (v === 'settings') fillSettings();
}

// ---------------- الخيارات ----------------
function currentOpts() {
  const seed = $('#opt-seed').value.trim();
  return {
    rembg: $('#opt-rembg').checked,
    texture: $('#opt-texture').checked,
    faces: Math.max(1000, Math.min(500000, parseInt($('#opt-faces').value, 10) || 30000)),
    seed: seed === '' ? '' : parseInt(seed, 10)
  };
}

function updateEngineUI() {
  const e = state.engines.find(x => x.id === $('#opt-engine').value);
  $('#engine-note').textContent = e?.note || '';
  const texToggle = e?.supports.textureToggle !== false;
  $('#opt-texture').disabled = !texToggle;
  $('#tex-note').classList.toggle('hidden', texToggle);
}

function markFacePreset() {
  const v = parseInt($('#opt-faces').value, 10);
  $$('.faces-presets button').forEach(b => b.classList.toggle('on', +b.dataset.f === v));
}

function persistOpts() {
  const o = currentOpts();
  ibra.saveSettings({ engine: $('#opt-engine').value, rembg: o.rembg, texture: o.texture, faces: o.faces, seed: o.seed });
}

// ---------------- التحويل والطابور ----------------
function bindConvert() {
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const files = [...e.dataTransfer.files];
    const items = files.map(f => ({ path: ibra.pathForFile(f), name: f.name })).filter(f => f.path && IMG_RE.test(f.name));
    if (!items.length) return toast('حط صور PNG أو JPG أو WEBP بس');
    if (items.length < files.length) toast('تجاهلت ملفات مو صور');
    addToQueue(items);
  });
  // منع فتح الملف إذا انسحب برّا المربع
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  $('#pick').addEventListener('click', async () => {
    const files = await ibra.pickImages();
    if (files.length) addToQueue(files);
  });

  $('#opt-engine').addEventListener('change', () => { updateEngineUI(); persistOpts(); });
  ['#opt-rembg', '#opt-texture', '#opt-seed'].forEach(s => $(s).addEventListener('change', persistOpts));
  $('#opt-faces').addEventListener('change', () => { markFacePreset(); persistOpts(); });
  $$('.faces-presets button').forEach(b => b.addEventListener('click', () => {
    $('#opt-faces').value = b.dataset.f; markFacePreset(); persistOpts();
  }));

  $('#start').addEventListener('click', () => {
    // الصور اللي بالانتظار تاخذ الخيارات الحالية
    const engineId = $('#opt-engine').value;
    const opts = currentOpts();
    state.queue.filter(q => q.status === 'wait').forEach(q => { q.engineId = engineId; q.opts = { ...opts }; });
    state.paused = null;
    renderBanner();
    processQueue();
  });
  $('#clear-done').addEventListener('click', () => {
    state.queue = state.queue.filter(q => q.status !== 'done' && q.status !== 'fail');
    if (state.selected && !state.queue.find(q => q.id === state.selected)) { state.selected = null; showResult(null); }
    renderQueue();
  });

  // أزرار النتيجة
  $('#act-save').addEventListener('click', () => openSaveModal(selectedItem()));
  $('#act-saveas').addEventListener('click', async () => {
    const it = selectedItem();
    if (!it?.result) return;
    const p = await ibra.saveAs(it.result.path, it.name.replace(/\.[^.]+$/, ''));
    if (p) toast('انحفظ ✓');
  });
  $('#act-folder').addEventListener('click', () => {
    const it = selectedItem();
    if (it?.result) ibra.showInFolder(it.result.path);
  });
  $('#act-retry').addEventListener('click', (e) => {
    e.stopPropagation();
    const it = selectedItem();
    if (!it) return;
    const menu = $('#retry-menu');
    menu.innerHTML = state.engines.filter(x => x.id !== it.engineId)
      .map(x => `<button data-e="${x.id}">حوّل بـ ${esc(x.name)}</button>`).join('');
    menu.classList.toggle('hidden');
  });
  $('#retry-menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-e]');
    if (!b) return;
    $('#retry-menu').classList.add('hidden');
    retryWith(selectedItem(), b.dataset.e);
  });
  document.addEventListener('click', () => $('#retry-menu').classList.add('hidden'));
}

function addToQueue(files) {
  const engineId = $('#opt-engine').value;
  const opts = currentOpts();
  for (const f of files) {
    state.queue.push({
      id: 'j' + (++uid) + '_' + Date.now(),
      path: f.path,
      name: f.name,
      url: f.url || ('ibra3d://local/' + encodeURIComponent(f.path)),
      engineId,
      opts: { ...opts },
      status: 'wait',
      pct: 0,
      text: '',
      result: null,
      error: null
    });
  }
  renderQueue();
  toast(`انضافت ${files.length} صورة للطابور`);
  processQueue();
}

function selectedItem() {
  return state.queue.find(q => q.id === state.selected) || null;
}

function retryWith(item, engineId) {
  if (!item) return;
  const copy = {
    ...item,
    id: 'j' + (++uid) + '_' + Date.now(),
    engineId,
    status: 'wait', pct: 0, text: '', result: null, error: null
  };
  const idx = state.queue.indexOf(item);
  state.queue.splice(idx + 1, 0, copy);
  state.selected = copy.id;
  state.paused = null;
  renderBanner();
  renderQueue();
  processQueue();
}

async function processQueue() {
  if (state.running) return;
  state.running = true;
  try {
    while (!state.paused) {
      const job = state.queue.find(q => q.status === 'wait');
      if (!job) break;
      await runOne(job);
    }
  } finally {
    state.running = false;
  }
}

async function runOne(job) {
  job.status = 'up';
  job.pct = 2;
  job.text = 'يتصل...';
  job.error = null;
  renderQueue();
  const res = await ibra.convert({ id: job.id, imagePath: job.path, engineId: job.engineId, opts: job.opts });
  if (res.cancelled) {
    job.status = 'fail';
    job.text = 'انلغى';
  } else if (res.ok) {
    job.status = 'done';
    job.pct = 100;
    job.result = res;
    job.text = `${res.engine} · ${res.triangles ? Math.round(res.triangles / 1000) + 'K مضلع · ' : ''}${res.sizeKb} KB · seed ${res.seed ?? '-'}`;
    if (!state.selected || selectedItem()?.status !== 'done') state.selected = job.id;
    if (state.selected === job.id) showResult(job);
  } else {
    job.status = 'fail';
    job.error = res.error;
    job.text = res.error?.title || 'فشل';
    const fb = nextEngineFor(job);
    if (['quota', 'busy', 'timeout', 'sleeping'].includes(res.error?.kind)) {
      if (state.settings.autoFallback && fb && !job.fallbackFrom) {
        toast(`${res.error.title} — يحوّل تلقائياً بـ ${engineName(fb)}`, 4000);
        const copy = { ...job, id: 'j' + (++uid) + '_' + Date.now(), engineId: fb, status: 'wait', pct: 0, text: '', error: null, fallbackFrom: job.engineId };
        state.queue.splice(state.queue.indexOf(job) + 1, 0, copy);
      } else if (res.error.kind === 'quota' && state.queue.some(q => q.status === 'wait' && q.engineId === job.engineId)) {
        // نوقف الطابور ونسأل بدل ما تفشل كل الصور الباقية
        state.paused = { engineId: job.engineId, info: res.error };
        renderBanner();
      }
    }
  }
  renderQueue();
}

function nextEngineFor(job) {
  const ids = state.engines.map(e => e.id);
  const tried = new Set([job.engineId, job.fallbackFrom].filter(Boolean));
  return ids.find(id => !tried.has(id)) || null;
}

function onProgress(p) {
  const job = state.queue.find(q => q.id === p.id);
  if (!job || job.status === 'done' || job.status === 'fail') return;
  job.pct = Math.max(job.pct, Math.min(99, Math.round(p.pct || 0)));
  job.text = p.text || '';
  job.status = (p.stage === 'converting') ? 'conv' : 'up';
  updateQueueItem(job);
}

function retryTimeText(info) {
  if (!info?.retryAt) return '';
  const d = new Date(info.retryAt);
  const same = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString('ar-IQ', { hour: 'numeric', minute: '2-digit' });
  return `ترجع تكدر تحاول تقريباً ${same ? 'اليوم' : 'باچر'} الساعة ${t}.`;
}

function renderBanner() {
  const b = $('#pause-banner');
  if (!state.paused) { b.classList.add('hidden'); return; }
  const { engineId, info } = state.paused;
  const others = state.engines.filter(e => e.id !== engineId);
  b.innerHTML = `<b>انوقف الطابور: ${esc(info.title)} (${esc(engineName(engineId))})</b>
    <div>${esc(retryTimeText(info))}</div>
    <div class="btns">
      ${others.map(e => `<button class="btn gold small" data-cont="${e.id}">كمّل الباقي بـ ${esc(e.name)}</button>`).join('')}
      <button class="btn ghost small" data-stop>خليه واقف</button>
    </div>`;
  b.classList.remove('hidden');
  $$('[data-cont]', b).forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.cont;
    state.queue.filter(q => q.status === 'wait').forEach(q => { q.engineId = id; });
    state.paused = null;
    renderBanner();
    renderQueue();
    processQueue();
  }));
  $('[data-stop]', b).addEventListener('click', () => b.classList.add('hidden'));
}

function queueItemHTML(q) {
  const err = q.status === 'fail' && q.error ? `
    <div class="qi-err">
      <b>${esc(q.error.title)}</b>
      <p>${esc(q.error.detail)}</p>
      ${q.error.retryAt ? `<p>${esc(retryTimeText(q.error))}</p>` : ''}
      <div class="btns">
        ${state.engines.filter(e => e.id !== q.engineId).map(e => `<button class="btn gold small" data-fb="${e.id}">حوّل بـ ${esc(e.name)}</button>`).join('')}
        <button class="btn ghost small" data-again>أعد المحاولة</button>
      </div>
    </div>` : '';
  return `
    <img src="${esc(q.url)}" alt="" loading="lazy">
    <div>
      <div class="qi-top">
        <span class="qi-name" title="${esc(q.name)}">${esc(q.name)}</span>
        <span class="st ${q.status}">${STATUS[q.status]}</span>
        ${q.status === 'wait' || q.status === 'done' || q.status === 'fail' ? '<button class="qi-x" title="شيل من الطابور" data-rm>✕</button>' : ''}
      </div>
      <div class="bar"><b style="width:${q.pct}%"></b></div>
      <div class="qi-sub">${q.status === 'done' ? esc(q.text) : esc(engineName(q.engineId)) + (q.text ? ' · ' + esc(q.text) : '')}</div>
      ${err}
    </div>`;
}

function renderQueue() {
  const ul = $('#queue');
  ul.innerHTML = '';
  for (const q of state.queue) {
    const li = document.createElement('li');
    li.className = `qi ${q.status}` + (q.id === state.selected ? ' sel' : '');
    li.dataset.id = q.id;
    li.innerHTML = queueItemHTML(q);
    ul.appendChild(li);
  }
  $('#queue-count').textContent = state.queue.length;
  $('#start').disabled = !state.queue.some(q => q.status === 'wait');
}

function updateQueueItem(q) {
  const li = $(`.qi[data-id="${q.id}"]`);
  if (!li) return renderQueue();
  li.className = `qi ${q.status}` + (q.id === state.selected ? ' sel' : '');
  $('.bar > b', li).style.width = q.pct + '%';
  $('.st', li).className = 'st ' + q.status;
  $('.st', li).textContent = STATUS[q.status];
  $('.qi-sub', li).textContent = engineName(q.engineId) + (q.text ? ' · ' + q.text : '');
}

$('#queue').addEventListener('click', (e) => {
  const li = e.target.closest('.qi');
  if (!li) return;
  const q = state.queue.find(x => x.id === li.dataset.id);
  if (!q) return;
  if (e.target.closest('[data-rm]')) {
    state.queue = state.queue.filter(x => x !== q);
    if (state.selected === q.id) { state.selected = null; showResult(null); }
    return renderQueue();
  }
  const fb = e.target.closest('[data-fb]');
  if (fb) return retryWith(q, fb.dataset.fb);
  if (e.target.closest('[data-again]')) return retryWith(q, q.engineId);
  state.selected = q.id;
  showResult(q);
  renderQueue();
});

function showResult(q) {
  const has = q && q.status === 'done' && q.result;
  $('#empty-stage').classList.toggle('hidden', !!has);
  $('#result').classList.toggle('hidden', !has);
  if (!has) return;
  $('#res-title').textContent = q.name;
  $('#res-meta').textContent = q.text;
  $('#res-img').src = q.url;
  $('#res-model').src = q.result.url;
}

// ---------------- الحفظ بالمكتبة ----------------
let saving = null;

async function ensureLibrary() {
  if (state.settings.libraryDir) return true;
  const ok = await confirmBox('اختار مجلد المكتبة',
    'أول مرة: اختار مجلد IBRA-3D-LIBRARY (اللي بيه models و catalog.json). إذا ما عندك، اختار مجلد فارغ وأنا أسويه.',
    [{ label: 'اختيار المجلد', value: true, gold: true }, { label: 'إلغاء', value: false }]);
  if (!ok) return false;
  const r = await ibra.pickLibrary();
  if (!r.ok || !r.data) { if (r.message) toast(r.message); return false; }
  state.settings = await ibra.getSettings();
  return true;
}

async function openSaveModal(item) {
  if (!item?.result) return;
  if (!(await ensureLibrary())) return;
  saving = item;
  $('#sv-err').classList.add('hidden');
  const base = item.name.replace(/\.[^.]+$/, '');
  $('#sv-en').value = /[a-z]/i.test(base) ? base.replace(/[_\-]+/g, ' ') : '';
  $('#sv-ar').value = /[\u0600-\u06FF]/.test(base) ? base : '';
  if (!$('#sv-type').value) $('#sv-type').value = 'P';
  await suggestCode();
  $('#save-modal').classList.remove('hidden');
  $('#sv-ar').focus();
}

async function suggestCode() {
  const r = await ibra.libSuggest($('#sv-type').value);
  if (r.ok) $('#sv-code').value = r.data;
}

$('#sv-type').addEventListener('change', suggestCode);
$('#sv-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.add('hidden')));

$('#sv-ok').addEventListener('click', async () => {
  const code = $('#sv-code').value.trim().toUpperCase();
  const prefix = $('#sv-type').value;
  const err = (m) => { $('#sv-err').textContent = m; $('#sv-err').classList.remove('hidden'); };
  if (!new RegExp(`^${prefix}\\d{1,4}$`).test(code)) return err(`الرمز لازم يبدي بحرف ${prefix} وبعده رقم، مثل ${prefix}01`);
  if (!$('#sv-ar').value.trim() && !$('#sv-en').value.trim()) return err('اكتب الاسم بالعربي أو الانكليزي');

  const data = {
    code, prefix,
    name_ar: $('#sv-ar').value.trim(),
    name_en: $('#sv-en').value.trim(),
    srcPath: saving.result.path,
    overwrite: false
  };
  let r = await ibra.libAdd(data);
  if (!r.ok && r.code === 'EXISTS') {
    const sug = await ibra.libSuggest(prefix);
    const choice = await confirmBox('الرمز موجود',
      `الرمز ${code} موجود بالمكتبة. تبدله بالمجسم الجديد، لو تختار رمز ثاني؟`,
      [
        { label: 'بدّل الموجود', value: 'replace', danger: true },
        { label: `رمز ثاني (${sug.ok ? sug.data : ''})`, value: 'other', gold: true },
        { label: 'إلغاء', value: null }
      ]);
    if (choice === 'replace') r = await ibra.libAdd({ ...data, overwrite: true });
    else if (choice === 'other') { if (sug.ok) $('#sv-code').value = sug.data; return; }
    else return;
  }
  if (!r.ok) return err(r.message || 'صار خطأ');
  $('#save-modal').classList.add('hidden');
  toast(`انحفظ بالمكتبة: ${r.data.file} ✓`);
});

// ---------------- نافذة التأكيد ----------------
function confirmBox(title, text, buttons) {
  return new Promise(resolve => {
    $('#cf-title').textContent = title;
    $('#cf-text').textContent = text;
    const box = $('#cf-actions');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.gold ? 'gold' : b.danger ? 'ghost danger' : 'ghost');
      el.textContent = b.label;
      el.addEventListener('click', () => { $('#confirm-modal').classList.add('hidden'); resolve(b.value); });
      box.appendChild(el);
    }
    $('#confirm-modal').classList.remove('hidden');
  });
}

// ---------------- المكتبة ----------------
function bindLibrary() {
  $('#lib-pick').addEventListener('click', async () => {
    const r = await ibra.pickLibrary();
    if (!r.ok) return toast(r.message);
    if (r.data) { state.settings = await ibra.getSettings(); loadLibrary(); }
  });
  $('#lib-open').addEventListener('click', async () => { const r = await ibra.libOpen(); if (!r.ok) toast(r.message); });
  $('#lib-export').addEventListener('click', async () => {
    const r = await ibra.libExport();
    if (!r.ok) return toast(r.message);
    if (r.data) { toast('انصدّرت المكتبة ✓'); ibra.showInFolder(r.data); }
  });
  $('#lib-search').addEventListener('input', (e) => { state.lib.q = e.target.value.trim().toLowerCase(); renderLibrary(); });
  $('#lib-filters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.lib.filter = b.dataset.f;
    renderLibrary();
  });
  $('#lib-grid').addEventListener('click', async (e) => {
    const card = e.target.closest('.mc');
    if (!card) return;
    const m = state.lib.models.find(x => x.code === card.dataset.code);
    if (e.target.closest('[data-del]')) {
      const ok = await confirmBox('حذف المجسم',
        `تحذف ${m.code} (${m.name_ar || m.name_en || ''}) من المكتبة؟ الملف ينتقل لسلة المحذوفات وينشال من catalog.json.`,
        [{ label: 'احذف', value: true, danger: true }, { label: 'إلغاء', value: false }]);
      if (!ok) return;
      const r = await ibra.libRemove(m.code);
      if (!r.ok) return toast(r.message);
      toast('انحذف ✓');
      loadLibrary();
    } else if (e.target.closest('[data-show]')) {
      ibra.showInFolder(m.abs);
    }
  });
}

async function loadLibrary() {
  const r = await ibra.libList();
  if (!r.ok) {
    state.lib.models = [];
    state.lib.dir = '';
    $('#lib-dir').textContent = 'ما مختار مجلد';
    const e = $('#lib-empty');
    e.innerHTML = `<p>اختار مجلد مكتبتك IBRA-3D-LIBRARY (بيه models و catalog.json) حتى تشوف المجسمات هنا.</p><button class="btn gold" id="lib-pick2">اختيار المجلد</button>`;
    e.classList.remove('hidden');
    $('#lib-pick2').addEventListener('click', () => $('#lib-pick').click());
    $('#lib-grid').innerHTML = '';
    $('#lib-filters').innerHTML = '';
    return;
  }
  state.lib.dir = r.data.dir;
  state.lib.models = r.data.models;
  $('#lib-dir').textContent = r.data.dir;
  $('#lib-dir').title = r.data.dir;
  renderLibrary();
}

function typeOf(m) {
  const p = String(m.code || '').charAt(0).toUpperCase();
  return state.types.find(t => t.prefix === p);
}

let thumbObserver;
function renderLibrary() {
  const { models, filter, q } = state.lib;
  const counts = {};
  for (const m of models) { const p = String(m.code).charAt(0).toUpperCase(); counts[p] = (counts[p] || 0) + 1; }
  $('#lib-filters').innerHTML = `<button data-f="all" class="${filter === 'all' ? 'on' : ''}">الكل<span class="n">${models.length}</span></button>` +
    state.types.map(t => `<button data-f="${t.prefix}" class="${filter === t.prefix ? 'on' : ''}">${t.prefix} ${esc(t.ar)}<span class="n">${counts[t.prefix] || 0}</span></button>`).join('');

  const list = models.filter(m => {
    if (filter !== 'all' && String(m.code).charAt(0).toUpperCase() !== filter) return false;
    if (!q) return true;
    return [m.code, m.name_ar, m.name_en, m.type].some(v => String(v || '').toLowerCase().includes(q));
  });

  const empty = $('#lib-empty');
  if (!models.length) { empty.innerHTML = '<p>المكتبة فارغة. حوّل صورة واضغط «حفظ بالمكتبة».</p>'; empty.classList.remove('hidden'); }
  else if (!list.length) { empty.innerHTML = '<p>ماكو نتائج.</p>'; empty.classList.remove('hidden'); }
  else empty.classList.add('hidden');

  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const th = en.target;
      thumbObserver.unobserve(th);
      if (th.dataset.src) {
        th.innerHTML = `<model-viewer src="${esc(th.dataset.src)}" camera-controls auto-rotate auto-rotate-delay="0" rotation-per-second="25deg" environment-image="neutral" interaction-prompt="none" shadow-intensity="0.8"></model-viewer>`;
      }
    }
  }, { root: $('#lib-grid'), rootMargin: '200px' });

  const grid = $('#lib-grid');
  grid.innerHTML = list.map(m => {
    const t = typeOf(m);
    return `<div class="mc glass" data-code="${esc(m.code)}">
      <div class="thumb" ${m.url ? `data-src="${esc(m.url)}"` : ''}>${m.url ? '' : '<span class="missing">الملف مفقود</span>'}</div>
      <div class="mc-top"><span class="mc-code">${esc(m.code)}</span><span class="mc-size">${m.size_kb ?? '-'} KB · ${esc(t?.ar || m.type || '')}</span></div>
      <div class="mc-name">${esc(m.name_ar || '—')}</div>
      <div class="mc-en">${esc(m.name_en || '')}</div>
      <div class="mc-actions">
        <button class="btn ghost" data-show>المجلد</button>
        <button class="btn ghost danger" data-del>حذف</button>
      </div>
    </div>`;
  }).join('');
  $$('.thumb[data-src]', grid).forEach(th => thumbObserver.observe(th));
}

// ---------------- الإعدادات ----------------
function bindSettings() {
  $('#set-token-show').addEventListener('click', () => {
    const i = $('#set-token');
    i.type = i.type === 'password' ? 'text' : 'password';
  });
  $('#set-token-clear').addEventListener('click', () => { $('#set-token').value = ''; });
  $('#hf-link').addEventListener('click', () => ibra.openExternal('https://huggingface.co/settings/tokens'));
  $('#set-lib-pick').addEventListener('click', async () => {
    const r = await ibra.pickLibrary();
    if (!r.ok) return toast(r.message);
    if (r.data) { state.settings = await ibra.getSettings(); fillSettings(); }
  });
  $('#set-save').addEventListener('click', async () => {
    const token = $('#set-token').value.trim();
    if (token && !token.includes('•') && !/^hf_[A-Za-z0-9]{20,}$/.test(token)) {
      return toast('التوكن لازم يبدي بـ hf_');
    }
    await ibra.saveSettings({ token, autoFallback: $('#set-fallback').checked });
    state.settings = await ibra.getSettings();
    fillSettings();
    const s = $('#set-saved');
    s.classList.remove('hidden');
    setTimeout(() => s.classList.add('hidden'), 2000);
  });
}

function fillSettings() {
  const s = state.settings;
  $('#set-token').value = s.token || '';
  $('#set-token').type = 'password';
  $('#set-fallback').checked = !!s.autoFallback;
  $('#set-lib').textContent = s.libraryDir || 'ما مختار';
}

init();
