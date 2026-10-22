import * as THREE from './three.module.min.js';
import EnvironmentScene from './model-viewer-environment.js';

// A single 3D scene gives the curved work panels and original David model real occlusion.
const section = document.querySelector('.orbit-section');
const stage = document.getElementById('orbit-stage');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const title = document.getElementById('orbit-title');
const count = document.getElementById('orbit-count');
const dots = document.getElementById('orbit-dots');
const hint = document.getElementById('orbit-hint');
const live = document.querySelector('.orbit-live');
const pointerLabel = document.querySelector('.orbit-pointer');
const TAU = Math.PI * 2;
let projects = [], cards = [], bust, renderer, scene, camera, ring;
let angle = 0, targetAngle = 0, active = 0;
let frame = 0, visible = true, dirty = true, drag = null, hover = null;
let renderedAngle = 0, lastFrameTime = 0, pendingPointer = null, occluders = [];
let lastPointer = null;
let mouseX = 0, mouseY = 0, moveX = 0, moveY = 0, buildVersion = 0;
let headPointerBounds = null, headReturn = null;
let headViewBounds = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const RADIUS = 3.95 * 1.1;
// Enlarge each cover and its glass surface by 10%, keeping the orbit radius.
const CARD_HEIGHT = (2.7 + .15) * 1.1;
const SCENE_SCALE = 1.2;
// Keep the original pointer range, with gentler tracking and a soft return.
const HEAD_POINTER_RANGE = THREE.MathUtils.degToRad(30);
const HEAD_RETURN_DURATION = 600;
const HEAD_TURN_RESPONSE_MS = 220 / (1.05 * 1.01);
const HEAD_MAX_TURN_SPEED = THREE.MathUtils.degToRad(220 * 1.05 * 1.01);
const HEAD_BASE_YAW = -0.308;
const HEAD_PANEL_PITCH_LIMIT = THREE.MathUtils.degToRad(18);
const panelLookPoint = new THREE.Vector3();
const meshDisposables = new Set();
const HEAD_MESH_URL = './orbit-assets/david-mesh.bin';
const HEAD_MESH_GZIP_URL = null;
let sceneProjectsKey = null;
const COARSE_POINTER = matchMedia('(pointer:coarse)').matches;
// Phones fill a tall, oversized canvas with layered transparent glass. Start at
// a lower resolution there, and step down further only when frames measurably
// miss their budget during continuous motion. Never step back up (no flicker).
const PIXEL_RATIO_STEPS = COARSE_POINTER ? [1.5, 1.25, 1] : [1.75, 1.5, 1.25];
const TEXTURE_LIMIT = COARSE_POINTER ? 1024 : 2048;
let pixelRatioLevel = 0, frameSamples = 0, slowFrames = 0, measureAfter = Infinity;
function currentPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_STEPS[pixelRatioLevel]);
}
function trackFrameCost(interval, now) {
  // Idle gaps between gestures are not slowness; skip start-up texture uploads.
  if (interval > 100 || now < measureAfter || pixelRatioLevel >= PIXEL_RATIO_STEPS.length - 1) return;
  frameSamples++;
  if (interval > 24) slowFrames++;
  if (frameSamples < 45) return;
  const tooSlow = slowFrames > frameSamples * .35;
  frameSamples = slowFrames = 0;
  if (!tooSlow) return;
  const next = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_STEPS[pixelRatioLevel + 1]);
  if (next >= currentPixelRatio()) return;
  pixelRatioLevel++;
  resize();
}

async function loadHeadGeometry() {
  if (HEAD_MESH_GZIP_URL && typeof DecompressionStream === 'function') {
    try {
      const response = await fetch(HEAD_MESH_GZIP_URL);
      if (!response.ok) throw new Error('Compressed geometry unavailable');
      return await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    } catch (error) { /* Keep a raw fallback for older browsers or damaged caches. */ }
  }
  const response = await fetch(HEAD_MESH_URL);
  if (!response.ok) throw new Error('David geometry unavailable');
  return response.arrayBuffer();
}

function invalidate() {
  dirty = true;
  if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render);
}
function effectiveTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
}
function syncTheme() {
  if (!renderer) return;
  const dark = effectiveTheme() === 'dark';
  renderer.toneMappingExposure = dark ? .9 : 1.08;
  // Original model-viewer exposure: 1.6 in light mode, 0.6 in dark mode.
  // Compensate only the head's IBL so the existing glass stays unchanged.
  if (bust) bust.material.envMapIntensity = (dark ? .6 : 1.6) / renderer.toneMappingExposure;
  // Draw now rather than on the next frame: the theme's view transition captures
  // the new state right after the switch, and the sculpture must already be lit.
  if (ring && visible && !document.hidden) {
    if (frame) cancelAnimationFrame(frame);
    render(performance.now());
  } else invalidate();
}
function fail(message) {
  section.classList.add('orbit-failed');
  stage.querySelector('.orbit-loading').textContent = message;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}
