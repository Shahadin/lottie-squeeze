/* Harness v2 — builds on the audit harness (same seeded fixtures, same canvas diff) and adds:
   alpha-channel diffs, an SVG-renderer check, structural validation, name-based access checks,
   per-image alpha checks, approximate heap use, and focused regression tests for every audit bug.
   Run: runBench() for the benchmark, runRegressions() for the regression suite.
   Open with ?app=baseline to run the same tests against the protected pre-upgrade copy. */

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function appDefaults() { await appReady; return app().eval('optOpts()'); }   // the app's own UI defaults (optOpts is a top-level const, not a window property)

/* ---------- walkers ---------- */
function walk(n, fn, skipHidden) {
  if (!n || typeof n !== 'object') return;
  if (skipHidden && !Array.isArray(n) && n.hd === true) return;
  fn(n);
  for (const k in n) walk(n[k], fn, skipHidden);
}
const isKeyframe = n => !Array.isArray(n) && typeof n.t === 'number' && ('s' in n || 'h' in n || 'i' in n);
function collect(layer, skipHidden) {
  const times = [], ease = [], colours = [], exprs = [], names = [], maskCl = [];
  // the layer itself is never skipped (a kept hidden layer is compared in full); hidden content inside it is
  const visit = (node, fn) => { fn(node); for (const k in node) walk(node[k], fn, skipHidden); };
  visit(layer, n => {
    if (Array.isArray(n)) return;
    if (isKeyframe(n)) { times.push(n.t); for (const h of ['i', 'o']) if (n[h] && typeof n[h] === 'object') for (const ax of ['x', 'y']) [].concat(n[h][ax] ?? []).forEach(v => ease.push(v)); }
    if ((n.ty === 'fl' || n.ty === 'st') && n.c) { const k = n.c.k; (n.c.a ? k.flatMap(kf => kf.s || []) : k).forEach(v => colours.push(v)); }
    if ((n.ty === 'gf' || n.ty === 'gs') && n.g) { const k = n.g.k.k; (n.g.k.a ? k.flatMap(kf => kf.s || []) : k).forEach(v => colours.push(v)); }
    if (typeof n.x === 'string' && ('k' in n || 'a' in n)) exprs.push(n.x);
    if (typeof n.nm === 'string') names.push(n.nm);
    if ('pt' in n && 'mode' in n) maskCl.push(n.cl);
  }, skipHidden);
  return { times, ease, colours, exprs, names, maskCl };
}
const maxPairDiff = (a, b) => { if (a.length !== b.length) return Infinity; let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

/* ---------- structural validation ---------- */
function structCheck(orig, out, o) {
  const problems = [], info = { maxEaseDiff: 0, maxColourDiff: 0, layersRemoved: 0 };
  for (const k of ['fr', 'ip', 'op', 'w', 'h']) if (orig[k] !== out[k]) problems.push(`root ${k}: ${orig[k]} → ${out[k]}`);
  const comps = c => [{ id: '(root)', layers: c.layers, fr: c.fr }, ...(c.assets || []).filter(a => a.layers).map(a => ({ id: a.id, layers: a.layers, fr: a.fr }))];
  const src = new Map(comps(orig).map(c => [c.id, c]));
  const assetIds = new Set((out.assets || []).map(a => a.id));
  for (const c of comps(out)) {
    const s = src.get(c.id); if (!s) { problems.push('unexpected comp ' + c.id); continue; }
    if (s.fr !== c.fr) problems.push(`${c.id} fr ${s.fr} → ${c.fr}`);
    const inds = new Set(c.layers.map(l => l.ind));
    s.layers.forEach(sl => { if (!inds.has(sl.ind)) { info.layersRemoved++; if (sl.hd !== true) problems.push(`${c.id}: visible layer ${sl.ind} removed`); } });
    c.layers.forEach((l, i) => {
      if (l.parent != null && !inds.has(l.parent)) problems.push(`${c.id}/${l.ind}: parent ${l.parent} missing`);
      if (l.tp != null && !inds.has(l.tp)) problems.push(`${c.id}/${l.ind}: matte parent ${l.tp} missing`);
      if (l.refId != null && !assetIds.has(l.refId)) problems.push(`${c.id}/${l.ind}: asset ${l.refId} missing`);
      const sl = s.layers.find(x => x.ind === l.ind); if (!sl) { problems.push(`${c.id}: unknown layer ${l.ind}`); return; }
      if (l.tt && l.tp == null) { const si = s.layers.indexOf(sl); if (!(i > 0 && si > 0 && c.layers[i - 1].ind === s.layers[si - 1].ind)) problems.push(`${c.id}/${l.ind}: legacy matte source changed`); }
      for (const k of ['ip', 'op', 'st', 'sr', 'parent', 'tt', 'td', 'tp', 'ty', 'refId', 'hd']) if (sl[k] !== l[k]) problems.push(`${c.id}/${l.ind}: ${k} ${sl[k]} → ${l[k]}`);
      const A = collect(sl, true), B = collect(l, true);   // compare visible content on both sides
      if (JSON.stringify(A.times) !== JSON.stringify(B.times)) problems.push(`${c.id}/${l.ind}: keyframe times changed`);
      if (sl.tm || l.tm) { const ta = (sl.tm.k || []).map(k => [k.t, k.s]), tb = (l.tm.k || []).map(k => [k.t, k.s]); if (JSON.stringify(ta) !== JSON.stringify(tb)) problems.push(`${c.id}/${l.ind}: time remap changed`); }
      if (JSON.stringify(A.exprs) !== JSON.stringify(B.exprs)) problems.push(`${c.id}/${l.ind}: expressions changed`);
      if (!o.names && JSON.stringify(A.names) !== JSON.stringify(B.names)) problems.push(`${c.id}/${l.ind}: names changed`);
      if (JSON.stringify(A.maskCl) !== JSON.stringify(B.maskCl)) problems.push(`${c.id}/${l.ind}: mask closed flag changed ${JSON.stringify(A.maskCl)} → ${JSON.stringify(B.maskCl)}`);
      const de = maxPairDiff(A.ease, B.ease), dc = maxPairDiff(A.colours, B.colours);
      if (de === Infinity) problems.push(`${c.id}/${l.ind}: easing count changed`); else info.maxEaseDiff = Math.max(info.maxEaseDiff, de);
      if (dc === Infinity) problems.push(`${c.id}/${l.ind}: colour count changed`); else info.maxColourDiff = Math.max(info.maxColourDiff, dc);
    });
  }
  let npBefore = 0, npAfter = 0;
  walk(orig, n => { if (n.ty === 'gr' && Array.isArray(n.it) && typeof n.np === 'number' && n.np !== n.it.length) npBefore++; });
  walk(out, n => { if (n.ty === 'gr' && Array.isArray(n.it) && typeof n.np === 'number' && n.np !== n.it.length) npAfter++; });
  if (npAfter > npBefore) problems.push(`property count (np) mismatches: ${npBefore} → ${npAfter}`);
  info.maxEaseDiff = +info.maxEaseDiff.toFixed(6); info.maxColourDiff = +info.maxColourDiff.toFixed(6);
  return { problems, ...info };
}

/* ---------- canvas diff with separate alpha statistics ---------- */
async function canvasDiff(orig, opt) {
  const size = 300;
  const P1 = await loadPlayer(orig, size), P2 = await loadPlayer(opt, size);
  if (!P1.a || !P2.a || !P1.canvas || !P2.canvas) return { renders: false, errors: [...P1.errors, ...P2.errors] };
  const frames = Math.ceil(orig.op - orig.ip);
  let worst = { f: -1, pctPx: 0, mean: 0 }, alphaMax = 0, alphaWorstPct = 0, sum = 0;
  for (let f = 0; f < frames; f++) {
    const d1 = frameData(P1, f), d2 = frameData(P2, f);
    let s = 0, cnt = 0, acnt = 0;
    for (let k = 0; k < d1.length; k += 4) {
      const m = Math.max(Math.abs(d1[k] - d2[k]), Math.abs(d1[k + 1] - d2[k + 1]), Math.abs(d1[k + 2] - d2[k + 2]), Math.abs(d1[k + 3] - d2[k + 3]));
      const da = Math.abs(d1[k + 3] - d2[k + 3]);
      s += m; if (m > 16) cnt++; if (da > alphaMax) alphaMax = da; if (da > 16) acnt++;
    }
    const px = d1.length / 4, pct = cnt / px * 100;
    sum += s / px; alphaWorstPct = Math.max(alphaWorstPct, acnt / px * 100);
    if (pct > worst.pctPx || (pct === worst.pctPx && s / px > worst.mean)) worst = { f, pctPx: +pct.toFixed(3), mean: +(s / px).toFixed(3) };
  }
  const res = { renders: P2.errors.length === 0, errors: P2.errors, frames, avgMeanDiff: +(sum / frames).toFixed(3), worst, alphaMax, alphaWorstPct: +alphaWorstPct.toFixed(3),
    timing: { fps: [P1.a.frameRate, P2.a.frameRate], totalFrames: [P1.a.totalFrames, P2.a.totalFrames] } };
  P1.a.destroy(); P2.a.destroy(); P1.div.remove(); P2.div.remove();
  return res;
}

/* ---------- SVG renderer: renders without errors, and rasterised frames match ---------- */
async function loadSvgPlayer(data, size) {
  const div = document.createElement('div'); div.style.cssText = `width:${size}px;height:${size}px;position:absolute;left:-5000px;top:0`; document.body.append(div);
  const errors = []; let a;
  try { a = lottie.loadAnimation({ container: div, renderer: 'svg', loop: false, autoplay: false, animationData: clone(data) }); }
  catch (e) { errors.push(String(e)); return { errors, div }; }
  a.addEventListener('error', () => errors.push('error event'));
  await new Promise(r => { a.addEventListener('DOMLoaded', r); setTimeout(r, 3000); });
  await sleep(100);
  return { a, div, errors, svg: div.querySelector('svg') };
}
async function rasterSvg(svg, size) {
  const xml = new XMLSerializer().serializeToString(svg);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); x.drawImage(img, 0, 0, size, size);
  return x.getImageData(0, 0, size, size).data;
}
async function svgDiff(orig, opt, step = 10) {
  const size = 200, S1 = await loadSvgPlayer(orig, size), S2 = await loadSvgPlayer(opt, size);
  if (!S1.a || !S2.a || !S2.svg) { [S1, S2].forEach(s => s.div && s.div.remove()); return { renders: false, errors: [...S1.errors, ...(S2.errors || [])] }; }
  let worstPct = 0, alphaMax = 0, n = 0;
  try {
    for (let f = 0; f < orig.op - orig.ip; f += step) {
      S1.a.goToAndStop(f, true); S2.a.goToAndStop(f, true);
      const d1 = await rasterSvg(S1.svg, size), d2 = await rasterSvg(S2.svg, size);
      let cnt = 0;
      for (let k = 0; k < d1.length; k += 4) {
        const m = Math.max(Math.abs(d1[k] - d2[k]), Math.abs(d1[k + 1] - d2[k + 1]), Math.abs(d1[k + 2] - d2[k + 2]), Math.abs(d1[k + 3] - d2[k + 3]));
        if (m > 16) cnt++; alphaMax = Math.max(alphaMax, Math.abs(d1[k + 3] - d2[k + 3]));
      }
      worstPct = Math.max(worstPct, cnt / (d1.length / 4) * 100); n++;
    }
  } catch (e) { S2.errors.push('rasterise: ' + e); }
  const res = { renders: S2.errors.length === 0, errors: S2.errors, framesSampled: n, worstPct: +worstPct.toFixed(3), alphaMax };
  S1.a.destroy(); S2.a.destroy(); S1.div.remove(); S2.div.remove();
  return res;
}

