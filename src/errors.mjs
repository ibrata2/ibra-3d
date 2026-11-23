// تحويل أخطاء Hugging Face / ZeroGPU الى رسائل عربية واضحة

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h} ساعة`);
  if (m) parts.push(`${m} دقيقة`);
  if (!h && s) parts.push(`${s} ثانية`);
  return parts.join(' و ') || 'لحظات';
}

/** يستخرج مدة الانتظار بالثواني من رسالة الخطأ إن وجدت */
export function parseRetrySeconds(msg) {
  if (!msg) return null;
  // "Try again in 0:12:34" أو "retry in 12:34"
  let m = msg.match(/(?:try again|retry)\s+in\s+(\d+):(\d{1,2}):(\d{1,2})/i);
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  m = msg.match(/(?:try again|retry)\s+in\s+(\d+):(\d{1,2})(?!:)/i);
  if (m) return (+m[1]) * 60 + (+m[2]);
  m = msg.match(/(?:try again|retry)\s+in\s+(\d+)\s*(second|sec|s|minute|min|m|hour|h)\b/i);
  if (m) {
    const n = +m[1];
    const u = m[2].toLowerCase();
    if (u.startsWith('h')) return n * 3600;
    if (u.startsWith('m')) return n * 60;
    return n;
  }
  return null;
}

/**
 * يرجع {kind, title, detail, retryAt, canFallback}
 * kind: quota | busy | timeout | sleeping | network | auth | input | unknown
 */
export function explainError(err) {
  const raw = errText(err);
  const low = raw.toLowerCase();
  const retry = parseRetrySeconds(raw);
  const retryAt = retry != null ? Date.now() + retry * 1000 : null;
  const when = retry != null
    ? `تكدر ترجع تحاول بعد ${fmtDuration(retry)} تقريباً.`
    : null;

  if (/quota|exceeded your|gpu limit|daily limit|zerogpu.*(limit|quota)/i.test(raw)) {
    // مثال حقيقي: "You have exceeded your ZeroGPU quota (120s requested vs. 159s left). Try again in 23:54:13."
    const q = raw.match(/\((\d+)\s*s\s*requested\s*vs\.?\s*(\d+)\s*s\s*left\)/i);
    const lines = [
      'Hugging Face يعطي كل مستخدم وقت معالجة مجاني محدود (ZeroGPU)، والوقت مشترك بين كل المحركات: إذا خلص بمحرك، خلص بالكل.'
    ];
    if (q) lines.push(`هذا المحرك طلب ${q[1]} ثانية، والباقي عندك ${q[2]} ثانية بس، فرفض يبدأ.`);
    if (q && +q[2] >= 60) lines.push('الباقي يكفي لمحرك يطلب وقت أقل: Hunyuan3D بدون تكستشر يطلب حوالي 60 ثانية.');
    else lines.push('الوقت المجاني خلص تقريباً كله، فتبديل المحرك ما راح يفيد هسه.');
    lines.push(when || 'الحد يتجدد تدريجياً، جرّب بعد كم ساعة.');
    lines.push('الحل الأسرع: توكن Hugging Face من حساب مجاني بالإعدادات، يحسب الوقت على حسابك بدل شبكة الإنترنت.');
    return {
      kind: 'quota', raw, retryAt, canFallback: true,
      requested: q ? +q[1] : null, left: q ? +q[2] : null,
      title: 'خلص الحد المجاني (ZeroGPU)',
      detail: lines.join('\n')
    };
  }
  if (/no gpu was available|gpu.*not available|queue is full|too many requests|429/i.test(raw)) {
    return {
      kind: 'busy', raw, retryAt, canFallback: true,
      title: 'المحرك مزدحم هسه',
      detail: 'كل كروت الشاشة المجانية مشغولة بهاللحظة. جرّب بعد دقيقة أو دقيقتين، أو حوّل بمحرك ثاني.'
    };
  }
  if (/gpu task aborted|timeout|timed out|duration/i.test(low)) {
    return {
      kind: 'timeout', raw, retryAt, canFallback: true,
      title: 'التحويل طوّل أكثر من الوقت المسموح',
      detail: 'المحرك وقف المعالجة لأنها تجاوزت الوقت المجاني. جرّب تقلل الخيارات (بدون تكستشر أو مضلعات أقل) أو جرّب محرك ثاني.'
    };
  }
  if (/sleeping|building|space.*(paused|stopped)|runtime_error|not running|space is not/i.test(low)) {
    return {
      kind: 'sleeping', raw, retryAt, canFallback: true,
      title: 'المحرك نايم أو متوقف',
      detail: 'الـ Space على Hugging Face متوقف أو دا يشتغل من جديد. انتظر دقيقتين وجرّب، أو حوّل بمحرك ثاني.'
    };
  }
  if (/unauthorized|401|403|invalid token|invalid credentials/i.test(low)) {
    return {
      kind: 'auth', raw, retryAt, canFallback: true,
      title: 'التوكن غير صالح',
      detail: 'توكن Hugging Face اللي بالإعدادات مرفوض. تأكد منه أو امسحه وجرّب بدون توكن.'
    };
  }
  if (/metadata could not be loaded|could not resolve app config|fetch failed|enotfound|econnreset|network|socket|getaddrinfo|eai_again/i.test(low)) {
    return {
      kind: 'network', raw, retryAt, canFallback: false,
      title: 'مشكلة بالإنترنت',
      detail: 'ما كدرت أوصل لـ Hugging Face. تأكد من الإنترنت (وإذا الموقع محجوب عندك جرّب شبكة ثانية) وأعد المحاولة.'
    };
  }
  return {
    kind: 'unknown', raw, retryAt, canFallback: true,
    title: 'المحرك رجّع خطأ',
    detail: 'صار خطأ أثناء التحويل. جرّب محرك ثاني أو صورة أوضح (جسم واحد بخلفية بسيطة).'
  };
}

export function errText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const parts = [];
  for (const k of ['message', 'title', 'detail', 'original_msg', 'error']) {
    if (err[k] && typeof err[k] === 'string') parts.push(err[k]);
  }
  if (!parts.length) {
    try { parts.push(JSON.stringify(err)); } catch { parts.push(String(err)); }
  }
  return parts.join(' | ');
}
