/* ============================================================
   KONFIGURATION — GitHub Actions schreibt die Secret-Werte in eine
   globale JS-Config, die der Browser hier einliest. Direkt aus den
   GitHub-Env-Variablen kann der Client nicht lesen; sie müssen zuerst
   in eine Datei bzw. globale Variable geschrieben werden.
   ============================================================ */
function resolveFirebaseConfig(){
  const defaults = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  };

  const root = typeof window !== 'undefined' ? window : globalThis;
  const globalConfig = root.MIIWISH_FIREBASE_CONFIG || {};
  const envLikeConfig = root.__MIIWISH_ENV__ || {};

  return {
    ...defaults,
    ...envLikeConfig,
    ...globalConfig
  };
}

const firebaseConfig = resolveFirebaseConfig();

function shouldUseDemoMode(config, firebaseAvailable = typeof firebase !== 'undefined'){
  return !config.apiKey || !config.projectId || config.projectId.includes("YOUR_") || !firebaseAvailable;
}

const DEMO_MODE = shouldUseDemoMode(firebaseConfig, typeof firebase !== 'undefined');

/* Scraping-Proxy-Chain. Der Browser versucht erst die direkte URL und fällt nur
   dann auf öffentliche Proxys zurück. So wird kein unnötiger Request gestartet,
   wenn die Seite bereits direkt erreichbar ist. */
const CORS_PROXIES = [
  "https://r.jina.ai/http://",
  "https://api.allorigins.win/raw?url="
];

