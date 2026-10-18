/* Phase 2 tests: exact keyframe optimization, duplicate-asset merging, .lottie export.
   Loaded after harness-v2.js (uses its fixtures, diffs and helpers). Run runPhase2() in the console. */

// key-order-independent JSON, so a round trip is judged on content
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

function fxKeyframes() {
  const EZ = () => ({ i: { x: [0.667], y: [1] }, o: { x: [0.333], y: [0] } });
  // every keyframe, the last included, carries easing so trimming can be tested
  const kfs = (vals, times, extra = () => ({})) => ({ a: 1, k: vals.map((s, j) => ({ t: times[j], s, ...EZ(), ...extra(j) })) });
  const T = o => Object.assign({ o: st(100), r: st(0), p: st([150, 150, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) }, o);
  const L1 = shapeLayer(1, 'Constant position and opacity', T({ o: kfs([[100], [100], [100]], [0, 30, 60]), p: kfs([[150, 150, 0], [150, 150, 0]], [0, 60], () => ({ to: [0, 0, 0], ti: [0, 0, 0] })) }),
    [group('A', [{ ty: 'rc', d: 1, s: st([60, 60]), p: st([0, 0]), r: st(0) }, fill([0.9, 0.3, 0.2])])], 60);
  const L2 = shapeLayer(2, 'Loop on a spatial curve', T({ p: kfs([[60, 60, 0], [60, 60, 0]], [0, 60], () => ({ to: [80, 0, 0], ti: [0, 80, 0] })) }),
    [group('B', [{ ty: 'el', d: 1, s: st([30, 30]), p: st([0, 0]) }, fill([0.2, 0.5, 0.9])])], 60);
  const L3 = shapeLayer(3, 'Plateau', T({ p: st([220, 220, 0]), r: kfs([[0], [50], [50], [50], [100]], [0, 15, 30, 45, 60]) }),
    [group('C', [{ ty: 'rc', d: 1, s: st([50, 20]), p: st([0, 0]), r: st(0) }, fill([0.1, 0.7, 0.3])])], 60);
  const shp = blob(8, 30);
  const L4 = shapeLayer(4, 'Constant path', ks([80, 230]),
    [group('D', [{ ty: 'sh', ks: { a: 1, k: [{ t: 0, s: [shp], i: { x: 0.667, y: 1 }, o: { x: 0.333, y: 0 } }, { t: 60, s: [clone(shp)] }] } }, fill([0.6, 0.2, 0.8])])], 60);
  const L5 = shapeLayer(5, 'Constant colour', ks([230, 80]),
    [group('E', [{ ty: 'rc', d: 1, s: st([40, 40]), p: st([0, 0]), r: st(5) }, { ty: 'fl', c: kfs([[1, 0.5, 0, 1], [1, 0.5, 0, 1]], [0, 60]), o: st(100), r: 1 }])], 60);
  const L6 = shapeLayer(6, 'Moving (control)', T({ p: kfs([[40, 150, 0], [260, 150, 0]], [0, 60]) }),
    [group('F', [{ ty: 'el', d: 1, s: st([16, 16]), p: st([0, 0]) }, fill([0, 0, 0])])], 60);
  return root('keyframes', 300, 300, 30, 60, [L1, L2, L3, L4, L5, L6]);
}

function fxDuplicates() {
  const f = clone(FX.images);
  f.assets.push({ ...clone(f.assets[0]), id: 'img_photo_copy' });
  f.layers.push({ ...clone(f.layers[2]), ind: 4, nm: 'photo copy', refId: 'img_photo_copy', ks: ks([120, 300], { a: st([160, 120, 0]), s: st([40, 40, 100]) }) });
  const comp = (id, nm, colour) => ({ id, nm, layers: [shapeLayer(1, 'Dot', ks([20, 20]), [group('G', [{ ty: 'el', d: 1, s: st([30, 30]), p: st([0, 0]) }, fill(colour)])], 60)] });
  f.assets.push(comp('comp_a', 'Badge A', [0.1, 0.6, 0.9]), comp('comp_b', 'Badge B (same content)', [0.1, 0.6, 0.9]), comp('comp_c', 'Badge C (different colour)', [0.9, 0.1, 0.4]));
  [['comp_a', 330], ['comp_b', 360], ['comp_c', 390]].forEach(([id, x], i) => f.layers.push({ ddd: 0, ind: 10 + i, ty: 0, nm: id, refId: id, sr: 1, ks: ks([x, 40]), ao: 0, w: 40, h: 40, ip: 0, op: 60, st: 0, bm: 0 }));
  return f;
}

// The official LottieFiles player (ThorVG renderer), loaded from its npm package
async function dotLottieWeb(blob) {
  try {
    if (!window.__DL) window.__DL = await import('https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web/+esm');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 200; canvas.style.cssText = 'position:absolute;left:-5000px'; document.body.append(canvas);
    // the package is built inside the app's iframe; copy its bytes into this page's realm,
    // otherwise the player's `instanceof ArrayBuffer` check fails and it tries to parse the bytes as JSON
    const bytes = new Uint8Array(await blob.arrayBuffer()).slice().buffer;
    const p = new window.__DL.DotLottie({ canvas, data: bytes, autoplay: false, loop: false });
    const res = await new Promise(r => {
      p.addEventListener('load', () => r({ loaded: true }));
      p.addEventListener('loadError', e => r({ loaded: false, error: String(e && (e.error || e.message || e.type)) }));
      setTimeout(() => r({ loaded: false, error: 'timeout' }), 10000);
    });
    if (res.loaded) {
      p.setFrame(Math.floor(p.totalFrames / 2)); await sleep(200);
      const c2 = document.createElement('canvas'); c2.width = c2.height = 200; const x2 = c2.getContext('2d'); x2.drawImage(canvas, 0, 0);
      const px = x2.getImageData(0, 0, 200, 200).data; let painted = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) painted++;
      Object.assign(res, { totalFrames: p.totalFrames, paintedPct: +(painted / 400).toFixed(1) });
    }
    p.destroy(); canvas.remove();
    return res;
  } catch (e) { return { loaded: false, error: 'player unavailable: ' + e.message }; }
}

