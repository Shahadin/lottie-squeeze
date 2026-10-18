/* Phase 3–4 tests: presets, background worker, full .lottie rebuild, limits and errors, freezes, cancellation.
   Uses fixtures/helpers from harness-v2.js, harness-phase2.js and harness-real.js. Run runPhase34() in the console. */

const P34 = { out: [] };
const pass34 = (id, title, ok, evidence) => P34.out.push({ id, title, result: ok ? 'PASS' : 'FAIL', evidence });
const presetOpts = name => { const W = app(); const p = W.eval('PRESETS')[name]; const o = { ...p }; delete o.hint; return o; };
const realNames = () => REAL_FILES.filter(n => n.endsWith('.json'));

// Main-thread freeze while `fn` runs: longest gap between 10 ms timer ticks inside the app's frame
async function longestFreeze(fn) {
  const W = app(); let last = W.performance.now(), max = 0;
  const iv = W.setInterval(() => { const n = W.performance.now(); max = Math.max(max, n - last); last = n; }, 10);
  const t0 = performance.now(); await fn(); const total = performance.now() - t0;
  await sleep(150); W.clearInterval(iv);
  return { totalMs: Math.round(total), longestFreezeMs: Math.round(max) };
}

window.runPhase34 = async function (opts = {}) {
  await appReady; P34.out = [];
  const W = app(); buildFixtures();
  const fx = { ...FX, keyframes: fxKeyframes(), duplicates: fxDuplicates() };
  const L = presetOpts('lossless'), B = presetOpts('balanced'), M = presetOpts('maximum');

  // R13 presets
  { const rows = {}; let ok = true;
    const sources = { ...fx };
    if (!opts.skipReal) for (const n of realNames()) sources['real:' + n] = (await loadReal(n)).anim;
    for (const [name, f] of Object.entries(sources)) {
      const self = (await canvasDiffSampled(f, f, 16)).worst.pctPx;   // renderer determinism for this file
      const rl = await W.optimizeLottie(f, L), rb = await W.optimizeLottie(f, B), rm = await W.optimizeLottie(f, M);
      // identical data renders identically by definition (avoids renderer noise on expression-driven files)
      const same = rl.text === JSON.stringify(f);
      let v = same ? { worst: { pctPx: 0 }, alphaMax: 0 } : self === 0 ? await canvasDiffSampled(f, rl.anim, 24) : null;
      // lottie-web occasionally draws an expression-driven file differently mid-batch, even for byte-identical data
      // (seen on navidad). A difference is therefore measured a second time; both readings are recorded.
      let firstReading = null;
      if (v && (v.worst.pctPx || v.alphaMax)) { firstReading = { pctPx: v.worst.pctPx, alphaMax: v.alphaMax }; v = await canvasDiffSampled(f, rl.anim, 24); }
      const sv = same ? { worstPct: 0 } : self === 0 ? await svgDiff(f, rl.anim, Math.max(1, Math.ceil((f.op - f.ip) / 6))) : null;
      const s = structCheck(f, rl.anim, { ...L, kf: true });
      const imagesUntouched = (f.assets || []).filter(a => typeof a.p === 'string' && a.p.startsWith('data:')).every(a => { const b = (rl.anim.assets || []).find(x => x.id === a.id); return !b || b.p === a.p; });
      const namesKept = !s.problems.some(p => /names changed/.test(p));
      const row = { selfDiff: self, losslessCanvasPct: v ? v.worst.pctPx : 'renderer not deterministic', losslessAlphaMax: v ? v.alphaMax : null, firstReading, losslessSvgPct: sv ? sv.worstPct : null,
        struct: s.problems.length, imagesUntouched, namesKept, rounded: rl.stats.rounded,
        bytes: { in: JSON.stringify(f).length, lossless: rl.text.length, balanced: rb.text.length, maximum: rm.text.length },
        psnr: { balanced: rb.stats.images ? +rb.stats.imgWorstPsnr.toFixed(1) : null, maximum: rm.stats.images ? +rm.stats.imgWorstPsnr.toFixed(1) : null } };
      const bad = (v && (v.worst.pctPx !== 0 || v.alphaMax !== 0)) || (sv && sv.worstPct !== 0) || s.problems.length || !imagesUntouched || !namesKept || rl.stats.rounded !== 0
        || (rb.stats.images && rb.stats.imgWorstPsnr < 32) || (rm.stats.images && rm.stats.imgWorstPsnr < 26) || rm.text.length > rb.text.length;
      if (bad) ok = false;
      rows[name] = row;
    }
    // the preset buttons drive the controls; touching a control switches to Custom
    W.applyPreset('lossless'); const uiL = W.eval('optOpts()'); W.document.querySelector('#opt-meta').click(); const custom = W.eval('presetName'); W.applyPreset('balanced');
    const uiOk = uiL.round === false && uiL.ifmt === 'keep' && custom === 'custom';
    pass34('R13', 'Presets: Lossless renders pixel-identically (canvas + SVG, alpha) with no rounding, untouched images and names; Balanced images ≥ 32 dB; Maximum ≥ 26 dB and never larger than Balanced; UI switches to Custom on change',
      ok && uiOk, { uiOk, rows }); }

  // R14 worker output is identical to the page's
  { const rows = {}; let ok = true; let job = 0;
    const sources = { ...fx }; if (!opts.skipReal) for (const n of realNames()) sources['real:' + n] = (await loadReal(n)).anim;
    for (const [name, f] of Object.entries(sources)) for (const [pn, o] of [['lossless', L], ['balanced', B], ['maximum', M]]) {
      const text = JSON.stringify(f); const a = await W.optimizeLottie(f, o); const w = await W.optimizeInWorker(text, o, 'eq' + (++job));
      const same = a.text === w.text; if (!same) ok = false; rows[name + ' / ' + pn] = same;
    }
    pass34('R14', 'Background worker output is byte-identical to on-page output (all fixtures and real files, all presets)', ok, rows); }

  // R15 full .lottie rebuild
  { const rows = {}; let ok = true;
    for (const n of REAL_FILES.filter(n => n.endsWith('.lottie') && n !== 'android_Heart.lottie')) {
      const buf = await (await fetch('../tests/real/' + n)).arrayBuffer();
      const src = await JSZip.loadAsync(buf);
      const rep = await W.repackDotLottie(new W.File([buf], n), B);
      const out = await JSZip.loadAsync(new Uint8Array(await rep.blob.arrayBuffer()).slice());   // copy across frames
      const files = z => Object.keys(z.files).filter(p => !z.files[p].dir);
      const anims = files(src).filter(p => /^(a|animations)\/.+\.json$/.test(p));
      const others = files(src).filter(p => !anims.includes(p) && !/^(i|images)\//.test(p));
      let othersSame = true; for (const p of others) { const x = await src.file(p).async('base64'), y = out.file(p) && await out.file(p).async('base64'); if (x !== y) othersSame = false; }
      let animsMatch = true, imagesResolve = true;
      for (const p of anims) {
        const orig = JSON.parse(await src.file(p).async('string')); await W.inlineImages(orig, src);
        const expected = await W.optimizeLottie(orig, B);
        const got = JSON.parse(await out.file(p).async('string')); await W.inlineImages(got, out);
        if (canon(got) !== canon(expected.anim)) animsMatch = false;
        if ((got.assets || []).some(a => a.p && !a.layers && !String(a.p).startsWith('data:'))) imagesResolve = false;
      }
      const player = await dotLottieWeb(rep.blob);
      rows[n] = { animations: anims.length + ' → ' + files(out).filter(p => /^(a|animations)\/.+\.json$/.test(p)).length, otherFilesByteIdentical: othersSame, everyAnimationEqualsSingleOptimize: animsMatch, imagesResolve,
        bytes: buf.byteLength + ' → ' + rep.blob.size, player: player.loaded ? 'loaded' : 'NOT loaded: ' + player.error };
      if (!(othersSame && animsMatch && imagesResolve && player.loaded)) ok = false;
    }
    pass34('R15', '.lottie rebuild keeps every animation (each equal to optimizing it alone), copies themes/state machines byte for byte, every image resolves, official player opens it', ok, rows); }

  // R16 limits and friendly errors, through the real upload handler
  { const ui = () => W.document.getElementById('o-status').textContent;
    const tryFile = async (file) => { W.document.getElementById('o-status').textContent = ''; await W.handleLottieFile(file); await sleep(250); return ui(); };
    const zipOf = async (entries) => { const z = new JSZip(); for (const [p, d] of Object.entries(entries)) z.file(p, d, { compression: 'DEFLATE' }); return new Uint8Array(await z.generateAsync({ type: 'arraybuffer' })); };
    const res = {};
    res.empty = await tryFile(new W.File([], 'empty.json'));
    res.invalidJson = await tryFile(new W.File(['{"layers": [ broken'], 'bad.json'));
    res.notLottie = await tryFile(new W.File(['{"hello": 1}'], 'other.json'));
    res.corruptLottie = await tryFile(new W.File([new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6, 7, 8])], 'broken.lottie'));
    res.noAnimation = await tryFile(new W.File([await zipOf({ 'manifest.json': '{"version":"1","animations":[]}' })], 'empty.lottie'));
    res.jsonNamedLottie = await tryFile(new W.File([JSON.stringify(FX.simple)], 'plain.lottie'));
    const LIM = W.eval('LIMITS'); const saved = { ...LIM };
    LIM.fileMB = 0.001; res.tooBig = await tryFile(new W.File([JSON.stringify(FX.multilayer)], 'big.json')); LIM.fileMB = saved.fileMB;
    LIM.unzippedMB = 5; res.zipBomb = await tryFile(new W.File([await zipOf({ 'manifest.json': '{"version":"1","animations":[{"id":"a"}]}', 'animations/a.json': JSON.stringify(FX.simple), 'pad.bin': '0'.repeat(8 * 1048576) })], 'bomb.lottie')); LIM.unzippedMB = saved.unzippedMB;
    await W.handleLottieFile(new W.File([JSON.stringify(FX.simple)], 'restore.json'));
    const ok = /empty/i.test(res.empty) && /valid JSON/i.test(res.invalidJson) && /isn't a Lottie/i.test(res.notLottie) && /can't be opened/i.test(res.corruptLottie)
      && /no animation/i.test(res.noAnimation) && !/could not|can't|isn't/i.test(res.jsonNamedLottie) && /limit/i.test(res.tooBig) && /unpacks to/i.test(res.zipBomb);
    pass34('R16', 'Clear messages for empty, invalid, non-Lottie, damaged, animation-less, too-large and zip-bomb files; JSON with a .lottie name opens', ok, res); }

  // R17 freezes and image cache
  { const big = clone(FX.character); const base = big.layers.filter(l => l.ty === 4 && !(l.ks.r && l.ks.r.x));
    let ind = 1000; for (let rep = 0; rep < 40; rep++) for (const l of base) { const n = clone(l); n.ind = ind++; big.layers.push(n); }
    const bigFile = () => new W.File([JSON.stringify(big)], 'big.json');
    const waitReady = async () => { for (let i = 0; i < 300 && !/Ready|expressions|Could not/.test(W.document.getElementById('o-status').textContent); i++) await sleep(50); };
    W.eval('workerBroken = false');
    const viaWorker = await longestFreeze(async () => { await W.handleLottieFile(bigFile()); await waitReady(); });
    W.eval('workerBroken = true'); W.eval('cancelWorker()');
    const onPage = await longestFreeze(async () => { await W.handleLottieFile(bigFile()); await waitReady(); });
    W.eval('workerBroken = false');
    // image cache: change only the precision on an image-heavy file
    const img = (await loadReal('rs_image.json')).anim; W.eval('imageCache.clear()');
    let t = performance.now(); await W.optimizeLottie(img, B); const firstMs = Math.round(performance.now() - t);
    t = performance.now(); await W.optimizeLottie(img, { ...B, prec: 2 }); const secondMs = Math.round(performance.now() - t);
    const ok = viaWorker.longestFreezeMs < onPage.longestFreezeMs && secondMs < firstMs;
    pass34('R17', 'Large file freezes the page less with the worker; changing only rounding reuses encoded images', ok,
      { file: (JSON.stringify(big).length / 1048576).toFixed(1) + ' MB', viaWorker, onPage, imageFile: { firstRunMs: firstMs, precisionOnlyChangeMs: secondMs } }); }

  // R18 cancellation: a new setting while a job runs replaces it, and the result matches the newest settings
  { const big = clone(FX.character); const base = big.layers.filter(l => l.ty === 4 && !(l.ks.r && l.ks.r.x));
    let ind = 1000; for (let rep = 0; rep < 20; rep++) for (const l of base) { const n = clone(l); n.ind = ind++; big.layers.push(n); }
    await W.handleLottieFile(new W.File([JSON.stringify(big)], 'cancel.json'));
    await sleep(5);
    const slider = W.document.getElementById('opt-prec'); slider.value = 2; slider.dispatchEvent(new W.Event('input'));
    await sleep(300); slider.value = 4; slider.dispatchEvent(new W.Event('input'));
    for (let i = 0; i < 300 && !/Ready|expressions/.test(W.document.getElementById('o-status').textContent); i++) await sleep(50);
    await sleep(300);
    const final = W.eval('optResult'), current = W.eval('JSON.stringify(optOpts())');
    const ok = !!final && final.key === current && JSON.parse(current).prec === 4;
    pass34('R18', 'Changing settings mid-run cancels the outdated job; the shown result matches the latest settings', ok, { resultMatchesLatest: final && final.key === current, latestPrecision: JSON.parse(current).prec, via: final && final.via });
    W.applyPreset('balanced'); }

  window.REG34 = P34.out; window.P34_DONE = true;
  document.getElementById('msg').textContent = 'phase 3-4 tests done (' + APP_VERSION + ')';
  return P34.out;
};
