<script>
(function () {
  const BACKEND_BASE_URL = window.BACKEND_BASE_URL || 'http://localhost:3000';
  window.BACKEND_BASE_URL = BACKEND_BASE_URL;

  const authKey = 'apocalypse_session_token';
  const authStore = {
    get()  { return localStorage.getItem(authKey); },
    set(t) { localStorage.setItem(authKey, t); },
    clear(){ localStorage.removeItem(authKey); }
  };
  window.authStore = authStore;

  async function authFetch(input, init = {}) {
    const token = authStore.get();
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', 'Bearer ' + token);
    return fetch(input, { ...init, headers });
  }
  window.authFetch = authFetch;

  async function getMe() {
    const t = authStore.get();
    if (!t) return null;
    try {
      const r = await authFetch(`${BACKEND_BASE_URL}/api/auth/me`);
      if (!r.ok) return null;
      const j = await r.json();
      return j.user || null;
    } catch { return null; }
  }
  window.getMe = getMe;

  // Redirige vers auth si non connecté. Retourne true si OK (auth), false sinon (redirigé).
  window.requireAuth = async function(nextPage = 'chat.html') {
    const me = await getMe();
    if (me) { initAuthUI(); return true; }
    const url = new URL('auth.html', location.href);
    url.searchParams.set('next', nextPage);
    location.replace(url.toString());
    return false;
  };

  // UI nav: affiche/masque logout selon session
  async function initAuthUI() {
    const me = await getMe();
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !me);
  }
  window.initAuthUI = initAuthUI;

  // Logout bouton
  window.handleLogoutClick = async function () {
    try { await authFetch(`${BACKEND_BASE_URL}/api/auth/logout`, { method: 'POST' }); } catch {}
    authStore.clear();
    location.href = 'auth.html';
  };

  // Init auto au chargement (pour chaque page)
  document.addEventListener('DOMContentLoaded', initAuthUI);
})();
</script>
