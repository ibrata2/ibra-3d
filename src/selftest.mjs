// اختبار ذاتي للتطوير فقط: يشتغل إذا IBRA_SELFTEST=<مجلد> ويلتقط صور للشاشات
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

export async function runSelfTest(win, outDir, extra = {}) {
  const wc = win.webContents;
  const shot = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
  };
  const js = (code) => wc.executeJavaScript(code, true);
  await wait(2500);
  await shot('1-convert-empty');
  if (extra.image) {
    await js(`addToQueue([{path: ${JSON.stringify(extra.image)}, name: 'test-chair.png'}])`);
    await wait(6000);
    await shot('2-convert-error');
  }
  if (extra.glb) {
    await js(`(() => {
      const it = {id:'jt', path:${JSON.stringify(extra.image || '')}, name:'cube.png', url:'ibra3d://local/'+encodeURIComponent(${JSON.stringify(extra.image || '')}), engineId:'hunyuan21', opts:{}, status:'done', pct:100,
        text:'Hunyuan3D 2.1 · 30K مضلع · 517 KB · seed 1234', result:{path:${JSON.stringify(extra.glb)}, url:'ibra3d://local/'+encodeURIComponent(${JSON.stringify(extra.glb)})}, error:null};
      state.queue.unshift(it); state.selected='jt'; renderQueue(); showResult(it);
    })()`);
    await wait(9000);
    await shot('3-convert-result');
    await js(`openSaveModal(selectedItem())`);
    await wait(1200);
    await shot('4-save-modal');
    await js(`document.querySelector('#sv-ar').value='مكعب تجربة'; document.querySelector('#sv-en').value='Test cube'; document.querySelector('#sv-ok').click()`);
    await wait(1500);
    await shot('5-after-save');
  }
  await js(`showView('library')`);
  await wait(9000);
  await shot('6-library');
  await js(`showView('settings')`);
  await wait(800);
  await shot('7-settings');
  await js(`showView('about')`);
  await wait(800);
  await shot('8-about');
}