window.runPhase2 = async function () {
  await appReady;
  const W = app(); buildFixtures(); const D = await appDefaults();
  const out = [];
  const pass = (id, title, ok, evidence) => out.push({ id, title, result: ok ? 'PASS' : 'FAIL', evidence });
  const exprOn = (f, li) => { const c = clone(f); c.layers[li].ks.r = { a: 0, k: 0, x: 'var $bm_rt;\n$bm_rt = 0;' }; return c; };

  // R9 exact keyframe optimization
  { const f = fxKeyframes(); const r = await W.optimizeLottie(f, D); const ref = await W.optimizeLottie(f, { ...D, kf: false });
    const L = i => r.anim.layers.find(l => l.ind === i);
    const lastClean = []; walk(r.anim, n => { if (n.a === 1 && Array.isArray(n.k) && n.k.length > 1 && typeof n.k[0].t === 'number') { const last = n.k[n.k.length - 1]; lastClean.push(!['i', 'o', 'to', 'ti'].some(k => k in last)); } });
    const expect = {
      opacityStatic: L(1).ks.o.a === 0 && L(1).ks.o.k === 100,
      positionStatic: L(1).ks.p.a === 0 && JSON.stringify(L(1).ks.p.k) === '[150,150,0]',
      spatialLoopKeptAnimated: L(2).ks.p.a === 1 && L(2).ks.p.k.length === 2,
      plateauMiddleRemoved: L(3).ks.r.k.length === 4,
      pathStatic: L(4).shapes[0].it[0].ks.a === 0 && !Array.isArray(L(4).shapes[0].it[0].ks.k),
      colourStatic: L(5).shapes[0].it[1].c.a === 0,
      movingKept: L(6).ks.p.a === 1 && L(6).ks.p.k.length === 2,
      lastKeyframesTrimmed: lastClean.length > 0 && lastClean.every(Boolean)
    };
    const vc = await canvasDiff(ref.anim, r.anim), vs = await svgDiff(ref.anim, r.anim, 1);
    const re = await W.optimizeLottie(exprOn(f, 5), D);
    pass('R9', 'Exact keyframe optimization: constant properties become static, a redundant plateau key is dropped, a spatial loop and real motion stay, final-key easing trimmed; skipped with expressions',
      Object.values(expect).every(Boolean) && vc.worst.pctPx === 0 && vc.alphaMax === 0 && vs.worstPct === 0 && vs.alphaMax === 0 && re.stats.kfSkipped === 'expressions' && re.stats.kfRemoved === 0,
      { ...expect, stats: { static: r.stats.kfStatic, removed: r.stats.kfRemoved, trimmed: r.stats.kfTrimmed }, canvasEveryFramePctPx: vc.worst.pctPx, canvasAlphaMax: vc.alphaMax,
        svgEveryFramePct: vs.worstPct, svgAlphaMax: vs.alphaMax, bytesWithoutWith: [ref.text.length, r.text.length], withExpression: re.stats.kfSkipped }); }

  // R10 duplicate assets
  { const f = fxDuplicates(); const r = await W.optimizeLottie(f, D); const ref = await W.optimizeLottie(f, { ...D, dedupe: false });
    const ids = r.anim.assets.map(a => a.id); const refs = r.anim.layers.map(l => l.refId).filter(Boolean);
    const expect = { photoCopyMerged: !ids.includes('img_photo_copy'), compBMerged: !ids.includes('comp_b'), compCKept: ids.includes('comp_c'), everyRefResolves: refs.every(x => ids.includes(x)), layersKept: r.anim.layers.length === f.layers.length };
    const vc = await canvasDiff(ref.anim, r.anim), vs = await svgDiff(ref.anim, r.anim);
    const re = await W.optimizeLottie(exprOn(f, 0), D);
    pass('R10', 'Identical images and precomps are stored once; a differing precomp is kept; every layer still resolves; skipped with expressions',
      Object.values(expect).every(Boolean) && r.stats.dupAssets === 2 && vc.worst.pctPx === 0 && vc.alphaMax === 0 && vs.worstPct === 0 && re.stats.dupAssets === 0,
      { ...expect, merged: r.stats.dupAssets, bytesWithoutWith: [ref.text.length, r.text.length], canvasPctPx: vc.worst.pctPx, svgPct: vs.worstPct, mergedWithExpression: re.stats.dupAssets }); }

  // R11 .lottie export: layout, round trip, official player
  { const rows = []; let ok = true;
    for (const [name, f] of Object.entries({ ...FX, keyframes: fxKeyframes(), duplicates: fxDuplicates() })) {
      const r = await W.optimizeLottie(f, D); const pkg = await W.buildDotLottie(r.anim);
      const zip = await JSZip.loadAsync(pkg); const files = Object.keys(zip.files).filter(p => !zip.files[p].dir);
      const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
      const json = JSON.parse(await zip.file('animations/' + manifest.animations[0].id + '.json').async('string'));
      const noInlineImages = !JSON.stringify(json).includes('data:image');
      const everyImageFileExists = (json.assets || []).filter(a => a.e === 0 && a.p && !a.layers).every(a => files.includes('images/' + a.p));
      const back = await W.readDotLottie(new File([pkg], name + '.lottie'));
      const roundTrip = canon(back) === canon(r.anim);
      const player = await dotLottieWeb(pkg);
      rows.push({ name, jsonBytes: new Blob([r.text]).size, lottieBytes: pkg.size, files, manifestVersion: manifest.version, noInlineImages, everyImageFileExists, roundTrip,
        player: player.loaded ? `loaded, ${player.totalFrames} frames, ${player.paintedPct}% painted` : 'NOT loaded: ' + player.error });
      if (!(noInlineImages && everyImageFileExists && roundTrip && manifest.version === '1' && player.loaded)) ok = false;
    }
    pass('R11', '.lottie export: valid layout, images stored as files, reopens to identical data, opens in the official dotLottie player', ok, rows); }

  // R12 repeat passes stay stable with every feature on
  { const res = {}; let ok = true;
    for (const [name, f] of Object.entries({ ...FX, keyframes: fxKeyframes(), duplicates: fxDuplicates() })) {
      const p1 = await W.optimizeLottie(f, D), p2 = await W.optimizeLottie(p1.anim, D), p3 = await W.optimizeLottie(p2.anim, D);
      res[name] = p2.text === p1.text && p3.text === p1.text; if (!res[name]) ok = false;
    }
    pass('R12', 'Optimizing an already optimized file changes nothing (all fixtures)', ok, res); }

  window.REG2 = out;
  document.getElementById('msg').textContent = 'phase 2 tests done (' + APP_VERSION + ')';
  return { version: APP_VERSION, defaults: D, results: out };
};