async function fetchPageHtml(url){
  const candidates = [url, ...CORS_PROXIES.map(proxy => proxy + encodeURIComponent(url))];
  let lastError = null;

  for (const candidate of candidates){
    try {
      const res = await fetch(candidate, { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (html && html.trim().length > 0) return html;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Seite konnte nicht geladen werden.');
}

let firestoreDb = null;
let auth = null;
if (!DEMO_MODE && typeof firebase !== 'undefined'){
  firebase.initializeApp(firebaseConfig);
  firestoreDb = firebase.firestore();
  auth = firebase.auth();

  if (auth && auth.setPersistence) {
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {
      console.warn('Firebase persistence konnte nicht aktiviert werden.');
    });
  }
}

const PALETTE = ['#F5D3DA','#C9D6EE','#D7C6E3','#E9C97D','#AFD3D3'];

const DEMO_ITEMS = [
  {id:'d1', title:'Kabellose Kopfhörer', price:'89,00 €', url:'', description:'Über-Ohr, aktives Noise Cancelling, am liebsten in schwarz oder dunkelgrün.', image:'https://picsum.photos/seed/kopfhoerer/400/300', reserved:false, color:'#7C2E46'},
  {id:'d2', title:'„Der Circus" — Roman', price:'18,00 €', url:'', description:'Stand schon lange auf meiner Leseliste, gebunden statt Taschenbuch.', image:'https://picsum.photos/seed/buch/400/300', reserved:true, color:'#6E8F73'},
  {id:'d3', title:'Wanderrucksack 25L', price:'69,90 €', url:'', description:'Für Tagestouren, wasserdicht, mit Rückenbelüftung.', image:'https://picsum.photos/seed/rucksack/400/300', reserved:false, color:'#C8983B'},
  {id:'d4', title:'Zimmerpflanze Monstera', price:'', url:'', description:'Freu mich über jede Grünpflanze fürs Wohnzimmer.', image:'https://picsum.photos/seed/pflanze/400/300', reserved:false, color:'#6E8F73'},
];
const DEMO_REQUESTS = [
  {id:'r1', name:'Tante Sabine', email:'tante.sabine@example.com', reason:'Ich bin die Schwester der Gastgeberin.', status:'pending', ts:Date.now()-3600000}
];

function normalizeRequestData(data = {}){
  return {
    name: String(data.name || '').trim(),
    email: String(data.email || '').trim().toLowerCase(),
    reason: String(data.reason || '').trim()
  };
}

function seedDemoIfNeeded(){
  if (localStorage.getItem('wl_items') === null) localStorage.setItem('wl_items', JSON.stringify(DEMO_ITEMS));
  if (localStorage.getItem('wl_requests') === null) localStorage.setItem('wl_requests', JSON.stringify(DEMO_REQUESTS));
}

/* ============================================================
   Datenschicht
   ============================================================ */
const db = {
  async getItems(){
    if (DEMO_MODE) return JSON.parse(localStorage.getItem('wl_items') || '[]');
    const snap = await firestoreDb.collection('items').orderBy('ts','asc').get();
    return snap.docs.map(d=>({id:d.id, ...d.data()}));
  },
  async addItem(item){
    item.color = PALETTE[Math.floor(Math.random()*PALETTE.length)];
    item.reserved = false;
    if (DEMO_MODE){
      const items = JSON.parse(localStorage.getItem('wl_items') || '[]');
      item.id = 'i'+Date.now();
      items.push(item);
      localStorage.setItem('wl_items', JSON.stringify(items));
      return;
    }
    await firestoreDb.collection('items').add({...item, ts: Date.now()});
  },
  async deleteItem(id){
    if (DEMO_MODE){
      let items = JSON.parse(localStorage.getItem('wl_items') || '[]');
      items = items.filter(i=>i.id!==id);
      localStorage.setItem('wl_items', JSON.stringify(items));
      return;
    }
    await firestoreDb.collection('items').doc(id).delete();
  },
  async toggleReserved(id, reserved){
    if (DEMO_MODE){
      let items = JSON.parse(localStorage.getItem('wl_items') || '[]');
      items = items.map(i=> i.id===id ? {...i, reserved} : i);
      localStorage.setItem('wl_items', JSON.stringify(items));
      return;
    }
    await firestoreDb.collection('items').doc(id).update({reserved});
  },
  async getRequests(){
    if (DEMO_MODE) return JSON.parse(localStorage.getItem('wl_requests') || '[]');
    const snap = await firestoreDb.collection('requests').orderBy('ts','asc').get();
    return snap.docs.map(d=>({id:d.id, ...d.data()}));
  },
  async addRequest(data){
    const request = normalizeRequestData(data);
    if (DEMO_MODE){
      const reqs = JSON.parse(localStorage.getItem('wl_requests') || '[]');
      const id = 'req'+Date.now();
      reqs.push({id, ...request, status:'pending', ts:Date.now()});
      localStorage.setItem('wl_requests', JSON.stringify(reqs));
      return id;
    }
    const ref = await firestoreDb.collection('requests').add({ ...request, status:'pending', ts: Date.now() });
    return ref.id;
  },
  async getRequestStatus(id){
    if (DEMO_MODE){
      const reqs = JSON.parse(localStorage.getItem('wl_requests') || '[]');
      const r = reqs.find(r=>r.id===id);
      return r ? r.status : null;
    }
    const doc = await firestoreDb.collection('requests').doc(id).get();
    return doc.exists ? doc.data().status : null;
  },
  async setRequestStatus(id, status){
    if (DEMO_MODE){
      let reqs = JSON.parse(localStorage.getItem('wl_requests') || '[]');
      reqs = reqs.map(r=> r.id===id ? {...r, status} : r);
      localStorage.setItem('wl_requests', JSON.stringify(reqs));
      return;
    }
    await firestoreDb.collection('requests').doc(id).update({status});
  }
};

/* ============================================================
   URL-Scraping
   ============================================================ */
function normalizeImageUrl(value, baseUrl){
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  try {
    return new URL(trimmed, baseUrl).href;
  } catch (error) {
    return trimmed;
  }
}

function findFirstImage(doc, baseUrl){
  const candidates = Array.from(doc.querySelectorAll('img[src]'));
  for (const img of candidates){
    const src = normalizeImageUrl(img.getAttribute('src'), baseUrl);
    if (src && !src.includes('data:image/svg+xml')) return src;
  }
  return '';
}

function getMeta(doc, selectors){
  for (const sel of selectors){
    const el = doc.querySelector(sel);
    if (el){
      const val = el.getAttribute('content') || el.textContent;
      if (val && val.trim()) return val.trim();
    }
  }
  return '';
}

function findPriceFromJsonLd(doc){
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts){
    try{
      const data = JSON.parse(s.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items){
        const offers = item.offers;
        if (!offers) continue;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        if (offer && offer.price) return offer.price + (offer.priceCurrency ? ' ' + offer.priceCurrency : '');
      }
    } catch(e){ /* kein valides JSON-LD, ignorieren */ }
  }
  return '';
}

/* Fallback: Titel aus dem URL-Pfad ableiten, wenn keine Meta-Angabe existiert.
   Nimmt das letzte sinnvolle Pfadsegment (überspringt reine Zahlen-IDs am Ende,
   wie sie z. B. Amazon/Zalando anhängen), macht aus Bindestrichen/Unterstrichen
   Leerzeichen, entfernt Datei-Endungen und schreibt Wörter groß. */
function deriveTitleFromUrl(url){
  try{
    const u = new URL(url);
    let segments = u.pathname.split('/').filter(Boolean);
    while (segments.length > 1 && /^[a-z0-9]{0,3}\d{4,}[a-z0-9]{0,3}$/i.test(segments[segments.length-1])){
      segments.pop();
    }
    let slug = segments[segments.length-1] || '';
    slug = decodeURIComponent(slug)
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\d{5,}\b/g, '')
      .trim();
    if (!slug) return '';
    return slug.split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  } catch(e){ return ''; }
}

async function scrapeUrl(url){
  const html = await fetchPageHtml(url);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  let title = getMeta(doc, ['meta[property="og:title"]','meta[name="twitter:title"]','meta[name="title"]','title']);
  let titleFromUrl = false;
  if (!title){
    title = deriveTitleFromUrl(url);
    titleFromUrl = !!title;
  }
  let image = getMeta(doc, ['meta[property="og:image"]','meta[name="twitter:image"]']);
  if (!image) image = findFirstImage(doc, url);
  image = normalizeImageUrl(image, url);
  let description = getMeta(doc, ['meta[property="og:description"]','meta[name="description"]']);
  description = description.slice(0,150);
  let price = getMeta(doc, ['meta[property="product:price:amount"]','meta[property="og:price:amount"]','meta[itemprop="price"]']);
  if (!price) price = findPriceFromJsonLd(doc);

  return { title: title || url, image, description, price, url, titleFromUrl };
}

/* ============================================================
   App-Zustand & Ansichten
   ============================================================ */
let isAdmin = false;
let lastScraped = null;
let statusPollTimer = null;

function show(id){ document.getElementById(id).classList.remove('hidden'); }
function hide(id){ document.getElementById(id).classList.add('hidden'); }
function hideAllGates(){ ['gateRequest','gateWaiting','gateDenied','mainContent','adminArea'].forEach(hide); }
function dismissBanner(){ hide('demoBanner'); }

function stopStatusPolling(){
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

function startStatusPolling(){
  stopStatusPolling();
  statusPollTimer = setInterval(async () => {
    const myReqId = localStorage.getItem('wl_myRequestId');
    if (!myReqId) {
      stopStatusPolling();
      return;
    }
    await checkStatus();
  }, 5000);
}

function isAuthenticatedUser(){
  return !!(auth && auth.currentUser);
}

function applyAdminState(user){
  isAdmin = !!user;
  document.getElementById('adminToggleBtn').textContent = isAdmin ? 'Abmelden' : 'Admin';

  if (!isAdmin) {
    const myReqId = localStorage.getItem('wl_myRequestId');
    if (!myReqId){ hideAllGates(); show('gateRequest'); return; }
    checkStatus();
    return;
  }

  renderAdmin();
  hideAllGates();
  show('mainContent'); show('adminArea');
  renderItems(true);
}

async function init(){
  if (DEMO_MODE){ seedDemoIfNeeded(); show('demoBanner'); }

  const stars = document.getElementById('starField');
  stars.innerHTML = '';
  for (let i=0;i<24;i++){
    const s = document.createElement('div');
    s.className='star';
    s.style.top = Math.random()*90+'%';
    s.style.left = Math.random()*100+'%';
    s.style.animationDelay = (Math.random()*4)+'s';
    stars.appendChild(s);
  }

  if (auth && auth.onAuthStateChanged) {
    auth.onAuthStateChanged((user) => {
      applyAdminState(user);
    });
    return;
  }

  isAdmin = isAuthenticatedUser();
  document.getElementById('adminToggleBtn').textContent = isAdmin ? 'Abmelden' : 'Admin';

  if (isAdmin){
    await renderAdmin();
    hideAllGates();
    show('mainContent'); show('adminArea');
    await renderItems(true);
    return;
  }

  const myReqId = localStorage.getItem('wl_myRequestId');
  if (!myReqId){ hideAllGates(); show('gateRequest'); return; }
  await checkStatus();
}

async function checkStatus(){
  const myReqId = localStorage.getItem('wl_myRequestId');
  if (!myReqId){
    stopStatusPolling();
    hideAllGates();
    show('gateRequest');
    return;
  }

  const status = await db.getRequestStatus(myReqId);
  hideAllGates();

  if (status === 'approved'){
    stopStatusPolling();
    show('mainContent');
    await renderItems(false);
    return;
  }

  if (status === 'denied'){
    stopStatusPolling();
    show('gateDenied');
    return;
  }

  show('gateWaiting');
  startStatusPolling();
}

async function submitRequest(){
  const name = document.getElementById('nameInput').value.trim();
  const email = document.getElementById('emailInput').value.trim();
  const reason = document.getElementById('reasonInput').value.trim();
  const errEl = document.getElementById('requestErr');

  if (!name || !email){
    errEl.textContent = 'Bitte gib mindestens deinen Namen und deine E-Mail ein.';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  const id = await db.addRequest({ name, email, reason });
  localStorage.setItem('wl_myRequestId', id);
  await checkStatus();
}

/* Items rendern */
async function renderItems(asAdmin){
  const items = await db.getItems();
  const grid = document.getElementById('itemsGrid');
  grid.innerHTML = '';
  items.forEach(item=>{
    const el = document.createElement('div');
    el.className = 'item' + (!asAdmin && item.reserved ? ' is-reserved' : '');
    el.innerHTML = `
      ${!asAdmin && item.reserved ? '<div class="reserved-tag">reserviert</div>' : ''}
      ${item.image
        ? `<img class="thumb" src="${escapeAttr(item.image)}" alt="" onerror="this.replaceWith(fallbackThumb('${escapeAttr(item.color||'#C9D6EE')}'))">`
        : fallbackThumbHtml(item.color||'#C9D6EE')}
      <div class="body">
        <h3>${escapeHtml(item.title)}</h3>
        ${item.price ? `<div class="price">${escapeHtml(item.price)}</div>` : ''}
        ${item.description ? `<div class="desc">${escapeHtml(item.description)}</div>` : ''}
        <div class="row">
          ${item.url ? `<a class="link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Zum Produkt</a>` : '<span></span>'}
          ${!asAdmin ? `<button class="btn small ${item.reserved?'secondary':''}" onclick="reserve('${item.id}', ${!item.reserved})">${item.reserved?'Freigeben':'Reservieren'}</button>` : ''}
        </div>
      </div>
    `;
    if (!asAdmin){
      el.addEventListener('mouseenter', ()=>spawnPetals(el));
    }
    grid.appendChild(el);
  });
  if (!items.length) grid.innerHTML = '<p class="empty-note">Noch keine Wünsche eingetragen.</p>';
}
function fallbackThumbHtml(color){
  return `<div class="thumb-fallback" style="background:${color}">kein Bild</div>`;
}
function fallbackThumb(color){
  const d = document.createElement('div');
  d.className='thumb-fallback';
  d.style.background = color;
  d.textContent = 'kein Bild';
  return d;
}

function spawnPetals(card){
  for (let i=0;i<5;i++){
    const petal = document.createElement('div');
    petal.className='petal-spawn';
    const startX = 20 + Math.random()*(card.offsetWidth-40);
    petal.style.left = startX+'px';
    petal.style.top = (card.offsetHeight-20)+'px';
    const dx=(Math.random()-0.5)*120, dy=-100-Math.random()*80, rot=(Math.random()-0.5)*240;
    petal.style.setProperty('--dx', dx+'px');
    petal.style.setProperty('--dy', dy+'px');
    petal.style.setProperty('--rot', rot+'deg');
    petal.style.animationDelay = (i*60)+'ms';
    card.appendChild(petal);
    setTimeout(()=>petal.remove(), 1700);
  }
}

async function reserve(id, newState){
  await db.toggleReserved(id, newState);
  await renderItems(false);
}

/* Admin */
async function renderAdmin(){
  const reqs = await db.getRequests();
  const list = document.getElementById('requestsList');
  const pending = reqs.filter(r=>r.status==='pending');
  list.innerHTML = pending.length ? '' : '<div class="empty-note">Keine offenen Anfragen.</div>';
  pending.forEach(r=>{
    const row = document.createElement('div');
    row.className='request-row';
    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(r.name)}</strong></div>
        ${r.email ? `<div style="font-size:12px;color:var(--ink-soft);">${escapeHtml(r.email)}</div>` : ''}
        ${r.reason ? `<div style="font-size:12px;color:var(--ink-soft);">${escapeHtml(r.reason)}</div>` : ''}
      </div>
      <span class="actions">
        <button class="btn small" onclick="respondRequest('${r.id}','approved')">Freigeben</button>
        <button class="btn small secondary" onclick="respondRequest('${r.id}','denied')">Ablehnen</button>
      </span>`;
    list.appendChild(row);
  });

  const items = await db.getItems();
  const itemsList = document.getElementById('adminItemsList');
  itemsList.innerHTML = items.length ? '' : '<div class="empty-note">Noch keine Wünsche.</div>';
  items.forEach(item=>{
    const row = document.createElement('div');
    row.className='item-admin-row';
    row.innerHTML = `
      <div class="meta-mini">
        ${item.image ? `<img src="${escapeAttr(item.image)}" alt="">` : ''}
        <div>
          <div>${escapeHtml(item.title)}</div>
          <div style="font-size:12px;color:var(--ink-soft);">${escapeHtml(item.price||'')}</div>
        </div>
      </div>
      <button class="btn small secondary" onclick="removeItem('${item.id}')">Entfernen</button>
    `;
    itemsList.appendChild(row);
  });
}

async function respondRequest(id, status){ await db.setRequestStatus(id, status); await renderAdmin(); }

/* Scraping-Flow im Admin-Panel */
async function runScrape(){
  const url = document.getElementById('scrapeUrlInput').value.trim();
  const statusEl = document.getElementById('scrapeStatus');
  if (!url){ statusEl.textContent = 'Bitte zuerst einen Link einfügen.'; return; }
  statusEl.textContent = 'Hole Bild, Preis und Beschreibung …';
  document.getElementById('scrapeBtn').disabled = true;
  hide('previewBox');
  try{
    const data = await scrapeUrl(url);
    lastScraped = data;
    document.getElementById('previewImg').src = data.image || '';
    document.getElementById('previewImg').style.display = data.image ? 'block' : 'none';
    document.getElementById('previewTitle').value = data.title || '';
    document.getElementById('previewPrice').value = data.price || '';
    document.getElementById('previewDesc').value = data.description || '';
    updateCharCount();
    show('previewBox');
    const missing = [];
    if (!data.image) missing.push('Bild');
    if (!data.price) missing.push('Preis');
    if (!data.description) missing.push('Beschreibung');
    let msg = missing.length
      ? `Gefunden — nur ${missing.join(', ')} konnte(n) nicht automatisch erkannt werden, bitte manuell ergänzen.`
      : 'Alles gefunden — Felder unten prüfen und speichern.';
    if (data.titleFromUrl) msg += ' (Titel wurde aus dem Link abgeleitet, bitte prüfen.)';
    statusEl.textContent = msg;
  } catch(e){
    const guessedTitle = deriveTitleFromUrl(url);
    lastScraped = { url, title: guessedTitle, image:'', price:'', description:'' };
    document.getElementById('previewImg').style.display='none';
    document.getElementById('previewTitle').value = guessedTitle;
    document.getElementById('previewPrice').value = '';
    document.getElementById('previewDesc').value = '';
    updateCharCount();
    show('previewBox');
    statusEl.textContent = guessedTitle
      ? `Seite konnte nicht ausgelesen werden — Titel „${guessedTitle}" wurde aus dem Link geraten, Rest bitte manuell ergänzen.`
      : 'Konnte die Seite nicht automatisch auslesen. Bitte die Felder unten manuell ausfüllen oder unten "manuell eintragen" nutzen.';
  } finally {
    document.getElementById('scrapeBtn').disabled = false;
  }
}

function updateCharCount(){
  const val = document.getElementById('previewDesc').value;
  document.getElementById('charCount').textContent = val.length;
}

async function saveScrapedItem(){
  const title = document.getElementById('previewTitle').value.trim();
  if (!title){ document.getElementById('scrapeStatus').textContent = 'Bitte einen Titel eintragen.'; return; }
  await db.addItem({
    title,
    price: document.getElementById('previewPrice').value.trim(),
    description: document.getElementById('previewDesc').value.trim().slice(0,150),
    image: lastScraped ? lastScraped.image : '',
    url: lastScraped ? lastScraped.url : document.getElementById('scrapeUrlInput').value.trim()
  });
  document.getElementById('scrapeUrlInput').value = '';
  hide('previewBox');
  document.getElementById('scrapeStatus').textContent = 'Wunsch gespeichert.';
  await renderAdmin();
  await renderItems(true);
}

async function addManualItem(){
  const title = document.getElementById('manualTitle').value.trim();
  if (!title) return;
  await db.addItem({
    title,
    price: document.getElementById('manualPrice').value.trim(),
    url: document.getElementById('manualUrl').value.trim(),
    description: document.getElementById('manualDesc').value.trim().slice(0,150),
    image: ''
  });
  ['manualTitle','manualPrice','manualUrl','manualDesc'].forEach(id=>document.getElementById(id).value='');
  await renderAdmin();
  await renderItems(true);
}

async function removeItem(id){ await db.deleteItem(id); await renderAdmin(); await renderItems(true); }

/* Admin-Login */
async function toggleAdminSession(){
  if (isAdmin && auth && auth.currentUser){
    await auth.signOut();
    isAdmin = false;
    init();
    return;
  }

  openAdminModal();
}

function openAdminModal(){
  show('adminModal');
  document.getElementById('adminEmailInput').value='';
  document.getElementById('adminPassInput').value='';
  hide('adminErr');
  document.getElementById('adminEmailInput').focus();
}

function closeAdminModal(){ hide('adminModal'); }

async function tryAdminLogin(){
  if (!auth){
    document.getElementById('adminErr').textContent = 'Firebase ist noch nicht verfügbar. Bitte zuerst den GitHub-Workflow ausführen, damit firebase-config.js erzeugt wird.';
    show('adminErr');
    return;
  }

  const email = document.getElementById('adminEmailInput').value.trim();
  const password = document.getElementById('adminPassInput').value;

  if (!email || !password){
    document.getElementById('adminErr').textContent = 'Bitte E-Mail und Passwort eingeben.';
    show('adminErr');
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeAdminModal();
    init();
  } catch (error) {
    document.getElementById('adminErr').textContent = error.message || 'Login fehlgeschlagen.';
    show('adminErr');
  }
}

function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
function escapeAttr(s){ return (s||'').replace(/"/g,'&quot;'); }

if (typeof document !== 'undefined') {
  init();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolveFirebaseConfig, shouldUseDemoMode, normalizeRequestData };
}
