// Génère asset-gallery.html à partir des JSON des agents A et B.
// Usage : node asset-research/build-gallery.mjs
// Les images et sons sont affichés depuis leurs URLs d'origine (rien n'est téléchargé).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const textures = readJson(join(here, 'textures', 'textures.json'));
const audioUi = readJson(join(here, 'audio-ui', 'audio-ui.json'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https:\/\//.test(String(u ?? '')) ? esc(u) : '#');
const list = (arr) => (arr?.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

let fontFaces = '';
function card(opt, kind, letter, idx) {
  const tag = `${letter}${idx + 1}`;
  const imgs = (opt.previewImages ?? [])
    .map((im) => `<figure><a href="${safeUrl(im.url)}" target="_blank" rel="noopener"><img loading="lazy" src="${safeUrl(im.url)}" alt="${esc(im.caption)}"></a><figcaption>${esc(im.caption)}</figcaption></figure>`)
    .join('');
  const audio = (opt.audioSamples ?? [])
    .map((a) => `<div class="snd"><span>${esc(a.caption)}</span><audio controls preload="none" src="${safeUrl(a.url)}"></audio></div>`)
    .join('');
  let font = '';
  if (kind === 'fonts' && opt.fontFamilyCss && /^https:\/\//.test(opt.fontFamilyCss)) {
    const fam = `preview-${idx}`;
    fontFaces += `@font-face{font-family:'${fam}';src:url('${esc(opt.fontFamilyCss)}');font-display:swap}\n`;
    font = `<p class="fontdemo" style="font-family:'${fam}',sans-serif">Construis ta maison ! 0123456789<br>ABC abc éèàç</p>`;
  }
  return `<article class="card">
  <header><span class="tag">${tag}</span><h3>${esc(opt.name)}</h3></header>
  <p class="meta"><b>${esc(opt.license)}</b> · ${esc(opt.author)}${opt.resolution ? ' · ' + esc(opt.resolution) : ''}</p>
  <p>${esc(opt.style ?? opt.description)}</p>
  ${opt.coverage ? `<p class="small"><b>Blocs :</b> ${esc(opt.coverage)}</p>` : ''}
  ${opt.missing?.length ? `<p class="small"><b>Manquants :</b> ${esc(opt.missing.join(', '))}</p>` : ''}
  ${font}
  <div class="imgs">${imgs || '<p class="small">Pas d\'aperçu image.</p>'}</div>
  ${audio ? `<div class="audio">${audio}</div>` : ''}
  <div class="pc"><div><h4>Pour</h4>${list(opt.pros)}</div><div><h4>Contre</h4>${list(opt.cons)}</div></div>
  <p class="links"><a href="${safeUrl(opt.sourceUrl)}" target="_blank" rel="noopener">Page source</a> · <a href="${safeUrl(opt.licenseUrl)}" target="_blank" rel="noopener">Licence</a></p>
</article>`;
}

function section(title, letter, kind, opts, reco) {
  if (!opts?.length) return `<section><h2>${esc(title)}</h2><p>En attente des résultats.</p></section>`;
  return `<section><h2>${esc(title)}</h2>${reco ? `<p class="reco"><b>Recommandation :</b> ${esc(reco)}</p>` : ''}
<div class="grid">${opts.map((o, i) => card(o, kind, letter, i)).join('')}</div></section>`;
}

const body = [
  section('Textures de blocs', 'T', 'textures', textures?.options, textures?.recommendation),
  section('Sons', 'S', 'sounds', audioUi?.sounds, audioUi?.recommendation?.sounds),
  section('Icônes d\'interface', 'I', 'icons', audioUi?.icons, audioUi?.recommendation?.icons),
  section('Police', 'P', 'fonts', audioUi?.fonts, audioUi?.recommendation?.fonts),
].join('\n');

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Galerie d'assets</title>
<style>
:root{--bg:#f6f8fb;--fg:#1d2433;--card:#fff;--muted:#5b6475;--accent:#2f7de1;--line:#dfe4ec}
@media (prefers-color-scheme:dark){:root{--bg:#141820;--fg:#e8ecf3;--card:#1e2430;--muted:#9aa4b5;--accent:#6aa8ff;--line:#2d3544}}
${fontFaces}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1280px;margin:auto;padding:24px 16px}
h1{margin:0 0 4px}h2{margin:40px 0 8px;border-bottom:2px solid var(--line);padding-bottom:6px}
.intro{color:var(--muted)}.reco{background:var(--card);border-left:4px solid var(--accent);padding:8px 12px;border-radius:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.card header{display:flex;gap:10px;align-items:center}.card h3{margin:0;font-size:18px}
.tag{background:var(--accent);color:#fff;font-weight:700;border-radius:6px;padding:2px 8px}
.meta{color:var(--muted);margin:4px 0}.small{font-size:13px;color:var(--muted)}
.imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin:10px 0}
figure{margin:0}figure img{width:100%;aspect-ratio:1;object-fit:contain;background:repeating-conic-gradient(#ccc 0 25%,#eee 0 50%) 0 0/16px 16px;border-radius:6px;image-rendering:pixelated}
figcaption{font-size:11px;color:var(--muted)}
.snd{display:flex;flex-direction:column;font-size:13px;margin:6px 0}.snd audio{width:100%;height:32px}
.pc{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px}.pc h4{margin:4px 0}.pc ul{margin:0;padding-left:18px}
.fontdemo{font-size:24px;background:var(--bg);padding:8px;border-radius:8px}
a{color:var(--accent)}
@media (max-width:420px){.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Galerie d'assets – Construction Brique</h1>
<p class="intro">Choisis une option par catégorie en donnant son code (ex. T2, S1, I1, P3). Les images et sons sont chargés depuis leurs sites d'origine. Clique une image pour l'agrandir.</p>
${body}
</main></body></html>`;

writeFileSync(join(root, 'asset-gallery.html'), html);
console.log('asset-gallery.html écrit');
