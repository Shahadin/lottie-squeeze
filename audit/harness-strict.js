/* Strict Lossless tests (S1–S7). Run runStrictSuite() in the console.
   The harness compares outputs with its OWN token scanner and zip comparison, not the app's verifier. */

// Harness-side JSON token scanner (independent of the app's minifier and verifier)
function hTokens(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
    if (c === 34) { let j = i + 1; for (; j < text.length; j++) { if (text[j] === '\\') { j++; continue; } if (text[j] === '"') break; } out.push(text.slice(i, j + 1)); i = j + 1; continue; }
    if ('{}[]:,'.indexOf(text[i]) >= 0) { out.push(text[i]); i++; continue; }
    let j = i; while (j < text.length && ' \t\n\r{}[]:,"'.indexOf(text[j]) < 0) j++; out.push(text.slice(i, j)); i = j;
  }
  return out;
}
const sameTokens = (a, b) => { const x = hTokens(a), y = hTokens(b); return x.length === y.length && x.every((t, k) => t === y[k]); };
async function zipEntries(blobOrBuf) {
  const data = blobOrBuf instanceof ArrayBuffer ? blobOrBuf : new Uint8Array(await blobOrBuf.arrayBuffer()).slice().buffer;
  const z = await JSZip.loadAsync(data); const map = new Map();
  for (const [n, f] of Object.entries(z.files)) map.set(n, f.dir ? 'DIR' : await f.async('base64'));
  return map;
}
const sameEntries = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
const fileOf = (W, bytes, name) => new W.File([bytes], name);

