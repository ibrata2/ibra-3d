// مكتبة IBRA-3D-LIBRARY: مجلد فيه models/ و catalog.json
import fs from 'node:fs';
import path from 'node:path';

export const TYPES = [
  { prefix: 'D', type: 'drivable', ar: 'سيارات سياقة', en: 'Drivable cars' },
  { prefix: 'T', type: 'truck', ar: 'شاحنات ومقطورات', en: 'Trucks & trailers' },
  { prefix: 'W', type: 'wheel', ar: 'عجلات', en: 'Wheels' },
  { prefix: 'C', type: 'character', ar: 'شخصيات', en: 'Characters' },
  { prefix: 'Z', type: 'zombie', ar: 'زومبي', en: 'Zombies' },
  { prefix: 'V', type: 'vehicle', ar: 'مركبات', en: 'Vehicles' },
  { prefix: 'A', type: 'car', ar: 'سيارات', en: 'Cars' },
  { prefix: 'P', type: 'prop', ar: 'أغراض', en: 'Props' }
];

export function typeByPrefix(p) {
  return TYPES.find(t => t.prefix === String(p || '').toUpperCase()) || null;
}

/**
 * يقرأ catalog.json ويحافظ على شكله الأصلي.
 * يرجع { entries, wrap } حيث wrap(entries) يرجع الكائن بنفس الشكل للحفظ.
 */
export function readCatalog(libDir) {
  const file = path.join(libDir, 'catalog.json');
  if (!fs.existsSync(file)) {
    return { entries: [], wrap: (e) => e, file, existed: false };
  }
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const data = text.trim() ? JSON.parse(text) : [];
  if (Array.isArray(data)) return { entries: data, wrap: (e) => e, file, existed: true };
  if (data && typeof data === 'object') {
    const key = ['models', 'items', 'catalog', 'entries', 'assets'].find(k => Array.isArray(data[k]))
      || Object.keys(data).find(k => Array.isArray(data[k]));
    if (key) {
      return { entries: data[key], wrap: (e) => ({ ...data, [key]: e }), file, existed: true };
    }
    return { entries: [], wrap: (e) => ({ ...data, models: e }), file, existed: true };
  }
  return { entries: [], wrap: (e) => e, file, existed: true };
}

function writeCatalog(cat, entries) {
  const tmp = cat.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cat.wrap(entries), null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, cat.file);
}

export function ensureLibrary(libDir) {
  fs.mkdirSync(path.join(libDir, 'models'), { recursive: true });
  const file = path.join(libDir, 'catalog.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]\n', 'utf8');
}

export function listModels(libDir) {
  const cat = readCatalog(libDir);
  return cat.entries.map(e => {
    const abs = path.join(libDir, e.file || `models/${e.code}.glb`);
    return { ...e, abs, exists: fs.existsSync(abs) };
  });
}

function codeNum(code, prefix) {
  const m = String(code || '').toUpperCase().match(new RegExp(`^${prefix}(\\d+)$`));
  return m ? parseInt(m[1], 10) : null;
}

/** يقترح الرمز التالي للنوع، مثل D07، بالاعتماد على الكتالوج والملفات الموجودة */
export function suggestCode(libDir, prefix) {
  prefix = String(prefix).toUpperCase();
  let max = 0;
  let width = 2;
  for (const e of readCatalog(libDir).entries) {
    const n = codeNum(e.code, prefix);
    if (n != null) {
      max = Math.max(max, n);
      width = Math.max(width, String(e.code).length - prefix.length);
    }
  }
  const mdir = path.join(libDir, 'models');
  if (fs.existsSync(mdir)) {
    for (const f of fs.readdirSync(mdir)) {
      const n = codeNum(path.parse(f).name, prefix);
      if (n != null) max = Math.max(max, n);
    }
  }
  return prefix + String(max + 1).padStart(width, '0');
}

export function codeExists(libDir, code) {
  code = String(code).toUpperCase();
  const inCat = readCatalog(libDir).entries.some(e => String(e.code).toUpperCase() === code);
  const onDisk = fs.existsSync(path.join(libDir, 'models', `${code}.glb`));
  return inCat || onDisk;
}

/**
 * يحفظ المجسم بالمكتبة.
 * {code, name_ar, name_en, prefix, srcPath, overwrite}
 */
export function addModel(libDir, { code, name_ar, name_en, prefix, srcPath, overwrite }) {
  ensureLibrary(libDir);
  code = String(code).trim().toUpperCase();
  if (!/^[A-Z]\d{1,4}$/.test(code)) throw new Error('الرمز لازم يكون حرف وبعده رقم، مثل D01');
  const t = typeByPrefix(prefix || code[0]);
  if (!t) throw new Error('نوع غير معروف');
  if (!overwrite && codeExists(libDir, code)) {
    const e = new Error('الرمز موجود');
    e.code = 'EXISTS';
    throw e;
  }
  const rel = `models/${code}.glb`;
  const dest = path.join(libDir, rel);
  fs.copyFileSync(srcPath, dest);
  const size_kb = Math.round(fs.statSync(dest).size / 1024);

  const cat = readCatalog(libDir);
  // نستخدم نفس قيمة type الموجودة بالكتالوج لنفس الحرف حتى يبقى الشكل موحّد
  const sameType = cat.entries.find(e => String(e.code || '').toUpperCase().startsWith(t.prefix) && /\d$/.test(e.code || '') && e.type);
  const entry = { code, name_ar: name_ar || '', name_en: name_en || '', type: sameType ? sameType.type : t.type, file: rel, size_kb };
  const entries = cat.entries.filter(e => String(e.code).toUpperCase() !== code);
  const idx = cat.entries.findIndex(e => String(e.code).toUpperCase() === code);
  if (idx >= 0) entries.splice(Math.min(idx, entries.length), 0, entry);
  else entries.push(entry);
  writeCatalog(cat, entries);
  return entry;
}

/** يحذف السطر من الكتالوج ويرجع مسار الملف (الحذف الفعلي للملف يتم بسلة المحذوفات بالـ main) */
export function removeModel(libDir, code) {
  code = String(code).toUpperCase();
  const cat = readCatalog(libDir);
  const entry = cat.entries.find(e => String(e.code).toUpperCase() === code);
  writeCatalog(cat, cat.entries.filter(e => String(e.code).toUpperCase() !== code));
  const rel = entry?.file || `models/${code}.glb`;
  return path.join(libDir, rel);
}