/* ---------- per-image alpha check (decoded pixels, not a visual guess) ---------- */
async function imagePixels(src, w, h) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const c = document.createElement('canvas'); c.width = w || img.naturalWidth; c.height = h || img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  return { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, nw: img.naturalWidth };
}
async function imageAlphaCheck(orig, out) {
  const rows = [];
  for (const a of orig.assets || []) {
    if (typeof a.p !== 'string' || !a.p.startsWith('data:image')) continue;
    const b = (out.assets || []).find(x => x.id === a.id); if (!b) { rows.push({ id: a.id, removed: true }); continue; }
    const A = await imagePixels(a.p), B = await imagePixels(b.p, A.w, A.h);
    let transparentIn = 0, transparentOut = 0, alphaMax = 0, alphaChanged = 0;
    for (let i = 3; i < A.d.length; i += 4) { if (A.d[i] < 255) transparentIn++; if (B.d[i] < 255) transparentOut++; const da = Math.abs(A.d[i] - B.d[i]); alphaMax = Math.max(alphaMax, da); if (da > 2) alphaChanged++; }
    rows.push({ id: a.id, formatIn: a.p.slice(11, a.p.indexOf(';')), formatOut: b.p.slice(11, b.p.indexOf(';')), changed: a.p !== b.p, bytesIn: a.p.length, bytesOut: b.p.length,
      transparentIn, transparentOut, alphaMax, alphaChangedPx: alphaChanged, resized: B.nw !== A.nw });
  }
  return rows;
}

