/* Real-world files: runs the app's own engine over every file in tests/real/ (not committed; see README).
   For each file: sizes (JSON, gzip, .lottie), time, parse, canvas + SVG pixel/alpha diffs on sampled frames,
   structural checks, per-feature isolation, .lottie round trip, official dotLottie player, name-based access.
   runReal({ settings }) — settings default to the app's own UI defaults. */

const REAL_FILES = [
  'web_adrock.json', 'web_bacon.json', 'web_banner.json', 'web_bodymovin.json', 'web_dalek.json', 'web_lights.json', 'web_monster.json',
  'web_navidad.json', 'web_ripple.json', 'web_starfish.json', 'rs_image.lottie', 'rs_emojis.lottie', 'rs_pigeon.lottie', 'rs_traffic_lights.lottie',
  'rs_image.json', 'rs_gradient.json', 'rs_text.json', 'android_2ParentsMatte.json', 'android_Masks.json', 'android_MaskInv.json',
  'android_KeyframeTypes.json', 'android_BounceEasings.json', 'android_ImageWithShadow.json', 'android_DynamicGradient.json', 'android_Heart.lottie'
];

// canvas diff on up to `max` evenly spaced frames (long animations would take minutes frame by frame)
async function canvasDiffSampled(orig, opt, max = 48) {
  const P1 = await loadPlayer(orig, 300), P2 = await loadPlayer(opt, 300);
  if (!P1.a || !P2.a || !P1.canvas || !P2.canvas) return { renders: false, errors: [...P1.errors, ...P2.errors] };
  const total = Math.max(1, Math.floor(orig.op - orig.ip)), step = Math.max(1, Math.ceil(total / max));
  frameData(P1, Math.min(1, total - 1)); frameData(P2, Math.min(1, total - 1)); await sleep(200);
  let worst = { f: -1, pctPx: 0 }, alphaMax = 0, n = 0;
  for (let f = 0; f < total; f += step) {
    const a = frameData(P1, f), b = frameData(P2, f); let cnt = 0;
    for (let k = 0; k < a.length; k += 4) {
      const m = Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2]), Math.abs(a[k + 3] - b[k + 3]));
      if (m > 16) cnt++; alphaMax = Math.max(alphaMax, Math.abs(a[k + 3] - b[k + 3]));
    }
    const pct = cnt / (a.length / 4) * 100; n++;
    if (pct > worst.pctPx) worst = { f, pctPx: +pct.toFixed(3) };
  }
  const res = { renders: P2.errors.length === 0, framesCompared: n, of: total, worst, alphaMax };
  P1.a.destroy(); P2.a.destroy(); P1.div.remove(); P2.div.remove();
  return res;
}

async function loadReal(name) {
  const W = app(); const res = await fetch('../tests/real/' + name);
  if (!res.ok) throw new Error('missing ' + name);
  const buf = await res.arrayBuffer();
  if (name.endsWith('.lottie')) return { anim: await W.readDotLottie(new W.File([buf], name)), inBytes: buf.byteLength, format: 'lottie' };
  const text = new TextDecoder().decode(buf);
  return { anim: JSON.parse(text), inBytes: buf.byteLength, format: 'json', text };
}

window.runReal = async function (opts = {}) {
  await appReady;
  const W = app(); const D = { ...(await appDefaults()), ...(opts.settings || {}) };
  const rows = [];
  for (const name of opts.only || REAL_FILES) {
    const row = { name };
    try {
      const src = await loadReal(name);
      const minified = JSON.stringify(src.anim);
      const t0 = performance.now(); const r = await W.optimizeLottie(src.anim, D); row.ms = Math.round(performance.now() - t0);
      let parses = true; try { JSON.parse(r.text); } catch { parses = false; }
      const g0 = await W.gzipSize(minified), g1 = await W.gzipSize(r.text);
      Object.assign(row, { format: src.format, inBytes: src.inBytes, jsonIn: minified.length, jsonOut: r.text.length, jsonSavedPct: +((1 - r.text.length / minified.length) * 100).toFixed(1),
        gzipIn: g0, gzipOut: g1, parses, hasExpr: r.hasExpr, stats: { rounded: r.stats.rounded, meta: r.stats.metaKeys, hidden: r.stats.hidden + '/' + r.stats.hiddenShapes, kf: r.stats.kfRemoved + '/' + r.stats.kfStatic, dup: r.stats.dupAssets, images: r.stats.images, imgSkipped: r.stats.imgSkipped } });
      if (typeof W.buildDotLottie === 'function') {
        const pkg = await W.buildDotLottie(r.anim); const back = await W.readDotLottie(new W.File([pkg], 'x.lottie'));
        row.lottieOut = pkg.size; row.lottieSavedPct = src.format === 'lottie' ? +((1 - pkg.size / src.inBytes) * 100).toFixed(1) : null;
        row.roundTrip = canon(back) === canon(r.anim);
        if (!opts.skipPlayer) { const p = await dotLottieWeb(pkg); row.player = p.loaded ? 'loaded' : 'NOT loaded: ' + p.error; }
      }
      row.struct = structCheck(src.anim, r.anim, D).problems;
      row.canvas = await canvasDiffSampled(src.anim, r.anim);
      if (!opts.skipSvg) { const s = await svgDiff(src.anim, r.anim, Math.max(1, Math.ceil((src.anim.op - src.anim.ip) / 8))); row.svg = { renders: s.renders, worstPct: s.worstPct, alphaMax: s.alphaMax, errors: s.errors }; }
      row.isolation = {};
      for (const f of ['kf', 'dedupe', 'hidden', 'meta']) if (D[f]) { const ref = await W.optimizeLottie(src.anim, { ...D, [f]: false }); row.isolation[f] = ref.text === r.text ? 'no change' : (await canvasDiffSampled(ref.anim, r.anim, 24)).worst.pctPx; }
      if (!D.names) { const acc = await devAccess(r.anim); row.namesFound = acc.byPath.filter(x => x.found).length + '/' + acc.byPath.length; }
    } catch (e) { row.error = String(e && e.message || e); }
    rows.push(row);
    document.getElementById('msg').textContent = `real files: ${rows.length}/${(opts.only || REAL_FILES).length}`;
  }
  window.REAL = rows; window.REAL_DONE = true;
  return rows;
};
