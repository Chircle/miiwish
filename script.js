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
    appId: "",
    adminUids: ""
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

function normalizeItemInput(data = {}){
  return {
    title: String(data.title || '').trim(),
    price: String(data.price || '').trim(),
    url: String(data.url || '').trim(),
    description: String(data.description || '').trim().slice(0,150),
    image: String(data.image || '').trim()
  };
}

function getRequestStatusMessage(status){
  if (status === 'pending') {
    return 'Du hast bereits eine Anfrage gestellt. Bitte warte auf die Freigabe.';
  }

  if (status === 'approved') {
    return 'Dein Zugriff wurde freigegeben. Du kannst deine Wunschliste jetzt sehen.';
  }

  if (status === 'declined') {
    return 'Dein Zugang wurde nicht freigegeben.';
  }

  return '';
}

/* Admin-UIDs kommen aus firebase-config.js (per GitHub Secret
   FIREBASE_ADMIN_UIDS generiert, kommasepariert), nicht mehr hart im
   Code. WICHTIG: Die gleiche(n) UID(s) müssen zusätzlich manuell in
   isAdmin() in firestore.rules eingetragen werden — die Rules-Datei
   wird aktuell nicht automatisiert deployt, das Secret hier betrifft
   nur den Client-Code (steuert lediglich, ob die Admin-Oberfläche
   angezeigt wird — die eigentliche Zugriffskontrolle passiert immer
   serverseitig über die Firestore Rules). */
