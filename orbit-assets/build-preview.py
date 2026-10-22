from pathlib import Path
import argparse,re,json,base64,os
parser=argparse.ArgumentParser(description='Build the portfolio V2 preview and optional production homepage.')
parser.add_argument('--production',action='store_true',help='Also write the V2 production index.html.')
args=parser.parse_args()
os.chdir(Path(__file__).resolve().parent.parent)
p=Path('orbit-assets/base-template.html').read_text()
p=p.replace('<title>林艾奭 — UI/UX Designer</title>','<title>林艾奭 — 環形作品集互動測試</title>')
p=p.replace('Noto+Sans+TC:wght@300;400;500;600;700&display=swap','Noto+Sans+TC:wght@300;400;500;600;700;800&display=swap')
p=p.replace('<a href="#hero" class="nav-logo" id="nav-name">林艾奭</a>', '<a href="#hero" class="nav-logo" id="nav-name">UI/UX Portfolio</a>')
p=p.replace("const navName = (p.nav_name && p.nav_name.trim()) || '林艾奭';", "const navName = ((p.nav_name && p.nav_name.trim()) || 'UI/UX Portfolio').replace(/作品集/g, 'Portfolio');")
p=re.sub(r'<!-- 3D 模型：fixed.*?<div class="wrapper">','<div class="wrapper">',p,flags=re.S)
p=re.sub(r'  <section id="projects">.*?</section>','',p,count=1,flags=re.S)
# Bring the existing profile and skills into one responsive layout, retaining
# their IDs and independent visibility settings for the original data renderer.
profile=re.search(r'<section class="hero" id="hero">.*?</section>',p,flags=re.S).group()
skills=re.search(r'  <section id="about".*?</section>',p,flags=re.S).group()
p=p.replace(skills,'',1)
profile=profile.replace('<div class="hero-text">','<div class="hero-text">\n    <p class="sec-label">關於我</p>',1)
p=re.sub(r'<section class="hero" id="hero">.*?</section>',
    lambda _: '<div class="profile-overview">\n'+profile+'\n'+skills+'\n</div>',p,count=1,flags=re.S)
start=p.index('// ── 3D 模型載入進度')
end=p.index('</script>',start)
p=p[:start]+p[end:]
p=p.replace('let current = sectionIds[0] || links[0].dataset.section;', 'let current = sectionIds[0] || links[0].dataset.section;\n  let nearestTop = -Infinity;')
p=p.replace('if (el && window.scrollY >= el.offsetTop - 100) current = id;', 'if (el) { const top = el.getBoundingClientRect().top; if (top <= 100 && top > nearestTop) { current = id; nearestTop = top; } }')
p=p.replace('  applySectionVisibility(sectionSettings);', '  applySectionVisibility(sectionSettings);\n  requestAnimationFrame(updateNav);')
p=p.replace('  allProjects = data;','  allProjects = data;\n  window.orbitProjects = data;\n  window.dispatchEvent(new CustomEvent("orbit-projects", { detail: data }));',1)
# Keep the original data renderer and project modal, use a complete fallback if WebGL is unavailable.
scene='''
<section id="projects" class="orbit-section" aria-label="環形作品集">
  <div class="orbit-sticky">
    <div class="orbit-wordmark" aria-hidden="true"><span class="orbit-wordmark-text">UI/UX</span></div>
    <div id="orbit-stage" class="orbit-stage" tabindex="0" role="region" aria-roledescription="互動作品輪播" aria-label="滾輪或拖曳旋轉作品，或按左右方向鍵切換、Enter 開啟專案">
      <p class="orbit-loading" role="status">正在佈置作品展間<span></span></p>
      <span class="orbit-pointer glass-el" aria-hidden="true">查看專案 ↗</span>
    </div>
    <div class="orbit-bottom">
      <div class="orbit-controls">
        <button class="orbit-arrow glass-el" id="orbit-prev" aria-label="上一件作品"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m14 6-6 6 6 6"/></svg></button>
        <button class="orbit-active" id="orbit-open" aria-label="開啟目前作品"><span class="orbit-count" id="orbit-count">01 / 03</span><span id="orbit-title">探索作品</span><span aria-hidden="true">↗</span></button>
        <button class="orbit-arrow glass-el" id="orbit-next" aria-label="下一件作品"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m10 6 6 6-6 6"/></svg></button>
      </div>
      <div class="orbit-dots" id="orbit-dots" aria-label="選擇作品"></div>
      <p class="orbit-hint" id="orbit-hint" hidden></p>
      <span class="orbit-live sr-only" aria-live="polite" aria-atomic="true"></span>
    </div>
  </div>
  <div class="orbit-fallback wrapper"><div class="glass-el glass-container"><div class="projects-grid" id="projects-grid"></div></div></div>
</section>
'''
p=p.replace('<main>','<main>\n'+scene,1)
p=p.replace('</head>', '<style id="orbit-layout">'+Path('orbit-assets/layout.css').read_text()+'</style>\n</head>')
fallback=json.loads(Path('orbit-assets/projects-snapshot.json').read_text())
module=Path('orbit-assets/orbit-scene.js').read_text()
three_uri='data:text/javascript;base64,'+base64.b64encode(Path('orbit-assets/three.module.min.js').read_bytes()).decode()
# Inline this small helper so standalone HTML embeds Three.js only once.
environment_module=Path('orbit-assets/model-viewer-environment.js').read_text()
environment_module=re.sub(r"import (\{[^;]+\}) from './three.module.min.js';", r'const \1 = THREE;', environment_module)
environment_module=environment_module.replace('export default class EnvironmentScene', 'class EnvironmentScene')
module=module.replace("import EnvironmentScene from './model-viewer-environment.js';", environment_module)
mesh_uri='data:application/octet-stream;base64,'+base64.b64encode(Path('orbit-assets/david-mesh.bin').read_bytes()).decode()
module=module.replace('./three.module.min.js',three_uri).replace('./orbit-assets/david-mesh.bin',mesh_uri)
p=p.replace('</body>', '<!-- Independent orbit prototype. Original David mesh: 1d_inc, CC BY 4.0. Three.js r169: MIT. See orbit-assets/ATTRIBUTION.txt. -->\n<script>window.orbitFallback = '+json.dumps(fallback,ensure_ascii=False)+';</script>\n<script type="module">'+module+'</script>\n</body>')
Path('orbit-test.html').write_text(p)
print('Wrote orbit-test.html; retained original theme CSS, live data, and full project modals')
if args.production:
    production=p.replace('<title>林艾奭 — 環形作品集互動測試</title>',
        '<title>林艾奭 — UI/UX Designer</title>\n<meta name="portfolio-version" content="2">')
    production=production.replace('Independent orbit prototype.', 'Portfolio V2.')
    production=re.sub(r'  <!-- model-viewer 函式庫不在 <head>.*?-->\n', '', production, count=1, flags=re.S)
    Path('index.html').write_text(production)
    print('Wrote index.html: production portfolio V2')
