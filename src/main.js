import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { createAircraftCollider, sweepAircraftSphere, sweepAircraftBox } from './collision.js';
import { FlightAudio } from './audio.js';
import { AIRCRAFT, createAircraft } from './aircraft.js';
import { mergeStaticMeshes } from './optimize.js';
import { initOfflineCache } from './offline-cache.js';
import { moveTarget, insideRing, ringPosition, DIFFICULTIES, obstaclePosition, GROUND_Y, clamp, advanceRingProgress } from './flight.js';

window.__skyBoot?.setPhase('正在准备飞机与天空…');
const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bce9eb');
scene.fog = new THREE.Fog('#bce9eb', 100, 310);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 650);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
} catch {
  $('loading').innerHTML = '<strong>天空还没准备好</strong><p>请在支持 WebGL 的新版 Chrome、Edge 或 Safari 中打开。</p>';
  throw new Error('This game requires WebGL.');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const environmentRoom = new RoomEnvironment();
const environmentGenerator = new THREE.PMREMGenerator(renderer);
const environmentMap = environmentGenerator.fromScene(environmentRoom, .04);
environmentRoom.dispose();
environmentGenerator.dispose();
$('scene').appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '三维飞机与云朵天空，方向键控制飞行，空格加速');
renderer.domElement.tabIndex = 0;
scene.add(new THREE.HemisphereLight(0xffffff, 0x77a69b, 1.1));
const sun = new THREE.DirectionalLight(0xfff4dd, 3);
sun.position.set(-30, 60, -25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 20, far: 110 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -.0002;
sun.shadow.normalBias = .025;
sun.shadow.radius = 3;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xffffff, 1);
rim.position.set(20, 10, 25);
scene.add(rim);

const materials = {};
function mat(color, roughness = .85) {
  const key = `${color}-${roughness}`;
  return materials[key] ||= new THREE.MeshStandardMaterial({ color, roughness });
}
function mesh(geo, color, parent, x=0, y=0, z=0) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x,y,z);
  parent.add(m);
  return m;
}
const sphere = new THREE.SphereGeometry(1, 14, 10);
const scenery = new THREE.Group();
scene.add(scenery);
const ocean = mesh(new THREE.PlaneGeometry(1500, 1500), '#79d4d1', scenery, 0, GROUND_Y-1.6, 0);
ocean.rotation.x = -Math.PI/2;
function cloud(x, y, z, scale=1) {
  const group = new THREE.Group();
  [[0,0,0,3.3],[3,.3,0,2.5],[-3,-.4,.3,2.5],[-.8,1.3,0,2.8],[1.8,1,.3,2.2]].forEach(([a,b,c,s])=> {
    const puff=mesh(sphere, '#ffffff', group,a,b,c);
    puff.scale.set(s,s*.65,s*.75);
  });
  group.position.set(x,y,z); group.scale.setScalar(scale); scenery.add(group); return group;
}
const clouds = [];
for (let i=0; i<32; i++) {
  const rawX = Math.sin(i*8.31)*100;
  const x = Math.abs(rawX)<26 ? (rawX<0?-26:26) : rawX;
  const y = 12 + Math.sin(i*4.3)*22;
  const z = 40-i*10;
  clouds.push(cloud(x,y,z,1+((i*7)%9)/5));
}
function island(x,z,s) {
  const group=new THREE.Group();
  const land=mesh(sphere,'#e8dba8',group); land.scale.set(12,2.5,9);
  const grass=mesh(sphere,'#87c8a0',group,0,1,0); grass.scale.set(10.8,2.5,8);
  for(let i=0;i<7;i++) {
    const a=i*2.4;
    const tx=Math.sin(a)*7, tz=Math.cos(a)*5;
    mesh(new THREE.CylinderGeometry(.25,.35,2.3,6),'#b79b78',group,tx,3,tz);
    const tree=mesh(new THREE.ConeGeometry(1.5,3.7,7),'#4ea890',group,tx,5,tz);
    tree.rotation.y=a;
  }
  group.position.set(x,-14,z); group.scale.setScalar(s); scenery.add(group); return group;
}
const islands=[];
for(let i=0;i<10;i++) islands.push(island((i%2?1:-1)*(48+i*5),-25-i*30,1+(i%3)*.5));
// A little lighthouse to make the sky feel like a real little world.
const lighthouse = new THREE.Group();
mesh(new THREE.CylinderGeometry(1,1.5,8,16),'#fff9e6',lighthouse,0,0,0);
mesh(new THREE.CylinderGeometry(1.06,1.15,1.5,16),'#f29777',lighthouse,0,1,0);
mesh(new THREE.CylinderGeometry(1.2,1.2,1.5,12),'#497e89',lighthouse,0,4.5,0);
mesh(new THREE.ConeGeometry(1.8,1.7,12),'#f29777',lighthouse,0,6,0);
lighthouse.position.set(-37,-7,-40); scenery.add(lighthouse);