function resize() {
  const {width, height} = stage.getBoundingClientRect();
  if (!width || !height) return;
  const aspect = width / height;
  // Extra canvas space keeps the enlarged sculpture clear of the viewport edges.
  // Compensate for that space so the requested scale remains exactly 120%.
  const style = getComputedStyle(stage);
  const extraHeight = parseFloat(style.getPropertyValue('--outset-top')) + parseFloat(style.getPropertyValue('--outset-bottom'));
  const baseHeight = Math.max(1, height - extraHeight);
  const baseViewHeight = Math.max(7.0, (RADIUS*2+.8) / (width / baseHeight));
  // Fit the full rotation envelope, including the front panel's lower edge,
  // hover lift and glass rim. Fit once per resize, never zoom while hovering.
  camera.updateMatrixWorld();
  const radius=RADIUS+.04, halfCardHeight=CARD_HEIGHT/2+.025;
  const point=new THREE.Vector3();
  let minY=Infinity,maxY=-Infinity;
  for(const y of [-.86-halfCardHeight,-.86+halfCardHeight+.08])for(const z of [-radius,radius]) {
    point.set(0,y,z).applyMatrix4(camera.matrixWorldInverse);
    minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
  }
  if(headViewBounds) {minY=Math.min(minY,headViewBounds.min);maxY=Math.max(maxY,headViewBounds.max);}
  const padding=width<=760?14:20;
  const viewHeight = Math.max(
    baseViewHeight * height / baseHeight / SCENE_SCALE,
    (maxY-minY)*height/Math.max(1,height-padding*2),
    radius*2*height/Math.max(1,width-padding*2)
  );
  const paddingWorld=padding*viewHeight/height;
  // Keep the existing composition when it fits; shift only enough to clear an edge.
  const centerY=THREE.MathUtils.clamp(0,maxY+paddingWorld-viewHeight/2,minY-paddingWorld+viewHeight/2);
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = centerY + viewHeight / 2;
  camera.bottom = centerY - viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(currentPixelRatio());
  renderer.setSize(width, height);
  updateHeadPointerBounds(width, height);
  invalidate();
}
function measureHeadViewBounds() {
  // Project the original mesh over all yaw angles and its allowed pitch range.
  // The yaw extrema are analytic; pitch samples include both limits. Cache this
  // once at load so pointer movement does not trigger geometry work or zooming.
  const vertices=bust.geometry.getAttribute('position');
  const m=camera.matrixWorldInverse.elements;
  const origin=bust.position.clone().applyMatrix4(camera.matrixWorldInverse);
  const horizontalWeight=Math.hypot(m[1],m[9]);
  let min=Infinity,max=-Infinity;
  for(let step=0;step<=24;step++) {
    const pitch=THREE.MathUtils.lerp(-HEAD_POINTER_RANGE/2,HEAD_PANEL_PITCH_LIMIT,step/24);
    const sin=Math.sin(pitch),cos=Math.cos(pitch);
    for(let i=0;i<vertices.count;i++) {
      const x=vertices.getX(i)*bust.scale.x,y=vertices.getY(i)*bust.scale.y,z=vertices.getZ(i)*bust.scale.z;
      const pitchedY=y*cos-z*sin,pitchedZ=y*sin+z*cos;
      const center=origin.y+m[5]*pitchedY;
      const spread=horizontalWeight*Math.hypot(x,pitchedZ);
      min=Math.min(min,center-spread);max=Math.max(max,center+spread);
    }
  }
  headViewBounds={min:min-.03,max:max+.03};
}
function updateHeadPointerBounds(width, height) {
  if (!bust) return;
  // A stable, head-sized interaction area with the original 400:460 container
  // ratio. Never recompute from the live rotation, which would feed back into input.
  bust.geometry.computeBoundingBox();
  const box = bust.geometry.boundingBox;
  const transform = new THREE.Matrix4().compose(bust.position,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, HEAD_BASE_YAW, 0)), bust.scale);
  camera.updateMatrixWorld();
  let left=Infinity, right=-Infinity, top=Infinity, bottom=-Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x,y,z).applyMatrix4(transform).project(camera);
    const px=(p.x+1)*width/2, py=(1-p.y)*height/2;
    left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
  }
  const h=(bottom-top)*1.04, w=h*400/460;
  headPointerBounds={left:(left+right-w)/2,top:(top+bottom-h)/2,width:w,height:h};
}
function nearestYaw(yaw, reference) {
  return reference + Math.atan2(Math.sin(yaw-reference),Math.cos(yaw-reference));
}
function returnHead() {
  mouseX=mouseY=0;
  if (!headReturn && (moveX || moveY)) {
    // Equivalent angle, shortest way home even after following a full orbit.
    moveX=nearestYaw(moveX*HEAD_POINTER_RANGE,0)/HEAD_POINTER_RANGE;
    headReturn={x:moveX,y:moveY,start:performance.now()};
  }
}
function updateHeadPointer(e, rect) {
  if (e.pointerType==='touch' || reduced.matches || !headPointerBounds) return;
  const b=headPointerBounds, x=e.clientX-rect.left, y=e.clientY-rect.top;
  if (x>=b.left && x<=b.left+b.width && y>=b.top && y<=b.top+b.height) {
    headReturn=null;
    mouseX=nearestYaw(((x-b.left)/b.width-.5)*HEAD_POINTER_RANGE,moveX*HEAD_POINTER_RANGE)/HEAD_POINTER_RANGE;
    mouseY=(y-b.top)/b.height-.5;
  } else returnHead();
}
function lookAtPanel(hit) {
  if (!bust || reduced.matches || lastPointer?.pointerType==='touch') return;
  const card=cards[hit.object.userData.projectIndex];
  // Aim mostly at the work itself, with a little movement within its surface.
  // Use its current world position, so rotating the ring changes David's gaze.
  card.group.localToWorld(panelLookPoint.set(0,0,RADIUS));
  panelLookPoint.lerp(hit.point,.25);
  // Follow the full ring, including negative Z behind David. Unwrap around the
  // current pose so crossing +/-180 degrees never reverses through the front.
  const currentYaw=HEAD_BASE_YAW+moveX*HEAD_POINTER_RANGE;
  const yaw=nearestYaw(Math.atan2(panelLookPoint.x,panelLookPoint.z),currentYaw);
  const pitch=THREE.MathUtils.clamp(Math.atan2(1.45-panelLookPoint.y,Math.hypot(panelLookPoint.x,panelLookPoint.z))*.5,0,HEAD_PANEL_PITCH_LIMIT);
  headReturn=null;
  mouseX=(yaw-HEAD_BASE_YAW)/HEAD_POINTER_RANGE;
  mouseY=pitch/HEAD_POINTER_RANGE;
}
function curvedGeometry(radius, span, height, invertUV = false) {
  const position = [], uv = [], indices = [];
  const segments = 96;
  for (let i=0; i<=segments; i++) {
    const a = (i/segments - .5)*span;
    for (let j=0; j<2; j++) {
      position.push(Math.sin(a)*radius, (j-.5)*height, Math.cos(a)*radius);
      uv.push(invertUV ? 1-i/segments : i/segments, j);
    }
  }
  for (let i=0; i<segments; i++) {
    const k=i*2; indices.push(k,k+2,k+1,k+2,k+3,k+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  meshDisposables.add(geometry);
  return geometry;
}
function rimCurve(radius, span, y) {
  const points=[];
  for(let i=0;i<=96;i++) {
    const a=(i/96-.5)*span;
    points.push(new THREE.Vector3(Math.sin(a)*radius,y,Math.cos(a)*radius));
  }
  return new THREE.CatmullRomCurve3(points);
}
function tube(curve, material, width=.013) {
  const geo=new THREE.TubeGeometry(curve,100,width,5,false);
  meshDisposables.add(geo);
  return new THREE.Mesh(geo,material);
}
// Unroll the cylinder to preserve the source image ratio. Every material uses
// these same positions; glass depth comes from its fine rim, not oversized faces.
function setCardAspectRatio(card, aspect = 16 / 9) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  if (card.aspect === ratio) return;
  const height = CARD_HEIGHT;
  const span = height * ratio / RADIUS;
  const oldGeometry = new Set(card.panels.map(mesh => mesh.geometry));
  card.frame.traverse(mesh => { if (mesh.geometry) oldGeometry.add(mesh.geometry); });
  oldGeometry.forEach(geometry => {
    geometry.dispose();
    meshDisposables.delete(geometry);
  });
  card.frame.clear();

  const frontGeometry = curvedGeometry(RADIUS, span, height);
  const backGeometry = curvedGeometry(RADIUS, span, height, true);
  card.panels.forEach(mesh => { mesh.geometry = mesh === card.surfaces[1] ? backGeometry : frontGeometry; });
  const { white, blue, pink } = card.rimMaterials;
  for (const y of [-height / 2, height / 2]) {
    card.frame.add(tube(rimCurve(RADIUS + .012, span, y), white));
    card.frame.add(tube(rimCurve(RADIUS - .012, span, y), y > 0 ? blue : pink, .018));
  }
  for (const side of [-1, 1]) {
    const a = side * span / 2, x = Math.sin(a) * RADIUS, z = Math.cos(a) * RADIUS;
    card.frame.add(tube(new THREE.LineCurve3(
      new THREE.Vector3(x, -height / 2, z), new THREE.Vector3(x, height / 2, z)
    ), white, .014));
  }
  card.aspect = ratio;
}
function coverURL(p) {
  try { return (Array.isArray(p.images) ? p.images : JSON.parse(p.images || '[]'))[0] || ''; }
  catch { return ''; }
}
function placeholderTexture(p) {
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#edf1f5';ctx.fillRect(0,0,1280,720);
  ctx.fillStyle='#333';ctx.font='500 52px "Noto Sans TC",sans-serif';
  const chars=Array.from(p.title || 'Project');
  const lines=[];let line='';
  for(const c of chars){if(ctx.measureText(line+c).width>1100){lines.push(line);line=c;}else line+=c;}lines.push(line);
  lines.forEach((s,i)=>ctx.fillText(s,70,300+i*80));
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}
function pickSceneAt(clientX,clientY) {
  const rect=stage.getBoundingClientRect();
  if(clientX<rect.left || clientX>rect.right || clientY<rect.top || clientY>rect.bottom)return null;
  pointer.set((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2);
  raycaster.setFromCamera(pointer,camera);
  // Include David, so a panel behind the sculpture cannot be clicked through the face.
  const hits=raycaster.intersectObjects([...cards.flatMap(c=>c.surfaces),...occluders],false);
  return hits[0] || null;
}
function pickSurfaceAt(clientX,clientY) {
  const hit=pickSceneAt(clientX,clientY);
  return hit?.object.userData.projectIndex !== undefined ? hit : null;
}
function pickAt(clientX,clientY) {
  return pickSurfaceAt(clientX,clientY)?.object.userData.projectIndex ?? null;
}
function updateActive(index, announce=false) {
  if(!projects.length)return;
  active=((index%projects.length)+projects.length)%projects.length;
  const p=projects[active];
  title.textContent=p.title;
  count.textContent=`${String(active+1).padStart(2,'0')} / ${String(projects.length).padStart(2,'0')}`;
  document.getElementById('orbit-open').setAttribute('aria-label',`開啟專案：${p.title}`);
  [...dots.children].forEach((b,i)=>b.setAttribute('aria-current',String(i===active)));
  if(announce)live.textContent=`第 ${active+1} 件作品，共 ${projects.length} 件：${p.title}`;
}
function nearestProject() {
  let nearest=0,distance=Infinity;
  cards.forEach((card,index)=>{
    const a=card.base+targetAngle;
    const d=Math.abs(Math.atan2(Math.sin(a),Math.cos(a)));
    if(d<distance){distance=d;nearest=index;}
  });
  return nearest;
}
function goTo(index, announce=true) {
  if(!projects.length)return;
  hover=null;pendingPointer=lastPointer=null;returnHead();stage.classList.remove('is-hovering');
  const i=((index%projects.length)+projects.length)%projects.length;
  const desired=-cards[i].base;
  const total=targetAngle;
  const delta=Math.atan2(Math.sin(desired-total),Math.cos(desired-total));
  targetAngle+=delta;
  if(reduced.matches)angle=targetAngle;
  updateActive(i,announce);invalidate();
}
function openProject(index=active) {
  hover=null;pendingPointer=lastPointer=null;returnHead();stage.classList.remove('is-hovering');invalidate();
  if(projects[index] && typeof window.openModal === 'function') window.openModal(projects[index].id);
}
async function buildProjects(data) {
  if(!Array.isArray(data))return;
  const key=JSON.stringify([window.orbitEmptyReason||'',data.map(p=>[p.id,p.title,coverURL(p)])]);
  if(key===sceneProjectsKey)return;
  sceneProjectsKey=key;
  const selectedId=projects[active]?.id;
  hint.textContent='';hint.hidden=true;
  const version=++buildVersion;
  hover=null;pendingPointer=lastPointer=null;returnHead();stage.classList.remove('is-hovering');
  const previous=cards;
  previous.forEach(c=>{
    ring.remove(c.group);
    c.group.traverse(o=>{if(o.material){o.material.map?.dispose();o.material.dispose();}});
  });
  meshDisposables.forEach(g=>g.dispose());
  meshDisposables.clear();
  projects=data;cards=[];dots.replaceChildren();
  if(!projects.length) {
    const unreachable=navigator.onLine===false || window.orbitEmptyReason==='offline';
    hint.textContent=unreachable?'暫時無法載入作品，連線後會自動更新':'目前沒有可顯示的作品';hint.hidden=false;
    title.textContent=unreachable?'等待連線':'暫無作品';count.textContent='00 / 00';invalidate();return;
  }
  const step=TAU/projects.length;
  const loader=new THREE.TextureLoader();
  projects.forEach((p,i)=>{
    const group=new THREE.Group();
    // Two front panels and one rear panel form the opening composition in the reference.
    const base=-Math.PI/3+i*step;
    group.rotation.y=base;group.position.y=-.86;
    ring.add(group);
    const glassMaterial=new THREE.ShaderMaterial({
      transparent:true,side:THREE.DoubleSide,depthWrite:false,
      vertexShader:`varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
        void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
        void main(){vec3 n=normalize(vNormal);vec3 v=normalize(vView);
          float fresnel=pow(1.-abs(dot(n,v)),2.8);
          float rim=pow(abs(vUv.y-.5)*2.,16.)+pow(abs(vUv.x-.5)*2.,22.);
          float reflection=pow(max(abs(dot(reflect(-normalize(vec3(-.6,.85,1.)),n),v)),0.),38.);
          float ribbon=exp(-pow((vUv.x*.7+vUv.y-.83)*12.,2.));
          vec3 tint=mix(vec3(.79,.89,1.),vec3(1.,.95,.99),vUv.x);
          float alpha=.075+fresnel*.16+rim*.26+reflection*.32+ribbon*.09;
          gl_FragColor=vec4(mix(tint,vec3(1.),reflection),min(alpha,.68));}`
    });
    const initialGeometry=new THREE.BufferGeometry();
    const glass=new THREE.Mesh(initialGeometry,glassMaterial);
    group.add(glass);
    const placeholder=placeholderTexture(p);
    const frontMaterial=new THREE.MeshBasicMaterial({map:placeholder,side:THREE.FrontSide,toneMapped:false,transparent:false,opacity:1,depthWrite:true});
    const backMaterial=frontMaterial.clone();backMaterial.side=THREE.BackSide;backMaterial.transparent=true;backMaterial.opacity=.56;backMaterial.depthWrite=false;
    const front=new THREE.Mesh(initialGeometry,frontMaterial);
    const back=new THREE.Mesh(initialGeometry,backMaterial);
    front.userData.projectIndex=i;back.userData.projectIndex=i;
    group.add(front,back);
    const white=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.94,depthWrite:false});
    const blue=new THREE.MeshBasicMaterial({color:0xb1d4f7,transparent:true,opacity:.70,depthWrite:false});
    const pink=new THREE.MeshBasicMaterial({color:0xe2d2f1,transparent:true,opacity:.55,depthWrite:false});
    // A clear-coat reflection above the opaque cover: a soft light panel with
    // a sharp highlight and subtle cool/warm edges, following the curved UVs.
    const sheenMaterial=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
      uniforms:{hoverAmount:{value:0},pointerUV:{value:new THREE.Vector2(.5,.5)},sweep:{value:1}},
      vertexShader:`varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
        void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
        uniform float hoverAmount;uniform vec2 pointerUV;uniform float sweep;
        void main(){
          vec3 n=normalize(vNormal);vec3 v=normalize(vView);
          float fresnel=pow(1.-abs(dot(n,v)),3.);
          float slant=(vUv.y-.5)*(.22+(pointerUV.y-.5)*.18);
          float axis=vUv.x+slant+n.x*.045;
          float center=mix(.18,.82,pointerUV.x);
          float distanceToLight=axis-center;
          float softbox=exp(-pow(distanceToLight*7.,2.))*.22;
          float glint=exp(-pow((distanceToLight+.035)*42.,2.))*.34;
          float echo=exp(-pow((distanceToLight-.15)*65.,2.))*.12;
          float sweepAxis=mix(-.35,1.35,sweep);
          float passing=exp(-pow((axis-sweepAxis)*13.,2.))*sin(sweep*3.14159265)*.34;
          float edge=pow(abs(vUv.x-.5)*2.,24.)+pow(abs(vUv.y-.5)*2.,30.);
          float edgeLight=edge*(.12+fresnel*.24);
          float idle=pow(vUv.y,18.)*.035;
          float alpha=idle+hoverAmount*(softbox+glint+echo+passing+edgeLight+fresnel*.035);
          vec3 tint=mix(vec3(.83,.94,1.),vec3(1.,.91,.96),smoothstep(-.08,.12,distanceToLight));
          tint=mix(tint,vec3(1.),clamp((glint+passing)*2.,0.,1.));
          gl_FragColor=vec4(tint,min(alpha,.66));
        }`
    });
    const sheen=new THREE.Mesh(initialGeometry,sheenMaterial);
    const frame=new THREE.Group();
    group.add(sheen,frame);
    const card={group,surfaces:[front,back],panels:[glass,front,back,sheen],frame,
      rimMaterials:{white,blue,pink},base,sheen:sheenMaterial,
      hoverTarget:new THREE.Vector2(.5,.5),wasHovered:false};
    setCardAspectRatio(card);
    cards.push(card);
    const dot=document.createElement('button');dot.className='orbit-dot';dot.type='button';
    dot.setAttribute('aria-label',`旋轉至作品 ${i+1}：${p.title}`);
    dot.addEventListener('click',()=>goTo(i));dots.append(dot);
    const url=coverURL(p);
    if(url)loader.load(url,texture=>{
      if(version!==buildVersion){texture.dispose();return;}
      texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),COARSE_POINTER?4:8);
      const image=texture.image;
      const width=image.naturalWidth || image.width;
      const height=image.naturalHeight || image.height;
      // Panels never display more than this; oversized covers stall the GPU upload
      // and mipmap generation on phones. Keep the original aspect ratio.
      if(Math.max(width,height)>TEXTURE_LIMIT) {
        const scale=TEXTURE_LIMIT/Math.max(width,height),canvas=document.createElement('canvas');
        canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
        const context=canvas.getContext('2d');
        if(context) {
          context.imageSmoothingQuality='high';
          context.drawImage(image,0,0,canvas.width,canvas.height);
          texture.image=canvas;texture.needsUpdate=true;
        }
      }
      setCardAspectRatio(card, width / height);
      frontMaterial.map=texture;backMaterial.map=texture;
      frontMaterial.needsUpdate=true;backMaterial.needsUpdate=true;placeholder.dispose();invalidate();
    },undefined,()=>{ /* The named placeholder remains usable when a cover is unavailable. */ });
  });
  // Start with the SinoPac banking project facing the viewer, including cached
  // loads. Data refreshes retain the selected work instead of resetting the ring.
  const preferred=projects.findIndex(p=>p.id===(selectedId ?? 1));
  const initial=preferred<0?0:preferred;
  angle=targetAngle=renderedAngle=-cards[initial].base;
  ring.rotation.y=renderedAngle;
  updateActive(initial);invalidate();
}
function render(now) {
  frame=0;
  if(!visible || document.hidden)return;
  const dt=Math.min((now-(lastFrameTime || now-16.67))/16.67,3);
  if(lastFrameTime)trackFrameCost(now-lastFrameTime,now);
  lastFrameTime=now;
  const ease=reduced.matches ? 1 : 1-Math.pow(.83,dt);
  const headEase=reduced.matches?1:1-Math.exp(-dt*16.67/HEAD_TURN_RESPONSE_MS);
  const headStep=reduced.matches?Infinity:HEAD_MAX_TURN_SPEED*dt*16.67/1000/HEAD_POINTER_RANGE;
  const ringWasMoving=Math.abs(targetAngle-angle)>.0002||Math.abs(angle-renderedAngle)>.0002;
  angle+=(targetAngle-angle)*ease;
  renderedAngle+=(angle-renderedAngle)*(drag?.locked ? 1 : ease);
  ring.rotation.y=renderedAngle;
  ring.updateMatrixWorld(true);
  const gazePointer=pendingPointer || (ringWasMoving ? lastPointer : null);
  if(gazePointer && !drag){
    const hit=pickSurfaceAt(gazePointer.x,gazePointer.y);
    hover=hit?.object.userData.projectIndex ?? null;
    if(hit){
      const card=cards[hover];
      // Back covers mirror their texture UVs; reflections stay on the physical surface.
      card.hoverTarget.set(hit.object===card.surfaces[1] ? 1-hit.uv.x : hit.uv.x,hit.uv.y);
      lookAtPanel(hit);
    } else {
      updateHeadPointer({clientX:gazePointer.x,clientY:gazePointer.y,pointerType:gazePointer.pointerType},stage.getBoundingClientRect());
    }
    stage.classList.toggle("is-hovering",hover!==null);pendingPointer=null;
  }
  if (headReturn) {
    const progress=reduced.matches?1:Math.min(1,(now-headReturn.start)/HEAD_RETURN_DURATION);
    const remaining=1-progress*progress*(3-2*progress);
    moveX=headReturn.x*remaining;moveY=headReturn.y*remaining;
    if (progress===1) headReturn=null;
  } else {
    moveX+=THREE.MathUtils.clamp((mouseX-moveX)*headEase,-headStep,headStep);
    moveY+=THREE.MathUtils.clamp((mouseY-moveY)*headEase,-headStep,headStep);
  }
  if(bust){
    bust.rotation.y=HEAD_BASE_YAW+moveX*HEAD_POINTER_RANGE;
    bust.rotation.x=moveY*HEAD_POINTER_RANGE;
    // The original moves the camera around a fixed model/environment. Rotating
    // both here preserves that lighting relationship within the shared ring scene.
    bust.material.envMapRotation.copy(bust.rotation);
    occluders.forEach(o=>{
      o.position.copy(o.userData.headOffset).applyQuaternion(bust.quaternion).add(bust.position);
      o.quaternion.copy(bust.quaternion);o.updateMatrixWorld();
    });
  }
  let reflectionsMoving=false;
  cards.forEach((c,i)=>{
    const hovered=hover===i && !drag;
    const target=hovered && !reduced.matches?.08:0;
    c.group.position.y+=(target-.86-c.group.position.y)*(reduced.matches?1:ease);
    const uniforms=c.sheen.uniforms;
    if(hovered && !c.wasHovered)uniforms.sweep.value=reduced.matches?1:0;
    c.wasHovered=hovered;
    const amount=hovered?1:0;
    uniforms.hoverAmount.value+=(amount-uniforms.hoverAmount.value)*ease;
    uniforms.pointerUV.value.lerp(c.hoverTarget,ease);
    if(uniforms.sweep.value<1)uniforms.sweep.value=reduced.matches?1:Math.min(1,uniforms.sweep.value+dt/42);
    const glow=uniforms.hoverAmount.value;
    c.rimMaterials.white.opacity=.94+glow*.06;
    c.rimMaterials.blue.opacity=.70+glow*.20;
    c.rimMaterials.pink.opacity=.55+glow*.15;
    if(Math.abs(amount-glow)>.001 || (hovered && uniforms.pointerUV.value.distanceToSquared(c.hoverTarget)>.000001) || uniforms.sweep.value<1)reflectionsMoving=true;
  });
  renderer.render(scene,camera);
  dirty=false;
  const moving=Math.abs(targetAngle-angle)>.0002||Math.abs(angle-renderedAngle)>.0002||Math.abs(mouseX-moveX)>.0002||Math.abs(mouseY-moveY)>.0002||cards.some((c,i)=>Math.abs(c.group.position.y-((hover===i && !drag && !reduced.matches?.08:0)-.86))>.001);
  if(moving || reflectionsMoving || headReturn)frame=requestAnimationFrame(render);
}
async function init() {
  try {
    renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
    renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled=false;
    renderer.domElement.setAttribute('aria-hidden','true');stage.prepend(renderer.domElement);
    const geometryRequest=loadHeadGeometry().then(binary=>({binary}),error=>({error}));
    scene=new THREE.Scene();
    camera=new THREE.OrthographicCamera(-6,6,3.5,-3.5,.1,100);
    camera.position.set(0,3.65,15);camera.lookAt(0,.4,0);
    ring=new THREE.Group();scene.add(ring);
    // Same neutral studio environment used by the original model-viewer 3.5.0.
    const environmentScene=new EnvironmentScene('neutral');
    const pmrem=new THREE.PMREMGenerator(renderer);
    const headEnvironment=pmrem.fromScene(environmentScene,.04,.1,100);
    pmrem.dispose();
    const environmentResources=new Set();
    environmentScene.traverse(o=>{if(o.geometry)environmentResources.add(o.geometry);if(o.material)environmentResources.add(o.material);});
    environmentResources.forEach(resource=>resource.dispose());
    syncTheme();resize();
    new ResizeObserver(resize).observe(stage);
    new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    matchMedia('(prefers-color-scheme:dark)').addEventListener('change',syncTheme);
    new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)invalidate();},{rootMargin:'100px'}).observe(stage);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)invalidate();});
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('作品展間暫時無法顯示，請使用下方作品列表。');});
    const geometryResult=await geometryRequest;
    if(geometryResult.error)throw geometryResult.error;
    const binary=geometryResult.binary,header=new DataView(binary);
    const vertices=header.getUint32(0,true),indices=header.getUint32(4,true);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(binary,8,vertices*3),3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(binary,8+vertices*12,vertices*3),3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(binary,8+vertices*24,indices),1));
    // Restore the original GLB material (baseColorFactor is linear RGB).
    bust=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
      color:new THREE.Color().setRGB(.539777445607042,.539777445607042,.539777445607042,THREE.LinearSRGBColorSpace),
      metalness:0,roughness:.6,side:THREE.DoubleSide,envMap:headEnvironment.texture
    }));
    // Pitch in the sculpture's local direction, so looking behind still looks
    // down toward the panel rather than tilting upward around the world's X axis.
    bust.rotation.order='YXZ';
    bust.scale.setScalar(5.4);bust.position.set(0,.85,0);bust.rotation.y=HEAD_BASE_YAW;
    scene.add(bust);
    measureHeadViewBounds();
    syncTheme();resize();
    // Lightweight pick volumes avoid raycasting the 46,664-triangle sculpture on every pointer move.
    const occluderMaterial=new THREE.MeshBasicMaterial({visible:false});
    const headPick=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),occluderMaterial);
    headPick.position.set(0,1.65,0);headPick.scale.set(1.12,1.65,.95);
    const neckPick=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),occluderMaterial);
    neckPick.position.set(0,-.6,0);neckPick.scale.set(1.05,1.15,.75);
    occluders=[headPick,neckPick];occluders.forEach(o=>{o.userData.headOffset=o.position.clone().sub(bust.position);scene.add(o);o.updateMatrixWorld();});
    await buildProjects(window.orbitProjects ?? window.orbitFallback);
    section.classList.add('orbit-ready');invalidate();
    measureAfter=performance.now()+1500;
  } catch(error) { console.error('Orbit preview:',error);fail('作品展間暫時無法顯示，請使用下方作品列表。'); }
}
window.addEventListener('orbit-projects',e=>{if(ring)buildProjects(e.detail);});

