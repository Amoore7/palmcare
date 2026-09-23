/* Routing — hybrid cached turn-by-turn navigation with OpenRouteService */
(function(){
  const ORS_KEY = '4716703039fd434cb4cca7b2813ddb34';
  const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/driving-car';
  const CACHE_STORE = 'routes';
  const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  let dbPromise = null;
  function getDB(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject)=>{
      const req = indexedDB.open('PalmCareRouting', 1);
      req.onupgradeneeded = e=>{
        const db = e.target.result;
        if(!db.objectStoreNames.contains(CACHE_STORE)){
          db.createObjectStore(CACHE_STORE, {keyPath: 'farmId'});
        }
      };
      req.onsuccess = e=> resolve(e.target.result);
      req.onerror = e=> reject(e.target.error);
    });
    return dbPromise;
  }

  async function getCachedRoute(farmId){
    const db = await getDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const req = store.get(farmId);
      req.onsuccess = ()=>{
        const data = req.result;
        if(data && Date.now() - data.timestamp < CACHE_TTL){
          resolve(data);
        } else {
          resolve(null);
        }
      };
      req.onerror = ()=> reject(req.error);
    });
  }

  async function saveRoute(farmId, routeData){
    const db = await getDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      const req = store.put({
        farmId,
        geometry: routeData.geometry,
        instructions: routeData.instructions,
        distance: routeData.distance,
        duration: routeData.duration,
        timestamp: Date.now()
      });
      req.onsuccess = ()=> resolve();
      req.onerror = ()=> reject(req.error);
    });
  }

  async function clearCache(farmId){
    const db = await getDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      const req = store.delete(farmId);
      req.onsuccess = ()=> resolve();
      req.onerror = ()=> reject(req.error);
    });
  }

  async function fetchRoute(start, end){
    const url = `${ORS_BASE}?api_key=${ORS_KEY}&start=${start.lng},${start.lat}&end=${end.lng},${end.lat}&instructions=true&language=ar&units=km&geometry=true&geometry_format=geojson&preference=shortest&continue_straight=true`;
    
    const resp = await fetch(url);
    if(!resp.ok){
      const err = await resp.json().catch(()=>({}));
      throw new Error(err.error || `ORS ${resp.status}`);
    }
    const data = await resp.json();
    
    const route = data.routes[0];
    const segment = route.segments[0];
    
    return {
      geometry: route.geometry.coordinates.map(c=>({lat: c[1], lng: c[0]})),
      distance: segment.distance / 1000, // km
      duration: segment.duration / 60, // minutes
      instructions: segment.steps.map(step=>({
        instruction: step.instruction,
        distance: step.distance / 1000, // km
        duration: step.duration / 60, // minutes
        type: step.type,
        modifier: step.modifier,
        exit_number: step.exit_number
      }))
    };
  }

  function projectPointToRoute(point, routeGeometry){
    if(!routeGeometry || routeGeometry.length < 2) return null;
    
    let minDist = Infinity;
    let closestIdx = 0;
    let closestPoint = null;
    
    for(let i=0; i<routeGeometry.length-1; i++){
      const a = routeGeometry[i];
      const b = routeGeometry[i+1];
      const dist = pointToSegmentDistance(point, a, b);
      if(dist < minDist){
        minDist = dist;
        closestIdx = i;
        closestPoint = projectPointOnSegment(point, a, b);
      }
    }
    
    return {
      index: closestIdx,
      distance: minDist,
      point: closestPoint,
      progress: closestIdx / (routeGeometry.length - 1)
    };
  }

  function pointToSegmentDistance(p, a, b){
    const lat1 = a.lat, lng1 = a.lng;
    const lat2 = b.lat, lng2 = b.lng;
    const lat = p.lat, lng = p.lng;
    
    const R = 6371000; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    
    const aLat = lat1 * Math.PI / 180;
    const bLat = lat2 * Math.PI / 180;
    
    const segmentLength = Math.sqrt(dLat*dLat + dLng*dLng) * R;
    if(segmentLength < 1) return Geo.distM(p, a);
    
    const t = Math.max(0, Math.min(1, 
      ((lat - lat1) * Math.PI / 180) * dLat / (segmentLength/R) +
      ((lng - lng1) * Math.PI / 180) * dLng / (segmentLength/R) / Math.cos(aLat)
    ));
    
    const projLat = lat1 + t * (lat2 - lat1);
    const projLng = lng1 + t * (lng2 - lng1);
    
    return Geo.distM(p, {lat: projLat, lng: projLng});
  }

  function projectPointOnSegment(p, a, b){
    const lat1 = a.lat, lng1 = a.lng;
    const lat2 = b.lat, lng2 = b.lng;
    const lat = p.lat, lng = p.lng;
    
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const segmentLengthSq = dLat*dLat + dLng*dLng;
    
    if(segmentLengthSq < 1e-12) return a;
    
    const t = Math.max(0, Math.min(1, 
      ((lat - lat1) * dLat + (lng - lng1) * dLng) / segmentLengthSq
    ));
    
    return {lat: lat1 + t * dLat, lng: lng1 + t * dLng};
  }

  function getNextInstruction(instructions, currentIdx, routeGeometry, currentPos){
    if(!instructions || instructions.length === 0) return null;
    
    const pos = projectPointToRoute(currentPos, routeGeometry);
    if(!pos) return instructions[0];
    
    let cumulativeDist = 0;
    for(let i=0; i<instructions.length; i++){
      cumulativeDist += instructions[i].distance * 1000; // meters
      const stepEndProgress = cumulativeDist / (instructions.reduce((s, ins)=> s + ins.distance, 0) * 1000);
      if(pos.progress < stepEndProgress){
        return {
          current: instructions[i],
          next: instructions[i+1] || null,
          distanceToTurn: (stepEndProgress - pos.progress) * instructions.reduce((s, ins)=> s + ins.distance, 0) * 1000,
          progress: pos.progress
        };
      }
    }
    return instructions[instructions.length - 1];
  }

  function formatInstruction(step, lang){
    const isAr = lang === 'ar';
    let text = step.instruction;
    
    if(isAr){
      text = text
        .replace(/Head /, 'اتجه ')
        .replace(/Turn left/, 'انعطف يساراً')
        .replace(/Turn right/, 'انعطف يميناً')
        .replace(/Turn sharp left/, 'انعطف يساراً حاداً')
        .replace(/Turn sharp right/, 'انعطف يميناً حاداً')
        .replace(/Turn slight left/, 'انعطف يساراً قليلاً')
        .replace(/Turn slight right/, 'انعطف يميناً قليلاً')
        .replace(/Continue /, 'استمر ')
        .replace(/Arrive/, 'وصلت')
        .replace(/Destination/, 'الوجهة')
        .replace(/meters?/, 'م')
        .replace(/kilometers?/, 'كم')
        .replace(/minutes?/, 'د');
    }
    return text;
  }

  window.Routing = {
    async getRoute(farmId, start, end, forceRefresh){
      if(!forceRefresh){
        const cached = await getCachedRoute(farmId);
        if(cached) return { ...cached, cached: true };
      }
      
      if(!navigator.onLine) return null;
      
      try{
        const route = await fetchRoute(start, end);
        await saveRoute(farmId, route);
        return { ...route, cached: false };
      }catch(e){
        console.error('Route fetch failed:', e);
        const cached = await getCachedRoute(farmId);
        if(cached) return { ...cached, cached: true, stale: true };
        return null;
      }
    },
    
    clearCache,
    
    projectPointToRoute,
    
    getNextInstruction,
    
    formatInstruction
  };
})();