const pedestal = new THREE.Group();
scene.add(pedestal);
const pad=mesh(new THREE.CylinderGeometry(8.8,8.8,.4,80),'#d3f0eb',pedestal,0,-3.7,0);
pad.receiveShadow=true;
const padRim=mesh(new THREE.TorusGeometry(8.5,.055,8,100),'#ffffff',pedestal,0,-3.46,0);
padRim.rotation.x=Math.PI/2;
const runway=new THREE.Group();
for(let i=-3;i<=3;i++)mesh(new THREE.BoxGeometry(.08,.015,.65),'#ffffff',runway,0,-3.45,i*1.8);
pedestal.add(runway);

let selected=AIRCRAFT[0].id;
function makePlane(gearDown){
  const model=mergeStaticMeshes(createAircraft(selected,{gearDown}));
  // Reflections belong to the aircraft; sampling them on the whole ocean and
  // every cloud is expensive on integrated and software graphics.
  model.traverse(part=>{if(part.isMesh){part.material.envMap=environmentMap.texture;part.material.envMapIntensity=.55;}});
  return model;
}
let plane=makePlane(true); scene.add(plane);
let aircraftCollider=null, hangarNeedsRender=true;
let hangarY=-3.5-new THREE.Box3().setFromObject(plane).min.y;
renderer.shadowMap.needsUpdate=true;
let flying=false, phase='hangar', score=0, elapsed=0, ringIndex=0, menuRotation=-.2;
let difficulty=DIFFICULTIES[0], ringMisses=0, obstacleIndex=0, fallTime=0, fallStartY=0, crashReason='';
let inspectionZoom=1, menuPitch=0;
let sound=true, volume=.35;
try{
  sound=localStorage.getItem('little-sky-sound')!=='false';
  const saved=localStorage.getItem('little-sky-volume');
  if(saved!==null&&Number.isFinite(Number(saved)))volume=clamp(Number(saved),0,1);
}catch{}
const flightAudio=new FlightAudio({enabled:sound,volume});
const keys=new Set(), held=new Set();
let boost=false;
const rings=[];
const ringColors=['#ffcf72','#f5a4a8','#98d6c7','#aebaf3','#ffc78a'];
function makeRing(index) {
  const g=new THREE.Group();
  mesh(new THREE.TorusGeometry(5.4,.27,10,64),ringColors[index%ringColors.length],g);
  const inner=mesh(new THREE.TorusGeometry(5.75,.045,6,64),'#ffffff',g);
  const star=new THREE.Group();
  const shape=new THREE.Shape();
  for(let i=0;i<10;i++) {
    const a=i*Math.PI/5+Math.PI/2, r=i%2?.65:1.35;
    if(i===0)shape.moveTo(Math.cos(a)*r,Math.sin(a)*r);else shape.lineTo(Math.cos(a)*r,Math.sin(a)*r);
  }
  shape.closePath();
  const starMesh=mesh(new THREE.ExtrudeGeometry(shape,{depth:.25,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.1,bevelThickness:.1}),'#ffd170',star);
  g.add(star); g.userData.star=star;
  const pos=ringPosition(index);
  g.position.set(pos.x,pos.y,-60-index*65); g.userData.index=index;
  g.visible=false; scene.add(g); rings.push(g);
}
for(let i=0;i<5;i++)makeRing(i);
const obstacles=[];
function clearObstacles() {
  for(const obstacle of obstacles){
    scene.remove(obstacle);
    obstacle.traverse(child=>{if(child.isMesh)child.geometry.dispose();});
  }
  obstacles.length=0;
}
function placeObstacle(obstacle,index,z) {
  const pos=obstaclePosition(index,difficulty.id);
  obstacle.position.set(pos.x,pos.y,z);
  obstacle.userData.index=index;
  obstacle.userData.baseX=pos.x;
  obstacle.userData.baseY=pos.y;
}
function buildObstacles() {
  clearObstacles();
  for(let i=0;i<difficulty.obstacleCount;i++){
    const g=new THREE.Group(), radius=difficulty.obstacleRadius;
    const balloon=mesh(new THREE.SphereGeometry(radius,24,16),'#e99864',g);
    const stripe=mesh(new THREE.TorusGeometry(radius,.1,8,48),'#fff3cc',g);
    stripe.rotation.x=Math.PI/2;
    mesh(new THREE.BoxGeometry(.95,.6,.95),'#b9865a',g,0,-radius-.8,0);
    for(const x of [-.34,.34])for(const z of [-.34,.34]){
      mesh(new THREE.CylinderGeometry(.025,.025,1,5),'#8c7965',g,x,-radius-.2,z);
    }
    const warning=mesh(new THREE.OctahedronGeometry(.32),'#fff3cc',g,0,radius+.65,0);
    g.userData.radius=radius;
    placeObstacle(g,i,difficulty.firstObstacleZ-i*difficulty.obstacleSpacing);
    obstacles.push(g);scene.add(g);
  }
  obstacleIndex=difficulty.obstacleCount;
}
function renderDifficulty(){
  $('difficulty-list').innerHTML=DIFFICULTIES.map(item=>`<button type="button" class="difficulty-option ${item.id===difficulty.id?'selected':''}" data-difficulty="${item.id}" aria-pressed="${item.id===difficulty.id}"><strong>${item.name}</strong><small>${item.description}</small></button>`).join('');
  $('difficulty-list').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
    difficulty=DIFFICULTIES.find(item=>item.id===button.dataset.difficulty);renderDifficulty();
  }));
  $('difficulty-description').textContent=difficulty.id==='easy'?'慢速、稀疏障碍，圆环更容易收集。':difficulty.id==='normal'?'速度接近简单的两倍，连续避障、精准穿圈。':'高速密集障碍会上下左右移动，连续漏过 3 圈航线结束。';
  $('flight-difficulty').textContent=difficulty.name;
}
function updateRouteStatus(){
  $('route-status').textContent=difficulty.maxMisses?`连续漏圈 ${ringMisses} / ${difficulty.maxMisses} · 穿圈可清零`:difficulty.id==='easy'?'自由练习 · 漏圈不结束':'连续避障 · 漏圈不结束';
}
function crash(reason){
  if(phase!=='flying')return;
  flightAudio.setActive(false);
  phase='falling';fallTime=0;fallStartY=plane.position.y;crashReason=reason;
  clearControls();message(reason==='ground'?'碰到地面了！':'碰到热气球了！');
  $('flight-controls').querySelectorAll('button').forEach(button=>button.disabled=true);
  $('boost-button').disabled=true;
}
function finishCrash(){
  phase='crashed';plane.visible=crashReason==='route';flightAudio.setActive(false);clearControls();
  $('flight-controls').querySelectorAll('button').forEach(button=>button.disabled=true);
  $('boost-button').disabled=true;
  $('crash-title').textContent=crashReason==='route'?'偏离航线啦，再试一次！':'这次碰到了，再试一次！';
  $('crash-reason').textContent=crashReason==='route'?'连续错过了 3 个圆环，本次航线结束。下次一边避障，一边跟着圆环飞；穿过圆环就能清零漏圈次数。':crashReason==='ground'?'飞得太低，飞机碰到地面了。下次记得抬高一点。':'飞机碰到了热气球。下次提前向两侧或上下避开吧。';
  $('crash-score').textContent=String(score);
  $('crash-panel').hidden=false;
  $('retry-button').focus({preventScroll:true});
}