// Page scrolling moves the whole hero normally; it never rotates the scene.
window.addEventListener('scroll',()=>{
  // Touch scrolling leaves nothing to reset; skip a WebGL redraw per scroll event.
  if(!ring || (hover===null && !pendingPointer && !lastPointer && !headReturn && !moveX && !moveY && !mouseX && !mouseY))return;
  hover=null;pendingPointer=lastPointer=null;returnHead();
  stage.classList.remove('is-hovering');invalidate();
},{passive:true});
reduced.addEventListener('change',()=>{headReturn=null;pendingPointer=lastPointer=null;mouseX=mouseY=moveX=moveY=0;invalidate();});

// Keep a continuous wheel gesture with its starting surface. A panel moving
// underneath the pointer must not steal a page scroll already in progress.
const wheelGesture={mode:null,time:-Infinity,x:0,y:0};
window.addEventListener('wheel',e=>{
  if(e.ctrlKey || e.metaKey || !e.deltaY)return;
  if(e.timeStamp-wheelGesture.time>250 || Math.hypot(e.clientX-wheelGesture.x,e.clientY-wheelGesture.y)>6) {
    wheelGesture.mode=null;wheelGesture.x=e.clientX;wheelGesture.y=e.clientY;
  }
  wheelGesture.time=e.timeStamp;
  if(!stage.contains(e.target))wheelGesture.mode='page';
},{capture:true,passive:true});