function resolveAdminUids(config){
  return String(config.adminUids || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const ADMIN_UIDS = resolveAdminUids(firebaseConfig);

function isAdminUser(user){
  return !!(user && ADMIN_UIDS.includes(user.uid));
}

/* "Schatz"-Sonderrolle: darf bereits reservierte Wünsche anderer an
   sich reißen. Rein für Spaß auf einer privaten Familien-Wunschliste
   gedacht — bewusst per fester E-Mail und nicht konfigurierbar. */
const SUPERUSER_EMAIL = 'schatz@schatz.de';

function isSuperuserUser(user){
  return !!(user && user.email && user.email.toLowerCase() === SUPERUSER_EMAIL);
}

/* Übersetzt Firebase-Auth-Fehlercodes in verständliche Meldungen.
   Bei Login-Fehlern wird bewusst NICHT unterschieden, ob die E-Mail
   überhaupt existiert (verhindert, dass man durch Ausprobieren
   herausfinden kann, welche Adressen registriert sind). */
function mapAuthError(error){
  const code = error && error.code;
  switch (code){
    case 'auth/email-already-in-use':
      return 'Für diese E-Mail existiert bereits ein Account. Bitte stattdessen einloggen.';
    case 'auth/invalid-email':
      return 'Bitte eine gültige E-Mail-Adresse eingeben.';
    case 'auth/weak-password':
      return 'Das Passwort ist zu schwach (mindestens 6 Zeichen).';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-Mail oder Passwort ist falsch.';
    case 'auth/too-many-requests':
      return 'Zu viele Versuche. Bitte warte kurz und versuche es erneut.';
    default:
      return 'Das hat leider nicht geklappt. Bitte versuche es erneut.';
  }
}

function setRequestFeedback(message, isError = true){
  const errEl = document && document.getElementById ? document.getElementById('requestErr') : null;
  if (!errEl) return;

  if (!message) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
    return;
  }

  errEl.textContent = message;
  errEl.classList.remove('hidden');
  if (isError) {
    errEl.classList.add('err');
  } else {
    errEl.classList.remove('err');
  }
}

function buildImageFallbackMarkup(color = '#C9D6EE'){ 
  return `<div class="image-fallback" style="background:${color}">kein Bild</div>`;
}

function buildImageFallbackElement(color = '#C9D6EE'){ 
  const el = document.createElement('div');
  el.className = 'image-fallback';
  el.style.background = color;
  el.textContent = 'kein Bild';
  return el;
}

function seedDemoIfNeeded(){
  if (localStorage.getItem('wl_items') === null) localStorage.setItem('wl_items', JSON.stringify(DEMO_ITEMS));
  if (localStorage.getItem('wl_requests') === null) localStorage.setItem('wl_requests', JSON.stringify(DEMO_REQUESTS));
}

/* Demo-Modus hat kein echtes Firebase Auth — simuliert Accounts lokal
   in localStorage, damit sich der Login/Registrieren-Flow auch ohne
   Firebase-Konfiguration testen lässt. */
let demoCurrentUser = null;
function loadDemoSession(){
  const raw = localStorage.getItem('wl_demo_session');
  demoCurrentUser = raw ? JSON.parse(raw) : null;
}
function saveDemoSession(user){
  demoCurrentUser = user;
  if (user) localStorage.setItem('wl_demo_session', JSON.stringify(user));
  else localStorage.removeItem('wl_demo_session');
}

function getCurrentUser(){
  if (DEMO_MODE) return demoCurrentUser;
  return auth && auth.currentUser ? auth.currentUser : null;
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
    const normalized = normalizeItemInput(item);
    normalized.color = PALETTE[Math.floor(Math.random()*PALETTE.length)];
    normalized.reserved = false;
    normalized.reservedBy = null;
    // Kein Bild gefunden -> Feld bewusst leer lassen. Das Grid zeigt dann
    // die Pastellfarben-Kachel mit "kein Bild" statt eines Fake-Fotos.
    if (DEMO_MODE){
      const items = JSON.parse(localStorage.getItem('wl_items') || '[]');
      normalized.id = 'i'+Date.now();
      items.push(normalized);
      localStorage.setItem('wl_items', JSON.stringify(items));
      return;
    }
    await firestoreDb.collection('items').add({...normalized, ts: Date.now()});
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
  async updateItem(id, fields){
    if (DEMO_MODE){
      let items = JSON.parse(localStorage.getItem('wl_items') || '[]');
      items = items.map(i=> i.id===id ? {...i, ...fields} : i);
      localStorage.setItem('wl_items', JSON.stringify(items));
      return;
    }
    // Voller Feld-Update, nur für Admin erlaubt (siehe Firestore Rules).
    await firestoreDb.collection('items').doc(id).update(fields);
  },
  async toggleReserved(id, reserved){
    if (DEMO_MODE){
      let items = JSON.parse(localStorage.getItem('wl_items') || '[]');
      const user = getCurrentUser();
      items = items.map(i=> i.id===id ? {...i, reserved, reservedBy: reserved ? (user ? user.uid : null) : null} : i);
      localStorage.setItem('wl_items', JSON.stringify(items));
      return;
    }
    const user = auth && auth.currentUser ? auth.currentUser : null;
    const reservedBy = reserved ? (user ? user.uid : null) : null;
    if (reserved && !reservedBy) {
      throw new Error('Nicht eingeloggt.');
    }
    await firestoreDb.collection('items').doc(id).update({reserved, reservedBy});
  },
  async stealItem(id, item){
    const user = getCurrentUser();
    if (!user) throw new Error('Nicht eingeloggt.');
    const previousUid = item.reservedBy;

    if (DEMO_MODE){
      let items = JSON.parse(localStorage.getItem('wl_items') || '[]');
      items = items.map(i => i.id===id ? {...i, reserved:true, reservedBy:user.uid} : i);
      localStorage.setItem('wl_items', JSON.stringify(items));
      if (previousUid && previousUid !== user.uid){
        const notifs = JSON.parse(localStorage.getItem('wl_notifications') || '[]');
        notifs.push({
          id: 'n'+Date.now(),
          toUid: previousUid,
          message: `Jemand mit besonderen Rechten hat dir „${item.title}" weggenommen — tut mir leid! Wähl dir gern etwas anderes aus.`,
          ts: Date.now()
        });
        localStorage.setItem('wl_notifications', JSON.stringify(notifs));
      }
      return;
    }

    await firestoreDb.collection('items').doc(id).update({ reserved: true, reservedBy: user.uid });
    if (previousUid && previousUid !== user.uid){
      await firestoreDb.collection('notifications').add({
        toUid: previousUid,
        message: `Jemand mit besonderen Rechten hat dir „${item.title}" weggenommen — tut mir leid! Wähl dir gern etwas anderes aus.`,
        ts: Date.now()
      });
    }
  },
  async getNotifications(uid){
    if (DEMO_MODE){
      const notifs = JSON.parse(localStorage.getItem('wl_notifications') || '[]');
      return notifs.filter(n => n.toUid === uid);
    }
    const snap = await firestoreDb.collection('notifications').where('toUid','==',uid).get();
    return snap.docs.map(d => ({id:d.id, ...d.data()}));
  },
  async dismissNotification(id){
    if (DEMO_MODE){
      let notifs = JSON.parse(localStorage.getItem('wl_notifications') || '[]');
      notifs = notifs.filter(n => n.id !== id);
      localStorage.setItem('wl_notifications', JSON.stringify(notifs));
      return;
    }
    await firestoreDb.collection('notifications').doc(id).delete();
  },
  async getRequests(){
    if (DEMO_MODE) return JSON.parse(localStorage.getItem('wl_requests') || '[]');
    const snap = await firestoreDb.collection('requests').orderBy('ts','asc').get();
    return snap.docs.map(d=>({id:d.id, ...d.data()}));
  },
  async addRequest(id, data){
    const request = normalizeRequestData(data);
    const payload = { ...request, uid: id, status: 'pending', ts: Date.now() };

    if (DEMO_MODE){
      const reqs = JSON.parse(localStorage.getItem('wl_requests') || '[]');
      const idx = reqs.findIndex(r => r.id === id);
      if (idx >= 0) reqs[idx] = { id, ...payload };
      else reqs.push({ id, ...payload });
      localStorage.setItem('wl_requests', JSON.stringify(reqs));
      return id;
    }

    await firestoreDb.collection('requests').doc(id).set(payload);
    return id;
  },
  async resubmitRequest(id){
    if (DEMO_MODE){
      let reqs = JSON.parse(localStorage.getItem('wl_requests') || '[]');
      reqs = reqs.map(r => r.id===id ? {...r, status:'pending', ts:Date.now()} : r);
      localStorage.setItem('wl_requests', JSON.stringify(reqs));
      return;
    }
    await firestoreDb.collection('requests').doc(id).set({ status: 'pending', ts: Date.now() }, { merge: true });
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
  async getRequestData(id){
    if (DEMO_MODE){
      const reqs = JSON.parse(localStorage.getItem('wl_requests') || '[]');
      return reqs.find(r=>r.id===id) || null;
    }
    const doc = await firestoreDb.collection('requests').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
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

/* Fallback-Quelle für Vorschaubilder: Microlink rendert die Zielseite
   serverseitig mit einem echten Browser und liefert Titel/Bild/
   Beschreibung als JSON zurück. Das umgeht viele Bot-Sperren (u.a. bei
   Amazon), die die direkten CORS-Proxys oben nicht schaffen.
   Kostenloses Kontingent ohne API-Key reicht für eine private
   Wunschliste locker aus; bei Bedarf kann man &apiKey=... anhängen
   (siehe microlink.io/docs) für ein höheres Limit. */
async function fetchMicrolinkPreview(url){
  const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(url)}&palette=false`;
  const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Microlink HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.status !== 'success' || !json.data) throw new Error('Microlink: keine Daten erhalten');
  const d = json.data;
  return {
    title: d.title || '',
    // Bewusst NUR d.image, nicht d.logo: wenn der Zielshop den Request
    // blockt (z.B. Amazon-Bot-Schutz), liefert Microlink oft nur das
    // Logo der Block-/Security-Seite (z.B. Akamai) als "logo" zurück —
    // das ist kein Produktbild und würde nur verwirren.
    image: (d.image && d.image.url) || '',
    description: d.description || ''
  };
}

/* Sortiert Bilder aus, die typischerweise KEIN Produktfoto sind, sondern
   ein Website-/Sicherheits-Logo — z.B. wenn statt der echten Shop-Seite
   eine Bot-Block-Seite (Akamai, Cloudflare o.ä.) ausgelesen wurde.
   Heuristik: SVGs sind auf Shop-Seiten praktisch nie das Produktfoto,
   und "logo" im Dateinamen/Pfad ist ein starkes Signal. */
function isLikelyLogoOrPlaceholder(url){
  if (!url) return true;
  const lower = url.toLowerCase();
  if (lower.includes('.svg')) return true;
  if (/logo/.test(lower)) return true;
  return false;
}

function sanitizeScrapedImage(url){
  return isLikelyLogoOrPlaceholder(url) ? '' : url;
}

async function scrapeUrl(url){
  let title = '', image = '', description = '', price = '', titleFromUrl = false;

  try {
    const html = await fetchPageHtml(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    title = getMeta(doc, ['meta[property="og:title"]','meta[name="twitter:title"]','meta[name="title"]','title']);
    image = getMeta(doc, ['meta[property="og:image"]','meta[name="twitter:image"]']);
    if (!image) image = findFirstImage(doc, url);
    if (image) image = sanitizeScrapedImage(normalizeImageUrl(image, url));
    description = getMeta(doc, ['meta[property="og:description"]','meta[name="description"]']).slice(0,150);
    price = getMeta(doc, ['meta[property="product:price:amount"]','meta[property="og:price:amount"]','meta[itemprop="price"]']);
    if (!price) price = findPriceFromJsonLd(doc);
  } catch (error) {
    // Direktes Auslesen (auch über die CORS-Proxys) ist fehlgeschlagen,
    // z.B. weil der Shop Bots/Proxys aktiv blockt (typisch bei Amazon).
    // Der Microlink-Fallback unten übernimmt in dem Fall komplett.
  }

  // Fehlt noch Titel oder Bild, zusätzlich über Microlink versuchen.
  if (!title || !image) {
    try {
      const preview = await fetchMicrolinkPreview(url);
      if (!title && preview.title) title = preview.title;
      if (!image && preview.image) image = sanitizeScrapedImage(normalizeImageUrl(preview.image, url));
      if (!description && preview.description) description = preview.description.slice(0,150);
    } catch (error) {
      // Beide Wege fehlgeschlagen -> unten greift der URL-Titel-Fallback,
      // Bild/Beschreibung/Preis bleiben leer und werden im Admin-Panel
      // als "manuell ergänzen" markiert.
    }
  }

  if (!title) {
    title = deriveTitleFromUrl(url);
    titleFromUrl = !!title;
  }

  return { title: title || url, image, description, price, url, titleFromUrl };
}

/* ============================================================
   App-Zustand & Ansichten
   ============================================================ */
let isAdmin = false;
let lastScraped = null;
let statusPollTimer = null;
let adminPollTimer = null;

function show(id){ document.getElementById(id).classList.remove('hidden'); }
function hide(id){ document.getElementById(id).classList.add('hidden'); }
function scrollToSection(sectionId, event){
  event.preventDefault();
  const el = document.getElementById(sectionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}
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
    if (!getCurrentUser()) {
      stopStatusPolling();
      return;
    }
    await checkStatus();
  }, 5000);
}

function stopAdminPolling(){
  if (adminPollTimer) {
    clearInterval(adminPollTimer);
    adminPollTimer = null;
  }
}

function startAdminPolling(){
  stopAdminPolling();
  adminPollTimer = setInterval(async () => {
    if (!isAdmin) {
      stopAdminPolling();
      return;
    }
    await renderAdmin();
  }, 3000);
}

/* Welche Items gehören aktuell (laut Firestore, nicht laut lokalem
   Zwischenspeicher) zum eingeloggten Nutzer. So bleibt die Anzeige
   auch dann korrekt, wenn ein Item z.B. per stealItem() den Besitzer
   gewechselt hat. */
function getMyReservedIds(items){
  const user = getCurrentUser();
  if (!user) return [];
  return items.filter(i => i.reservedBy === user.uid).map(i => i.id);
}

/* Zeigt "Angemeldet als …" oben im Header. text=null blendet sie aus. */
function setIdentityBar(text, options = {}){
  const el = document.getElementById('identityBar');
  if (!el) return;
  if (!text) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  let html = escapeHtml(text);
  if (options.resetAction) {
    html += ` · <a href="#" onclick="${options.resetAction}; return false;">${escapeHtml(options.resetLabel || 'Abmelden')}</a>`;
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
}

async function logoutUser(){
  stopStatusPolling();
  stopAdminPolling();
  stopNotificationPolling();
  if (DEMO_MODE) {
    saveDemoSession(null);
    isAdmin = false;
    document.getElementById('adminToggleBtn').textContent = 'Admin';
    setIdentityBar(null);
    hideAllGates();
    show('gateRequest');
    setAuthMode('login');
    return;
  }
  if (auth) await auth.signOut();
  // onAuthStateChanged übernimmt danach den Rest.
}

function applyAdminState(user){
  isAdmin = isAdminUser(user);
  document.getElementById('adminToggleBtn').textContent = isAdmin ? 'Abmelden' : 'Admin';

  if (isAdmin) {
    setIdentityBar(`Angemeldet als ${user.email || 'Admin'}`);
    stopNotificationPolling();
    renderAdmin();
    startAdminPolling();
    hideAllGates();
    show('mainContent'); show('adminArea');
    renderItems(true);
    return;
  }

  stopAdminPolling();
  checkStatus(user);
}

async function init(){
  if (DEMO_MODE){ seedDemoIfNeeded(); loadDemoSession(); show('demoBanner'); }

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

  setAuthMode('login');

  if (DEMO_MODE){
    applyAdminState(demoCurrentUser);
    return;
  }

  if (auth && auth.onAuthStateChanged) {
    auth.onAuthStateChanged((user) => {
      applyAdminState(user);
    });
    return;
  }

  applyAdminState(auth ? auth.currentUser : null);
}

async function checkStatus(userParam){
  const user = userParam || getCurrentUser();
  if (!user){
    stopStatusPolling();
    setRequestFeedback('');
    setIdentityBar(null);
    hideAllGates();
    show('gateRequest');
    setAuthMode('login');
    return;
  }

  const reqData = await db.getRequestData(user.uid);
  hideAllGates();

  if (!reqData){
    // Eingeloggt, aber keine (mehr passende) Anfrage gefunden — Randfall.
    setIdentityBar(null);
    show('gateRequest');
    setAuthMode('login');
    return;
  }

  const label = reqData.name ? `${reqData.name} (${reqData.email || ''})` : (reqData.email || user.email || '');
  setIdentityBar(`Angemeldet als ${label}`, { resetAction: 'logoutUser()', resetLabel: 'Abmelden' });

  if (reqData.status === 'approved'){
    stopStatusPolling();
    setRequestFeedback('');
    show('mainContent');
    await renderItems(false);
    startNotificationPolling();
    return;
  }

  if (reqData.status === 'declined'){
    stopStatusPolling();
    setRequestFeedback(getRequestStatusMessage('declined'));
    show('gateDenied');
    return;
  }

  setRequestFeedback(getRequestStatusMessage('pending'));
  show('gateWaiting');
  startStatusPolling();
}

async function refreshAfterApprovalCheck(){
  const user = getCurrentUser();
  if (!user) return;

  const reqData = await db.getRequestData(user.uid);
  if (reqData && reqData.status === 'approved') {
    hideAllGates();
    show('mainContent');
    const label = reqData.name ? `${reqData.name} (${reqData.email || ''})` : (reqData.email || '');
    setIdentityBar(`Angemeldet als ${label}`, { resetAction: 'logoutUser()', resetLabel: 'Abmelden' });
    await renderItems(false);
    stopStatusPolling();
    startNotificationPolling();
  }
}

async function resubmitRequest(){
  const user = getCurrentUser();
  if (!user) return;
  await db.resubmitRequest(user.uid);
  await checkStatus();
}

/* Umschalten zwischen Einloggen / Registrieren / Passwort vergessen */
function setAuthMode(mode){
  hide('modeLogin'); hide('modeRegister'); hide('modeForgot');
  document.getElementById('modeLoginBtn').classList.toggle('secondary', mode !== 'login');
  document.getElementById('modeRegisterBtn').classList.toggle('secondary', mode !== 'register');
  if (mode === 'login') show('modeLogin');
  else if (mode === 'register') show('modeRegister');
  else if (mode === 'forgot') show('modeForgot');
  ['loginErr','requestErr','forgotMsg'].forEach(id => {
    const e = document.getElementById(id);
    if (e) { e.classList.add('hidden'); e.textContent = ''; }
  });
}

async function loginUser(){
  const email = document.getElementById('loginEmailInput').value.trim();
  const password = document.getElementById('loginPasswordInput').value;
  const errEl = document.getElementById('loginErr');
  errEl.classList.add('hidden'); errEl.textContent = '';

  if (!email || !password){
    errEl.textContent = 'Bitte E-Mail und Passwort eingeben.';
    errEl.classList.remove('hidden');
    return;
  }

  if (DEMO_MODE){
    const users = JSON.parse(localStorage.getItem('wl_demo_users') || '[]');
    const match = users.find(u => u.email === email.toLowerCase() && u.password === password);
    if (!match){
      errEl.textContent = 'E-Mail oder Passwort ist falsch.';
      errEl.classList.remove('hidden');
      return;
    }
    saveDemoSession({ uid: match.uid, email: match.email });
    await checkStatus();
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged übernimmt danach den Rest.
  } catch (error) {
    errEl.textContent = mapAuthError(error);
    errEl.classList.remove('hidden');
  }
}

async function sendPasswordReset(){
  const email = document.getElementById('forgotEmailInput').value.trim();
  const msgEl = document.getElementById('forgotMsg');
  msgEl.classList.remove('hidden');

  if (!email){
    msgEl.textContent = 'Bitte gib deine E-Mail ein.';
    return;
  }

  if (DEMO_MODE){
    msgEl.textContent = 'Im Demo-Modus (ohne Firebase) kann kein echter Reset-Link verschickt werden.';
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);
  } catch (error) {
    // Absichtlich keine Fehlerunterscheidung, damit man nicht ausprobieren
    // kann, welche E-Mail-Adressen registriert sind.
  }
  msgEl.textContent = 'Falls diese Adresse bei uns registriert ist, wurde eine E-Mail mit einem Link zum Zurücksetzen verschickt.';
}

async function submitRequest(){
  const name = document.getElementById('nameInput').value.trim();
  const email = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const passwordConfirm = document.getElementById('passwordConfirmInput').value;
  const reason = document.getElementById('reasonInput').value.trim();
  const errEl = document.getElementById('requestErr');
  errEl.classList.add('hidden'); errEl.textContent = '';

  if (!name || !email || !password){
    errEl.textContent = 'Bitte Name, E-Mail und Passwort ausfüllen.';
    errEl.classList.remove('hidden');
    return;
  }
  if (password.length < 6){
    errEl.textContent = 'Das Passwort muss mindestens 6 Zeichen haben.';
    errEl.classList.remove('hidden');
    return;
  }
  if (password !== passwordConfirm){
    errEl.textContent = 'Die Passwörter stimmen nicht überein.';
    errEl.classList.remove('hidden');
    return;
  }

  if (DEMO_MODE){
    const users = JSON.parse(localStorage.getItem('wl_demo_users') || '[]');
    if (users.some(u => u.email === email.toLowerCase())){
      errEl.textContent = 'Für diese E-Mail existiert im Demo-Modus bereits ein Account. Bitte einloggen.';
      errEl.classList.remove('hidden');
      return;
    }
    const uid = 'demo-' + Date.now();
    users.push({ uid, email: email.toLowerCase(), password, name });
    localStorage.setItem('wl_demo_users', JSON.stringify(users));
    await db.addRequest(uid, { name, email, reason });
    saveDemoSession({ uid, email: email.toLowerCase() });
    await checkStatus();
    return;
  }

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await db.addRequest(cred.user.uid, { name, email, reason });
    // onAuthStateChanged übernimmt danach den Rest.
  } catch (error) {
    errEl.textContent = mapAuthError(error);
    errEl.classList.remove('hidden');
  }
}

/* Items rendern */
async function renderItems(asAdmin){
  const items = await db.getItems();
  const grid = document.getElementById('itemsGrid');
  grid.innerHTML = '';

  const currentUser = getCurrentUser();
  const isSuperuser = !asAdmin && isSuperuserUser(currentUser);
  const myReserved = getMyReservedIds(items);

  // Show reservation counter for users
  if (!asAdmin) {
    const counter = document.createElement('div');
    counter.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 20px 0; font-size: 14px; color: var(--ink-soft); border-bottom: 1px solid rgba(91,71,99,.12); margin-bottom: 10px;';
    counter.textContent = `Du hast ${myReserved.length} von 3 Artikeln ausgewählt`;
    grid.appendChild(counter);
  }

  items.forEach(item=>{
    const finalImage = item.image || '';
    const color = item.color || '#C9D6EE';
    const el = document.createElement('div');
    el.className = 'item' + (!asAdmin && item.reserved ? ' is-reserved' : '');
    const isMine = myReserved.includes(item.id);
    let actionButton = '';
    if (!asAdmin) {
      if (!item.reserved) {
        actionButton = `<button class="btn small" onclick="reserve('${item.id}', true)">Reservieren</button>`;
      } else if (isMine) {
        actionButton = `<button class="btn small secondary" onclick="reserve('${item.id}', false)">Freigeben</button>`;
      } else if (isSuperuser) {
        actionButton = `<button class="btn small steal-btn" onclick="stealItemAction('${item.id}')">🎁 Stibitzen</button>`;
      }
      // Sonst (von jemand anderem reserviert, kein Superuser): kein
      // Button, nur die "reserviert"-Markierung.
    }
    el.innerHTML = `
      ${!asAdmin && item.reserved ? '<div class="reserved-tag">reserviert</div>' : ''}
      ${finalImage
        ? `<img class="thumb" src="${escapeAttr(finalImage)}" alt="" onerror="this.replaceWith(fallbackThumb('${escapeAttr(color)}'))">`
        : fallbackThumbHtml(color)}
      <div class="body">
        <h3>${escapeHtml(item.title)}</h3>
        ${item.price ? `<div class="price">${escapeHtml(item.price)}</div>` : ''}
        ${item.description ? `<div class="desc">${escapeHtml(item.description)}</div>` : ''}
        <div class="row">
          ${item.url ? `<a class="link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Zum Produkt</a>` : '<span></span>'}
          ${actionButton}
        </div>
      </div>
    `;
    if (!asAdmin){
      el.addEventListener('mouseenter', ()=>spawnPetals(el));
    }
    grid.appendChild(el);
  });
  if (!items.length) grid.innerHTML = '<p class="empty-note">Noch keine Wünsche eingetragen.</p>';

  if (!asAdmin) {
    await checkNotifications();
  }
}
function fallbackThumbHtml(color){
  return buildImageFallbackMarkup(color);
}
function fallbackThumb(color){
  return buildImageFallbackElement(color);
}
function showImageFallback(elementId, color = '#D7C6E3'){
  const imgEl = document.getElementById(elementId);
  const fallbackEl = document.getElementById(elementId + 'Fallback');
  if (!imgEl || !fallbackEl) return;
  imgEl.style.display = 'none';
  fallbackEl.style.background = color;
  fallbackEl.textContent = 'kein Bild';
  fallbackEl.classList.remove('hidden');
}
function clearImageFallback(elementId){
  const imgEl = document.getElementById(elementId);
  const fallbackEl = document.getElementById(elementId + 'Fallback');
  if (!imgEl || !fallbackEl) return;
  fallbackEl.classList.add('hidden');
  imgEl.style.display = 'block';
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
  if (!newState) {
    // User is unreserving - just do it
    await db.toggleReserved(id, false);
    await renderItems(false);
    return;
  }

  // User wants to reserve (newState = true)
  const items = await db.getItems();
  const myReserved = getMyReservedIds(items);
  if (myReserved.length >= 3) {
    // Already have 3, need to pick one to replace
    const reserved = items.filter(i => myReserved.includes(i.id));

    let swapId = prompt(
      'Du kannst maximal 3 Artikel auswählen. Welchen möchtest du ersetzen?\n\n' +
      reserved.map((i, idx) => `${idx + 1}. ${i.title}`).join('\n') +
      '\n\n(Gib 1, 2 oder 3 ein, oder drücke Escape zum Abbrechen)'
    );

    if (!swapId) return;
    swapId = parseInt(swapId);
    if (swapId < 1 || swapId > 3 || isNaN(swapId)) {
      alert('Ungültige Eingabe.');
      return;
    }

    const oldId = reserved[swapId - 1].id;
    await db.toggleReserved(oldId, false);
  }

  await db.toggleReserved(id, true);
  await renderItems(false);
}

/* "Schatz"-Sonderfunktion: reißt ein bereits von jemand anderem
   reserviertes Item an sich und benachrichtigt die vorherige Person
   per In-App-Banner. Zählt genauso gegen das 3er-Limit wie eine
   normale Reservierung. */
async function stealItemAction(id){
  const items = await db.getItems();
  const item = items.find(i => i.id === id);
  if (!item || !item.reserved) { await renderItems(false); return; }

  const myReserved = getMyReservedIds(items);
  if (myReserved.length >= 3) {
    const mine = items.filter(i => myReserved.includes(i.id));
    let swapId = prompt(
      'Du hast schon 3 Artikel ausgewählt. Welchen möchtest du dafür freigeben?\n\n' +
      mine.map((i, idx) => `${idx + 1}. ${i.title}`).join('\n') +
      '\n\n(Zahl eingeben oder Escape zum Abbrechen)'
    );
    if (!swapId) return;
    swapId = parseInt(swapId);
    if (swapId < 1 || swapId > mine.length || isNaN(swapId)) {
      alert('Ungültige Eingabe.');
      return;
    }
    await db.toggleReserved(mine[swapId - 1].id, false);
  }

  await db.stealItem(id, item);
  await renderItems(false);
}

/* Benachrichtigungs-Banner: zeigt "dir wurde ein Wunsch weggenommen"-
   Meldungen für den eingeloggten Nutzer. */
let notificationPollTimer = null;

async function checkNotifications(){
  const user = getCurrentUser();
  const el = document.getElementById('notificationBanner');
  if (!el) return;
  if (!user) { el.classList.add('hidden'); el.innerHTML = ''; return; }

  const notifs = await db.getNotifications(user.uid);
  if (!notifs.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }

  el.innerHTML = notifs.map(n => `
    <div class="notification-item">
      <span>${escapeHtml(n.message)}</span>
      <button class="btn small secondary" onclick="dismissNotification('${n.id}')">Ok, schade 💔</button>
    </div>
  `).join('');
  el.classList.remove('hidden');
}

async function dismissNotification(id){
  await db.dismissNotification(id);
  await checkNotifications();
}

function startNotificationPolling(){
  stopNotificationPolling();
  notificationPollTimer = setInterval(checkNotifications, 8000);
}

function stopNotificationPolling(){
  if (notificationPollTimer) {
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
}

/* Admin */
/* Erkennung möglicher Umgehungsversuche: gleicher Name oder gleicher
   E-Mail-Local-Part (Teil vor dem @) wie bei einer bereits ABGELEHNTEN
   Anfrage, aber mit anderer Domain/TLD (z.B. "oma@gmail.com" vs.
   "oma@gmail.de"). Blockiert nichts automatisch, warnt den Admin nur. */
function emailLocalPart(email){
  const normalized = String(email || '').trim().toLowerCase();
  const at = normalized.indexOf('@');
  return at > 0 ? normalized.slice(0, at) : normalized;
}

function normalizeNameForCompare(name){
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findSimilarDeclinedRequest(candidate, allRequests){
  const candName = normalizeNameForCompare(candidate.name);
  const candLocal = emailLocalPart(candidate.email);
  const candEmail = String(candidate.email || '').trim().toLowerCase();

  return allRequests.find(other => {
    if (other.id === candidate.id) return false;
    if (other.status !== 'declined') return false;
    const otherEmail = String(other.email || '').trim().toLowerCase();
    if (otherEmail === candEmail) return false; // exakt gleiche Mail -> kein neuer Fall, sondern Resubmit
    const sameName = candName && normalizeNameForCompare(other.name) === candName;
    const sameLocalPart = candLocal && emailLocalPart(other.email) === candLocal;
    return sameName || sameLocalPart;
  });
}

async function renderAdmin(){
  const reqs = await db.getRequests();
  const list = document.getElementById('requestsList');
  const pending = reqs.filter(r=>r.status==='pending');
  list.innerHTML = pending.length ? '' : '<div class="empty-note">Keine offenen Anfragen.</div>';
  pending.forEach(r=>{
    const row = document.createElement('div');
    row.className='request-row';
    const similar = findSimilarDeclinedRequest(r, reqs);
    const warningMarkup = similar
      ? `<div style="font-size:12px;color:#A24A63;margin-top:4px;">⚠️ Ähnlich zu einer bereits abgelehnten Anfrage: <strong>${escapeHtml(similar.name)}</strong>${similar.email ? ` (${escapeHtml(similar.email)})` : ''}</div>`
      : '';
    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(r.name)}</strong></div>
        ${r.email ? `<div style="font-size:12px;color:var(--ink-soft);">${escapeHtml(r.email)}</div>` : ''}
        ${r.reason ? `<div style="font-size:12px;color:var(--ink-soft);">${escapeHtml(r.reason)}</div>` : ''}
        ${warningMarkup}
      </div>
      <span class="actions">
        <button class="btn small" onclick="respondRequest('${r.id}','approved')">Freigeben</button>
        <button class="btn small secondary" onclick="respondRequest('${r.id}','declined')">Ablehnen</button>
      </span>`;
    list.appendChild(row);
  });

  const items = await db.getItems();
  adminItemsCache = items;
  const itemsList = document.getElementById('adminItemsList');
  itemsList.innerHTML = items.length ? '' : '<div class="empty-note">Noch keine Wünsche.</div>';
  items.forEach(item=>{
    const row = document.createElement('div');
    row.className='item-admin-row';
    const color = item.color || '#C9D6EE';
    const imageMarkup = item.image
      ? `<img src="${escapeAttr(item.image)}" alt="" onerror="this.replaceWith(fallbackThumb('${escapeAttr(color)}'))">`
      : fallbackThumbHtml(color);
    row.innerHTML = `
      <div class="meta-mini">
        ${imageMarkup}
        <div>
          <div>${escapeHtml(item.title)}</div>
          <div style="font-size:12px;color:var(--ink-soft);">${escapeHtml(item.price||'')}</div>
        </div>
      </div>
      <span class="actions">
        <button class="btn small secondary" onclick="openEditModal('${item.id}')">Bearbeiten</button>
        <button class="btn small secondary" onclick="removeItem('${item.id}')">Entfernen</button>
      </span>
    `;
    itemsList.appendChild(row);
  });
}

async function respondRequest(id, status){
  await db.setRequestStatus(id, status);
  if (status === 'approved') {
    const current = getCurrentUser();
    if (current && current.uid === id) {
      await refreshAfterApprovalCheck();
    }
  }
  await renderAdmin();
}

/* Rendert das Vorschaubild (oder die Pastell-"kein Bild"-Kachel) für
   eine gegebene URL. Wird sowohl beim automatischen Scrape als auch
   bei manueller Eingabe im Bild-URL-Feld benutzt. */
function applyPreviewImage(url, imgId = 'previewImg', fallbackId = 'previewImgFallback'){
  const previewColor = PALETTE[Math.floor(Math.random()*PALETTE.length)];
  const previewImgEl = document.getElementById(imgId);
  const previewFallbackEl = document.getElementById(fallbackId);
  if (!previewImgEl) return;
  previewImgEl.onerror = null;
  if (previewFallbackEl) previewFallbackEl.classList.add('hidden');
  if (url) {
    previewImgEl.style.display = 'block';
    previewImgEl.src = url;
    previewImgEl.onerror = () => {
      previewImgEl.style.display = 'none';
      if (previewFallbackEl) {
        previewFallbackEl.style.background = previewColor;
        previewFallbackEl.textContent = 'kein Bild';
        previewFallbackEl.classList.remove('hidden');
      }
    };
  } else {
    previewImgEl.style.display = 'none';
    if (previewFallbackEl) {
      previewFallbackEl.style.background = previewColor;
      previewFallbackEl.textContent = 'kein Bild';
      previewFallbackEl.classList.remove('hidden');
    }
  }
}

/* Wird aufgerufen, wenn der Admin die Bild-URL im "manuell eintragen"-
   Feld einträgt oder ändert — dieses eine Feld wird jetzt sowohl für
   die Scrape-Vorschau als auch für den rein manuellen Eintrag benutzt. */
function updatePreviewImageFromInput(){
  const url = document.getElementById('manualImage').value.trim();
  applyPreviewImage(url);
}

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
    document.getElementById('manualImage').value = data.image || '';
    applyPreviewImage(data.image || '');
    if (document.getElementById('manualDetails')) document.getElementById('manualDetails').open = true;
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
    document.getElementById('manualImage').value = '';
    applyPreviewImage('');
    if (document.getElementById('manualDetails')) document.getElementById('manualDetails').open = true;
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
    image: document.getElementById('manualImage').value.trim(),
    url: lastScraped ? lastScraped.url : document.getElementById('scrapeUrlInput').value.trim()
  });
  document.getElementById('scrapeUrlInput').value = '';
  document.getElementById('manualImage').value = '';
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
    image: document.getElementById('manualImage').value.trim()
  });
  ['manualTitle','manualPrice','manualUrl','manualImage','manualDesc'].forEach(id=>document.getElementById(id).value='');
  await renderAdmin();
  await renderItems(true);
}