/* ---------- name-based developer access (lottie-web) ---------- */
async function devAccess(anim) {
  const S = await loadSvgPlayer(anim, 200);
  if (!S.a) return { ok: false, errors: S.errors };
  const top = anim.layers.filter(l => typeof l.nm === 'string' && l.hd !== true);
  const byPath = top.map(l => ({ nm: l.nm, found: typeof S.a.renderer.getElementByPath === 'function' ? !!S.a.renderer.getElementByPath([l.nm]) : null }));
  const ids = anim.layers.filter(l => l.ln).map(l => ({ ln: l.ln, inSvg: !!S.svg.querySelector('#' + CSS.escape(l.ln)) }));
  const classes = anim.layers.filter(l => l.cl && l.ty !== 2).map(l => ({ cl: l.cl, inSvg: !!S.svg.querySelector('.' + CSS.escape(l.cl)) }));
  S.a.destroy(); S.div.remove();
  return { getElementByPath: typeof byPath[0]?.found === 'boolean', byPath, ids, classes };
}

/* ---------- measurement ---------- */
async function measure2(name, fx, o, label, opts = {}) {
  const W = app();
  const minified = JSON.stringify(fx);
  const heap0 = performance.memory ? performance.memory.usedJSHeapSize : null;
  const t0 = performance.now();
  const r = await W.optimizeLottie(fx, o);
  const ms = performance.now() - t0;
  const heap1 = performance.memory ? performance.memory.usedJSHeapSize : null;
  const bytes = s => new Blob([s]).size;
  let parses = true; try { JSON.parse(r.text); } catch { parses = false; }
  const g0 = await W.gzipSize(minified), g1 = await W.gzipSize(r.text);
  const canvas = await canvasDiff(fx, r.anim);
  const svg = opts.svg === false ? null : await svgDiff(fx, r.anim);
  const struct = structCheck(fx, r.anim, o);
  return { test: name, settings: label, inBytes: bytes(minified), outBytes: bytes(r.text), savedPct: +((1 - bytes(r.text) / bytes(minified)) * 100).toFixed(1),
    gzipIn: g0, gzipOut: g1, gzipSavedPct: +((1 - g1 / g0) * 100).toFixed(1), ms: +ms.toFixed(1), heapDeltaMB: heap0 != null ? +((heap1 - heap0) / 1048576).toFixed(1) : 'n/a',
    parses, canvas, svg, struct, stats: r.stats, outAnim: r.anim };
}