const sparks=[];
function celebrate(position) {
  for(let i=0;i<22;i++){
    const p=mesh(new THREE.OctahedronGeometry(.2),ringColors[i%5],scene,...position.toArray());
    p.userData.velocity=new THREE.Vector3((Math.random()-.5)*12,Math.random()*8,(Math.random()-.5)*10);
    p.userData.life=1.2; sparks.push(p);
  }
}
function chime(){flightAudio.playChime();}
let messageTimer;
function message(text) {
  $('celebration').textContent=text;
  $('celebration').classList.add('show');
  clearTimeout(messageTimer);
  messageTimer=setTimeout(()=>$('celebration').classList.remove('show'),2600);
}
const planeIcon=(color)=>`<svg viewBox="0 0 80 52" fill="none" aria-hidden="true"><path d="M39 5c-2 0-3 3-3 6v11L12 34v5l24-6v9l-7 5v3l11-3 11 3v-3l-7-5v-9l24 6v-5L44 22V11c0-3-2-6-5-6Z" fill="${color}"/><path d="M39 8v35" stroke="white" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/></svg>`;
function renderCards() {
  $('aircraft-list').innerHTML=AIRCRAFT.map((item,i)=>`<button class="aircraft-card ${selected===item.id?'selected':''}" data-id="${item.id}" aria-pressed="${selected===item.id}"><span class="aircraft-icon" style="--plane-color:${item.color}">${planeIcon(item.color)}</span><span class="aircraft-info"><h3>${item.name}</h3><p>${item.subtitle}</p></span><span class="aircraft-badge" aria-hidden="true">${selected===item.id?'✓':`0${i+1}`}</span></button>`).join('');
  $('aircraft-list').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>selectAircraft(button.dataset.id)));
}
function disposePlane(group) {
  const geometries=new Set(), materials=new Set();
  group.traverse(obj=>{if(obj.isMesh){geometries.add(obj.geometry);(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>materials.add(m));}});
  geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
}
function rebuildPlane(gearDown) {
  scene.remove(plane);disposePlane(plane);
  plane=makePlane(gearDown);
  scene.add(plane);aircraftCollider=gearDown?null:createAircraftCollider(plane);
  if(gearDown)hangarY=-3.5-new THREE.Box3().setFromObject(plane).min.y;
  sun.castShadow=gearDown;
  renderer.shadowMap.needsUpdate=true;
  hangarNeedsRender=true;
}
function selectAircraft(id) {
  if(selected!==id){selected=id;rebuildPlane(true);}
  const item=AIRCRAFT.find(a=>a.id===id);
  $('selected-name').textContent=item.name;
  $('selected-description').textContent=item.fact;
  $('flight-name').textContent=item.name;
  $('aircraft-details').textContent=item.length&&item.wingspan?`机长 ${item.length} 米 · 翼展 ${item.wingspan} 米 · ${item.engines} 台发动机`:'';
  renderCards();
}
function clearControls(){keys.clear();held.clear();boost=false;document.querySelectorAll('.is-pressed').forEach(el=>el.classList.remove('is-pressed'));}
function startFlight() {
  if(phase==='flying')return;
  flying=true;phase='flying';score=0;ringMisses=0;elapsed=0;ringIndex=5;fallTime=0;crashReason='';updateRouteStatus();
  if(plane.userData.gearDown)rebuildPlane(false);
  clearControls();plane.visible=true;plane.position.set(0,3,3);plane.rotation.set(0,0,0);
  rings.forEach((r,i)=>{const pos=ringPosition(i);r.position.set(pos.x,pos.y,-60-i*65);r.scale.setScalar(difficulty.id==='hard'?.78:1);r.visible=true;});
  buildObstacles();
  for(const particle of sparks){scene.remove(particle);particle.geometry.dispose();}sparks.length=0;
  $('crash-panel').hidden=true;
  $('flight-controls').querySelectorAll('button').forEach(button=>button.disabled=false);
  $('boost-button').disabled=false;
  pedestal.visible=false;
  document.body.classList.add('is-flying');$('hangar-ui').hidden=true;$('flight-ui').hidden=false;
  $('stars-count').textContent='0';$('flight-difficulty').textContent=difficulty.name;
  message('自己掌舵，注意躲开热气球！');
  flightAudio.setActive(true);flightAudio.setFlight(difficulty.speed,false);
  void flightAudio.unlock().then(()=>chime());
  renderer.domElement.focus({preventScroll:true});
}
function goHome() {
  flightAudio.setActive(false);
  flying=false;phase='hangar';clearControls();rings.forEach(r=>r.visible=false);clearObstacles();pedestal.visible=true;
  rebuildPlane(true);
  plane.visible=true;plane.position.set(0,hangarY,0);plane.rotation.set(0,0,0);
  $('crash-panel').hidden=true;
  document.body.classList.remove('is-flying');$('hangar-ui').hidden=false;$('flight-ui').hidden=true;
  $('start-button').focus({preventScroll:true});
}
$('start-button').addEventListener('click',startFlight);
$('home-button').addEventListener('click',goHome);
$('retry-button').addEventListener('click',startFlight);
$('crash-home-button').addEventListener('click',goHome);
function updateSound(){
  $('sound-toggle').setAttribute('aria-pressed',String(sound));
  $('sound-toggle').setAttribute('aria-label',sound?'关闭声音':'开启声音');
  $('sound-toggle').classList.toggle('sound-on',sound);
  $('sound-toggle').title=sound?'声音已开启':'声音已关闭';
  const label=$('sound-toggle').querySelector('.sound-label');if(label)label.textContent=sound?'声音开':'声音关';
}
$('sound-toggle').addEventListener('click',()=>{
  sound=!sound;flightAudio.setEnabled(sound);
  try{localStorage.setItem('little-sky-sound',String(sound));}catch{}
  updateSound();if(sound)void flightAudio.unlock().then(()=>chime());
});
$('volume-control').value=String(Math.round(volume*100));
$('volume-value').textContent=`${Math.round(volume*100)}%`;
$('volume-control').addEventListener('input',e=>{
  volume=Number(e.target.value)/100;flightAudio.setVolume(volume);
  $('volume-value').textContent=`${e.target.value}%`;
  e.target.setAttribute('aria-valuetext',`${e.target.value}%`);
  try{localStorage.setItem('little-sky-volume',String(volume));}catch{}
});
$('help-toggle').addEventListener('click',()=>{clearControls();flightAudio.setActive(false);$('help-dialog').showModal();});
$('close-help').addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',(e)=>{if(e.target===$('help-dialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close();}});
const keyMap={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down'};
addEventListener('keydown',e=>{
  if(phase!=='flying'||$('help-dialog').open)return;
  if(keyMap[e.key]){e.preventDefault();keys.add(keyMap[e.key]);}
  if(e.code==='Space' && (e.target===document.body||e.target===renderer.domElement)){e.preventDefault();boost=true;}
});
addEventListener('keyup',e=>{if(keyMap[e.key])keys.delete(keyMap[e.key]);if(e.code==='Space')boost=false;});
addEventListener('blur',clearControls);
document.addEventListener('visibilitychange',()=>{clearControls();flightAudio.setActive(!document.hidden&&phase==='flying'&&!$('help-dialog').open);});
for(const button of document.querySelectorAll('[data-direction]')){
  const release=e=>{held.delete(button.dataset.direction);button.classList.remove('is-pressed');};
  button.addEventListener('pointerdown',e=>{if(phase!=='flying')return;e.preventDefault();button.setPointerCapture(e.pointerId);held.add(button.dataset.direction);button.classList.add('is-pressed');});
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
  button.addEventListener('keydown',e=>{if(phase==='flying'&&(e.key===' '||e.key==='Enter')){e.preventDefault();held.add(button.dataset.direction);}});
  button.addEventListener('keyup',release);button.addEventListener('blur',release);
}
const boostButton=$('boost-button');
boostButton.addEventListener('pointerdown',e=>{if(phase!=='flying')return;e.preventDefault();boostButton.setPointerCapture(e.pointerId);boost=true;boostButton.classList.add('is-pressed');});
for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])boostButton.addEventListener(name,()=>{boost=false;boostButton.classList.remove('is-pressed');});
boostButton.addEventListener('keydown',e=>{if(phase==='flying'&&(e.key===' '||e.key==='Enter')){e.preventDefault();boost=true;}});
boostButton.addEventListener('keyup',()=>boost=false);
const inspectionPointers=new Map();
let inspectionGesture=null;
function setZoom(value){
  inspectionZoom=clamp(value,.65,2.6);
  hangarNeedsRender=true;
  $('zoom-in').disabled=inspectionZoom>=2.6;
  $('zoom-out').disabled=inspectionZoom<=.65;
}
function resetGesture(){
  const points=[...inspectionPointers.values()];
  inspectionGesture=points.length>=2?{distance:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),zoom:inspectionZoom}:
    points.length?{x:points[0].x,y:points[0].y,rotation:menuRotation,pitch:menuPitch}:null;
}
$('zoom-in').addEventListener('click',()=>setZoom(inspectionZoom*1.25));
$('zoom-out').addEventListener('click',()=>setZoom(inspectionZoom/1.25));
function selectView(view){
  const presets={front:[-.9,-.17],side:[Math.PI/2-.9,-.17],top:[-.9,1.1],reset:[-.2,0]};
  [menuRotation,menuPitch]=presets[view];
  hangarNeedsRender=true;
  document.querySelectorAll('.view-preset').forEach(button=>button.setAttribute('aria-pressed',String(button.id===`view-${view}`)));
}
for(const view of ['front','side','top'])$(`view-${view}`).addEventListener('click',()=>selectView(view));
$('zoom-reset').addEventListener('click',()=>{setZoom(1);selectView('reset');});
renderer.domElement.addEventListener('wheel',e=>{if(flying)return;e.preventDefault();setZoom(inspectionZoom*Math.exp(-e.deltaY*.001));},{passive:false});
renderer.domElement.addEventListener('pointerdown',e=>{
  if(flying)return;
  inspectionPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  renderer.domElement.setPointerCapture(e.pointerId);resetGesture();
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(flying||!inspectionPointers.has(e.pointerId))return;
  inspectionPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const points=[...inspectionPointers.values()];
  if(points.length>=2&&inspectionGesture?.distance){
    const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
    setZoom(inspectionGesture.zoom*distance/inspectionGesture.distance);
  }else if(inspectionGesture){
    menuRotation=inspectionGesture.rotation+(e.clientX-inspectionGesture.x)*.009;
    menuPitch=clamp(inspectionGesture.pitch+(e.clientY-inspectionGesture.y)*.005,-.22,1.1);
    hangarNeedsRender=true;
    document.querySelectorAll('.view-preset').forEach(button=>button.setAttribute('aria-pressed','false'));
  }
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,e=>{
  inspectionPointers.delete(e.pointerId);resetGesture();
});
addEventListener('blur',()=>{inspectionPointers.clear();resetGesture();});

function resize(){
  hangarNeedsRender=true;
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));
}
addEventListener('resize',resize);
const clock=new THREE.Clock();
const cameraTarget=new THREE.Vector3();
function frame(){
  requestAnimationFrame(frame);
  const dt=Math.min(clock.getDelta(),.1);
  const paused=$('help-dialog').open||document.hidden;
  flightAudio.setActive(phase==='flying'&&!paused);
  flightAudio.setFlight(difficulty.speed*(boost?1.6:1),boost);
  // Keep the clock and controls live, but don't redraw a completely still
  // inspection scene between gestures.
  if(!flying&&!hangarNeedsRender&&!sparks.length)return;
  if(flying){
    if(!paused&&phase==='flying'){
      elapsed+=dt;
      const previousPlane=plane.position.clone();
      const previousQuaternion=plane.quaternion.clone();
      const input={x:Number(keys.has('right')||held.has('right'))-Number(keys.has('left')||held.has('left')),y:Number(keys.has('up')||held.has('up'))-Number(keys.has('down')||held.has('down'))};
      moveTarget(plane.position,input,dt);
      plane.rotation.z=THREE.MathUtils.damp(plane.rotation.z,-input.x*.32,4,dt);
      plane.rotation.x=THREE.MathUtils.damp(plane.rotation.x,input.y*.15,4,dt);
      plane.rotation.y=THREE.MathUtils.damp(plane.rotation.y,-input.x*.1,4,dt);
      const speed=difficulty.speed*(boost?1.6:1);
      for(const r of rings){
        const previousZ=r.position.z;
        r.position.z+=speed*dt;r.userData.star.rotation.y+=dt;
        if(previousZ<3&&r.position.z>=3){
          const collected=insideRing(plane.position,r.position,difficulty.ringTolerance);
          const progress=advanceRingProgress({score,misses:ringMisses},collected,difficulty);
          score=progress.score;ringMisses=progress.misses;updateRouteStatus();
          if(collected){
            $('stars-count').textContent=String(score);celebrate(r.position);chime();
            const words=score%5===0?`已经收集 ${score} 颗星星啦！你真棒！`:['漂亮！一颗小星星！','飞得真稳，小机长！','云朵也在为你鼓掌！','下一站，新的小惊喜！'][score%4];
            message(words);
          }else message(difficulty.maxMisses?`漏过 ${ringMisses} 个圆环，跟上航线！`:'没关系，下一朵惊喜就在前面！');
          r.visible=false;
          if(progress.routeFailed){crashReason='route';finishCrash();break;}
        }
        if(r.position.z>25){const pos=ringPosition(ringIndex++);r.position.set(pos.x,pos.y,Math.min(...rings.map(other=>other.position.z))-65);r.visible=true;}
      }
      if(phase==='flying'&&plane.position.y<-7&&aircraftCollider.lowestPointY()<=ocean.position.y){
        plane.position.y+=ocean.position.y-aircraftCollider.lowestPointY();crash('ground');
      }
      for(const obstacle of obstacles){
        if(phase!=='flying')break;
        const before=obstacle.position.clone();
        obstacle.position.z+=speed*dt;
        if(difficulty.moving){
          obstacle.position.x=obstacle.userData.baseX+Math.sin(elapsed*.95+obstacle.userData.index)*difficulty.motionAmplitude;
          obstacle.position.y=obstacle.userData.baseY+Math.sin(elapsed*.7+obstacle.userData.index*1.1)*1.6;
        }
        const radius=obstacle.userData.radius;
        const previousBasket={x:before.x,y:before.y-radius-.8,z:before.z};
        const basket={x:obstacle.position.x,y:obstacle.position.y-radius-.8,z:obstacle.position.z};
        const bodyHit=sweepAircraftSphere(aircraftCollider,plane,previousPlane,previousQuaternion,before,obstacle.position,radius-.04);
        const basketHit=sweepAircraftBox(aircraftCollider,plane,previousPlane,previousQuaternion,new THREE.Vector3(previousBasket.x,previousBasket.y,previousBasket.z),new THREE.Vector3(basket.x,basket.y,basket.z),new THREE.Vector3(.455,.28,.455));
        const hit=bodyHit&&basketHit?(bodyHit.t<basketHit.t?bodyHit:basketHit):(bodyHit||basketHit);
        if(hit){
          const endPosition=plane.position.clone(),endQuaternion=plane.quaternion.clone();
          plane.position.lerpVectors(previousPlane,endPosition,hit.t);
          plane.quaternion.slerpQuaternions(previousQuaternion,endQuaternion,hit.t);
          obstacle.position.lerpVectors(before,obstacle.position.clone(),hit.t);
          plane.updateMatrixWorld(true);crash('balloon');break;
        }
        if(obstacle.position.z>28){
          const nextZ=Math.min(...obstacles.map(other=>other.position.z))-difficulty.obstacleSpacing;
          placeObstacle(obstacle,obstacleIndex++,nextZ);
        }
      }
      for(const c of clouds){c.position.z+=speed*dt*.65;if(c.position.z>65)c.position.z=-270;}
      for(const land of islands){land.position.z+=speed*dt*.65;if(land.position.z>70)land.position.z=-260;}
      lighthouse.position.z+=speed*dt*.65;if(lighthouse.position.z>70)lighthouse.position.z=-260;
    }
    if(!paused&&phase==='falling'){
      fallTime+=dt;
      const duration=crashReason==='ground'?1.2:2;
      const t=clamp((fallTime-.22)/duration,0,1);
      if(fallTime>=.22){
        plane.position.y=THREE.MathUtils.lerp(fallStartY,GROUND_Y-2,t*t);
        plane.rotation.z+=dt*1.8;
        plane.rotation.x=THREE.MathUtils.lerp(0,-.65,t);
      }
      if(t>=1)finishCrash();
    }
    const mobile=innerWidth<700;
    camera.position.set(plane.position.x*.9,Math.max(plane.position.y,GROUND_Y+1)+6,mobile?39:29);
    cameraTarget.set(plane.position.x*.95,plane.position.y+2,-32);
    camera.lookAt(cameraTarget);
  }else{
    plane.position.set(0,hangarY,0);
    plane.rotation.set(0,0,0);
    const mobile=innerWidth<700;
    const distance=mobile?42:35,azimuth=.9+menuRotation,elevation=.38+menuPitch;
    cameraTarget.set(0,hangarY+(mobile?-.7:.6),0);
    camera.position.set(Math.sin(azimuth)*Math.cos(elevation)*distance,cameraTarget.y+Math.sin(elevation)*distance,-Math.cos(azimuth)*Math.cos(elevation)*distance);
    camera.lookAt(cameraTarget);
    // Leave room for the aircraft selection column without distorting the model.
    camera.setViewOffset(innerWidth,innerHeight,mobile?0:innerWidth*.055,mobile?innerHeight*.10:0,innerWidth,innerHeight);
  }
  if(flying)camera.clearViewOffset();
  const zoom=flying?1:inspectionZoom;
  if(camera.zoom!==zoom){camera.zoom=zoom;camera.updateProjectionMatrix();}
  for(let i=sparks.length-1;i>=0;i--){
    const p=sparks[i];p.userData.life-=dt;p.position.addScaledVector(p.userData.velocity,dt);p.scale.setScalar(Math.max(0,p.userData.life));
    if(p.userData.life<=0){scene.remove(p);p.geometry.dispose();sparks.splice(i,1);}
  }
  renderer.render(scene,camera);
  hangarNeedsRender=false;
}
export function getGameState(){
  return {phase,score,misses:ringMisses,failureReason:crashReason,elapsed,audio:flightAudio.getStatus(),difficulty:difficulty.id,gearDown:plane.userData.gearDown,wheelCount:plane.userData.wheelCount,position:plane.position.toArray(),zoom:inspectionZoom,rotation:[menuPitch,menuRotation],obstacles:obstacles.map(o=>({position:o.position.toArray(),radius:o.userData.radius})),speed:difficulty.speed*(boost?1.6:1)};
}
renderer.domElement.getGameState=getGameState;
selectAircraft(selected);updateSound();renderDifficulty();setZoom(1);
frame();
if(window.__skyBoot)window.__skyBoot.finish();else $('loading').hidden=true;
initOfflineCache();
