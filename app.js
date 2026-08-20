
const VERSION='0804.1718';
const TILE_URL='https://wmts.nlsc.gov.tw/wmts/EMAP6_OPENDATA/default/GoogleMapsCompatible/{z}/{y}/{x}';
const LEGACY_TILE_CACHE='geolive-tiles-z15-v1';
const REGION_CACHE_PREFIX='geolive-region-';
const DB_NAME='GeoLiveFullPWA1348', DB_VERSION=3;
const $=s=>document.querySelector(s);
const state={recording:false,paused:false,watchId:null,points:[],photos:[],liveLine:null,livePhotoMarkers:[],projects:new Map(),offlineLayers:new Map()};
let map, onlineLayer;

function toast(msg,ms=2600){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._to);t._to=setTimeout(()=>t.classList.add('hidden'),ms)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function safeName(s){return String(s||'project').replace(/[\\/:*?"<>|]+/g,'_').trim().slice(0,100)||'project'}
function openDB(){return new Promise((ok,no)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('projects'))d.createObjectStore('projects',{keyPath:'name'});if(!d.objectStoreNames.contains('offline'))d.createObjectStore('offline',{keyPath:'id'});};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function dbOp(store,mode,action){const d=await openDB();return new Promise((ok,no)=>{const tx=d.transaction(store,mode),os=tx.objectStore(store),r=action(os);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
const dbAll=s=>dbOp(s,'readonly',o=>o.getAll()), dbGet=(s,k)=>dbOp(s,'readonly',o=>o.get(k)), dbPut=(s,v)=>dbOp(s,'readwrite',o=>o.put(v)), dbDel=(s,k)=>dbOp(s,'readwrite',o=>o.delete(k));

let TOWN_BOUNDARIES=null;
function normalizeAdminName(v){
  return String(v||'')
    .trim()
    .replace(/\s+/g,'')
    .replace(/台/g,'臺');
}
async function loadTownBoundaries(){
  if(TOWN_BOUNDARIES)return TOWN_BOUNDARIES;
  const r=await fetch('./town_boundaries.geojson',{cache:'no-store'});
  if(!r.ok)throw new Error('無法讀取全臺鄉鎮市區界線資料');
  const data=await r.json();
  if(!Array.isArray(data.features)||data.features.length<300){
    throw new Error('鄉鎮市區界線資料不完整');
  }
  TOWN_BOUNDARIES=data;
  return TOWN_BOUNDARIES;
}
async function resolveLocalTownBoundary(city,district){
  const data=await loadTownBoundaries();
  const cityKey=normalizeAdminName(city);
  const townKey=normalizeAdminName(district);

  const feature=(data.features||[]).find(f=>{
    const p=f.properties||{};
    return normalizeAdminName(p.COUNTYNAME)===cityKey &&
           normalizeAdminName(p.TOWNNAME)===townKey;
  });

  if(!feature){
    throw new Error(`本機界線資料找不到「${city}${district}」，請確認縣市與鄉鎮市區選擇。`);
  }

  const b=feature.bbox;
  if(!Array.isArray(b)||b.length!==4){
    throw new Error(`${city}${district} 的界線範圍資料不完整`);
  }

  return {
    bounds:[Number(b[0]),Number(b[1]),Number(b[2]),Number(b[3])],
    geometry:feature.geometry,
    matchedName:`${feature.properties.COUNTYNAME}${feature.properties.TOWNNAME}`,
    townCode:feature.properties.TOWNCODE
  };
}
async function adminOptionsFromBoundary(){
  const data=await loadTownBoundaries();
  const grouped=new Map();
  for(const f of data.features||[]){
    const p=f.properties||{};
    if(!p.COUNTYNAME||!p.TOWNNAME)continue;
    if(!grouped.has(p.COUNTYNAME))grouped.set(p.COUNTYNAME,[]);
    grouped.get(p.COUNTYNAME).push(p.TOWNNAME);
  }
  return grouped;
}


function initMap(){
 map=L.map('map',{zoomControl:true,maxZoom:22}).setView([23.7,121],7);
 onlineLayer=L.tileLayer(TILE_URL,{maxNativeZoom:15,maxZoom:22,attribution:'內政部國土測繪中心 NLSC'}).addTo(map);
 map.on('zoomend moveend',refreshPhotoIcons);
}
function setCoords(lat,lon){$('#coords').textContent=`${lat.toFixed(6)}, ${lon.toFixed(6)}`}
function zoomPhotoSize(){const z=map.getZoom();if(z>=17)return[88,66];if(z>=15)return[68,51];if(z>=13)return[50,38];if(z>=11)return[34,26];return[24,18]}
function photoIcon(url){const[w,h]=zoomPhotoSize();return L.divIcon({className:'photo-icon',html:`<img src="${url}" width="${w}" height="${h}">`,iconSize:[w,h],iconAnchor:[w/2,h/2]})}
function showLarge(url){$('#modalTitle').textContent='照片';$('#modalBody').innerHTML=`<img class="photo-large" src="${url}">`;$('#modal').classList.remove('hidden')}
function markerForPhoto(ph){if(ph.lat==null||ph.lon==null||!ph.data)return null;const m=L.marker([ph.lat,ph.lon],{icon:photoIcon(ph.data),keyboard:false});m._photoUrl=ph.data;m.on('dblclick',()=>showLarge(ph.data));return m}
function refreshPhotoIcons(){for(const p of state.projects.values())for(const m of p.photoMarkers)m.setIcon(photoIcon(m._photoUrl));for(const m of state.livePhotoMarkers)m.setIcon(photoIcon(m._photoUrl));declutter()}
function declutter(){const all=[];for(const p of state.projects.values())if(p.open)all.push(...p.photoMarkers);all.push(...state.livePhotoMarkers);const occ=[];const[w,h]=zoomPhotoSize();for(const m of all){if(!map.hasLayer(m))continue;const pt=map.latLngToContainerPoint(m.getLatLng());const hit=occ.some(q=>Math.abs(q.x-pt.x)<w*.75&&Math.abs(q.y-pt.y)<h*.75);m.setOpacity(hit&&map.getZoom()<15?0:1);if(!hit)occ.push(pt)}}
function haversineMeters(a,b){
  const R=6371000;
  const rad=v=>v*Math.PI/180;
  const dLat=rad(b[0]-a[0]),dLon=rad(b[1]-a[1]);
  const la1=rad(a[0]),la2=rad(b[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function drawProfile(points){
  const c=$('#profileCanvas'),ctx=c.getContext('2d');
  const W=c.width,H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.font='11px -apple-system, sans-serif';
  ctx.fillStyle='#333';

  const valid=(points||[]).filter(p=>Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))&&Number.isFinite(Number(p[2])));
  if(valid.length<2){
    ctx.fillText('尚無足夠的 GPS 高度資料',10,18);
    return;
  }

  const d=[0];
  for(let i=1;i<valid.length;i++)d.push(d[i-1]+haversineMeters(valid[i-1],valid[i]));
  const elev=valid.map(p=>Number(p[2]));
  const total=d[d.length-1];
  const mn=Math.min(...elev),mx=Math.max(...elev),range=Math.max(1,mx-mn);

  const L=42,R=8,T=10,B=24,pw=W-L-R,ph=H-T-B;
  ctx.strokeStyle='#aaa';
  ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,H-B);ctx.lineTo(W-R,H-B);ctx.stroke();

  ctx.fillStyle='#555';
  ctx.fillText(`${mx.toFixed(0)}m`,2,T+5);
  ctx.fillText(`${mn.toFixed(0)}m`,2,H-B+3);

  const distLabel=total>=1000?`${(total/1000).toFixed(2)} km`:`${Math.round(total)} m`;
  ctx.fillText('0',L-2,H-6);
  const tw=ctx.measureText(distLabel).width;
  ctx.fillText(distLabel,W-R-tw,H-6);

  ctx.strokeStyle='#111';
  ctx.lineWidth=2;
  ctx.beginPath();
  elev.forEach((v,i)=>{
    const px=L+(total>0?d[i]/total:0)*pw;
    const py=T+ph-(v-mn)/range*ph;
    if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
  });
  ctx.stroke();

  ctx.fillStyle='#333';
  const label='距離';
  const lw=ctx.measureText(label).width;
  ctx.fillText(label,L+(pw-lw)/2,H-6);
}
function clearLive(){if(state.liveLine)map.removeLayer(state.liveLine);state.livePhotoMarkers.forEach(m=>map.removeLayer(m));state.liveLine=null;state.livePhotoMarkers=[];state.points=[];state.photos=[];drawProfile([])}
function updateLiveLine(){if(!state.liveLine)state.liveLine=L.polyline([],{color:'red',weight:4}).addTo(map);state.liveLine.setLatLngs(state.points.map(p=>[p[0],p[1]]));drawProfile(state.points)}
function startWatch(){if(state.watchId!=null)return;if(!navigator.geolocation){toast('Safari 不支援 GPS');return}state.watchId=navigator.geolocation.watchPosition(pos=>{const{latitude,longitude,altitude}=pos.coords;setCoords(latitude,longitude);if(state.recording&&!state.paused){state.points.push([latitude,longitude,altitude||0]);updateLiveLine()}if(map.getZoom()<12)map.setView([latitude,longitude],16)},err=>toast('GPS 錯誤：'+err.message,5000),{enableHighAccuracy:true,maximumAge:1000,timeout:15000})}
function stopWatch(){if(state.watchId!=null)navigator.geolocation.clearWatch(state.watchId);state.watchId=null}
function setRecordingUI(){
  $('#finishBtn').classList.toggle('hidden',!state.recording);
  $('#cameraBtn').classList.toggle('hidden',!state.recording||state.paused);
  const label=$('#mainBtnLabel');
  if(label)label.textContent=!state.recording?'開始':state.paused?'繼續':'暫停';
  const icon=$('#mainBtn .action-icon');
  if(icon)icon.textContent=!state.recording?'●':state.paused?'▶':'Ⅱ';
}

function fileDataURL(f){return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(f)})}
async function exifGPS(file){try{if(window.exifr){const g=await exifr.gps(file);if(g&&Number.isFinite(g.latitude)&&Number.isFinite(g.longitude))return[g.latitude,g.longitude,0]}}catch(e){}return null}

async function saveProject(obj){obj.name=safeName(obj.name);obj.updated=new Date().toISOString();await dbPut('projects',obj);return obj}
async function loadProjects(){const list=(await dbAll('projects')).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));$('#projectList').innerHTML='';for(const meta of list){const row=document.createElement('div');row.className='project-row';const b=document.createElement('button');b.className='project-name';b.textContent=meta.name;b.onclick=()=>toggleProject(meta.name);const close=document.createElement('button');close.className='mini';close.textContent=state.projects.get(meta.name)?.open?'關閉':'開啟';close.onclick=()=>toggleProject(meta.name);const menu=document.createElement('button');menu.className='mini';menu.textContent='⋮';menu.onclick=()=>projectActions(meta.name);row.append(b,close,menu);$('#projectList').append(row)}}
async function toggleProject(name){let p=state.projects.get(name);if(p&&p.open){closeProject(name);await loadProjects();return}const meta=await dbGet('projects',name);if(!meta)return;const line=L.polyline((meta.points||[]).map(x=>[x[0],x[1]]),{color:'red',weight:4}).addTo(map);const markers=[];for(const ph of meta.photos||[]){const m=markerForPhoto(ph);if(m){m.addTo(map);markers.push(m)}}p={meta,line,photoMarkers:markers,open:true};state.projects.set(name,p);const group=L.featureGroup([line,...markers]);if(group.getBounds().isValid())map.fitBounds(group.getBounds(),{padding:[25,25]});drawProfile(meta.points||[]);refreshPhotoIcons();await loadProjects()}
function closeProject(name){const p=state.projects.get(name);if(!p)return;map.removeLayer(p.line);p.photoMarkers.forEach(m=>map.removeLayer(m));p.open=false}
async function projectActions(name){openModal('專案管理',`<button class="wide" id="pDownload">下載 GPX＋KMZ＋SHP＋照片 ZIP</button><button class="wide" id="pRename">重新命名</button><button class="wide" id="pClose">關閉顯示</button><button class="wide danger" id="pDelete">刪除全部資料</button>`);$('#pDownload').onclick=()=>exportProject(name);$('#pRename').onclick=async()=>{const nn=prompt('新名稱',name);if(!nn||nn===name)return;const obj=await dbGet('projects',name);if(await dbGet('projects',safeName(nn))){toast('新名稱已存在');return}await dbDel('projects',name);obj.name=safeName(nn);await saveProject(obj);closeProject(name);state.projects.delete(name);$('#modal').classList.add('hidden');await loadProjects()};$('#pClose').onclick=async()=>{closeProject(name);$('#modal').classList.add('hidden');await loadProjects()};$('#pDelete').onclick=async()=>{if(!confirm(`確定刪除 ${name} 的所有資料？`))return;closeProject(name);state.projects.delete(name);await dbDel('projects',name);$('#modal').classList.add('hidden');await loadProjects();toast('已完整刪除專案')}}

function gpxText(points){return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="GeoLive 0804.1348" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>GeoLive</name><trkseg>${points.map(p=>`<trkpt lat="${p[0]}" lon="${p[1]}"><ele>${p[2]||0}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`}
function kmlText(points,photos){const coords=points.map(p=>`${p[1]},${p[0]},${p[2]||0}`).join(' ');const marks=photos.filter(p=>p.lat!=null).map((p,i)=>`<Placemark><name>${esc(p.name||'photo')}</name><Point><coordinates>${p.lon},${p.lat},${p.alt||0}</coordinates></Point></Placemark>`).join('');return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Route</name><Style><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style><LineString><coordinates>${coords}</coordinates></LineString></Placemark>${marks}</Document></kml>`}
function dataURLBlob(s){const[a,b]=s.split(',');const mime=(a.match(/:(.*?);/)||[])[1]||'image/jpeg';const bin=atob(b),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new Blob([u],{type:mime})}
function le16(v){return[v&255,(v>>8)&255]}function le32(v){return[v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255]}function be32(v){return[(v>>24)&255,(v>>16)&255,(v>>8)&255,v&255]}
function f64(v){const b=new ArrayBuffer(8);new DataView(b).setFloat64(0,v,true);return[...new Uint8Array(b)]}
function makePolylineShp(points){const pts=points.map(p=>[+p[1],+p[0]]);const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);const xmin=Math.min(...xs),ymin=Math.min(...ys),xmax=Math.max(...xs),ymax=Math.max(...ys);const recBytes=4+32+4+4+4+pts.length*16;const fileBytes=100+8+recBytes;let a=[];a.push(...be32(9994),...Array(20).fill(0),...be32(fileBytes/2),...le32(1000),...le32(3),...f64(xmin),...f64(ymin),...f64(xmax),...f64(ymax),...Array(32).fill(0));a.push(...be32(1),...be32(recBytes/2),...le32(3),...f64(xmin),...f64(ymin),...f64(xmax),...f64(ymax),...le32(1),...le32(pts.length),...le32(0));for(const p of pts)a.push(...f64(p[0]),...f64(p[1]));return new Uint8Array(a)}
function makeShx(points){const xs=points.map(p=>+p[1]),ys=points.map(p=>+p[0]);const xmin=Math.min(...xs),ymin=Math.min(...ys),xmax=Math.max(...xs),ymax=Math.max(...ys);const recBytes=4+32+4+4+4+points.length*16;let a=[];a.push(...be32(9994),...Array(20).fill(0),...be32(54),...le32(1000),...le32(3),...f64(xmin),...f64(ymin),...f64(xmax),...f64(ymax),...Array(32).fill(0),...be32(50),...be32(recBytes/2));return new Uint8Array(a)}
function makeDbf(name){const enc=new TextEncoder();const fieldLen=80,headerLen=65,recLen=81,total=headerLen+recLen+1;const b=new Uint8Array(total);const d=new Date();b[0]=3;b[1]=d.getFullYear()-1900;b[2]=d.getMonth()+1;b[3]=d.getDate();b.set(le32(1),4);b.set(le16(headerLen),8);b.set(le16(recLen),10);b.set(enc.encode('NAME'),32);b[43]='C'.charCodeAt(0);b[48]=fieldLen;b[64]=13;b[65]=32;const txt=enc.encode(String(name).slice(0,fieldLen));b.set(txt,66);b[total-1]=26;return b}
async function exportProject(name){if(!window.JSZip){toast('ZIP 套件尚未載入，請先連網重開一次');return}const p=await dbGet('projects',name),zip=new JSZip();zip.file('route.gpx',gpxText(p.points||[]));const kml=kmlText(p.points||[],p.photos||[]);const kmz=new JSZip();kmz.file('doc.kml',kml);zip.file('route.kmz',await kmz.generateAsync({type:'blob'}));if((p.points||[]).length>=2){zip.file('route.shp',makePolylineShp(p.points));zip.file('route.shx',makeShx(p.points));zip.file('route.dbf',makeDbf(p.name));zip.file('route.prj','GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]')}let i=1;for(const ph of p.photos||[]){if(!ph.data)continue;const blob=dataURLBlob(ph.data),ext=blob.type.includes('png')?'png':blob.type.includes('webp')?'webp':'jpg';zip.file(`photos/${String(i).padStart(3,'0')}_${safeName(ph.name||'photo')}.${ext}`,blob);i++}zip.file('project.json',JSON.stringify(p,null,2));const blob=await zip.generateAsync({type:'blob'});downloadBlob(blob,`${safeName(name)}.zip`);toast('已建立完整專案 ZIP')}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000)}

function tileXY(lat,lon,z){const n=2**z,x=Math.floor((lon+180)/360*n),lr=lat*Math.PI/180,y=Math.floor((1-Math.asinh(Math.tan(lr))/Math.PI)/2*n);return[x,y]}
function tileBounds(bounds,z){const[w,s,e,n]=bounds,[x1,y1]=tileXY(n,w,z),[x2,y2]=tileXY(s,e,z);return[Math.min(x1,x2),Math.max(x1,x2),Math.min(y1,y2),Math.max(y1,y2)]}
function tileUrl(z,x,y){return TILE_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y)}
function pointInRing(point,ring){
  const[x,y]=point;let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const[xi,yi]=ring[i],[xj,yj]=ring[j];
    const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-15)+xi);
    if(intersect)inside=!inside;
  }
  return inside;
}
function pointInPolygon(point,polygon){
  if(!polygon?.length||!pointInRing(point,polygon[0]))return false;
  for(let i=1;i<polygon.length;i++){
    if(pointInRing(point,polygon[i]))return false;
  }
  return true;
}
function pointInGeometry(point,geometry){
  if(!geometry)return false;
  if(geometry.type==='Polygon')return pointInPolygon(point,geometry.coordinates);
  if(geometry.type==='MultiPolygon')return geometry.coordinates.some(poly=>pointInPolygon(point,poly));
  return false;
}
function tileCenterLonLat(x,y,z){
  const n=2**z;
  const lon=(x+0.5)/n*360-180;
  const latRad=Math.atan(Math.sinh(Math.PI*(1-2*(y+0.5)/n)));
  return[lon,latRad*180/Math.PI];
}

function tileLonLatBounds(x,y,z){
  const n=2**z;
  const west=x/n*360-180, east=(x+1)/n*360-180;
  const north=Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
  const south=Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/n)))*180/Math.PI;
  return [west,south,east,north];
}
function pointOnSegment(p,a,b){
  const cross=(p[1]-a[1])*(b[0]-a[0])-(p[0]-a[0])*(b[1]-a[1]);
  if(Math.abs(cross)>1e-10)return false;
  return p[0]>=Math.min(a[0],b[0])-1e-10 && p[0]<=Math.max(a[0],b[0])+1e-10 &&
         p[1]>=Math.min(a[1],b[1])-1e-10 && p[1]<=Math.max(a[1],b[1])+1e-10;
}
function segmentsIntersect(a,b,c,d){
  const orient=(p,q,r)=>{
    const v=(q[1]-p[1])*(r[0]-q[0])-(q[0]-p[0])*(r[1]-q[1]);
    if(Math.abs(v)<1e-12)return 0;
    return v>0?1:2;
  };
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  if(o1!==o2&&o3!==o4)return true;
  return (o1===0&&pointOnSegment(c,a,b))||(o2===0&&pointOnSegment(d,a,b))||
         (o3===0&&pointOnSegment(a,c,d))||(o4===0&&pointOnSegment(b,c,d));
}
function ringIntersectsRect(ring,rect){
  const[w,s,e,n]=rect;
  for(const p of ring){
    if(p[0]>=w&&p[0]<=e&&p[1]>=s&&p[1]<=n)return true;
  }
  const corners=[[w,s],[e,s],[e,n],[w,n]];
  if(corners.some(c=>pointInRing(c,ring)))return true;
  const edges=[[[w,s],[e,s]],[[e,s],[e,n]],[[e,n],[w,n]],[[w,n],[w,s]]];
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    for(const [c,d] of edges){
      if(segmentsIntersect(ring[j],ring[i],c,d))return true;
    }
  }
  return false;
}
function polygonIntersectsTile(poly,x,y,z){
  if(!poly?.length)return false;
  const rect=tileLonLatBounds(x,y,z);
  // Outer boundary intersection or tile center contained in polygon, respecting holes.
  if(ringIntersectsRect(poly[0],rect))return true;
  const center=tileCenterLonLat(x,y,z);
  return pointInPolygon(center,poly);
}
function geometryIntersectsTile(geometry,x,y,z){
  if(!geometry)return false;
  if(geometry.type==='Polygon')return polygonIntersectsTile(geometry.coordinates,x,y,z);
  if(geometry.type==='MultiPolygon')return geometry.coordinates.some(poly=>polygonIntersectsTile(poly,x,y,z));
  return false;
}

async function downloadOffline(city,district,status,bar){
  const zooms=[12,13,14,15];
  status.textContent=`正在讀取 ${city}${district} 本機鄉鎮市區界線…`;

  const region=await resolveLocalTownBoundary(city,district);
  const bounds=region.bounds;
  const geometry=region.geometry;

  const jobs=[];
  for(const z of zooms){
    const[x1,x2,y1,y2]=tileBounds(bounds,z);
    for(let x=x1;x<=x2;x++){
      for(let y=y1;y<=y2;y++){
        if(geometryIntersectsTile(geometry,x,y,z))jobs.push([z,x,y]);
      }
    }
  }

  const expected=jobs.length;
  if(expected<1)throw new Error('行政區內沒有可下載的圖磚');
  if(expected>18000)throw new Error(`需要 ${expected} 張圖磚，超過 18000 張安全上限`);

  const id=`${Date.now()}_${safeName(city+district)}`;
  const cacheName=`${REGION_CACHE_PREFIX}${id}-z12-15-v1`;
  const cache=await caches.open(cacheName);

  status.textContent=`已確認：${region.matchedName}｜Zoom 12–15｜共 ${expected} 張`;
  let done=0,errors=0;

  for(let i=0;i<jobs.length;i+=6){
    await Promise.all(jobs.slice(i,i+6).map(async([z,x,y])=>{
      const u=tileUrl(z,x,y);
      try{
        const r=await fetch(u,{cache:'reload'});
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        await cache.put(u,r.clone());
      }catch(e){
        errors++;
      }
      done++;
      status.textContent=`${region.matchedName}｜下載 ${done}/${expected}｜失敗 ${errors}`;
      bar.style.width=`${Math.round(done/expected*100)}%`;
    }));
  }

  if(expected-errors<1){
    await caches.delete(cacheName);
    throw new Error('圖磚全部下載失敗，請確認網路後重試');
  }

  const m={
    id,label:region.matchedName,city,district,bounds,geometry,
    matched_name:region.matchedName,town_code:region.townCode,
    min_zoom:12,max_zoom:15,
    expected_tiles:expected,tiles:expected-errors,errors,
    basemap:'NLSC EMAP6_OPENDATA',
    range_method:'MOI township polygon',
    cache_name:cacheName,
    created:new Date().toISOString()
  };
  await dbPut('offline',m);
  return m;
}
async function loadOffline(){return(await dbAll('offline')).sort((a,b)=>String(b.created).localeCompare(String(a.created)))}
class CachedRegionLayer extends L.GridLayer{
  constructor(meta,opts={}){
    super(opts);
    this.meta=meta;
  }
  createTile(coords,done){
    const tile=document.createElement('img');
    tile.alt='';
    tile.setAttribute('role','presentation');
    tile.style.width='256px';
    tile.style.height='256px';

    const minZ=this.meta.min_zoom??12;
    const maxZ=this.meta.max_zoom??15;
    if(coords.z<minZ||coords.z>maxZ){
      setTimeout(()=>done(null,tile),0);
      return tile;
    }

    const source=tileUrl(coords.z,coords.x,coords.y);
    caches.open(this.meta.cache_name)
      .then(c=>c.match(source))
      .then(resp=>{
        if(!resp)throw new Error('tile not cached');
        return resp.blob();
      })
      .then(blob=>{
        const u=URL.createObjectURL(blob);
        tile.onload=()=>{URL.revokeObjectURL(u);done(null,tile)};
        tile.onerror=()=>{URL.revokeObjectURL(u);done(new Error('tile image error'),tile)};
        tile.src=u;
      })
      .catch(()=>done(null,tile));
    return tile;
  }
}
async function toggleOffline(id){
  if(state.offlineLayers.has(id)){
    map.removeLayer(state.offlineLayers.get(id));
    state.offlineLayers.delete(id);
    return;
  }

  const m=await dbGet('offline',id);
  if(!m)return;

  const l=new CachedRegionLayer(m,{
    minZoom:m.min_zoom??12,
    maxNativeZoom:m.max_zoom??15,
    maxZoom:22,
    bounds:[[m.bounds[1],m.bounds[0]],[m.bounds[3],m.bounds[2]]],
    keepBuffer:2
  }).addTo(map);

  state.offlineLayers.set(id,l);
  const targetBounds=[[m.bounds[1],m.bounds[0]],[m.bounds[3],m.bounds[2]]];
  map.fitBounds(targetBounds,{padding:[18,18],maxZoom:m.max_zoom??15});
  if(map.getZoom()<(m.min_zoom??12))map.setZoom(m.min_zoom??12);
  toast(`已開啟 ${m.label} 離線地圖`);
}
async function deleteOffline(id){
  if(state.offlineLayers.has(id))map.removeLayer(state.offlineLayers.get(id));
  state.offlineLayers.delete(id);

  const m=await dbGet('offline',id);
  if(m?.cache_name)await caches.delete(m.cache_name);
  else await caches.delete(`${REGION_CACHE_PREFIX}${id}-z15-v1`);

  await dbDel('offline',id);
  toast('已刪除這個行政區的離線地圖與圖磚');
}
async function clearTileCache(){
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k===LEGACY_TILE_CACHE||k.startsWith(REGION_CACHE_PREFIX)).map(k=>caches.delete(k)));

  const maps=await dbAll('offline');
  for(const m of maps)await dbDel('offline',m.id);

  for(const [id,l] of state.offlineLayers.entries())map.removeLayer(l);
  state.offlineLayers.clear();

  toast('已清除全部離線地圖與舊版共用圖磚');
}

const DISTRICTS={
'臺北市':['中正區','大同區','中山區','松山區','大安區','萬華區','信義區','士林區','北投區','內湖區','南港區','文山區'],
'新北市':['板橋區','三重區','中和區','永和區','新莊區','新店區','土城區','蘆洲區','樹林區','汐止區','鶯歌區','三峽區','淡水區','瑞芳區','五股區','泰山區','林口區','深坑區','石碇區','坪林區','三芝區','石門區','八里區','平溪區','雙溪區','貢寮區','金山區','萬里區','烏來區'],
'桃園市':['桃園區','中壢區','平鎮區','八德區','楊梅區','蘆竹區','大溪區','龍潭區','龜山區','大園區','觀音區','新屋區','復興區'],
'臺中市':['中區','東區','南區','西區','北區','西屯區','南屯區','北屯區','豐原區','東勢區','大甲區','清水區','沙鹿區','梧棲區','后里區','神岡區','潭子區','大雅區','新社區','石岡區','外埔區','大安區','烏日區','大肚區','龍井區','霧峰區','太平區','大里區','和平區'],
'臺南市':['中西區','東區','南區','北區','安平區','安南區','永康區','歸仁區','新化區','左鎮區','玉井區','楠西區','南化區','仁德區','關廟區','龍崎區','官田區','麻豆區','佳里區','西港區','七股區','將軍區','學甲區','北門區','新營區','後壁區','白河區','東山區','六甲區','下營區','柳營區','鹽水區','善化區','大內區','山上區','新市區','安定區'],
'高雄市':['楠梓區','左營區','鼓山區','三民區','鹽埕區','前金區','新興區','苓雅區','前鎮區','旗津區','小港區','鳳山區','林園區','大寮區','大樹區','大社區','仁武區','鳥松區','岡山區','橋頭區','燕巢區','田寮區','阿蓮區','路竹區','湖內區','茄萣區','永安區','彌陀區','梓官區','旗山區','美濃區','六龜區','甲仙區','杉林區','內門區','茂林區','桃源區','那瑪夏區'],
'基隆市':['仁愛區','信義區','中正區','中山區','安樂區','暖暖區','七堵區'],'新竹市':['東區','北區','香山區'],
'新竹縣':['竹北市','竹東鎮','新埔鎮','關西鎮','湖口鄉','新豐鄉','芎林鄉','橫山鄉','北埔鄉','寶山鄉','峨眉鄉','尖石鄉','五峰鄉'],
'苗栗縣':['苗栗市','頭份市','苑裡鎮','通霄鎮','竹南鎮','後龍鎮','卓蘭鎮','大湖鄉','公館鄉','銅鑼鄉','南庄鄉','頭屋鄉','三義鄉','西湖鄉','造橋鄉','三灣鄉','獅潭鄉','泰安鄉'],
'彰化縣':['彰化市','員林市','和美鎮','鹿港鎮','溪湖鎮','二林鎮','田中鎮','北斗鎮','花壇鄉','芬園鄉','大村鄉','永靖鄉','伸港鄉','線西鄉','福興鄉','秀水鄉','埔心鄉','埔鹽鄉','大城鄉','芳苑鄉','竹塘鄉','社頭鄉','二水鄉','田尾鄉','埤頭鄉','溪州鄉'],
'南投縣':['南投市','埔里鎮','草屯鎮','竹山鎮','集集鎮','名間鄉','鹿谷鄉','中寮鄉','魚池鄉','國姓鄉','水里鄉','信義鄉','仁愛鄉'],
'雲林縣':['斗六市','斗南鎮','虎尾鎮','西螺鎮','土庫鎮','北港鎮','古坑鄉','大埤鄉','莿桐鄉','林內鄉','二崙鄉','崙背鄉','麥寮鄉','東勢鄉','褒忠鄉','臺西鄉','元長鄉','四湖鄉','口湖鄉','水林鄉'],
'嘉義市':['東區','西區'],'嘉義縣':['太保市','朴子市','布袋鎮','大林鎮','民雄鄉','溪口鄉','新港鄉','六腳鄉','東石鄉','義竹鄉','鹿草鄉','水上鄉','中埔鄉','竹崎鄉','梅山鄉','番路鄉','大埔鄉','阿里山鄉'],
'屏東縣':['屏東市','潮州鎮','東港鎮','恆春鎮','萬丹鄉','長治鄉','麟洛鄉','九如鄉','里港鄉','鹽埔鄉','高樹鄉','萬巒鄉','內埔鄉','竹田鄉','新埤鄉','枋寮鄉','新園鄉','崁頂鄉','林邊鄉','南州鄉','佳冬鄉','琉球鄉','車城鄉','滿州鄉','枋山鄉','三地門鄉','霧臺鄉','瑪家鄉','泰武鄉','來義鄉','春日鄉','獅子鄉','牡丹鄉'],
'宜蘭縣':['宜蘭市','羅東鎮','蘇澳鎮','頭城鎮','礁溪鄉','壯圍鄉','員山鄉','冬山鄉','五結鄉','三星鄉','大同鄉','南澳鄉'],
'花蓮縣':['花蓮市','鳳林鎮','玉里鎮','新城鄉','吉安鄉','壽豐鄉','光復鄉','豐濱鄉','瑞穗鄉','富里鄉','秀林鄉','萬榮鄉','卓溪鄉'],
'臺東縣':['臺東市','成功鎮','關山鎮','卑南鄉','鹿野鄉','池上鄉','東河鄉','長濱鄉','太麻里鄉','大武鄉','綠島鄉','海端鄉','延平鄉','金峰鄉','達仁鄉','蘭嶼鄉'],
'澎湖縣':['馬公市','湖西鄉','白沙鄉','西嶼鄉','望安鄉','七美鄉'],'金門縣':['金城鎮','金湖鎮','金沙鎮','金寧鄉','烈嶼鄉','烏坵鄉'],'連江縣':['南竿鄉','北竿鄉','莒光鄉','東引鄉']};

function openModal(title,html){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;$('#modal').classList.remove('hidden')}
$('#modalClose').onclick=()=>$('#modal').classList.add('hidden');$('#modal').onclick=e=>{if(e.target===$('#modal'))$('#modal').classList.add('hidden')};

$('#mainBtn').onclick=()=>{if(!state.recording){clearLive();state.recording=true;state.paused=false;startWatch();toast('開始記錄')}else{state.paused=!state.paused;toast(state.paused?'已暫停':'繼續記錄')}setRecordingUI()};
$('#finishBtn').onclick=async()=>{state.recording=false;state.paused=false;stopWatch();setRecordingUI();const d=new Date(),def=d.toISOString().slice(0,19).replace(/[-:T]/g,'')+'_位置';const name=prompt('專案名稱',def)||def;await saveProject({name,points:state.points,photos:state.photos});clearLive();await loadProjects();toast('專案已儲存於 iPhone')};
$('#cameraInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;navigator.geolocation.getCurrentPosition(async pos=>{const data=await fileDataURL(f),{latitude,longitude,altitude}=pos.coords;const ph={name:f.name,data,lat:latitude,lon:longitude,alt:altitude||0};state.photos.push(ph);const m=markerForPhoto(ph);if(m){m.addTo(map);state.livePhotoMarkers.push(m)}e.target.value='';toast('照片已加入')},err=>toast('拍照定位失敗：'+err.message),{enableHighAccuracy:true})};

$('#importBtn').onclick=()=>$('#folderInput').click();
$('#folderInput').onchange=async e=>{const files=[...e.target.files],gpx=files.find(f=>f.name.toLowerCase().endsWith('.gpx'));if(!gpx){toast('找不到 GPX');return}try{const txt=await gpx.text(),doc=new DOMParser().parseFromString(txt,'application/xml'),points=[...doc.querySelectorAll('trkpt')].map(n=>[+n.getAttribute('lat'),+n.getAttribute('lon'),+(n.querySelector('ele')?.textContent||0)]),imgs=files.filter(f=>/\.(jpe?g|png|webp|tiff?)$/i.test(f.name)),photos=[];let missing=0;for(const f of imgs){const gps=await exifGPS(f),data=await fileDataURL(f);if(gps)photos.push({name:f.name,data,lat:gps[0],lon:gps[1],alt:gps[2]});else missing++}const name=safeName(gpx.name.replace(/\.gpx$/i,''));await saveProject({name,points,photos,unlocated_count:missing});await loadProjects();toast(`匯入完成：${points.length} 點、${photos.length} 張定位照片；${missing} 張無 GPS 未放置`,5000)}catch(err){toast('匯入失敗：'+err.message,5000)}e.target.value=''};

$('#offlineDownloadBtn').onclick=async()=>{
  try{
    const grouped=await adminOptionsFromBoundary();
    const cities=[...grouped.keys()].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
    const cityOptions=cities.map(x=>`<option>${esc(x)}</option>`).join('');

    openModal('下載離線道路地圖（鄉鎮界線版）',
      `<div class="form-row"><label>縣市</label><select id="citySel">${cityOptions}</select></div>
       <div class="form-row"><label>區／鄉鎮市</label><select id="districtSel"></select></div>
       <button id="doDownload" class="primary">依鄉鎮界線下載離線地圖</button>
       <div class="progress"><div id="dlBar"></div></div>
       <p id="dlStatus"></p>
       <small class="note">使用內建全臺鄉鎮市區界線；下載 Zoom 12–15。下載期間請保持 GeoLive 在前景並避免自動鎖定。</small>`
    );

    const fill=()=>{
      const city=$('#citySel').value;
      const towns=(grouped.get(city)||[]).slice().sort((a,b)=>a.localeCompare(b,'zh-Hant'));
      $('#districtSel').innerHTML=towns.map(x=>`<option>${esc(x)}</option>`).join('');
    };
    fill();
    $('#citySel').onchange=fill;

    $('#doDownload').onclick=async()=>{
      const s=$('#dlStatus'),bar=$('#dlBar');
      s.textContent='正在準備下載…';
      bar.style.width='0%';
      try{
        const m=await downloadOffline($('#citySel').value,$('#districtSel').value,s,bar);
        s.textContent=`完成：${m.tiles}/${m.expected_tiles} 張，失敗 ${m.errors}`;
        toast(`${m.label} 離線道路地圖下載完成`,4000);
      }catch(e){
        s.textContent='失敗：'+e.message;
      }
    };
  }catch(e){
    toast('無法載入鄉鎮市區界線：'+e.message,6000);
  }
};

$('#offlineManageBtn').onclick=async()=>{const arr=await loadOffline();openModal('管理離線地圖',`${arr.map(m=>`<div class="offline-row"><span style="flex:1">${esc(m.label)}<br><small>${m.tiles}/${m.expected_tiles} tiles｜Z15</small></span><button class="mini" data-open="${esc(m.id)}">${state.offlineLayers.has(m.id)?'關閉':'開啟'}</button><button class="mini" data-del="${esc(m.id)}">刪除</button></div>`).join('')||'尚無離線地圖'}<button id="clearTiles" class="wide danger">清除全部離線圖磚快取</button>`);document.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{await toggleOffline(b.dataset.open);$('#modal').classList.add('hidden')});document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(confirm('確定刪除此地圖紀錄？')){await deleteOffline(b.dataset.del);$('#modal').classList.add('hidden')}});$('#clearTiles').onclick=async()=>{if(confirm('確定清除所有離線圖磚？')){await clearTileCache();$('#modal').classList.add('hidden')}}};





async function migrateOfflineCache1716(){
  const flag='geolive_offline_cache_migrated_1716';
  if(localStorage.getItem(flag)==='1')return;

  const keys=await caches.keys();
  await Promise.all(keys
    .filter(k=>k===LEGACY_TILE_CACHE||k.startsWith(REGION_CACHE_PREFIX))
    .map(k=>caches.delete(k)));

  const oldMaps=await dbAll('offline');
  for(const m of oldMaps)await dbDel('offline',m.id);

  localStorage.setItem(flag,'1');
}

function updateNetwork(){const online=navigator.onLine;$('#networkBadge').textContent=online?'● 有網路':'● 真正離線';$('#networkBadge').style.color=online?'#176b34':'#b22';$('#simulateOffline').checked=!online;if(!online&&onlineLayer&&map.hasLayer(onlineLayer))map.removeLayer(onlineLayer);if(online&&onlineLayer&&!map.hasLayer(onlineLayer))onlineLayer.addTo(map)}
addEventListener('online',()=>{updateNetwork();toast('iPhone 已恢復網路')});addEventListener('offline',()=>{updateNetwork();toast('iPhone 目前真的沒有網路')});
$('#simulateOffline').onchange=e=>{if(e.target.checked)alert('請從 iPhone 右上角向下滑，開啟控制中心，再開啟飛航模式並確認 Wi‑Fi 已關閉。回到 GeoLive 後，右上角會顯示「真正離線」。');else alert('請關閉飛航模式，重新開啟 Wi‑Fi 或行動數據。')};

$('#menuBtn').onclick=()=>$('#drawer').classList.toggle('hidden');$('#closeDrawer').onclick=()=>$('#drawer').classList.add('hidden');

(async()=>{try{initMap();await migrateOfflineCache1716();await loadProjects();startWatch();updateNetwork();drawProfile([])}catch(e){toast('初始化失敗：'+e.message,5000)}})();



// ===== 0804.1717 dip measurement =====
(()=>{
  let dipZero=0;
  let dipStarted=false;
  let permissionReady=false;

  function el(id){return document.getElementById(id)}
  function onOrientation(e){
    if(!dipStarted)return;
    const beta=Number.isFinite(e.beta)?e.beta:0;
    const gamma=Number.isFinite(e.gamma)?e.gamma:0;

    let tilt=Math.atan(Math.sqrt(
      Math.tan(beta*Math.PI/180)**2+
      Math.tan(gamma*Math.PI/180)**2
    ))*180/Math.PI;
    tilt=Math.max(0,Math.min(90,tilt));

    const shown=Math.max(0,Math.min(90,tilt-dipZero));
    el('dipValue').textContent=shown.toFixed(1)+'°';
    el('dipValue').dataset.raw=tilt.toString();

    const dominant=Math.abs(beta)>=Math.abs(gamma)
      ?(beta>=0?'手機上端較高':'手機上端較低')
      :(gamma>=0?'手機右側較高':'手機左側較高');
    el('dipDirection').textContent=dominant;
  }

  async function ensureMotionPermission(){
    if(permissionReady)return;
    if(typeof DeviceOrientationEvent==='undefined')throw new Error('此裝置不支援傾角感測器');
    if(typeof DeviceOrientationEvent.requestPermission==='function'){
      const p=await DeviceOrientationEvent.requestPermission();
      if(p!=='granted')throw new Error('未允許「動作與方向」存取');
    }
    window.addEventListener('deviceorientation',onOrientation,true);
    permissionReady=true;
  }

  el('dipBtn')?.addEventListener('click',()=>{
    el('dipModal')?.classList.remove('hidden');
  });
  el('dipClose')?.addEventListener('click',()=>{
    el('dipModal')?.classList.add('hidden');
  });
  el('dipModal')?.addEventListener('click',e=>{
    if(e.target===el('dipModal'))el('dipModal').classList.add('hidden');
  });
  el('startDipBtn')?.addEventListener('click',async()=>{
    try{
      await ensureMotionPermission();
      dipStarted=true;
      el('sensorStatus').textContent='傾角測量已啟用';
    }catch(err){
      el('sensorStatus').textContent=err.message;
    }
  });
  el('zeroDipBtn')?.addEventListener('click',()=>{
    const raw=parseFloat(el('dipValue')?.dataset.raw);
    if(Number.isFinite(raw)){
      dipZero=raw;
      el('dipValue').textContent='0.0°';
      el('sensorStatus').textContent='已以目前姿態歸零';
    }
  });
})();