function buildFixtures() {
  seed = 1337;                       // identical sequence to the audit run
  const imgs = makeImages();
  const fx = { simple: fxSimple(), multilayer: fxMultiLayer(), 'gradients-masks': fxGradMask(), images: fxImages(imgs), character: fxCharacter() };
  window.FX = fx; window.IMGS = imgs;
  return fx;
}

window.runBench = async function () {
  await appReady;
  const fx = buildFixtures(), D = await appDefaults();
  const settings = [['default', {}], ['prec 2', { prec: 2 }], ['prec 1', { prec: 1 }], ['least lossy', { prec: 5, names: false, meta: false, hidden: false, unused: false, ifmt: 'keep' }]];
  const rows = [];
  for (const [name, f] of Object.entries(fx)) for (const [label, over] of settings) rows.push(await measure2(name, f, { ...D, ...over }, label));
  window.BENCH = rows;
  document.getElementById('msg').textContent = 'bench done (' + APP_VERSION + ')';
  return { version: APP_VERSION, defaults: D, rows: rows.map(r => ({ ...r, outAnim: undefined, stats: undefined })) };
};

/* ---------- regression fixtures ---------- */
function fxExprController() {   // the audit's B1 case, rebuilt exactly
  const f = clone(FX.simple);
  f.layers.push({ ddd: 0, ind: 9, ty: 3, nm: 'Controller', hd: true, sr: 1, ks: { o: { a: 0, k: 0 }, r: { a: 1, k: [{ t: 0, s: [0], i: { x: [0.667], y: [1] }, o: { x: [0.333], y: [0] } }, { t: 60, s: [180] }] }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } }, ao: 0, ip: 0, op: 60, st: 0, bm: 0 });
  f.layers[0].ks.r = { a: 0, k: 0, x: "var $bm_rt;\n$bm_rt = thisComp.layer('Controller').transform.rotation;" };
  return f;
}
function fxDependencies() {      // hidden layers that other layers need, plus one that nothing needs
  const f = clone(FX.simple);
  const hiddenNull = (ind, nm, extra = {}) => Object.assign({ ddd: 0, ind, ty: 3, nm, hd: true, sr: 1, ks: ks([0, 0]), ao: 0, ip: 0, op: 60, st: 0, bm: 0 }, extra);
  const card = f.layers[0], dot = f.layers[1];
  card.ln = 'hero-card'; card.cl = 'brand-card';
  card.parent = 10;
  card.shapes[0].it.splice(card.shapes[0].it.length - 1, 0, { ty: 'st', c: st([0, 0, 0, 1]), o: st(100), w: st(3), lc: 1, lj: 1, ml: 4, bm: 0, nm: 'Hidden stroke', hd: true });
  card.shapes[0].np = card.shapes[0].it.length;
  const rig = hiddenNull(10, 'Parent rig', { ks: ks([200, 200], { r: anim([0, 60], [[0], [30]]) }) });
  rig.ks.p = st([0, 0, 0]);
  const tpMatte = shapeLayer(11, 'Matte via tp', ks([200, 200]), [group('M', [{ ty: 'el', d: 1, s: st([260, 260]), p: st([0, 0]) }, fill([1, 1, 1])])], 60, { hd: true });
  dot.tt = 1; dot.tp = 11;
  const legacyMatte = shapeLayer(12, 'Legacy matte above', ks([200, 200]), [group('M', [{ ty: 'rc', d: 1, s: st([300, 120]), p: st([0, 0]), r: st(0) }, fill([1, 1, 1])])], 60, { hd: true });
  const legacyMatted = shapeLayer(13, 'Legacy matted', ks([200, 300]), [group('R', [{ ty: 'rc', d: 1, s: st([360, 80]), p: st([0, 0]), r: st(10) }, fill([0.2, 0.6, 0.3])])], 60, { tt: 1 });
  const guide = hiddenNull(16, 'Guide (unused)');
  const lcComp = { id: 'comp_lc', nm: 'Layer control comp', layers: [
    hiddenNull(1, 'Target of layer control'),
    shapeLayer(2, 'Uses layer control', ks([50, 50], { }), [group('S', [{ ty: 'rc', d: 1, s: st([40, 40]), p: st([0, 0]), r: st(0) }, fill([0.8, 0.3, 0.1])])], 60,
      { ef: [{ ty: 5, nm: 'Layer Control', np: 3, ix: 1, en: 1, ef: [{ ty: 10, nm: 'Layer', ix: 1, v: { a: 0, k: 1, ix: 1 } }] }] })
  ] };
  const pre = { ddd: 0, ind: 20, ty: 0, nm: 'LC precomp', refId: 'comp_lc', sr: 1, ks: ks([340, 340]), ao: 0, w: 100, h: 100, ip: 0, op: 60, st: 0, bm: 0 };
  f.layers = [legacyMatte, legacyMatted, rig, card, tpMatte, dot, guide, pre];
  f.assets = [lcComp];
  return f;
}
function fxOpenMask() {
  const f = clone(FX['gradients-masks']);
  f.layers[2].masksProperties[0].cl = false;   // open mask: "cl" is the closed flag, not a class name
  f.layers[2].masksProperties[1].cl = true;
  return f;
}
function makeAlphaImages() {
  const base = document.createElement('canvas'); base.width = 320; base.height = 240; const bx = base.getContext('2d');
  return loadImg2(IMGS.photo).then(photo => {
    const mk = (fn) => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const x = c.getContext('2d'); x.drawImage(photo, 0, 0); fn(x, c); return c.toDataURL('image/png'); };
    return {
      opaquePhoto: IMGS.photo,
      isolatedHoles: mk(x => { for (let y = 0; y < 240; y += 2) for (let xx = 1; xx < 320; xx += 4) x.clearRect(xx, y, 1, 1); }),
      singlePixel: mk(x => x.clearRect(157, 119, 1, 1)),
      halfTransparent: mk((x, c) => { const d = x.getImageData(0, 0, 320, 240); for (let i = 3; i < d.data.length; i += 4) d.data[i] = 128; x.putImageData(d, 0, 0); }),
      softEdges: IMGS.sprite
    };
  });
}
function loadImg2(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function fxAlpha(images) {
  const ids = Object.keys(images);
  return root('alpha-suite', 400, 400, 30, 30, ids.map((id, i) => ({ ddd: 0, ind: i + 1, ty: 2, nm: id, refId: id, sr: 1, ks: ks([200, 200], { a: st([160, 120, 0]) }), ao: 0, ip: 0, op: 30, st: 0, bm: 0 })),
    ids.map(id => ({ id, w: id === 'softEdges' ? 200 : 320, h: id === 'softEdges' ? 200 : 240, u: '', p: images[id], e: 1 })));
}

window.runRegressions = async function () {
  await appReady;
  const W = app(); buildFixtures(); const D = await appDefaults();
  const out = [];
  const pass = (id, title, ok, evidence) => out.push({ id, title, result: ok ? 'PASS' : 'FAIL', evidence });

  // Structural changes are judged in isolation: default output vs the same rounding with every structural option off.
  // (Rounding effects are measured separately in the benchmark.)
  const isolated = async (f) => { const full = await W.optimizeLottie(f, D); const ref = await W.optimizeLottie(f, { ...D, hidden: false, meta: false, unused: false, names: false });
    return { full, v: await canvasDiff(ref.anim, full.anim), vsOriginal: (await canvasDiff(f, full.anim)).worst.pctPx }; };

  // R1 expression reads a hidden controller layer
  { const f = fxExprController(); const { full: r, v, vsOriginal } = await isolated(f);
    const kept = r.anim.layers.some(l => l.ind === 9);
    pass('R1', 'Hidden controller used by an expression is kept; structural changes render pixel-identically', kept && v.worst.pctPx === 0 && v.alphaMax === 0,
      { controllerKept: kept, structuralWorstPctPx: v.worst.pctPx, structuralAlphaMax: v.alphaMax, vsOriginalIncludingRoundingPctPx: vsOriginal }); }

  // R2 hidden-layer dependencies without expressions
  { const f = fxDependencies(); const { full: r, v, vsOriginal } = await isolated(f); const inds = r.anim.layers.map(l => l.ind); const lc = r.anim.assets.find(a => a.id === 'comp_lc');
    const s = structCheck(f, r.anim, D);
    const cardGroup = r.anim.layers.find(l => l.ind === 1).shapes[0];
    const expect = { parentKept: inds.includes(10), tpMatteKept: inds.includes(11), legacyMatteKept: inds.includes(12), guideRemoved: !inds.includes(16), layerControlTargetKept: lc && lc.layers.some(l => l.ind === 1),
      hiddenStrokeRemoved: !cardGroup.it.some(x => x.hd), npMatchesItems: cardGroup.np === cardGroup.it.length };
    pass('R2', 'Hidden layers needed by parents, mattes or layer controls are kept; unused guide removed; np stays correct',
      Object.values(expect).every(Boolean) && s.problems.length === 0 && v.worst.pctPx === 0 && v.alphaMax === 0,
      { ...expect, structuralProblems: s.problems, structuralWorstPctPx: v.worst.pctPx, structuralAlphaMax: v.alphaMax, vsOriginalIncludingRoundingPctPx: vsOriginal }); }

  // R3 transparency
  { const imgs = await makeAlphaImages(); const f = fxAlpha(imgs); const res = {};
    let ok = true;
    for (const fmt of ['auto', 'webp', 'jpeg']) {
      const r = await W.optimizeLottie(f, { ...D, ifmt: fmt }); const rows = await imageAlphaCheck(f, r.anim);
      res[fmt] = rows.map(x => ({ id: x.id, out: x.formatOut, changed: x.changed, transparentIn: x.transparentIn, transparentOut: x.transparentOut, alphaMax: x.alphaMax, alphaChangedPx: x.alphaChangedPx }));
      for (const x of rows) if (x.transparentIn > 0 && (x.formatOut === 'jpeg' || x.alphaMax > 2 || x.transparentOut < x.transparentIn)) ok = false;
    }
    pass('R3', 'Transparent pixels survive in Auto, WebP and JPEG modes (isolated, single, half-transparent, soft edges)', ok, res); }

  // R4 timing never rounded
  { const f = FX.character, res = {}; let ok = true;
    for (const p of [3, 2, 1]) { const r = await W.optimizeLottie(f, { ...D, prec: p }); const s = structCheck(f, r.anim, { ...D, prec: p });
      const timing = s.problems.filter(x => /fr|ip|op|st|keyframe times|time remap/.test(x));
      res['prec ' + p] = { fr: r.anim.fr, op: r.anim.op, tmEnd: r.anim.layers.find(l => l.tm).tm.k[1].s[0], timingProblems: timing, maxEaseDiff: s.maxEaseDiff, maxColourDiff: s.maxColourDiff };
      if (timing.length || r.anim.fr !== f.fr || r.anim.op !== f.op || s.maxEaseDiff > 0.0005 || s.maxColourDiff > 0.0005) ok = false; }
    pass('R4', 'Frame rate, duration, keyframe times and time remap are exact; easing and colours within 0.0005 at every precision', ok, res); }

  // R5 name-based access under defaults
  { const f = fxDependencies(); const r = await W.optimizeLottie(f, D); const s = structCheck(f, r.anim, D); const acc = await devAccess(r.anim);
    const namesSame = !s.problems.some(p => /names changed/.test(p));
    const ok = !D.names && namesSame && acc.byPath.every(x => x.found !== false) && acc.ids.every(x => x.inSvg) && acc.classes.every(x => x.inSvg);
    pass('R5', 'Default settings keep every name; lottie-web finds layers by name, id and class', ok, { removeNamesDefault: D.names, namesIdentical: namesSame, ...acc }); }

  // R6 repeated passes under defaults
  { let cur = FX.images; const texts = []; const vs = [];
    for (let p = 1; p <= 3; p++) { const r = await W.optimizeLottie(cur, D); texts.push(r.text); cur = r.anim; vs.push((await canvasDiff(FX.images, cur)).worst.pctPx); }
    const reenc = []; cur = FX.images;
    for (let p = 1; p <= 3; p++) { const r = await W.optimizeLottie(cur, { ...D, reencode: true }); cur = r.anim; reenc.push((await canvasDiff(FX.images, cur)).worst.pctPx); }
    pass('R6', 'Repeat passes with default settings do not change the output again', texts[1] === texts[0] && texts[2] === texts[0],
      { pass2IdenticalToPass1: texts[1] === texts[0], pass3IdenticalToPass1: texts[2] === texts[0], worstPctPxPerPass: vs, withReencodeOptIn_worstPctPxPerPass: reenc }); }

  // R7 open mask closed-flag
  { const f = fxOpenMask(); const r = await W.optimizeLottie(f, { ...D, names: true, meta: true }); const m = r.anim.layers[2].masksProperties;
    const v = await canvasDiff(f, r.anim);
    pass('R7', 'Mask "cl" (closed flag) is never stripped, even with every removal option on', m[0].cl === false && m[1].cl === true && v.worst.pctPx === 0, { mask1cl: m[0].cl, mask2cl: m[1].cl, worstPctPx: v.worst.pctPx }); }

  // R8 statistics compare like with like (driven through the real UI)
  { const zip = new JSZip(); const dl = clone(FX.images); dl.assets.forEach(a => { a.u = 'images/'; a.p = a.id + '.png'; a.e = 0; });
    zip.file('manifest.json', JSON.stringify({ version: '1', animations: [{ id: 'main' }] })); zip.file('animations/main.json', JSON.stringify(dl));
    for (const a of FX.images.assets) zip.file('images/' + a.id + '.png', a.p.split(',')[1], { base64: true });
    const file = new File([await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })], 'test.lottie');
    const ui = id => W.document.getElementById(id) ? W.document.getElementById(id).textContent : '(missing)';
    const waitReady = async () => { for (let i = 0; i < 100 && !/Ready|expressions/.test(ui('o-status')); i++) await sleep(50); await sleep(400); };
    await W.handleLottieFile(file); await waitReady();
    const zipView = { label: ui('o-before-label'), original: ui('o-before'), savedLabel: ui('o-saved-label'), saved: ui('o-saved'), gzipLabel: ui('o-gzip-label'), log: [...W.document.querySelectorAll('#o-log li')].map(li => li.textContent).slice(0, 4) };
    const jsonText = JSON.stringify(FX.simple, null, 2); await W.handleLottieFile(new File([jsonText], 'pretty.json')); await waitReady();
    const jsonView = { label: ui('o-before-label'), original: ui('o-before'), fileBytes: new Blob([jsonText]).size, saved: ui('o-saved') };
    const ok = /lottie/i.test(zipView.label) && /JSON/.test(zipView.savedLabel) && !zipView.saved.startsWith('+') && /JSON/.test(jsonView.label);
    pass('R8', '.lottie input is labelled and compared JSON-to-JSON; JSON input shows the real file size', ok, { zipView, jsonView }); }

  window.REG = out;
  document.getElementById('msg').textContent = 'regressions done (' + APP_VERSION + ')';
  return { version: APP_VERSION, defaults: D, results: out };
};
