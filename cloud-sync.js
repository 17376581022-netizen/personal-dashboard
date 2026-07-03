(() => {
  'use strict';

  const SESSION_KEY = 'personalDashboard.cloudSession.v1';
  const LAST_SYNC_KEY = 'personalDashboard.lastCloudSync.v1';
  const POLL_INTERVAL = 30 * 1000;
  const config = window.DASHBOARD_CLOUD_CONFIG || {};
  const bridge = window.PersonalDashboardCloudBridge;
  const $ = selector => document.querySelector(selector);
  let session = null;
  let syncTimer = null;
  let pushTimer = null;
  let syncInFlight = false;
  let pendingConflict = null;

  const baseUrl = String(config.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(config.supabaseAnonKey || '').trim();
  const configured = /^https:\/\//.test(baseUrl) && apiKey.length > 20;

  function notify(message, type = '') {
    if (bridge?.notify) bridge.notify(message, type);
  }

  function showError(message = '') {
    $('#syncError').textContent = message;
    $('#syncError').classList.toggle('hidden', !message);
  }

  function setStatus(message, state = '') {
    $('#syncStatus').textContent = message;
    $('#syncDot').className = `sync-dot ${state}`.trim();
  }

  function setBusy(busy) {
    ['#syncLogin', '#syncSignup', '#syncPhoneSendCode', '#syncPhoneVerify', '#syncWechatLogin', '#syncNow', '#syncLogout'].forEach(selector => {
      const element = $(selector);
      if (element) element.disabled = busy;
    });
  }

  function renderAuth() {
    const signedIn = Boolean(session?.access_token && session?.user?.id);
    $('#syncSignedOut').classList.toggle('hidden', signedIn || !configured);
    $('#syncSignedIn').classList.toggle('hidden', !signedIn);
    $('#syncConfigHint').classList.toggle('hidden', configured);
    $('#syncUserEmail').textContent = signedIn ? session.user.phone || session.user.email || '已登录' : '';
    if (!configured) setStatus('等待配置');
    else if (signedIn) setStatus('云端已连接', 'online');
    else setStatus('未登录');
  }

  function parseSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value?.access_token && value?.refresh_token && value?.user?.id ? value : null;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function saveSession(value) {
    session = value;
    if (session?.expires_in && !session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    renderAuth();
  }

  function clearSession() {
    session = null;
    pendingConflict = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
    renderAuth();
  }

  async function api(path, { method = 'GET', body, token, prefer } = {}) {
    const headers = { apikey: apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(data?.msg || data?.error_description || data?.message || `云端请求失败（${response.status}）`);
    return data;
  }

  async function ensureSession() {
    if (!session) return null;
    const expiresSoon = !session.expires_at || Number(session.expires_at) * 1000 < Date.now() + 60_000;
    if (!expiresSoon) return session;
    try {
      const refreshed = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
      saveSession(refreshed);
      return session;
    } catch (error) {
      clearSession();
      showError('登录已过期，请重新登录。');
      throw error;
    }
  }

  async function signIn() {
    const email = $('#syncEmail').value.trim();
    const password = $('#syncPassword').value;
    if (!email || password.length < 6) return showError('请输入有效邮箱和至少 6 位密码。');
    setBusy(true); showError(''); setStatus('正在登录…', 'syncing');
    try {
      const result = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      saveSession(result);
      $('#syncPassword').value = '';
      notify('登录成功，正在同步。');
      await reconcile();
    } catch (error) {
      showError(error.message || '登录失败。');
      setStatus('登录失败');
    } finally { setBusy(false); }
  }

  async function signUp() {
    const email = $('#syncEmail').value.trim();
    const password = $('#syncPassword').value;
    if (!email || password.length < 6) return showError('请输入有效邮箱和至少 6 位密码。');
    setBusy(true); showError(''); setStatus('正在注册…', 'syncing');
    try {
      const result = await api('/auth/v1/signup', { method: 'POST', body: { email, password } });
      if (result?.access_token) {
        saveSession(result);
        await reconcile();
      } else {
        setStatus('注册成功');
        notify('注册成功，请直接登录。');
      }
      $('#syncPassword').value = '';
    } catch (error) {
      showError(error.message || '注册失败。');
      setStatus('注册失败');
    } finally { setBusy(false); }
  }

  function normalizePhone(value) {
    const compact = String(value || '').replace(/[\s()-]/g, '');
    if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
    if (/^\+\d{8,15}$/.test(compact)) return compact;
    return '';
  }

  function switchAuthMode(mode) {
    document.querySelectorAll('[data-auth-mode]').forEach(button => {
      const active = button.dataset.authMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-auth-panel]').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.authPanel !== mode);
    });
    showError('');
  }

  async function sendPhoneCode() {
    const phone = normalizePhone($('#syncPhone').value);
    if (!phone) return showError('请输入有效手机号；中国大陆手机号可直接输入 11 位号码。');
    setBusy(true); showError(''); setStatus('正在发送验证码…', 'syncing');
    try {
      await api('/auth/v1/otp', { method: 'POST', body: { phone, create_user: true } });
      $('#syncPhone').value = phone;
      setStatus('验证码已发送');
      notify('短信验证码已发送，请注意查收。');
      $('#syncPhoneCode').focus();
    } catch (error) {
      showError(error.message || '验证码发送失败。请确认短信服务已配置。');
      setStatus('发送失败');
    } finally { setBusy(false); }
  }

  async function verifyPhoneCode() {
    const phone = normalizePhone($('#syncPhone').value);
    const token = $('#syncPhoneCode').value.trim();
    if (!phone || !/^\d{4,8}$/.test(token)) return showError('请输入手机号和有效的短信验证码。');
    setBusy(true); showError(''); setStatus('正在验证…', 'syncing');
    try {
      const result = await api('/auth/v1/verify', { method: 'POST', body: { type: 'sms', phone, token } });
      if (!result?.access_token) throw new Error('验证码验证成功，但登录会话无效。');
      saveSession(result);
      $('#syncPhoneCode').value = '';
      notify('手机号验证成功，正在同步。');
      await reconcile();
    } catch (error) {
      showError(error.message || '验证码无效或已过期。');
      setStatus('验证失败');
    } finally { setBusy(false); }
  }

  function startWechatLogin() {
    showError('微信登录需要先配置微信开放平台 AppID、AppSecret 和安全回调服务，当前尚未启用。');
    setStatus('微信待配置');
  }

  async function signOut() {
    setBusy(true);
    try {
      if (session?.access_token) await api('/auth/v1/logout', { method: 'POST', token: session.access_token });
    } catch { /* Local logout still succeeds if the network is unavailable. */ }
    clearSession(); setBusy(false); notify('已退出云端账号。');
  }

  async function fetchRemote() {
    await ensureSession();
    const query = `/rest/v1/dashboard_state?select=user_id,data,updated_at&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`;
    const rows = await api(query, { token: session.access_token });
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function pushLocal() {
    if (!session || syncInFlight || pendingConflict) return;
    syncInFlight = true; setStatus('正在上传…', 'syncing'); showError('');
    try {
      await ensureSession();
      const rows = await api('/rest/v1/dashboard_state?on_conflict=user_id', {
        method: 'POST', token: session.access_token, prefer: 'resolution=merge-duplicates,return=representation',
        body: { user_id: session.user.id, data: bridge.getSnapshot() }
      });
      const updatedAt = Array.isArray(rows) && rows[0]?.updated_at ? rows[0].updated_at : new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, updatedAt);
      bridge.clearDirty();
      setStatus('刚刚已同步', 'online');
    } catch (error) {
      showError(error.message || '云端同步失败。');
      setStatus('同步失败');
    } finally { syncInFlight = false; }
  }

  function hasMeaningfulLocalData(data) {
    return Boolean(data && (
      data['personalDashboard.todos.v1']?.length || data['personalDashboard.todoCompletions.v1']?.length ||
      data['personalDashboard.events.v1']?.length || data['personalDashboard.projects.v1']?.length ||
      Object.keys(data['personalDashboard.notes.v1'] || {}).length || Object.keys(data['personalDashboard.habitChecks.v1'] || {}).length ||
      data.dashboardWeatherLocation || (data['personalDashboard.links.v1']?.length || 0) > 8
    ));
  }

  function showConflict(remote) {
    pendingConflict = remote;
    $('#syncConflict').classList.remove('hidden');
    setStatus('需要选择', 'syncing');
  }

  async function reconcile() {
    if (!session || syncInFlight || pendingConflict) return;
    syncInFlight = true; setStatus('正在检查云端…', 'syncing'); showError('');
    try {
      const remote = await fetchRemote();
      if (!remote) { syncInFlight = false; return pushLocal(); }
      const localData = bridge.getSnapshot();
      const lastSync = localStorage.getItem(LAST_SYNC_KEY);
      const dirtyAt = bridge.getDirtyAt();
      if (!lastSync && hasMeaningfulLocalData(localData)) {
        syncInFlight = false; showConflict(remote); return;
      }
      if (dirtyAt && new Date(dirtyAt) > new Date(remote.updated_at)) {
        syncInFlight = false; return pushLocal();
      }
      if (!lastSync || new Date(remote.updated_at) > new Date(lastSync)) {
        localStorage.setItem(LAST_SYNC_KEY, remote.updated_at);
        bridge.clearDirty();
        bridge.applySnapshot(remote.data);
        return;
      }
      localStorage.setItem(LAST_SYNC_KEY, remote.updated_at);
      bridge.clearDirty();
      setStatus('云端已是最新', 'online');
    } catch (error) {
      showError(error.message || '无法读取云端数据。');
      setStatus('同步失败');
    } finally { syncInFlight = false; }
  }

  function schedulePush() {
    if (!session || pendingConflict) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushLocal, 1200);
  }

  async function useCloudVersion() {
    if (!pendingConflict) return;
    const remote = pendingConflict; pendingConflict = null;
    $('#syncConflict').classList.add('hidden');
    localStorage.setItem(LAST_SYNC_KEY, remote.updated_at);
    bridge.clearDirty(); bridge.applySnapshot(remote.data);
  }

  async function uploadLocalVersion() {
    pendingConflict = null; $('#syncConflict').classList.add('hidden');
    await pushLocal();
  }

  async function init() {
    if (!bridge) return;
    session = parseSession();
    renderAuth();
    $('#syncLogin').addEventListener('click', signIn);
    $('#syncSignup').addEventListener('click', signUp);
    $('#syncPhoneSendCode').addEventListener('click', sendPhoneCode);
    $('#syncPhoneVerify').addEventListener('click', verifyPhoneCode);
    $('#syncWechatLogin').addEventListener('click', startWechatLogin);
    document.querySelectorAll('[data-auth-mode]').forEach(button => {
      button.addEventListener('click', () => switchAuthMode(button.dataset.authMode));
    });
    $('#syncLogout').addEventListener('click', signOut);
    $('#syncNow').addEventListener('click', reconcile);
    $('#syncUseCloud').addEventListener('click', useCloudVersion);
    $('#syncUseLocal').addEventListener('click', uploadLocalVersion);
    $('#syncPassword').addEventListener('keydown', event => { if (event.key === 'Enter') signIn(); });
    $('#syncPhone').addEventListener('keydown', event => { if (event.key === 'Enter') sendPhoneCode(); });
    $('#syncPhoneCode').addEventListener('keydown', event => { if (event.key === 'Enter') verifyPhoneCode(); });
    window.addEventListener('dashboard:local-change', schedulePush);
    window.addEventListener('online', () => reconcile());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcile(); });
    syncTimer = setInterval(() => { if (!document.hidden) reconcile(); }, POLL_INTERVAL);
    if (configured && session) await reconcile();
  }

  init();
})();
