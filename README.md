<div dir="rtl">

# IBRA 3D

تطبيق ويندوز يحوّل الصورة الى مجسم ثلاثي الأبعاد بصيغة **GLB** — مجاني بالكامل.

الحاسبة ما تحتاج كارت شاشة قوي: التطبيق يرسل الصورة لأدوات مجانية على Hugging Face Spaces ويرجع ملف GLB جاهز للألعاب.

## المحركات

| المحرك | الـ Space | الملاحظات |
|---|---|---|
| Hunyuan3D 2.1 (الافتراضي) | `tencent/Hunyuan3D-2.1` | `/shape_generation` أو `/generation_all` (تكستشر) ثم `/on_export_click` لتقليل المضلعات وتصدير GLB |
| TRELLIS.2 | `microsoft/TRELLIS.2` | `/preprocess_image` ← `/image_to_3d` ← `/extract_glb` (التكستشر دائماً مشمول) |
| Hunyuan3D 2 (احتياط) | `tencent/Hunyuan3D-2` | نفس Hunyuan 2.1 مع مدخل `caption` إضافي |

أسماء الـ endpoints والمدخلات مأخوذة من الـ API الحي لكل Space (view_api) بتاريخ نوفمبر 2026.

## المميزات

- سحب وإفلات عدة صور (PNG / JPG / WEBP) بطابور، مع شريط تقدم وحالة لكل صورة.
- خيارات: إزالة الخلفية، تكستشر، عدد المضلعات (افتراضي 30 ألف)، seed.
- معاينة المجسم بـ model-viewer يم الصورة الأصلية.
- إذا خلص الحد المجاني (ZeroGPU) يطلع تنبيه عربي يشرح السبب ومتى ترجع تحاول، ويعرض التحويل بمحرك ثاني.
- توكن Hugging Face اختياري يزيد العدد اليومي، ينحفظ مشفّر على الجهاز فقط.
- إصلاح تلقائي للمجسمات: إضافة normals و material للمجسمات اللي تطلع بدونها حتى ما تظهر سوداء بالألعاب.
- مكتبة **IBRA-3D-LIBRARY**: حفظ برموز (D, T, W, C, Z, V, A, P)، catalog.json بنفس الشكل، بحث وفلترة، حذف، تصدير ZIP.

## التشغيل للتطوير

```
npm install
npm start
npm test
```

## البناء

ملف التنصيب (NSIS) ينبني تلقائياً بـ GitHub Actions وينزل بالـ Releases عند رفع tag:

```
git tag v1.0.0
git push origin v1.0.0
```

## حول

برمجة وتطوير ابراهيم الخزرجي

- موقع تطبيقاتي: https://ibraprogram.netlify.app/
- تليكرام: https://t.me/ibraprogram
- تيك توك: ibraprogram

المحركات ملك أصحابها (Tencent و Microsoft) ولكل محرك رخصته.

</div>