window.runStrictSuite = async function (opts = {}) {
  await appReady; const W = app(); buildFixtures();
  const out = []; const pass = (id, title, ok, evidence) => out.push({ id, title, result: ok ? 'PASS' : 'FAIL', evidence });

  // S1 token preservation in the browser (same cases as the Node unit test, through the app's entry point)
  { const cases = { pretty: '{\n  "a": 1,\n  "b": [ 1, 2 ]\n}', longDecimal: '{ "fr" : 29.97002997002997 }', bigInt: '[ 9007199254740993 ]', scientific: '[ 1e+03 , 2E-7 ]',
      negZero: '{ "z": -0 }', unicodeEscape: '{ "s": "caf\\u00e9 \\ud83d\\ude00" }', escapes: '{ "s": "a  b \\" c \\\\ d" }', nested: '{"a":{"b":[{"c":[[],{}]}]} , "d" : [ ] }' };
    const res = {}; let ok = true;
    for (const [k, v] of Object.entries(cases)) { const r = W.strictLosslessJson(v); const good = r.ok && sameTokens(v, r.text) && !/[\n\r\t]| (?=[^"]*(?:"[^"]*"[^"]*)*$)/.test(r.text.replace(/"(?:\\.|[^"\\])*"/g, '""')); res[k] = good ? r.text : 'FAIL ' + (r.reason || r.text); if (!good) ok = false; }
    const bad = W.strictLosslessJson('{"a":1,}'); res.malformed = bad.ok ? 'accepted (wrong)' : bad.reason; if (bad.ok) ok = false;
    pass('S1', 'JSON value tokens survive exactly (long decimals, 2^53+1, 1e+03, -0, \\u escapes, escaped quotes/backslashes, nesting); malformed JSON is reported, not rewritten', ok, res); }

  // S2 animations: fixtures (pretty-printed, as exported) and every real JSON file
  { const rows = {}; let ok = true;
    const sources = {};
    for (const [n, f] of Object.entries({ ...FX, keyframes: fxKeyframes(), duplicates: fxDuplicates(), expressions: fxExprController(), dependencies: fxDependencies(), openMask: fxOpenMask() })) sources['fx:' + n] = JSON.stringify(f, null, 2);
    if (!opts.skipReal) for (const n of REAL_FILES.filter(n => n.endsWith('.json'))) { const r = await fetch('../tests/real/' + n); sources['real:' + n] = await r.text(); }
    for (const [n, text] of Object.entries(sources)) {
      const t0 = performance.now(); const r = W.strictLosslessJson(text); const ms = Math.round(performance.now() - t0);
      const tokensSame = r.ok && sameTokens(text, r.text);
      const again = r.ok ? W.strictLosslessJson(r.text) : null;
      const idempotent = again && again.ok && again.text === r.text;
      const notBigger = r.ok && new Blob([r.text]).size <= new Blob([text]).size;
      let pixels = null;
      if (opts.pixels && r.ok && !r.unchanged) pixels = (await canvasDiffSampled(JSON.parse(text), JSON.parse(r.text), 12)).worst.pctPx;
      rows[n] = { in: new Blob([text]).size, out: r.ok ? new Blob([r.text]).size : null, ms, unchanged: !!r.unchanged, tokensSame, idempotent, pixels };
      if (!(tokensSame && idempotent && notBigger) || (pixels != null && pixels !== 0)) ok = false;
    }
    pass('S2', 'Every fixture and real JSON: identical value tokens (harness scanner), never larger, idempotent', ok, rows); }

  // S3 dotLottie packages
  { const rows = {}; let ok = true;
    const png1 = IMGS.sprite.split(',')[1], png2 = IMGS.sparse.split(',')[1];
    const build = async (files, level) => { const z = new JSZip(); for (const [p, d] of files) { if (d === 'DIR') z.file(p, null, { dir: true }); else z.file(p, d.b64 ? d.b64 : d, d.b64 ? { base64: true, compression: level ? 'DEFLATE' : 'STORE' } : { compression: level ? 'DEFLATE' : 'STORE', compressionOptions: { level: level || 1 } }); } return new Uint8Array(await z.generateAsync({ type: 'uint8array' })); };
    const animSameNames = JSON.stringify({ v: '5.7.4', fr: 30, ip: 0, op: 10, w: 100, h: 100, assets: [{ id: 'a', w: 10, h: 10, u: '/images/', p: 'pic.png', e: 0 }, { id: 'b', w: 10, h: 10, u: '/i/', p: 'pic.png', e: 0 }, { id: 'unused', w: 10, h: 10, u: '/images/', p: 'spare.png', e: 0 }], layers: [] }, null, 2);
    const synthetic = {
      'sameNamesExtras.lottie': await build([['manifest.json', '{"version":"1","animations":[{"id":"x"}]}'], ['animations/x.json', animSameNames], ['images/pic.png', { b64: png1 }], ['i/pic.png', { b64: png2 }],
        ['images/spare.png', { b64: png1 }], ['images/orphan.png', { b64: png2 }], ['fonts/f.ttf', 'FONTDATA'.repeat(50)], ['t/theme.json', '{ "rules": [] }'], ['s/sm.json', '{ "states": [] }'], ['notes/readme.txt', 'hello  world'], ['empty/', 'DIR']], 1),
      'missingImage.lottie': await build([['manifest.json', '{"version":"1","animations":[{"id":"x"}]}'], ['animations/x.json', animSameNames], ['images/pic.png', { b64: png1 }]], 1),
      'alreadyTight.lottie': await build([['manifest.json', '{"version":"1","animations":[{"id":"x"}]}'], ['animations/x.json', '{"v":"5.7.4","fr":30,"ip":0,"op":10,"w":10,"h":10,"layers":[]}']], 9)
    };
    const real = {};
    if (!opts.skipReal) for (const n of REAL_FILES.filter(n => n.endsWith('.lottie') && n !== 'android_Heart.lottie')) real[n] = new Uint8Array(await (await fetch('../tests/real/' + n)).arrayBuffer());
    for (const [n, bytes] of Object.entries({ ...synthetic, ...real })) {
      const t0 = performance.now(); const res = await W.strictLosslessDotLottie(fileOf(W, bytes, n)); const ms = Math.round(performance.now() - t0);
      const outBytes = new Uint8Array(await res.blob.arrayBuffer()).slice();
      const entriesSame = sameEntries(await zipEntries(bytes.slice().buffer), await zipEntries(outBytes.buffer));
      const again = await W.strictLosslessDotLottie(fileOf(W, outBytes, n));
      const idempotent = sameEntries(await zipEntries(outBytes.buffer), await zipEntries(new Uint8Array(await again.blob.arrayBuffer()).slice().buffer));
      const player = await dotLottieWeb(new Blob([outBytes]));
      rows[n] = { in: bytes.length, out: outBytes.length, ms, unchanged: !!res.unchanged, entries: res.check && res.check.entries, entriesSame, idempotent, notes: res.check && res.check.notes, player: player.loaded ? 'loaded' : 'not loaded: ' + player.error };
      if (!(res.ok && entriesSame && idempotent && outBytes.length <= bytes.length)) ok = false;
      if (n === 'missingImage.lottie' && !(res.check.notes || []).some(x => /not found/.test(x))) ok = false;
      if (n === 'alreadyTight.lottie' && !res.unchanged) rows[n].noteUnchanged = 'repack was smaller (allowed)';
    }
    // same-name images in different folders resolve to their own bytes
    const read = await W.readDotLottie(fileOf(W, synthetic['sameNamesExtras.lottie'], 's.lottie'));
    const resolution = { a: read.assets[0].p.endsWith(png1.slice(-24)), b: read.assets[1].p.endsWith(png2.slice(-24)) };
    if (!(resolution.a && resolution.b)) ok = false;
    pass('S3', '.lottie: every entry (incl. unused images, fonts, themes, state machines, extra files, empty folders) keeps identical bytes; never larger; idempotent; missing images reported; same-name images resolve by full path', ok, { resolution, rows }); }

  // S4 damaged package and malformed JSON through the real upload handler, in Lossless
  { W.applyPreset('lossless'); const ui = () => W.document.getElementById('o-status').textContent;
    const tryFile = async f => { await W.handleLottieFile(f); for (let i = 0; i < 60 && /Optimizing|Reading/.test(ui() + W.document.getElementById('opt-name').textContent); i++) await sleep(50); await sleep(200); return ui(); };
    const res = { damaged: await tryFile(new W.File([new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9])], 'bad.lottie')), malformed: await tryFile(new W.File(['{"layers": [ broken'], 'bad.json')) };
    const ok = /can't be opened/.test(res.damaged) && /valid JSON/.test(res.malformed);
    pass('S4', 'Damaged .lottie and malformed JSON give clear errors in Lossless; nothing is produced', ok, res); }

  // S5 negative tests: the app's verifiers must reject tampered outputs
  { const res = {}; let ok = true;
    const orig = JSON.stringify(FX.images, null, 2), min = W.strictLosslessJson(orig).text;
    const jsonTamper = { numberChanged: min.replace('"fr":30', '"fr":31'), nameChanged: min.replace('"nm":"images"', '"nm":"imagez"'), imageByteChanged: min.replace(/(data:image\/png;base64,.{40})./, (m, a) => a + (m.endsWith('A') ? 'B' : 'A')), tokenRemoved: min.replace(',"ddd":0', '') };
    for (const [k, v] of Object.entries(jsonTamper)) { const r = W.verifyStrictJson(orig, v); res['json:' + k] = r.ok ? 'ACCEPTED (wrong)' : 'rejected'; if (r.ok || v === min) ok = false; }
    const pkg = (await W.strictLosslessDotLottie(fileOf(W, new Uint8Array(await (await fetch('../tests/real/rs_image.lottie')).arrayBuffer()), 'x.lottie')));
    const srcBytes = new Uint8Array(await (await fetch('../tests/real/rs_image.lottie')).arrayBuffer());
    const base = await JSZip.loadAsync(new Uint8Array(await pkg.blob.arrayBuffer()).slice());
    // each tampered copy differs from the verified output in exactly one way (no folders added by the zip library)
    const tamper = async fn => { const z = new JSZip(); for (const [n, f] of Object.entries(base.files)) z.file(n, f.dir ? null : await f.async('uint8array'), f.dir ? { dir: true, createFolders: false } : { createFolders: false }); await fn(z); return new W.Blob([await z.generateAsync({ type: 'uint8array' })]); };
    const untouched = await W.verifyStrictPackage(new W.Blob([srcBytes]), await tamper(() => {}));
    res.controlUntouchedCopy = untouched.ok ? 'accepted (correct)' : 'REJECTED (wrong): ' + untouched.reason; if (!untouched.ok) ok = false;
    const imgPath = Object.keys(base.files).find(p => /^images\//.test(p)), animPath = Object.keys(base.files).find(p => /^animations\//.test(p));
    const pkgTamper = {
      entryRemoved: await tamper(z => z.remove(imgPath)),
      imageByteChanged: await tamper(async z => { const b = await base.file(imgPath).async('uint8array'); b[100] ^= 1; z.file(imgPath, b, { createFolders: false }); }),
      referenceChanged: await tamper(async z => { z.file(animPath, (await base.file(animPath).async('string')).replace('image_0.png', 'image_9.png'), { createFolders: false }); }),
      entryAdded: await tamper(z => z.file('extra.txt', 'x', { createFolders: false })),
      numberChanged: await tamper(async z => { z.file(animPath, (await base.file(animPath).async('string')).replace(/"fr":(\d+)/, (m, d) => '"fr":' + (+d + 1)), { createFolders: false }); })
    };
    // each must be rejected for the change that was made, not for something incidental
    const expectReason = { entryRemoved: /missing/, imageByteChanged: /differs at byte|changed size/, referenceChanged: /differs at byte|changed size/, entryAdded: /unexpected entries: extra\.txt$/, numberChanged: /differs at byte|changed size/ };
    for (const [k, b] of Object.entries(pkgTamper)) { const r = await W.verifyStrictPackage(new W.Blob([srcBytes]), b); res['pkg:' + k] = r.ok ? 'ACCEPTED (wrong)' : 'rejected: ' + r.reason; if (r.ok || !expectReason[k].test(r.reason)) ok = false; }
    pass('S5', 'Verifiers reject changed numbers, names, image bytes, removed tokens, removed/added entries and altered references', ok, res); }

  // S6 the Lossless preset really runs the strict path, and leaving it switches to Custom + the normal engine
  { W.applyPreset('lossless'); const ui = id => W.document.getElementById(id).textContent;
    const wait = async () => { for (let i = 0; i < 100 && /Optimizing|…/.test(ui('o-status') + ui('o-after')); i++) await sleep(50); await sleep(250); };
    const pretty = JSON.stringify(FX.multilayer, null, 2);
    await W.handleLottieFile(new W.File([pretty], 'pretty.json')); await wait();
    const r1 = W.eval('optResult');
    const jsonView = { strict: !!(r1 && r1.strict), outputIsTokenIdentical: r1 && sameTokens(pretty, r1.text), status: ui('o-status'), before: ui('o-before'), after: ui('o-after'), saved: ui('o-saved'), jsonButton: ui('o-dl'), lottieButton: ui('o-dl-lottie') };
    const lottieBytes = new Uint8Array(await (await fetch('../tests/real/rs_pigeon.lottie')).arrayBuffer());
    await W.handleLottieFile(new W.File([lottieBytes], 'pigeon.lottie')); await wait();
    const r2 = W.eval('optResult');
    const pkgSame = r2 && r2.dotLottie ? sameEntries(await zipEntries(lottieBytes.slice().buffer), await zipEntries(new Uint8Array(await r2.dotLottie.arrayBuffer()).slice().buffer)) : false;
    const lottieView = { strict: !!(r2 && r2.strict), downloadEntriesIdentical: pkgSame, status: ui('o-status'), before: ui('o-before'), after: ui('o-after'), saved: ui('o-saved') };
    W.document.getElementById('opt-defaults').click(); await sleep(400); await wait();
    const custom = { preset: W.eval('presetName'), strict: !!(W.eval('optResult') && W.eval('optResult').strict) };
    W.applyPreset('balanced'); await sleep(400);
    const ok = jsonView.strict && jsonView.outputIsTokenIdentical && /Verified/.test(jsonView.status) && lottieView.strict && pkgSame && custom.preset === 'custom' && !custom.strict;
    pass('S6', 'In the app: Lossless uses the strict path for JSON and .lottie (downloads identical in content); changing a switch moves to Custom and the normal engine', ok, { jsonView, lottieView, custom }); }

  // S7 Balanced/Maximum unchanged by this work: same output as the pre-change engine (?app=phase34 copy)
  { const fr = document.createElement('iframe'); fr.src = '../baseline/lottie-squeeze-standalone.size-gains.html?x=' + Date.now(); fr.style.cssText = 'width:10px;height:10px'; document.body.append(fr);
    await new Promise(r => fr.onload = () => setTimeout(r, 1500)); const O = fr.contentWindow;
    const res = {}; let ok = true;
    for (const preset of ['balanced', 'maximum']) {
      const on = W.eval(`(() => { const p = { ...PRESETS.${preset} }; delete p.hint; return p; })()`), oo = O.eval(`(() => { const p = { ...PRESETS.${preset} }; delete p.hint; return p; })()`);
      for (const [n, f] of Object.entries(FX)) { const a = await W.optimizeLottie(f, on), b = await O.optimizeLottie(f, oo); const same = a.text === b.text; res[preset + ':' + n] = same; if (!same) ok = false; }
      if (!opts.skipReal) for (const n of REAL_FILES.filter(n => n.endsWith('.json'))) { const f = (await loadReal(n)).anim; const a = await W.optimizeLottie(f, on), b = await O.optimizeLottie(f, oo); const same = a.text === b.text; res[preset + ':' + n] = same; if (!same) ok = false; }
    }
    fr.remove();
    pass('S7', 'Balanced and Maximum produce byte-identical output to the version before this change (fixtures and real files)', ok, res); }

  window.STRICT = out; window.STRICT_DONE = true;
  document.getElementById('msg').textContent = 'strict suite done';
  return out;
};
