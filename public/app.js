const API = '/api/ducks';
const DUCK_URL = 'https://static.vecteezy.com/system/resources/previews/046/497/888/original/plastic-rubber-duck-isolated-on-transparent-background-free-png.png';

// ── Map setup ──
const isMobile = window.matchMedia('(max-width: 768px)').matches;
const map = L.map('map', { zoomControl: true }).setView([39.5, -98.35], isMobile ? 3 : 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 18
}).addTo(map);

const duckIcon = L.divIcon({
  className: '',
  html: `<img src="${DUCK_URL}" alt="duck" style="width:44px;height:44px;object-fit:contain;display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.4));" />`,
  iconSize: [44, 44],
  iconAnchor: [22, 36],
  popupAnchor: [0, -38]
});

const clusterGroup = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 60,
  iconCreateFunction(cluster) {
    const count = cluster.getChildCount();
    const size = count < 10 ? 34 : count < 100 ? 40 : 46;
    return L.divIcon({
      html: `<div class="duck-cluster-num">${count}</div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }
});
map.addLayer(clusterGroup);

// ── State ──
let ducks = [];
let adminKey = null;
const markers = new Map();

// ── DOM refs ──
const modal = document.getElementById('modal-overlay');
const form = document.getElementById('duck-form');
const duckList = document.getElementById('duck-list');
const geocodeStatus = document.getElementById('geocode-status');
const submitBtn = document.getElementById('submit-btn');
const logBtn = document.getElementById('log-btn');

const emptyState = document.getElementById('empty-state');
const duckCount = document.getElementById('duck-count');

// Admin DOM refs
const adminToggle = document.getElementById('admin-toggle');
const adminForm = document.getElementById('admin-form');
const adminKeyInput = document.getElementById('admin-key-input');
const adminSubmit = document.getElementById('admin-submit');
const adminStatus = document.getElementById('admin-status');
const adminActiveBar = document.getElementById('admin-active-bar');
const adminLock = document.getElementById('admin-lock');

// ── Geocoding ──
async function geocode(city) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (!data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    display: data[0].display_name.split(',').slice(0, 2).join(',')
  };
}

// ── Duck rendering ──
function addDuck(duck, flyTo = false) {
  if (markers.has(duck.id)) return;

  const li = document.createElement('li');
  li.className = 'duck-item';
  li.dataset.duckId = duck.id;
  li.innerHTML = `
    <div class="duck-item-body">
      <div class="duck-item-name">
        <img class="list-duck" src="${DUCK_URL}" alt="" />
        ${esc(duck.finderName)}
      </div>
      <div class="duck-item-meta">📍 ${esc(duck.city)}${duck.ship ? ` · 🚢 ${esc(duck.ship)}` : ''}</div>
    </div>
    ${duck.image ? `<img class="card-thumb" src="${esc(duck.image)}" alt="duck photo" />` : ''}
    <button class="delete-btn" title="Delete duck" aria-label="Delete duck from ${esc(duck.city)}">×</button>
  `;

  li.querySelector('.delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!adminKey) return;
    if (!confirm(`Delete duck from ${duck.city} (found by ${duck.finderName})?`)) return;
    try {
      const res = await fetch(`${API}/${duck.id}`, {
        method: 'DELETE',
        headers: { 'x-admin-key': adminKey }
      });
      if (res.status === 401) { exitAdminMode(); return; }
      if (!res.ok) throw new Error();
      removeDuck(duck.id);
    } catch {
      alert('Delete failed. Please try again.');
    }
  });

  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-btn')) return;
    document.body.classList.remove('sidebar-open');
    const m = markers.get(duck.id);
    if (m) clusterGroup.zoomToShowLayer(m, () => m.openPopup());
  });

  duckList.insertBefore(li, duckList.firstChild);
  emptyState.classList.add('hidden');

  const marker = L.marker([duck.lat, duck.lng], { icon: duckIcon });
  marker.bindPopup(`
    <div class="duck-popup">
      ${duck.image
        ? `<img class="popup-user-photo" src="${esc(duck.image)}" alt="duck photo" />`
        : `<img src="${DUCK_URL}" alt="duck" />`}
      <strong>${esc(duck.finderName)}</strong>
      <div class="popup-city">📍 ${esc(duck.city)}</div>
      ${duck.ship ? `<div class="popup-ship">🚢 ${esc(duck.ship)}</div>` : ''}
      <div class="popup-date">${new Date(duck.foundAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}</div>
    </div>
  `, { maxWidth: 200 });
  clusterGroup.addLayer(marker);
  markers.set(duck.id, marker);
  duckCount.textContent = markers.size;

  if (flyTo) clusterGroup.zoomToShowLayer(marker, () => marker.openPopup());
}

function removeDuck(id) {
  const marker = markers.get(id);
  if (marker) { clusterGroup.removeLayer(marker); markers.delete(id); }
  const li = duckList.querySelector(`[data-duck-id="${id}"]`);
  if (li) li.remove();
  ducks = ducks.filter(d => d.id !== id);
  duckCount.textContent = markers.size;
  if (markers.size === 0) emptyState.classList.remove('hidden');
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Admin mode ──
adminToggle.addEventListener('click', () => {
  adminForm.classList.toggle('hidden');
  if (!adminForm.classList.contains('hidden')) adminKeyInput.focus();
});

async function tryUnlock() {
  const key = adminKeyInput.value.trim();
  if (!key) return;
  adminSubmit.disabled = true;
  adminStatus.textContent = 'Checking…';
  adminStatus.className = '';
  try {
    const res = await fetch('/api/admin/verify', { headers: { 'x-admin-key': key } });
    if (res.ok) {
      adminKey = key;
      adminForm.classList.add('hidden');
      adminToggle.classList.add('hidden');
      adminActiveBar.classList.remove('hidden');
      document.body.classList.add('admin-active');
      adminKeyInput.value = '';
      adminStatus.textContent = '';
    } else {
      adminStatus.textContent = 'Wrong password.';
      adminStatus.className = 'error';
      adminKeyInput.select();
    }
  } catch {
    adminStatus.textContent = 'Could not connect.';
    adminStatus.className = 'error';
  }
  adminSubmit.disabled = false;
}

adminSubmit.addEventListener('click', tryUnlock);
adminKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

function exitAdminMode() {
  adminKey = null;
  document.body.classList.remove('admin-active');
  adminActiveBar.classList.add('hidden');
  adminToggle.classList.remove('hidden');
}

adminLock.addEventListener('click', exitAdminMode);

// ── Populate ship select ──
async function loadShips() {
  try {
    const res = await fetch('/api/ships');
    const lines = await res.json();
    const sel = document.getElementById('ship-select');
    lines.forEach(({ line, ships }) => {
      const group = document.createElement('optgroup');
      group.label = line;
      ships.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        group.appendChild(opt);
      });
      sel.appendChild(group);
    });
  } catch (e) {
    console.error('Could not load ships', e);
  }
}

// ── Initial load ──
async function fetchDucks() {
  try {
    const res = await fetch(API);
    const all = await res.json();
    ducks = all;
    duckList.innerHTML = '';
    clusterGroup.clearLayers();
    markers.clear();
    all.forEach(d => addDuck(d, false));
    if (all.length === 0) emptyState.classList.remove('hidden');
  } catch (e) {
    console.error('Fetch error', e);
  }
}

// ── SSE real-time updates ──
function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('duck', (e) => {
    const duck = JSON.parse(e.data);
    if (!markers.has(duck.id)) { ducks.push(duck); addDuck(duck, false); }
  });
  es.addEventListener('delete', (e) => {
    const { id } = JSON.parse(e.data);
    removeDuck(id);
  });
  es.onerror = () => { es.close(); setTimeout(connectSSE, 5000); };
}

// ── Mobile drawer ──
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const fabLog = document.getElementById('fab-log');

sidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
sidebarOverlay.addEventListener('click', () => document.body.classList.remove('sidebar-open'));

// ── Photo preview ──
const photoZone = document.getElementById('photo-zone');
const photoInput = document.getElementById('duck-image');
const photoPrompt = document.getElementById('photo-prompt');
const photoPreviewWrap = document.getElementById('photo-preview-wrap');
const photoPreview = document.getElementById('photo-preview');
const clearPhoto = document.getElementById('clear-photo');

photoZone.addEventListener('click', e => {
  if (e.target !== clearPhoto) photoInput.click();
});

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    photoPreview.src = e.target.result;
    photoPrompt.classList.add('hidden');
    photoPreviewWrap.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

clearPhoto.addEventListener('click', e => {
  e.stopPropagation();
  photoInput.value = '';
  photoPreview.src = '';
  photoPreviewWrap.classList.add('hidden');
  photoPrompt.classList.remove('hidden');
});

// ── Log duck modal ──
function openModal() {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (document.activeElement) document.activeElement.blur();
  modal.classList.add('hidden');
  modal.style.top = '';
  modal.style.height = '';
  document.body.style.overflow = '';
  form.reset();
  photoInput.value = '';
  photoPreview.src = '';
  photoPreviewWrap.classList.add('hidden');
  photoPrompt.classList.remove('hidden');
  geocodeStatus.textContent = '';
  geocodeStatus.className = '';
  submitBtn.disabled = false;
  // After the keyboard animates away, reset any internal iOS scroll and re-measure the map.
  setTimeout(() => {
    window.scrollTo(0, 0);
    map.invalidateSize();
  }, 400);
}

logBtn.addEventListener('click', openModal);
fabLog.addEventListener('click', openModal);

// Scroll focused inputs into view after keyboard finishes appearing
form.addEventListener('focusin', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
    setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
  }
});
document.getElementById('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

let geocodeTimer;
document.getElementById('city-name').addEventListener('input', e => {
  clearTimeout(geocodeTimer);
  const val = e.target.value.trim();
  if (!val) { geocodeStatus.textContent = ''; geocodeStatus.className = ''; return; }
  geocodeStatus.textContent = 'Searching…';
  geocodeStatus.className = 'loading';
  geocodeTimer = setTimeout(async () => {
    const result = await geocode(val);
    if (result) {
      geocodeStatus.textContent = `✓ Found: ${result.display}`;
      geocodeStatus.className = 'success';
    } else {
      geocodeStatus.textContent = '⚠ City not found — check spelling';
      geocodeStatus.className = 'error';
    }
  }, 600);
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  submitBtn.disabled = true;

  const finderName = document.getElementById('finder-name').value.trim() || 'Anonymous';
  const cityRaw = document.getElementById('city-name').value.trim();

  geocodeStatus.textContent = 'Finding your city on the map…';
  geocodeStatus.className = 'loading';

  const geo = await geocode(cityRaw);
  if (!geo) {
    geocodeStatus.textContent = '⚠ Could not find that city. Try a different spelling.';
    geocodeStatus.className = 'error';
    submitBtn.disabled = false;
    return;
  }

  try {
    const ship = document.getElementById('ship-select').value;
    const formData = new FormData();
    formData.append('finderName', finderName);
    if (ship) formData.append('ship', ship);
    formData.append('city', geo.display || cityRaw);
    formData.append('lat', geo.lat);
    formData.append('lng', geo.lng);
    const imageFile = photoInput.files[0];
    if (imageFile) formData.append('image', imageFile);

    const res = await fetch(API, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Server error');
    const duck = await res.json();
    closeModal();
    if (!markers.has(duck.id)) {
      ducks.push(duck);
      addDuck(duck, false);
    }
    // Always fly to the new duck — SSE may have already added the marker
    setTimeout(() => {
      map.flyTo([duck.lat, duck.lng], 13, { animate: true, duration: 1.2 });
    }, 350);
    setTimeout(() => {
      const m = markers.get(duck.id);
      if (m) m.openPopup();
    }, 1800);
  } catch (err) {
    geocodeStatus.textContent = 'Something went wrong. Please try again.';
    geocodeStatus.className = 'error';
    submitBtn.disabled = false;
  }
});

// ── iOS visual viewport compensation ──
// The sticky header handles its own positioning when iOS scrolls the page for
// the keyboard. We only need to resize the modal so the form stays above the keyboard.
if (window.visualViewport) {
  const onVP = () => {
    const vp = window.visualViewport;
    if (!modal.classList.contains('hidden')) {
      modal.style.top = vp.offsetTop + 'px';
      modal.style.height = vp.height + 'px';
    }
    if (vp.height >= window.innerHeight - 10) map.invalidateSize();
  };
  window.visualViewport.addEventListener('resize', onVP);
  window.visualViewport.addEventListener('scroll', onVP);
}

// ── Init ──
loadShips();
fetchDucks().then(() => connectSSE());