// Test the actual scene objects, not the canvas or a broad rectangular band.
// Empty background on either side (and between objects) keeps native page scroll.
stage.addEventListener('wheel',e=>{
  if(!cards.length || !section.classList.contains('orbit-ready') || section.classList.contains('orbit-failed') || e.ctrlKey || e.metaKey || !e.deltaY)return;
  if(wheelGesture.mode==='page')return;
  if(wheelGesture.mode!=='orbit' && !pickSceneAt(e.clientX,e.clientY)) {
    wheelGesture.mode='page';return;
  }
  if(!e.cancelable)return;
  wheelGesture.mode='orbit';
  e.preventDefault();
  if(drag)return;
  const rect=stage.getBoundingClientRect();
  const unit=e.deltaMode===1 ? 16 : e.deltaMode===2 ? rect.height : 1;
  targetAngle-=THREE.MathUtils.clamp(e.deltaY*unit,-120,120)*.004;
  hover=null;
  stage.classList.remove('is-hovering');
  pendingPointer=lastPointer={x:e.clientX,y:e.clientY,pointerType:'mouse'};
  const nearest=nearestProject();
  if(nearest!==active)updateActive(nearest);
  invalidate();
},{passive:false});

stage.addEventListener('pointerdown',e=>{
  if(e.button!==0 || !cards.length)return;
  hover=null;pendingPointer=lastPointer=null;returnHead();stage.classList.remove('is-hovering');invalidate();
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,startAngle:targetAngle,moved:false,locked:false,velocity:0,lastTime:e.timeStamp,rect:stage.getBoundingClientRect()};
  if(e.pointerType==='mouse')stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove',e=>{
  // A drag reuses the rectangle measured on pointerdown: no layout read per move.
  const rect=drag && e.pointerId===drag.id ? drag.rect : stage.getBoundingClientRect();
  if(e.pointerType!=='touch'){pointerLabel.style.left=`${e.clientX-rect.left}px`;pointerLabel.style.top=`${e.clientY-rect.top}px`;}
  if(drag && e.pointerId===drag.id){
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.locked && Math.abs(dy)>8 && Math.abs(dy)>Math.abs(dx)*1.2){drag=null;return;}
    // Mouse is captured on pointerdown; touch and pen already have implicit capture.
    // Explicitly capturing touch mid-swipe made the browser fire lostpointercapture,
    // which ended the drag after its first frame and left the ring stuck.
    if(!drag.locked && Math.abs(dx)>6){drag.moved=true;drag.locked=true;stage.classList.add('is-dragging');}
    if(drag.locked){targetAngle=drag.startAngle+dx/Math.max(rect.width,500)*TAU*.8;angle=targetAngle;renderedAngle=targetAngle;hover=null;stage.classList.remove('is-hovering');invalidate();}
    drag.velocity=(e.clientX-drag.lastX)/Math.max(8,e.timeStamp-drag.lastTime);
    drag.lastTime=e.timeStamp;drag.lastX=e.clientX;return;
  }
  updateHeadPointer(e,rect);
  if(cards.length && e.pointerType!=='touch')pendingPointer=lastPointer={x:e.clientX,y:e.clientY,pointerType:e.pointerType};
  invalidate();
});
function finishDrag(e,cancelled=false) {
  if(!drag)return;
  const current=drag;drag=null;stage.classList.remove('is-dragging');
  if(stage.hasPointerCapture(current.id))stage.releasePointerCapture(current.id);
  if(cancelled)return;
  if(current.moved){
    updateActive(nearestProject(),true);
    const delta=e.timeStamp-current.lastTime<100 ? current.velocity*65 : 0;
    if(!reduced.matches)targetAngle+=THREE.MathUtils.clamp(delta/Math.max(stage.clientWidth,500)*TAU*.5,-.1,.1);
    const rect=stage.getBoundingClientRect();
    if(e.pointerType!=='touch' && e.clientX>=rect.left && e.clientX<=rect.right && e.clientY>=rect.top && e.clientY<=rect.bottom)
      pendingPointer=lastPointer={x:e.clientX,y:e.clientY,pointerType:e.pointerType};
    invalidate();
  }else{
    const picked=pickAt(e.clientX,e.clientY);if(picked!==null){updateActive(picked);openProject(picked);}
  }
}
stage.addEventListener('pointerup',e=>finishDrag(e));
stage.addEventListener('pointercancel',e=>finishDrag(e,true));
stage.addEventListener('lostpointercapture',e=>{
  // pointerup/pointercancel finish a drag; only an unexpected loss mid-drag resets it.
  if(!drag || e.pointerId!==drag.id)return;
  const current=drag;drag=null;stage.classList.remove('is-dragging');
  if(current.moved){updateActive(nearestProject(),true);invalidate();}
});
stage.addEventListener('pointerleave',()=>{pendingPointer=lastPointer=null;if(drag)return;hover=null;returnHead();stage.classList.remove('is-hovering');invalidate();});
stage.addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'){e.preventDefault();goTo(active+1);}
  if(e.key==='ArrowLeft'){e.preventDefault();goTo(active-1);}
  if(e.key==='Enter'||e.key===' '){e.preventDefault();openProject();}
  if(e.key==='Home'){e.preventDefault();goTo(0);}
  if(e.key==='End'){e.preventDefault();goTo(projects.length-1);}
});
document.getElementById('orbit-prev').addEventListener('click',()=>goTo(active-1));
document.getElementById('orbit-next').addEventListener('click',()=>goTo(active+1));
document.getElementById('orbit-open').addEventListener('click',()=>openProject());
init();