async function removeItem(id){ await db.deleteItem(id); await renderAdmin(); await renderItems(true); }

/* Bearbeiten bestehender Wünsche */
let adminItemsCache = [];
let editingItemId = null;

function openEditModal(id){
  const item = adminItemsCache.find(i => i.id === id);
  if (!item) return;
  editingItemId = id;
  document.getElementById('editTitle').value = item.title || '';
  document.getElementById('editPrice').value = item.price || '';
  document.getElementById('editUrl').value = item.url || '';
  document.getElementById('editImageUrl').value = item.image || '';
  document.getElementById('editDesc').value = item.description || '';
  updateEditCharCount();
  applyPreviewImage(item.image || '', 'editImg', 'editImgFallback');
  const err = document.getElementById('editErr');
  err.classList.add('hidden');
  err.textContent = '';
  document.getElementById('editItemModal').classList.remove('hidden');
}

function closeEditModal(){
  editingItemId = null;
  document.getElementById('editItemModal').classList.add('hidden');
}

function updateEditImagePreview(){
  const url = document.getElementById('editImageUrl').value.trim();
  applyPreviewImage(url, 'editImg', 'editImgFallback');
}

function updateEditCharCount(){
  const val = document.getElementById('editDesc').value;
  document.getElementById('editCharCount').textContent = val.length;
}

async function saveEditedItem(){
  if (!editingItemId) return;
  const title = document.getElementById('editTitle').value.trim();
  if (!title){
    const err = document.getElementById('editErr');
    err.textContent = 'Bitte einen Titel eintragen.';
    err.classList.remove('hidden');
    return;
  }
  await db.updateItem(editingItemId, {
    title,
    price: document.getElementById('editPrice').value.trim(),
    url: document.getElementById('editUrl').value.trim(),
    image: document.getElementById('editImageUrl').value.trim(),
    description: document.getElementById('editDesc').value.trim().slice(0,150)
  });
  closeEditModal();
  await renderAdmin();
  await renderItems(true);
}

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
  module.exports = {
    resolveFirebaseConfig,
    shouldUseDemoMode,
    normalizeRequestData,
    normalizeItemInput,
    getRequestStatusMessage,
    resolveAdminUids,
    buildImageFallbackMarkup
  };
}