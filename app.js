(() => {
  'use strict';

  const WEATHER_LOCATION_KEY = 'dashboardWeatherLocation';
  const WEATHER_DATA_KEY = 'dashboardWeatherData';
  const WEATHER_UPDATED_AT_KEY = 'dashboardWeatherUpdatedAt';
  const WEATHER_REFRESH_INTERVAL = 30 * 60 * 1000;
  const SYNC_DIRTY_AT_KEY = 'personalDashboard.syncDirtyAt.v1';
  let dashboardInitialized = false;

  const STORAGE = {
    todos: 'personalDashboard.todos.v1',
    habits: 'personalDashboard.habits.v1',
    habitChecks: 'personalDashboard.habitChecks.v1',
    todoCompletions: 'personalDashboard.todoCompletions.v1',
    events: 'personalDashboard.events.v1',
    links: 'personalDashboard.links.v1',
    projects: 'personalDashboard.projects.v1',
    notes: 'personalDashboard.notes.v1',
    weatherLocation: WEATHER_LOCATION_KEY,
    weatherData: WEATHER_DATA_KEY,
    weatherUpdatedAt: WEATHER_UPDATED_AT_KEY
  };

  const defaultHabits = ['阅读', '运动', '早睡', '喝水', '写作', '整理房间'];
  const defaultLinks = [
    ['ChatGPT', 'https://chatgpt.com'], ['Google', 'https://www.google.com'],
    ['YouTube', 'https://www.youtube.com'], ['Notion', 'https://www.notion.so'],
    ['Figma', 'https://www.figma.com'], ['Canva', 'https://www.canva.com'],
    ['豆瓣', 'https://www.douban.com'], ['小红书', 'https://www.xiaohongshu.com']
  ];
  const quotes = [
    '把今天过清楚，明天就少一点追债。', '小步也算前进，尤其是在不想动的时候。',
    '先完成，再完美。秩序通常是做出来的。', '给重要的事留一点不被打扰的时间。',
    '不用赢过所有人，先别输给打开了十七个标签页的自己。', '稳定地做一点，比偶尔燃烧一次更可靠。'
  ];

  const $ = (selector) => document.querySelector(selector);
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch { return fallback; }
  };
  const markDashboardChanged = () => {
    if (!dashboardInitialized) return;
    const changedAt = new Date().toISOString();
    localStorage.setItem(SYNC_DIRTY_AT_KEY, changedAt);
    window.dispatchEvent(new CustomEvent('dashboard:local-change', { detail: { changedAt } }));
  };
  const write = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
    markDashboardChanged();
  };
  const todayKey = () => formatDateKey(new Date());
  const formatDateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const parseLocalDate = (value) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const dayDifference = (dateKey, baseKey = todayKey()) => {
    const target = parseLocalDate(dateKey);
    const base = parseLocalDate(baseKey);
    return Math.round((target - base) / 86400000);
  };
  const prettyDate = (dateKey) => parseLocalDate(dateKey).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  const weekKeys = () => {
    const now = parseLocalDate(todayKey());
    const mondayOffset = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      return formatDateKey(date);
    });
  };

  let todos = read(STORAGE.todos, []);
  let habits = read(STORAGE.habits, null) || defaultHabits.map(name => ({ id: uid(), name }));
  let habitChecks = read(STORAGE.habitChecks, {});
  let todoCompletions = read(STORAGE.todoCompletions, []);
  let events = read(STORAGE.events, []);
  let links = read(STORAGE.links, null) || defaultLinks.map(([name, url]) => ({ id: uid(), name, url }));
  let projects = read(STORAGE.projects, []);
  let notes = read(STORAGE.notes, {});
  let editingProjectId = null;
  let noteTimer = null;
  let weatherRefreshTimer = null;
  let weatherVisibilityBound = false;
  let weatherEventsBound = false;
  let weatherRequestSequence = 0;
  let musicTracks = [];
  let visibleMusicTracks = [];
  let currentMusicId = null;
  let activeMusicPlatform = 'netease';
  let appleMusic = null;
  let appleMusicReady = false;
  let appleMusicConfigured = false;
  let applePlaybackTimer = null;
  let aplayer = null;
  let metingOnline = true;
  let playlistTracks = [];
  let quickPickTracks = [];
  const trackStore = new Map();

  // Persist first-run defaults immediately so deleting all items remains intentional.
  if (!localStorage.getItem(STORAGE.habits)) write(STORAGE.habits, habits);
  if (!localStorage.getItem(STORAGE.links)) write(STORAGE.links, links);

  // Backfill completion history for data created before Monthly Review existed.
  let completionHistoryChanged = false;
  todos.forEach(todo => {
    if (todo.completed && !todoCompletions.some(record => record.todoId === todo.id)) {
      todoCompletions.push({ id: uid(), todoId: todo.id, text: todo.text, date: todo.completedAt || todayKey() });
      todo.completedAt ||= todayKey();
      completionHistoryChanged = true;
    }
  });
  if (completionHistoryChanged) {
    write(STORAGE.todos, todos);
    write(STORAGE.todoCompletions, todoCompletions);
  }

  function toast(message, type = '') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    $('#toastRegion').append(node);
    setTimeout(() => node.remove(), 2600);
  }

  function updateHeader() {
    const now = new Date();
    $('#todayDate').textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    $('#clock').textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function empty(message) { return `<p class="empty-state">${esc(message)}</p>`; }

  const weatherCodeMap = {
    0: '晴', 1: '主要晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '中等毛毛雨', 55: '大毛毛雨', 56: '轻微冻毛毛雨', 57: '强冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '轻微冻雨', 67: '强冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '小阵雨', 81: '中等阵雨',
    82: '强阵雨', 85: '小阵雪', 86: '强阵雪', 95: '雷暴', 96: '雷暴伴轻微冰雹', 99: '雷暴伴强冰雹'
  };

  function getWeatherDescription(code) {
    return weatherCodeMap[Number(code)] || '未知天气';
  }

  function readWeatherStorage(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); }
    catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  function saveWeatherLocation(location) {
    localStorage.setItem(WEATHER_LOCATION_KEY, JSON.stringify(location));
    markDashboardChanged();
  }

  function loadWeatherLocation() {
    const location = readWeatherStorage(WEATHER_LOCATION_KEY);
    if (!isValidWeatherLocation(location)) {
      if (location !== null) localStorage.removeItem(WEATHER_LOCATION_KEY);
      return null;
    }
    return location;
  }

  function saveWeatherData(weatherData) {
    localStorage.setItem(WEATHER_DATA_KEY, JSON.stringify(weatherData));
    localStorage.setItem(WEATHER_UPDATED_AT_KEY, weatherData.fetchedAt);
    markDashboardChanged();
  }

  function loadWeatherData() {
    const weatherData = readWeatherStorage(WEATHER_DATA_KEY);
    if (!isValidWeatherData(weatherData)) {
      if (weatherData !== null) localStorage.removeItem(WEATHER_DATA_KEY);
      return null;
    }
    return weatherData;
  }

  function clearWeatherError() {
    $('#weather-error').textContent = '';
    $('#weather-error').classList.add('hidden');
  }

  function showWeatherError(message) {
    $('#weather-error').textContent = message;
    $('#weather-error').classList.remove('hidden');
  }

  function setWeatherLoading(isLoading) {
    $('#weather-loading').classList.toggle('hidden', !isLoading);
    $('#save-weather-city-btn').disabled = isLoading;
    $('#refresh-weather-btn').disabled = isLoading;
  }

  async function fetchJsonWithRetry(url, { attempts = 2, timeout = 5000 } = {}) {
    let lastError = new Error('网络请求失败');
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let timer;
      try {
        const timeoutRequest = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('网络请求超时')), timeout);
        });
        const response = await Promise.race([
          fetch(url, { cache: 'no-store' }),
          timeoutRequest
        ]);
        if (!response.ok) throw new Error(`服务返回 ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 450 * (2 ** attempt)));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  async function searchCity(cityName) {
    const name = String(cityName || '').trim();
    if (!name) {
      toast('请输入城市名称', 'error');
      throw new Error('请输入城市名称');
    }
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', name);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'zh');
    url.searchParams.set('format', 'json');
    let data;
    try { data = await fetchJsonWithRetry(url.toString(), { attempts: 3, timeout: 5500 }); }
    catch { throw new Error('城市搜索失败，已自动重试，请检查网络后再试'); }
    const result = data.results?.[0];
    if (!result) throw new Error('未找到城市，请换个名称试试');
    const location = {
      name: result.name,
      country: result.country || result.country_code || '',
      latitude: Number(result.latitude),
      longitude: Number(result.longitude),
      timezone: result.timezone || 'auto'
    };
    if (!isValidWeatherLocation(location)) throw new Error('城市搜索返回的数据不完整');
    return location;
  }

  async function fetchWeather(location) {
    if (!isValidWeatherLocation(location)) throw new Error('保存的城市信息无效，请重新设置城市');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day');
    url.searchParams.set('timezone', 'auto');
    let data;
    try { data = await fetchJsonWithRetry(url.toString(), { attempts: 2, timeout: 4500 }); }
    catch { return fetchWeatherFallback(location); }
    if (!data.current || typeof data.current !== 'object') throw new Error('天气服务返回的数据不完整');
    return {
      location,
      current: {
        time: data.current.time ?? null,
        temperature_2m: data.current.temperature_2m ?? null,
        apparent_temperature: data.current.apparent_temperature ?? null,
        relative_humidity_2m: data.current.relative_humidity_2m ?? null,
        precipitation: data.current.precipitation ?? null,
        weather_code: data.current.weather_code ?? null,
        wind_speed_10m: data.current.wind_speed_10m ?? null,
        is_day: data.current.is_day ?? null
      },
      units: data.current_units || {},
      timezone: data.timezone || location.timezone,
      fetchedAt: new Date().toISOString()
    };
  }

  async function fetchWeatherFallback(location) {
    const url = new URL(`https://wttr.in/${encodeURIComponent(`${location.latitude},${location.longitude}`)}`);
    url.searchParams.set('format', 'j1');
    url.searchParams.set('lang', 'zh');
    let data;
    try { data = await fetchJsonWithRetry(url.toString(), { attempts: 2, timeout: 6500 }); }
    catch { throw new Error('天气服务请求失败'); }
    const condition = data.current_condition?.[0];
    if (!condition || typeof condition !== 'object') throw new Error('备用天气服务返回的数据不完整');
    let localHour = new Date().getHours();
    try {
      localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: location.timezone, hour: '2-digit', hour12: false }).format(new Date()));
    } catch { /* Use the browser's local hour if the saved timezone is unavailable. */ }
    const weatherText = translateFallbackWeather(condition.lang_zh?.[0]?.value || condition.weatherDesc?.[0]?.value || '未知天气');
    return {
      location,
      current: {
        time: new Date().toISOString(),
        temperature_2m: condition.temp_C ?? null,
        apparent_temperature: condition.FeelsLikeC ?? null,
        relative_humidity_2m: condition.humidity ?? null,
        precipitation: condition.precipMM ?? null,
        weather_code: null,
        weather_text: weatherText,
        wind_speed_10m: condition.windspeedKmph ?? null,
        is_day: localHour >= 6 && localHour < 18 ? 1 : 0
      },
      units: { temperature_2m: '°C', wind_speed_10m: 'km/h', precipitation: 'mm' },
      timezone: location.timezone,
      source: 'wttr.in',
      fetchedAt: new Date().toISOString()
    };
  }

  function translateFallbackWeather(value) {
    const text = String(value || '').trim();
    const translations = {
      'clear': '晴', 'sunny': '晴', 'partly cloudy': '局部多云', 'cloudy': '多云', 'overcast': '阴',
      'mist': '薄雾', 'fog': '雾', 'smoky haze': '烟霾', 'haze': '霾',
      'patchy rain nearby': '附近有零星小雨', 'light rain': '小雨', 'moderate rain': '中雨', 'heavy rain': '大雨',
      'light rain shower': '小阵雨', 'moderate or heavy rain shower': '中到大阵雨',
      'thundery outbreaks in nearby': '附近有雷雨', 'patchy light rain with thunder': '局部雷阵雨',
      'patchy snow nearby': '附近有零星小雪', 'light snow': '小雪', 'moderate snow': '中雪', 'heavy snow': '大雪'
    };
    return translations[text.toLowerCase()] || text || '未知天气';
  }

  function weatherValue(value, suffix = '', round = false) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '--';
    const number = round ? Math.round(Number(value)) : Number(value);
    return `${number}${suffix}`;
  }

  function formatWeatherDateTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ');
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function renderWeather(weatherData, options = {}) {
    const card = $('#weather-card');
    if (!isValidWeatherData(weatherData)) {
      card.className = 'weather-card empty';
      card.innerHTML = '<p>请先设置城市，天气才会自动更新。</p>';
      return;
    }
    const { cached = false } = options;
    const current = weatherData.current;
    const dayLabel = current.is_day === 1 ? '白天' : current.is_day === 0 ? '夜晚' : '--';
    const cacheLabel = cached ? '<span class="weather-cache-note">显示上次数据</span>' : '';
    const sourceLabel = weatherData.source === 'wttr.in' ? '<span class="weather-cache-note">备用天气源</span>' : '';
    card.className = 'weather-card';
    card.innerHTML = `
      <div class="weather-main">
        <div><p class="weather-location">${esc(weatherData.location.name)}${weatherData.location.country ? `，${esc(weatherData.location.country)}` : ''}</p><p class="weather-description">${esc(current.weather_text || getWeatherDescription(current.weather_code))} · ${dayLabel}</p></div>
        <strong class="weather-temp">${weatherValue(current.temperature_2m, '°C', true)}</strong>
      </div>
      <div class="weather-meta"><span>天气时间：${esc(formatWeatherDateTime(current.time))}</span><span>更新时间：${esc(formatWeatherDateTime(weatherData.fetchedAt))}</span>${cacheLabel}${sourceLabel}</div>
      <div class="weather-grid">
        <div class="weather-item"><span>当前温度</span><strong>${weatherValue(current.temperature_2m, '°C', true)}</strong></div>
        <div class="weather-item"><span>体感温度</span><strong>${weatherValue(current.apparent_temperature, '°C', true)}</strong></div>
        <div class="weather-item"><span>湿度</span><strong>${weatherValue(current.relative_humidity_2m, '%', true)}</strong></div>
        <div class="weather-item"><span>降水</span><strong>${weatherValue(current.precipitation, ' mm')}</strong></div>
        <div class="weather-item"><span>风速</span><strong>${weatherValue(current.wind_speed_10m, ' km/h', true)}</strong></div>
      </div>`;
  }

  function isValidWeatherLocation(location) {
    return isPlainObject(location) && typeof location.name === 'string' && location.name.trim().length > 0 &&
      typeof location.country === 'string' && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)) &&
      typeof location.timezone === 'string';
  }

  function isValidWeatherData(weatherData) {
    return isPlainObject(weatherData) && isValidWeatherLocation(weatherData.location) && isPlainObject(weatherData.current) &&
      isPlainObject(weatherData.units) && typeof weatherData.timezone === 'string' && typeof weatherData.fetchedAt === 'string' &&
      !Number.isNaN(new Date(weatherData.fetchedAt).getTime());
  }

  async function setWeatherCity(cityName) {
    const name = String(cityName || '').trim();
    if (!name) {
      showWeatherError('请输入城市名称');
      toast('请输入城市名称', 'error');
      return;
    }
    const requestId = ++weatherRequestSequence;
    clearWeatherError();
    setWeatherLoading(true);
    try {
      const location = await searchCity(name);
      if (requestId !== weatherRequestSequence) return;
      saveWeatherLocation(location);
      $('#weather-city-input').value = location.name;
      const weatherData = await fetchWeather(location);
      if (requestId !== weatherRequestSequence) return;
      saveWeatherData(weatherData);
      renderWeather(weatherData);
      toast(`已设置城市：${location.name}`);
    } catch (error) {
      if (requestId !== weatherRequestSequence) return;
      const message = error?.message || '设置城市失败，请稍后重试';
      showWeatherError(message);
      toast(message, 'error');
    } finally {
      if (requestId === weatherRequestSequence) setWeatherLoading(false);
    }
  }

  async function updateWeather({ silent = false } = {}) {
    const location = loadWeatherLocation();
    if (!location) {
      if (!silent) {
        showWeatherError('请先设置城市');
        toast('请先设置城市', 'error');
      }
      return;
    }
    const requestId = ++weatherRequestSequence;
    clearWeatherError();
    setWeatherLoading(true);
    try {
      const weatherData = await fetchWeather(location);
      if (requestId !== weatherRequestSequence) return;
      saveWeatherData(weatherData);
      renderWeather(weatherData);
      if (!silent) toast('天气已更新');
    } catch {
      if (requestId !== weatherRequestSequence) return;
      const cached = loadWeatherData();
      if (cached) {
        renderWeather(cached, { cached: true });
        showWeatherError('天气更新失败，显示上次数据');
      } else {
        renderWeather(null);
        showWeatherError('天气更新失败，请稍后重试');
      }
    } finally {
      if (requestId === weatherRequestSequence) setWeatherLoading(false);
    }
  }

  function startWeatherAutoRefresh() {
    if (!weatherRefreshTimer) {
      weatherRefreshTimer = setInterval(() => {
        if (!document.hidden) updateWeather({ silent: true });
      }, WEATHER_REFRESH_INTERVAL);
    }
    if (!weatherVisibilityBound) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateWeather({ silent: true });
      });
      weatherVisibilityBound = true;
    }
  }

  function initWeather() {
    const cached = loadWeatherData();
    renderWeather(cached, { cached: Boolean(cached) });
    const location = loadWeatherLocation();
    if (location) {
      $('#weather-city-input').value = location.name;
      updateWeather({ silent: true });
    }
    if (!weatherEventsBound) {
      $('#save-weather-city-btn').addEventListener('click', () => setWeatherCity($('#weather-city-input').value));
      $('#refresh-weather-btn').addEventListener('click', () => updateWeather());
      $('#weather-city-input').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          setWeatherCity(event.currentTarget.value);
        }
      });
      document.querySelectorAll('[data-weather-city]').forEach(button => {
        button.addEventListener('click', () => {
          const city = button.dataset.weatherCity;
          $('#weather-city-input').value = city;
          setWeatherCity(city);
        });
      });
      weatherEventsBound = true;
    }
    startWeatherAutoRefresh();
  }

  /* ---------------- 音乐点播：聚合播放（网易云 / QQ音乐 / 酷狗）+ Apple Music ---------------- */

  const METING_PLATFORMS = {
    netease: {
      server: 'netease', label: '网易云音乐', color: '#e4473e',
      originUrl: id => `https://music.163.com/#/song?id=${id}`
    },
    qq: {
      server: 'tencent', label: 'QQ音乐', color: '#35c682',
      originUrl: id => `https://y.qq.com/n/ryqq/songDetail/${id}`
    },
    kugou: {
      server: 'kugou', label: '酷狗音乐', color: '#4aa3ff',
      originUrl: () => ''
    }
  };
  const RANDOM_SEARCH_WORDS = ['热歌', '流行金曲', '周杰伦', '林俊杰', '陈奕迅', '民谣', '摇滚', '邓紫棋', '治愈系', '经典老歌'];

  function musicConfig() { return window.DASHBOARD_MUSIC_CONFIG || {}; }
  function metingApiBase() {
    return String(musicConfig().metingApi || 'https://api.i-meto.com/meting/api').replace(/\/+$/, '');
  }
  function playlistName() { return String(musicConfig().neteasePlaylistName || '我的歌单'); }

  function setMusicStatus(message, isError = false) {
    const status = $('#musicStatus');
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  async function metingFetch({ server, type, id }) {
    const url = `${metingApiBase()}?server=${encodeURIComponent(server)}&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Meting 接口返回 ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  function registerTrack(track) { trackStore.set(track.id, track); return track; }

  function metingTrackFromApi(item, platform) {
    const conf = METING_PLATFORMS[platform];
    const idMatch = /[?&]id=([^&]+)/.exec(item?.url || '');
    const remoteId = idMatch ? idMatch[1] : '';
    return registerTrack({
      id: `${platform}-${remoteId || uid()}`,
      platform,
      platformName: conf.label,
      trackName: item?.title || '未知歌曲',
      artistName: item?.author || '未知歌手',
      color: conf.color,
      url: item?.url || '',
      pic: item?.pic || '',
      lrc: item?.lrc || '',
      remoteId,
      originUrl: remoteId ? conf.originUrl(remoteId) : ''
    });
  }

  function trackToAplayerAudio(track) {
    const audio = {
      name: track.trackName,
      artist: track.artistName,
      url: track.url,
      cover: track.pic,
      lrc: track.lrc,
      originUrl: track.originUrl || '',
      platform: track.platform,
      platformName: track.platformName
    };
    // 非网易云平台音源失败时，自动尝试网易云同名歌曲代播
    if (track.platform !== 'netease') {
      audio.fallbackTitle = track.trackName;
      audio.fallbackArtist = track.artistName;
      audio.fallbackPlatform = track.platformName;
    }
    return audio;
  }

  async function substituteWithNetease(audio, failedIndex) {
    const player = ensureAplayer();
    if (!player || !audio?.fallbackTitle || audio.fallbackTried) return;
    audio.fallbackTried = true;
    const query = `${audio.fallbackTitle} ${audio.fallbackArtist || ''}`.trim();
    setMusicStatus(`${audio.fallbackPlatform}音源受限，正在网易云寻找《${audio.fallbackTitle}》代播…`);
    try {
      const data = await metingFetch({ server: 'netease', type: 'search', id: query });
      const candidates = (Array.isArray(data) ? data : []).map(item => metingTrackFromApi(item, 'netease')).filter(track => track.url);
      if (!candidates.length) {
        setMusicStatus(`《${audio.fallbackTitle}》在${audio.fallbackPlatform}和网易云都暂时无法播放，换一首试试。`, true);
        return;
      }
      const normalize = value => String(value || '').replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
      const titleKey = normalize(audio.fallbackTitle);
      const best = candidates.find(track => normalize(track.trackName).includes(titleKey) || titleKey.includes(normalize(track.trackName))) || candidates[0];
      player.list.add(trackToAplayerAudio(best));
      // 删除失败的那一条，保持列表干净
      if (Number.isInteger(failedIndex) && player.list.audios[failedIndex] === audio) player.list.remove(failedIndex);
      player.list.switch(player.list.audios.length - 1);
      player.play();
      setMusicStatus(`${audio.fallbackPlatform}暂不可播，已切换网易云音源播放《${best.trackName}》 · ${best.artistName}。`);
    } catch (error) {
      console.warn('Netease substitute failed', error);
      setMusicStatus('这首歌暂时无法播放，可能是版权限制或接口繁忙，换一首试试。', true);
    }
  }

  function updateMusicOpenButton(track) {
    const button = $('#musicOpenButton');
    if (track?.originUrl) {
      button.href = track.originUrl;
      button.textContent = `在 ${track.platformName} 打开 ↗`;
      button.className = `button music-open-button ${track.platform}`;
    } else {
      button.className = 'button music-open-button hidden';
    }
  }

  function pauseApplePlayback() {
    try { if (appleMusic?.isPlaying) appleMusic.pause(); } catch { /* 忽略暂停失败 */ }
  }

  function ensureAplayer() {
    if (aplayer || !window.APlayer) return aplayer;
    aplayer = new window.APlayer({
      container: $('#dashboardAPlayer'),
      audio: [],
      lrcType: 3,
      listFolded: false,
      listMaxHeight: '240px',
      autoplay: false,
      preload: 'none',
      theme: '#66d6a7',
      volume: 0.7
    });
    aplayer.on('play', () => {
      pauseApplePlayback();
      const audio = aplayer.list.audios[aplayer.list.index];
      if (!audio) return;
      setMusicStatus(`正在播放《${audio.name}》 · ${audio.artist}${audio.platformName ? ` · ${audio.platformName}` : ''}`);
      updateMusicOpenButton(audio);
      const matched = [...trackStore.values()].find(track => track.url && track.url === audio.url);
      currentMusicId = matched ? matched.id : null;
      renderMusicResults();
    });
    aplayer.on('error', () => {
      const index = aplayer.list.index;
      const audio = aplayer.list.audios[index];
      if (audio?.fallbackTitle && !audio.fallbackTried) {
        substituteWithNetease(audio, index);
        return;
      }
      setMusicStatus('这首歌暂时无法播放，可能是版权限制或接口繁忙，换一首试试。', true);
    });
    return aplayer;
  }

  function playMetingTrack(track) {
    const player = ensureAplayer();
    if (!player) { setMusicStatus('播放器组件未加载成功，请刷新页面重试。', true); return; }
    pauseApplePlayback();
    let index = player.list.audios.findIndex(audio => audio.url === track.url);
    if (index === -1) {
      player.list.add(trackToAplayerAudio(track));
      index = player.list.audios.length - 1;
    }
    player.list.switch(index);
    player.play();
    currentMusicId = track.id;
    updateMusicOpenButton(track);
    renderMusicResults();
  }

  async function loadNeteasePlaylist({ silent = false } = {}) {
    const playlistId = String(musicConfig().neteasePlaylistId || '').trim();
    if (!playlistId) { enterMusicFallback('未配置网易云歌单 ID，当前展示离线歌单快照。'); return; }
    if (!silent) setMusicStatus(`正在载入「${playlistName()}」…`);
    try {
      const data = await metingFetch({ server: 'netease', type: 'playlist', id: playlistId });
      const tracks = (Array.isArray(data) ? data : []).map(item => metingTrackFromApi(item, 'netease')).filter(track => track.url);
      if (!tracks.length) throw new Error('playlist empty');
      metingOnline = true;
      playlistTracks = tracks;
      quickPickTracks = tracks.slice(0, 12);
      const player = ensureAplayer();
      if (player) {
        player.list.clear();
        player.list.add(playlistTracks.map(trackToAplayerAudio));
      }
      if (activeMusicPlatform === 'netease') {
        $('#metingPlayerWrap').classList.remove('hidden');
        $('#musicNowPlaying').classList.add('hidden');
        visibleMusicTracks = quickPickTracks;
        renderMusicResults();
        setMusicStatus(`「${playlistName()}」 · ${tracks.length} 首已就绪，播放器下方可展开完整歌单；也可直接搜索全曲库。`);
      }
    } catch (error) {
      console.warn('Meting playlist load failed', error);
      enterMusicFallback('歌单接口暂时不可用，已切换为离线歌单快照（网易云官方外链播放）。');
    }
  }

  function fallbackCatalog() {
    const snapshot = Array.isArray(window.MUSIC_PLAYLIST_FALLBACK) ? window.MUSIC_PLAYLIST_FALLBACK : [];
    return snapshot.map(item => registerTrack({
      id: `netease-${item.id}`,
      platform: 'netease',
      platformName: '网易云音乐',
      trackName: item.name,
      artistName: item.artist,
      mood: playlistName(),
      color: '#e4473e',
      url: `https://music.163.com/#/song?id=${item.id}`,
      remoteId: String(item.id),
      offline: true
    }));
  }

  function enterMusicFallback(message) {
    metingOnline = false;
    if (activeMusicPlatform !== 'netease') { setMusicStatus(message, true); return; }
    musicTracks = [...musicTracks.filter(track => track.platform === 'apple'), ...fallbackCatalog()];
    $('#metingPlayerWrap').classList.add('hidden');
    $('#musicNowPlaying').classList.remove('hidden');
    filterMusic('');
    setMusicStatus(message, true);
  }

  async function searchMetingMusic(platform, term) {
    const conf = METING_PLATFORMS[platform];
    const query = String(term || '').trim();
    if (!query) { setMusicStatus('请输入歌曲名或歌手名。', true); return; }
    setMusicStatus(`正在${conf.label}搜索“${query}”…`);
    try {
      const data = await metingFetch({ server: conf.server, type: 'search', id: query });
      const tracks = (Array.isArray(data) ? data : []).map(item => metingTrackFromApi(item, platform)).filter(track => track.url);
      visibleMusicTracks = tracks;
      renderMusicResults();
      setMusicStatus(tracks.length
        ? `${conf.label} · 找到 ${tracks.length} 首，点击即可播放。`
        : `${conf.label}没有找到匹配歌曲，换个关键词试试。`, !tracks.length);
    } catch (error) {
      console.warn('Meting search failed', error);
      setMusicStatus(`${conf.label}搜索失败，接口可能暂时繁忙，请稍后重试。`, true);
    }
  }

  function musicPlatformLabel(track) {
    return `<span class="music-platform-badge ${track.platform}"><span class="platform-dot ${track.platform}"></span>${esc(track.platformName)}</span>`;
  }

  function renderMusicResults() {
    const container = $('#musicResults');
    if (!visibleMusicTracks.length) {
      let message = '没有匹配的曲目，换个关键词试试。';
      if (activeMusicPlatform === 'apple') message = '完成 Apple 开发者令牌配置后，这里会显示官方搜索结果。';
      else if (activeMusicPlatform !== 'netease') message = `输入歌手或歌名，开始搜索${METING_PLATFORMS[activeMusicPlatform].label}曲库。`;
      container.innerHTML = `<p class="music-empty">${message}</p>`;
      return;
    }
    container.innerHTML = visibleMusicTracks.map((track, position) => {
      const cover = track.pic || track.artwork || '';
      const resultMark = cover
        ? `<img src="${esc(cover)}" alt="" loading="lazy">`
        : String(position + 1).padStart(2, '0');
      const subtitle = track.mood ? `${esc(track.artistName)} · ${esc(track.mood)}` : esc(track.artistName);
      return `
      <button class="music-result${track.id === currentMusicId ? ' active' : ''}" type="button" data-music-id="${esc(track.id)}" aria-label="播放 ${esc(track.trackName)}，${esc(track.artistName)}，${esc(track.platformName)}">
        <span class="music-result-mark ${track.platform}" style="--track-color:${esc(track.color || '#66d6a7')}" aria-hidden="true">${resultMark}</span>
        <span class="music-result-copy"><strong>${esc(track.trackName)}</strong><span>${subtitle}</span></span>
        ${musicPlatformLabel(track)}
      </button>`;
    }).join('');
  }

  function filterMusic(query = $('#musicSearchInput').value) {
    const term = String(query || '').trim().toLocaleLowerCase('zh-CN');
    const pool = musicTracks.filter(track => track.platform === 'netease' && track.offline);
    visibleMusicTracks = pool
      .filter(track => !term || `${track.trackName} ${track.artistName}`.toLocaleLowerCase('zh-CN').includes(term))
      .slice(0, 60);
    renderMusicResults();
    setMusicStatus(visibleMusicTracks.length
      ? `离线歌单 · 匹配 ${visibleMusicTracks.length} 首${term ? '' : '，输入关键词可筛选'}。`
      : '没有匹配的歌曲，换个关键词试试。', !visibleMusicTracks.length);
  }

  function resetMusicEmbed() {
    const embed = $('#musicEmbed');
    embed.className = 'music-embed hidden';
    embed.innerHTML = '';
  }

  function setNowPlaying(track, overline = `SELECTED · ${track.platformName}`) {
    const artwork = track.artwork
      ? `<div class="music-disc" style="background-image:url('${esc(track.artwork)}');background-size:cover;background-position:center" aria-hidden="true"><span>♪</span></div>`
      : '<div class="music-disc" aria-hidden="true"><span>♪</span></div>';
    const nowPlaying = $('#musicNowPlaying');
    nowPlaying.className = `music-now-playing selected ${track.platform}`;
    nowPlaying.style.setProperty('--track-color', track.color);
    nowPlaying.innerHTML = `
      ${artwork}
      <div class="music-now-copy"><span class="music-overline">${esc(overline)}</span><strong>${esc(track.trackName)}</strong><span>${esc(track.artistName)}${track.mood ? ` · ${esc(track.mood)}` : ''}</span></div>
      ${musicPlatformLabel(track)}`;
  }

  async function playAppleTrack(track) {
    if (!track || track.platform !== 'apple') return;
    if (!appleMusicReady || !appleMusic) {
      setMusicStatus('Apple Music 尚未完成配置，请先连接官方服务。', true);
      return;
    }
    currentMusicId = track.id;
    if (aplayer) aplayer.pause();
    setNowPlaying(track, appleMusic.isAuthorized ? 'NOW PLAYING · APPLE MUSIC' : 'PREVIEW · APPLE MUSIC');
    resetMusicEmbed();
    $('#musicOpenButton').className = 'button music-open-button hidden';
    try {
      setMusicStatus(`正在载入《${track.trackName}》…`);
      await appleMusic.setQueue({ song: track.appleId });
      await appleMusic.play();
      showApplePlaybackControls(true);
      startApplePlaybackUpdates();
      setMusicStatus(appleMusic.isAuthorized
        ? `正在通过 Apple Music 播放《${track.trackName}》。`
        : `正在播放《${track.trackName}》试听片段；连接订阅账号可播放完整歌曲。`);
    } catch (error) {
      console.error('Apple Music playback failed', error);
      setMusicStatus('Apple Music 暂时无法播放这首歌，请确认订阅、地区版权和浏览器权限。', true);
    }
    renderMusicResults();
  }

  function selectExternalMusic(track) {
    if (!track || track.platform !== 'netease') return;
    currentMusicId = track.id;
    if (aplayer) aplayer.pause();
    setNowPlaying(track);
    const embed = $('#musicEmbed');
    const openButton = $('#musicOpenButton');
    openButton.href = track.url;
    openButton.textContent = `在 ${track.platformName} 打开 ↗`;
    openButton.className = 'button music-open-button netease';
    const songId = track.remoteId || track.id.replace('netease-', '');
    embed.className = 'music-embed';
    embed.innerHTML = `<iframe title="网易云音乐播放《${esc(track.trackName)}》" loading="lazy" allow="autoplay" referrerpolicy="strict-origin-when-cross-origin" src="https://music.163.com/outchain/player?type=2&id=${encodeURIComponent(songId)}&auto=0&height=66"></iframe>`;
    setMusicStatus('已载入网易云官方外链播放器；若歌曲因版权不可用，可打开官方歌曲页。');
    renderMusicResults();
  }
  function formatPlaybackTime(seconds) {
    const value = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  function showApplePlaybackControls(show) {
    document.querySelectorAll('.apple-player-button').forEach(button => button.classList.toggle('hidden', !show));
    $('#applePlaybackProgress').classList.toggle('hidden', !show);
  }

  function updateApplePlaybackUI() {
    if (!appleMusic) return;
    const duration = Number(appleMusic.currentPlaybackDuration) || 0;
    const current = Number(appleMusic.currentPlaybackTime) || 0;
    $('#applePlaybackCurrent').textContent = formatPlaybackTime(current);
    $('#applePlaybackDuration').textContent = formatPlaybackTime(duration);
    $('#applePlaybackSeek').value = duration ? String(Math.min(1000, Math.round(current / duration * 1000))) : '0';
    $('#applePlayPauseButton').textContent = appleMusic.isPlaying ? '暂停' : '播放';
  }

  function startApplePlaybackUpdates() {
    clearInterval(applePlaybackTimer);
    updateApplePlaybackUI();
    applePlaybackTimer = setInterval(updateApplePlaybackUI, 750);
  }

  function updateAppleAccountUI() {
    const configured = appleMusicReady && appleMusic;
    const authorized = Boolean(configured && appleMusic.isAuthorized);
    $('#appleMusicConnectButton').disabled = !configured || authorized;
    $('#appleMusicConnectButton').classList.toggle('hidden', authorized);
    $('#appleMusicLibraryButton').classList.toggle('hidden', !authorized);
    $('#appleMusicLogoutButton').classList.toggle('hidden', !authorized);
    if (!configured) return;
    $('#appleMusicAccountTitle').textContent = authorized ? 'Apple Music 已连接' : 'Apple Music 播放器已就绪';
    $('#appleMusicAccountDetail').textContent = authorized
      ? '可播放完整歌曲并查看最近播放记录。'
      : '未登录时仅能试听；连接有效订阅后播放完整歌曲。';
    $('#appleMusicConnectButton').textContent = '连接 Apple Music';
  }

  async function getAppleDeveloperToken() {
    const config = window.APPLE_MUSIC_CONFIG || {};
    if (String(config.developerToken || '').trim()) return String(config.developerToken).trim();
    const endpoint = String(config.developerTokenEndpoint || '').trim();
    if (!endpoint) throw new Error('尚未设置 Apple Music 令牌服务');
    const cloud = window.DASHBOARD_CLOUD_CONFIG || {};
    const headers = { Accept: 'application/json' };
    if (String(cloud.supabaseAnonKey || '').trim()) {
      headers.apikey = cloud.supabaseAnonKey;
      headers.Authorization = `Bearer ${cloud.supabaseAnonKey}`;
    }
    const response = await fetch(endpoint, { headers, cache: 'no-store' });
    if (!response.ok) throw new Error(`Apple Music 令牌服务返回 ${response.status}`);
    const payload = await response.json();
    if (!payload?.token) throw new Error('Apple Music 令牌服务未返回令牌');
    return payload.token;
  }

  function readAppleResponseData(response, path = []) {
    let value = response?.data ?? response;
    path.forEach(key => { value = value?.[key]; });
    return Array.isArray(value?.data) ? value.data : Array.isArray(value) ? value : [];
  }

  function appleArtworkUrl(artwork, size = 96) {
    const template = artwork?.url;
    if (!template) return '';
    return template.replace('{w}', String(size)).replace('{h}', String(size)).replace('{f}', 'jpg');
  }

  function appleResourceToTrack(resource) {
    const attributes = resource?.attributes || {};
    const color = attributes.artwork?.bgColor ? `#${attributes.artwork.bgColor}` : '#fa2d48';
    return registerTrack({
      id: `apple-${resource.id}`,
      appleId: resource.id,
      platform: 'apple',
      platformName: 'Apple Music',
      trackName: attributes.name || '未知歌曲',
      artistName: attributes.artistName || '未知歌手',
      mood: attributes.albumName || attributes.genreNames?.[0] || 'Apple Music',
      color,
      artwork: appleArtworkUrl(attributes.artwork, 160),
      url: attributes.url || `https://music.apple.com/cn/song/${resource.id}`
    });
  }

  async function searchAppleMusic(term, { silent = false } = {}) {
    const query = String(term || '').trim();
    if (!query) {
      setMusicStatus('请输入歌曲名或歌手名。', true);
      return;
    }
    if (!appleMusicReady || !appleMusic) {
      setMusicStatus('Apple Music 令牌尚未配置，完成开发者设置后即可搜索官方曲库。', true);
      return;
    }
    if (!silent) setMusicStatus(`正在 Apple Music 搜索“${query}”…`);
    try {
      const response = await appleMusic.api.music(`/v1/catalog/${appleMusic.storefrontId || 'cn'}/search`, {
        term: query,
        types: 'songs',
        limit: '25'
      });
      const resources = readAppleResponseData(response, ['results', 'songs']);
      const appleTracks = resources.map(appleResourceToTrack);
      musicTracks = [...musicTracks.filter(track => track.platform !== 'apple'), ...appleTracks];
      if (activeMusicPlatform === 'apple') {
        visibleMusicTracks = appleTracks;
        currentMusicId = null;
        renderMusicResults();
        setMusicStatus(appleTracks.length ? `Apple Music · 找到 ${appleTracks.length} 首歌曲。` : 'Apple Music 没有找到匹配歌曲。', !appleTracks.length);
      }
    } catch (error) {
      console.error('Apple Music search failed', error);
      if (activeMusicPlatform === 'apple') setMusicStatus('Apple Music 搜索失败，请稍后重试或检查开发者令牌。', true);
    }
  }

  async function loadAppleRecentTracks() {
    if (!appleMusic?.isAuthorized) {
      setMusicStatus('请先连接 Apple Music 账号。', true);
      return;
    }
    setMusicStatus('正在读取 Apple Music 最近播放…');
    try {
      const response = await appleMusic.api.music('/v1/me/recent/played/tracks', { limit: '25' });
      const resources = readAppleResponseData(response);
      const appleTracks = resources.filter(item => item.type === 'songs').map(appleResourceToTrack);
      musicTracks = [...musicTracks.filter(track => track.platform !== 'apple'), ...appleTracks];
      if (activeMusicPlatform === 'apple') {
        visibleMusicTracks = appleTracks;
        currentMusicId = null;
        renderMusicResults();
        setMusicStatus(appleTracks.length ? `已载入 ${appleTracks.length} 首最近播放。` : '最近播放记录为空。');
      }
    } catch (error) {
      console.error('Apple Music history failed', error);
      setMusicStatus('暂时无法读取最近播放，请重新授权后再试。', true);
    }
  }

  async function configureAppleMusic() {
    if (appleMusicConfigured || !window.MusicKit) return;
    appleMusicConfigured = true;
    try {
      const token = await getAppleDeveloperToken();
      const config = window.APPLE_MUSIC_CONFIG || {};
      appleMusic = await window.MusicKit.configure({
        developerToken: token,
        storefrontId: config.storefrontId || 'cn',
        app: { name: 'Personal Dashboard', build: '1.1.0' }
      });
      appleMusicReady = true;
      appleMusic.addEventListener('nowPlayingItemDidChange', updateApplePlaybackUI);
      appleMusic.addEventListener('playbackStateDidChange', updateApplePlaybackUI);
      updateAppleAccountUI();
      await searchAppleMusic('华语流行', { silent: true });
    } catch (error) {
      console.error('Apple Music configuration failed', error);
      appleMusicConfigured = false;
      $('#appleMusicAccountTitle').textContent = '需要完成 Apple 开发者配置';
      $('#appleMusicAccountDetail').textContent = '播放器界面已接入；配置安全令牌后即可授权、搜索和播放。';
      $('#appleMusicConnectButton').disabled = true;
      if (activeMusicPlatform === 'apple') {
        setMusicStatus('Apple Music 播放器已安装，等待配置官方开发者密钥。');
        renderMusicResults();
      }
    }
  }

  async function authorizeAppleMusic() {
    if (!appleMusicReady || !appleMusic) return;
    const button = $('#appleMusicConnectButton');
    button.disabled = true;
    button.textContent = '正在连接…';
    try {
      await appleMusic.authorize();
      updateAppleAccountUI();
      setMusicStatus(appleMusic.isAuthorized ? 'Apple Music 已连接，可以直接播放完整歌曲。' : '未完成 Apple Music 授权。', !appleMusic.isAuthorized);
    } catch (error) {
      console.error('Apple Music authorization failed', error);
      setMusicStatus('Apple Music 授权未完成，请确认账号订阅状态后重试。', true);
      updateAppleAccountUI();
    }
  }

  async function unauthorizeAppleMusic() {
    if (!appleMusic) return;
    try {
      await appleMusic.unauthorize();
      updateAppleAccountUI();
      setMusicStatus('已断开 Apple Music；仍可播放官方试听片段。');
    } catch {
      setMusicStatus('断开 Apple Music 失败，请刷新页面后重试。', true);
    }
  }

  function switchMusicPlatform(platform) {
    activeMusicPlatform = platform;
    currentMusicId = null;
    resetMusicEmbed();
    const isApple = platform === 'apple';
    $('#appleMusicPanel').classList.toggle('hidden', !isApple);
    $('#metingPlayerWrap').classList.toggle('hidden', isApple || !metingOnline);
    $('#musicNowPlaying').classList.toggle('hidden', !isApple && metingOnline);
    showApplePlaybackControls(isApple && Boolean(appleMusic?.nowPlayingItem));
    updateMusicOpenButton(null);
    const notice = $('#musicProviderNotice');
    if (isApple) {
      if (aplayer) aplayer.pause();
      notice.classList.add('hidden');
      $('#musicSearchInput').placeholder = '在 Apple Music 搜索歌曲或歌手';
      $('#musicShowAllButton').textContent = '华语精选';
      visibleMusicTracks = musicTracks.filter(track => track.platform === 'apple');
      renderMusicResults();
      setMusicStatus(appleMusicReady ? '输入歌曲或歌手，直接搜索 Apple Music 官方曲库。' : 'Apple Music 播放器等待开发者令牌配置。');
      return;
    }
    const conf = METING_PLATFORMS[platform];
    notice.classList.remove('hidden');
    $('#musicSearchInput').placeholder = `在${conf.label}搜索歌曲或歌手`;
    if (platform === 'netease') {
      $('#musicShowAllButton').textContent = '返回我的歌单';
      if (metingOnline) {
        notice.innerHTML = `<strong>网易云音乐 · 聚合播放：</strong>默认展示你的歌单「${esc(playlistName())}」，也可以直接搜索网易云全曲库在线播放。播放地址由 Meting 公共接口解析，少数歌曲可能因版权限制无法播放。`;
        visibleMusicTracks = quickPickTracks;
        renderMusicResults();
        if (playlistTracks.length) {
          setMusicStatus(`「${playlistName()}」 · ${playlistTracks.length} 首已就绪，播放器下方可展开完整歌单。`);
        } else {
          setMusicStatus(`正在载入「${playlistName()}」…`);
          loadNeteasePlaylist();
        }
      } else {
        notice.innerHTML = '<strong>离线模式：</strong>聚合接口暂时不可用，正在展示歌单快照；点击歌曲将使用网易云官方外链播放器播放。';
        filterMusic('');
      }
      return;
    }
    $('#musicShowAllButton').textContent = '清空搜索';
    notice.innerHTML = `<strong>${conf.label} · 聚合播放：</strong>可搜索${conf.label}曲库并在线播放。${conf.label}部分歌曲受版权限制，遇到不可播放时会自动切换网易云同名音源代播，并保留「在${conf.label}打开」入口。`;
    visibleMusicTracks = [];
    renderMusicResults();
    setMusicStatus(`输入歌手或歌名，搜索${conf.label}曲库；也可以点“随机选一首”。`);
  }

  async function handleMusicRandom() {
    if (activeMusicPlatform === 'apple') {
      const candidates = visibleMusicTracks.length ? visibleMusicTracks : musicTracks.filter(track => track.platform === 'apple');
      if (!candidates.length) { setMusicStatus('请先搜索一首 Apple Music 歌曲。', true); return; }
      playAppleTrack(candidates[Math.floor(Math.random() * candidates.length)]);
      return;
    }
    if (activeMusicPlatform === 'netease') {
      if (!metingOnline) {
        const pool = musicTracks.filter(track => track.platform === 'netease' && track.offline);
        if (!pool.length) { setMusicStatus('当前没有可选择的歌曲。', true); return; }
        selectExternalMusic(pool[Math.floor(Math.random() * pool.length)]);
        return;
      }
      if (!playlistTracks.length) await loadNeteasePlaylist({ silent: true });
      if (!playlistTracks.length) { setMusicStatus('歌单还没有载入完成，稍后再试。', true); return; }
      playMetingTrack(playlistTracks[Math.floor(Math.random() * playlistTracks.length)]);
      return;
    }
    const conf = METING_PLATFORMS[activeMusicPlatform];
    const word = RANDOM_SEARCH_WORDS[Math.floor(Math.random() * RANDOM_SEARCH_WORDS.length)];
    setMusicStatus(`随机灵感“${word}”，正在${conf.label}找歌…`);
    try {
      const data = await metingFetch({ server: conf.server, type: 'search', id: word });
      const tracks = (Array.isArray(data) ? data : []).map(item => metingTrackFromApi(item, activeMusicPlatform)).filter(track => track.url);
      if (!tracks.length) { setMusicStatus('这次没有找到可播放的歌曲，再点一次试试。', true); return; }
      visibleMusicTracks = tracks;
      renderMusicResults();
      playMetingTrack(tracks[Math.floor(Math.random() * Math.min(5, tracks.length))]);
    } catch (error) {
      console.warn('Meting random search failed', error);
      setMusicStatus(`${conf.label}接口暂时繁忙，稍后再试。`, true);
    }
  }

  function initMusic() {
    renderMusicResults();
    $('#musicSearchForm').addEventListener('submit', event => {
      event.preventDefault();
      const term = $('#musicSearchInput').value;
      if (activeMusicPlatform === 'apple') searchAppleMusic(term);
      else if (activeMusicPlatform === 'netease' && !metingOnline) filterMusic(term);
      else searchMetingMusic(activeMusicPlatform, term);
    });
    $('#musicSearchInput').addEventListener('input', event => {
      if (activeMusicPlatform === 'netease' && !metingOnline) filterMusic(event.currentTarget.value);
    });
    $('#musicPlatformTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-music-platform]');
      if (!button) return;
      document.querySelectorAll('[data-music-platform]').forEach(tab => {
        const isActive = tab === button;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-pressed', String(isActive));
      });
      $('#musicSearchInput').value = '';
      switchMusicPlatform(button.dataset.musicPlatform);
    });
    $('#musicResults').addEventListener('click', event => {
      const button = event.target.closest('[data-music-id]');
      if (!button) return;
      const track = trackStore.get(button.dataset.musicId);
      if (!track) return;
      if (track.platform === 'apple') playAppleTrack(track);
      else if (track.offline) selectExternalMusic(track);
      else playMetingTrack(track);
    });
    $('#musicRandomButton').addEventListener('click', handleMusicRandom);
    $('#musicShowAllButton').addEventListener('click', () => {
      $('#musicSearchInput').value = '';
      if (activeMusicPlatform === 'apple') { searchAppleMusic('华语流行'); return; }
      if (activeMusicPlatform === 'netease') {
        if (metingOnline) {
          visibleMusicTracks = quickPickTracks;
          renderMusicResults();
          if (playlistTracks.length) {
            setMusicStatus(`「${playlistName()}」 · ${playlistTracks.length} 首已就绪，播放器下方可展开完整歌单。`);
          } else {
            setMusicStatus(`正在载入「${playlistName()}」…`);
            loadNeteasePlaylist();
          }
        } else filterMusic('');
        return;
      }
      visibleMusicTracks = [];
      renderMusicResults();
      setMusicStatus(`输入歌手或歌名，搜索${METING_PLATFORMS[activeMusicPlatform].label}曲库。`);
    });
    $('#appleMusicConnectButton').addEventListener('click', authorizeAppleMusic);
    $('#appleMusicLogoutButton').addEventListener('click', unauthorizeAppleMusic);
    $('#appleMusicLibraryButton').addEventListener('click', loadAppleRecentTracks);
    $('#applePlayPauseButton').addEventListener('click', async () => {
      if (!appleMusic) return;
      try {
        if (appleMusic.isPlaying) appleMusic.pause();
        else await appleMusic.play();
        updateApplePlaybackUI();
      } catch { setMusicStatus('浏览器阻止了自动播放，请再次点击播放。', true); }
    });
    $('#applePreviousButton').addEventListener('click', async () => {
      try { await appleMusic?.skipToPreviousItem(); } catch { setMusicStatus('已经是播放队列中的第一首。'); }
    });
    $('#appleNextButton').addEventListener('click', async () => {
      try { await appleMusic?.skipToNextItem(); } catch { setMusicStatus('已经是播放队列中的最后一首。'); }
    });
    $('#applePlaybackSeek').addEventListener('change', async event => {
      if (!appleMusic) return;
      const duration = Number(appleMusic.currentPlaybackDuration) || 0;
      try { await appleMusic.seekToTime(duration * Number(event.currentTarget.value) / 1000); } catch { /* 忽略拖动失败 */ }
    });
    switchMusicPlatform('netease');
    if (window.MusicKit) configureAppleMusic();
    else document.addEventListener('musickitloaded', configureAppleMusic, { once: true });
  }

  function monthPrefix() { return todayKey().slice(0, 7); }

  function renderMonthlyReview() {
    if (!$('#monthlyOverview')) return;
    const prefix = monthPrefix();
    const now = parseLocalDate(todayKey());
    const daysElapsed = now.getDate();
    const monthChecks = Object.entries(habitChecks).filter(([date]) => date.startsWith(prefix));
    const habitCounts = habits.map(habit => ({
      ...habit,
      count: monthChecks.filter(([, checks]) => checks?.[habit.id]).length
    }));
    const noteDays = Object.entries(notes).filter(([date, value]) => date.startsWith(prefix) && String(value).trim()).length;
    const completedTodos = todoCompletions.filter(record => record.date?.startsWith(prefix)).length;
    const totalHabitChecks = habitCounts.reduce((sum, habit) => sum + habit.count, 0);
    const possibleHabitChecks = habits.length * daysElapsed;
    const habitRate = possibleHabitChecks ? Math.round(totalHabitChecks / possibleHabitChecks * 100) : 0;

    $('#monthlyLabel').textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
    $('#monthlyOverview').innerHTML = [
      [completedTodos, '完成 To-Do'], [noteDays, '写下 Daily Note'], [`${habitRate}%`, '习惯完成率']
    ].map(([value, label]) => `<div class="monthly-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('#monthlyHabits').innerHTML = habitCounts.length ? habitCounts.map(habit => {
      const rate = Math.min(100, Math.round(habit.count / daysElapsed * 100));
      return `<div class="monthly-habit">
        <div class="monthly-habit-head"><span>${esc(habit.name)}</span><span>${habit.count} 次 / ${daysElapsed} 天</span></div>
        <div class="monthly-progress" role="progressbar" aria-label="${esc(habit.name)}本月完成率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rate}"><div class="monthly-progress-fill" style="width:${rate}%"></div></div>
      </div>`;
    }).join('') : empty('暂无习惯数据。');

    let comment = '这个月还在展开中，慢慢把小事做实。';
    if (habitRate >= 70 && noteDays >= Math.ceil(daysElapsed / 2)) comment = '这个月相当稳，生活的齿轮咬合得不错。';
    else if (completedTodos >= daysElapsed) comment = '任务推进很扎实，混乱本月暂时处于下风。';
    else if (!completedTodos && !noteDays && !totalHabitChecks) comment = '本月数据还很安静。今天记下一笔，就算开张。';
    $('#monthlyComment').textContent = comment;
  }

  function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function validDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = parseLocalDate(value);
    return !Number.isNaN(parsed.getTime()) && formatDateKey(parsed) === value;
  }
  function validId(value) { return typeof value === 'string' && value.length > 0; }

  function validateBackup(backup) {
    if (!isPlainObject(backup) || backup.app !== 'Personal Dashboard' || backup.version !== 1 || !isPlainObject(backup.data)) {
      return '这不是有效的 Personal Dashboard 备份文件。';
    }
    const data = backup.data;
    if (!Array.isArray(data[STORAGE.todos]) || !data[STORAGE.todos].every(item => isPlainObject(item) && validId(item.id) && typeof item.text === 'string' && typeof item.completed === 'boolean')) return '待办数据结构不正确。';
    if (!Array.isArray(data[STORAGE.habits]) || !data[STORAGE.habits].every(item => isPlainObject(item) && validId(item.id) && typeof item.name === 'string')) return '习惯数据结构不正确。';
    if (!isPlainObject(data[STORAGE.habitChecks]) || !Object.entries(data[STORAGE.habitChecks]).every(([date, checks]) => validDateKey(date) && isPlainObject(checks) && Object.values(checks).every(value => value === true))) return '习惯打卡数据结构不正确。';
    if (!Array.isArray(data[STORAGE.todoCompletions]) || !data[STORAGE.todoCompletions].every(item => isPlainObject(item) && validId(item.id) && validId(item.todoId) && typeof item.text === 'string' && validDateKey(item.date))) return '待办完成记录结构不正确。';
    if (!Array.isArray(data[STORAGE.events]) || !data[STORAGE.events].every(item => isPlainObject(item) && validId(item.id) && typeof item.name === 'string' && validDateKey(item.date) && typeof item.note === 'string')) return '重要日期数据结构不正确。';
    if (!Array.isArray(data[STORAGE.links]) || !data[STORAGE.links].every(item => isPlainObject(item) && validId(item.id) && typeof item.name === 'string' && typeof item.url === 'string' && Boolean(normalizeUrl(item.url)))) return '快捷链接数据结构不正确。';
    if (!Array.isArray(data[STORAGE.projects]) || !data[STORAGE.projects].every(item => isPlainObject(item) && validId(item.id) && typeof item.name === 'string' && typeof item.stage === 'string' && validDateKey(item.deadline) && Number.isFinite(Number(item.progress)) && Number(item.progress) >= 0 && Number(item.progress) <= 100 && typeof item.note === 'string')) return '项目数据结构不正确。';
    if (!isPlainObject(data[STORAGE.notes]) || !Object.entries(data[STORAGE.notes]).every(([date, value]) => validDateKey(date) && typeof value === 'string')) return '每日记录数据结构不正确。';
    if (Object.hasOwn(data, STORAGE.weatherLocation) && data[STORAGE.weatherLocation] !== null && !isValidWeatherLocation(data[STORAGE.weatherLocation])) return '天气城市数据结构不正确。';
    if (Object.hasOwn(data, STORAGE.weatherData) && data[STORAGE.weatherData] !== null && !isValidWeatherData(data[STORAGE.weatherData])) return '天气缓存数据结构不正确。';
    if (Object.hasOwn(data, STORAGE.weatherUpdatedAt) && data[STORAGE.weatherUpdatedAt] !== null &&
      (typeof data[STORAGE.weatherUpdatedAt] !== 'string' || Number.isNaN(new Date(data[STORAGE.weatherUpdatedAt]).getTime()))) return '天气更新时间结构不正确。';
    return '';
  }

  function backupSnapshot() {
    return {
      [STORAGE.todos]: todos,
      [STORAGE.habits]: habits,
      [STORAGE.habitChecks]: habitChecks,
      [STORAGE.todoCompletions]: todoCompletions,
      [STORAGE.events]: events,
      [STORAGE.links]: links,
      [STORAGE.projects]: projects,
      [STORAGE.notes]: notes,
      [STORAGE.weatherLocation]: loadWeatherLocation(),
      [STORAGE.weatherData]: loadWeatherData(),
      [STORAGE.weatherUpdatedAt]: localStorage.getItem(WEATHER_UPDATED_AT_KEY)
    };
  }

  function exportData() {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; saveNote(); }
    const payload = { app: 'Personal Dashboard', version: 1, exportedAt: new Date().toISOString(), data: backupSnapshot() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `personal-dashboard-backup-${todayKey()}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('数据备份已导出。');
  }

  function storeDashboardData(data) {
    Object.values(STORAGE).forEach(key => {
      if (!Object.hasOwn(data, key) || data[key] === null) {
        localStorage.removeItem(key);
      } else if (key === WEATHER_UPDATED_AT_KEY) {
        localStorage.setItem(key, data[key]);
      } else {
        localStorage.setItem(key, JSON.stringify(data[key]));
      }
    });
  }

  async function importData(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('备份文件过大，请检查文件是否正确。', 'error');
    try {
      const backup = JSON.parse(await file.text());
      const error = validateBackup(backup);
      if (error) return toast(error, 'error');
      storeDashboardData(backup.data);
      localStorage.setItem(SYNC_DIRTY_AT_KEY, new Date().toISOString());
      toast('数据恢复成功，正在刷新页面。');
      setTimeout(() => location.reload(), 650);
    } catch {
      toast('无法读取这个 JSON 文件，请检查文件内容。', 'error');
    }
  }

  function renderTodos() {
    $('#todoList').innerHTML = todos.length ? todos.map(todo => `
      <li class="list-row ${todo.completed ? 'done' : ''}">
        <input type="checkbox" data-action="toggle-todo" data-id="${todo.id}" ${todo.completed ? 'checked' : ''} aria-label="完成 ${esc(todo.text)}">
        <span class="item-text">${esc(todo.text)}</span>
        <button class="icon-button" data-action="delete-todo" data-id="${todo.id}" type="button" aria-label="删除 ${esc(todo.text)}">×</button>
      </li>`).join('') : empty('今天还没有待办。空气里短暂地充满了自由。');
    updateSummary();
    renderMonthlyReview();
  }

  function renderHabits() {
    const today = todayKey();
    const thisWeek = weekKeys();
    $('#habitDateLabel').textContent = `${today.slice(5).replace('-', '/')} · 本周`;
    $('#habitList').innerHTML = habits.length ? habits.map(habit => {
      const checked = Boolean(habitChecks[today]?.[habit.id]);
      const weekly = thisWeek.filter(day => habitChecks[day]?.[habit.id]).length;
      return `<div class="habit-item ${checked ? 'checked' : ''}">
        <label class="habit-check">
          <input type="checkbox" data-action="toggle-habit" data-id="${habit.id}" ${checked ? 'checked' : ''}>
          <span>${esc(habit.name)}</span>
        </label>
        <span class="habit-meta">本周 ${weekly}/7</span>
        <button class="icon-button" data-action="delete-habit" data-id="${habit.id}" type="button" aria-label="删除 ${esc(habit.name)}">×</button>
      </div>`;
    }).join('') : empty('还没有习惯。可以从一个小到不好意思失败的目标开始。');
    updateSummary();
    renderMonthlyReview();
  }

  function renderEvents() {
    const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
    $('#countdownList').innerHTML = sorted.length ? sorted.map(event => {
      const days = dayDifference(event.date);
      const label = days > 0 ? `还有 ${days} 天` : days < 0 ? `已过去 ${Math.abs(days)} 天` : '就是今天';
      return `<article class="countdown-item">
        <div><p class="item-title">${esc(event.name)}</p><p class="item-note">${prettyDate(event.date)}${event.note ? ` · ${esc(event.note)}` : ''}</p></div>
        <span class="count-badge ${days < 0 ? 'past' : ''}">${label}</span>
        <button class="icon-button" data-action="delete-event" data-id="${event.id}" type="button" aria-label="删除 ${esc(event.name)}">×</button>
      </article>`;
    }).join('') : empty('暂无重要日期。日历现在很安静。');
  }

  function renderLinks() {
    $('#linkList').innerHTML = links.length ? links.map(link => `
      <div class="link-item">
        <a class="quick-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">
          <span class="link-mark">${esc(link.name.trim().charAt(0).toUpperCase() || '?')}</span><span class="link-name">${esc(link.name)}</span>
        </a>
        <button class="icon-button" data-action="delete-link" data-id="${link.id}" type="button" aria-label="删除 ${esc(link.name)}">×</button>
      </div>`).join('') : empty('暂无快捷链接。');
  }

  function projectDeadlineText(deadline) {
    const days = dayDifference(deadline);
    if (days < 0) return `已逾期 ${Math.abs(days)} 天`;
    if (days === 0) return '今天截止';
    return `${days} 天后截止`;
  }

  function renderProjects() {
    const sorted = [...projects].sort((a, b) => a.deadline.localeCompare(b.deadline));
    $('#projectList').innerHTML = sorted.length ? sorted.map(project => {
      const days = dayDifference(project.deadline);
      const urgent = days >= 0 && days <= 3 && Number(project.progress) < 100;
      return `<article class="project-item ${urgent ? 'urgent' : ''}">
        <div class="project-top"><div><p class="item-title">${esc(project.name)}</p><span class="project-stage">${esc(project.stage)}</span></div>
          <div class="project-actions">
            <button class="icon-button" data-action="edit-project" data-id="${project.id}" type="button" aria-label="编辑 ${esc(project.name)}">✎</button>
            <button class="icon-button" data-action="delete-project" data-id="${project.id}" type="button" aria-label="删除 ${esc(project.name)}">×</button>
          </div>
        </div>
        <div class="progress-line"><span>进度</span><strong>${project.progress}%</strong></div>
        <div class="progress-track"><div class="progress-fill" style="width:${project.progress}%"></div></div>
        <p class="deadline">${prettyDate(project.deadline)} · ${projectDeadlineText(project.deadline)}</p>
        ${project.note ? `<p class="item-note">${esc(project.note)}</p>` : ''}
      </article>`;
    }).join('') : empty('还没有项目。先建一个，给野心找个住处。');
    updateSummary();
  }

  function showProjectForm(project = null) {
    editingProjectId = project?.id || null;
    $('#projectName').value = project?.name || '';
    $('#projectStage').value = project?.stage || '';
    $('#projectDeadline').value = project?.deadline || todayKey();
    $('#projectProgress').value = project?.progress ?? 50;
    $('#progressOutput').textContent = `${project?.progress ?? 50}%`;
    $('#projectNote').value = project?.note || '';
    $('#saveProject').textContent = project ? '保存修改' : '保存项目';
    $('#projectForm').classList.remove('is-hidden');
    $('#toggleProjectForm').classList.add('is-hidden');
    $('#projectName').focus();
  }

  function hideProjectForm() {
    editingProjectId = null;
    $('#projectForm').reset();
    $('#projectProgress').value = 50;
    $('#progressOutput').textContent = '50%';
    $('#projectForm').classList.add('is-hidden');
    $('#toggleProjectForm').classList.remove('is-hidden');
  }

  function loadNote(dateKey) {
    $('#dailyNote').value = notes[dateKey] || '';
    $('#saveStatus').textContent = dateKey === todayKey() ? '更改将自动保存' : `正在查看 ${prettyDate(dateKey)}`;
    $('#saveStatus').classList.remove('saved');
  }

  function saveNote() {
    const date = $('#noteDate').value;
    const value = $('#dailyNote').value;
    if (value.trim()) notes[date] = value;
    else delete notes[date];
    write(STORAGE.notes, notes);
    $('#saveStatus').textContent = '已自动保存';
    $('#saveStatus').classList.add('saved');
    updateSummary();
    renderMonthlyReview();
  }

  function updateSummary() {
    if (!$('#summaryStats')) return;
    const completedTodos = todos.filter(todo => todo.completed).length;
    const checkedToday = habits.filter(habit => habitChecks[todayKey()]?.[habit.id]).length;
    const urgentProjects = projects.filter(project => {
      const days = dayDifference(project.deadline);
      return days >= 0 && days <= 3 && Number(project.progress) < 100;
    }).length;
    const hasNote = Boolean((notes[todayKey()] || '').trim());
    $('#summaryStats').innerHTML = [
      [`${completedTodos}/${todos.length}`, '今日待办完成'], [`${checkedToday}/${habits.length}`, '今日习惯完成'],
      [urgentProjects, '临近截止项目'], [hasNote ? '写了' : '未写', 'Daily Note']
    ].map(([value, label]) => `<div class="summary-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');

    const todoRate = todos.length ? completedTodos / todos.length : 0;
    const habitRate = habits.length ? checkedToday / habits.length : 0;
    let comment = '今天还算像个有计划的人类。';
    if (todos.length >= 8 && todoRate < .5) comment = '今天的待办有点多，建议别继续假装自己是机器。';
    else if (todoRate >= .75 && todos.length) comment = '任务完成得不错，混乱暂时被压住了。';
    else if (habitRate >= .65) comment = '习惯完成率不错，文明微微前进了一步。';
    else if (!todos.length && checkedToday === 0 && !hasNote) comment = '仪表盘很安静。挑一件小事开始，局面就会不同。';
    $('#summaryComment').textContent = comment;
  }

  function normalizeUrl(value) {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(normalized);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
      return url.href;
    } catch { return null; }
  }

  $('#exportData').addEventListener('click', exportData);
  $('#importData').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', event => {
    importData(event.target.files?.[0]);
    event.target.value = '';
  });

  $('#todoForm').addEventListener('submit', event => {
    event.preventDefault();
    const text = $('#todoInput').value.trim();
    if (!text) return toast('待办内容不能为空。', 'error');
    todos.unshift({ id: uid(), text, completed: false, createdAt: todayKey(), completedAt: null });
    write(STORAGE.todos, todos); event.target.reset(); renderTodos(); toast('待办已添加。');
  });
  $('#todoList').addEventListener('change', event => {
    if (event.target.dataset.action !== 'toggle-todo') return;
    const todo = todos.find(item => item.id === event.target.dataset.id);
    if (todo) {
      todo.completed = event.target.checked;
      if (event.target.checked) {
        todo.completedAt = todayKey();
        if (!todoCompletions.some(record => record.todoId === todo.id)) {
          todoCompletions.push({ id: uid(), todoId: todo.id, text: todo.text, date: todayKey() });
        }
      } else {
        todo.completedAt = null;
        todoCompletions = todoCompletions.filter(record => record.todoId !== todo.id);
      }
      write(STORAGE.todos, todos);
      write(STORAGE.todoCompletions, todoCompletions);
      renderTodos();
    }
  });
  $('#todoList').addEventListener('click', event => {
    const button = event.target.closest('[data-action="delete-todo"]');
    if (!button) return;
    todos = todos.filter(item => item.id !== button.dataset.id); write(STORAGE.todos, todos); renderTodos(); toast('待办已删除。');
  });
  $('#clearCompleted').addEventListener('click', () => {
    const count = todos.filter(todo => todo.completed).length;
    if (!count) return toast('目前没有已完成待办。');
    todos = todos.filter(todo => !todo.completed); write(STORAGE.todos, todos); renderTodos(); toast(`已清理 ${count} 条待办。`);
  });

  $('#habitForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#habitInput').value.trim();
    if (!name) return toast('习惯名称不能为空。', 'error');
    if (habits.some(item => item.name.toLowerCase() === name.toLowerCase())) return toast('这个习惯已经存在。', 'error');
    habits.push({ id: uid(), name }); write(STORAGE.habits, habits); event.target.reset(); renderHabits(); toast('新习惯已加入。');
  });
  $('#habitList').addEventListener('change', event => {
    if (event.target.dataset.action !== 'toggle-habit') return;
    const date = todayKey();
    habitChecks[date] ||= {};
    if (event.target.checked) habitChecks[date][event.target.dataset.id] = true;
    else delete habitChecks[date][event.target.dataset.id];
    if (!Object.keys(habitChecks[date]).length) delete habitChecks[date];
    write(STORAGE.habitChecks, habitChecks); renderHabits();
  });
  $('#habitList').addEventListener('click', event => {
    const button = event.target.closest('[data-action="delete-habit"]');
    if (!button) return;
    habits = habits.filter(item => item.id !== button.dataset.id);
    Object.values(habitChecks).forEach(day => delete day[button.dataset.id]);
    write(STORAGE.habits, habits); write(STORAGE.habitChecks, habitChecks); renderHabits(); toast('习惯已删除。');
  });

  $('#countdownForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#eventName').value.trim(); const date = $('#eventDate').value; const note = $('#eventNote').value.trim();
    if (!name || !date) return toast('请填写事件名称和日期。', 'error');
    events.push({ id: uid(), name, date, note }); write(STORAGE.events, events); event.target.reset(); renderEvents(); toast('重要日期已添加。');
  });
  $('#countdownList').addEventListener('click', event => {
    const button = event.target.closest('[data-action="delete-event"]');
    if (!button) return;
    events = events.filter(item => item.id !== button.dataset.id); write(STORAGE.events, events); renderEvents(); toast('日期已删除。');
  });

  $('#linkForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#linkName').value.trim(); const url = normalizeUrl($('#linkUrl').value.trim());
    if (!name) return toast('请填写链接名称。', 'error');
    if (!url) return toast('请输入有效的网址。', 'error');
    links.push({ id: uid(), name, url }); write(STORAGE.links, links); event.target.reset(); renderLinks(); toast('快捷链接已添加。');
  });
  $('#linkList').addEventListener('click', event => {
    const button = event.target.closest('[data-action="delete-link"]');
    if (!button) return;
    event.preventDefault(); links = links.filter(item => item.id !== button.dataset.id); write(STORAGE.links, links); renderLinks(); toast('快捷链接已删除。');
  });

  $('#toggleProjectForm').addEventListener('click', () => showProjectForm());
  $('#cancelProject').addEventListener('click', hideProjectForm);
  $('#projectProgress').addEventListener('input', event => { $('#progressOutput').textContent = `${event.target.value}%`; });
  $('#projectForm').addEventListener('submit', event => {
    event.preventDefault();
    const data = {
      name: $('#projectName').value.trim(), stage: $('#projectStage').value.trim(), deadline: $('#projectDeadline').value,
      progress: Math.min(100, Math.max(0, Number($('#projectProgress').value))), note: $('#projectNote').value.trim()
    };
    if (!data.name || !data.stage || !data.deadline) return toast('请填写项目名称、阶段和截止日期。', 'error');
    if (editingProjectId) {
      const project = projects.find(item => item.id === editingProjectId);
      if (project) Object.assign(project, data);
      toast('项目修改已保存。');
    } else { projects.push({ id: uid(), ...data }); toast('项目已创建。'); }
    write(STORAGE.projects, projects); hideProjectForm(); renderProjects();
  });
  $('#projectList').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const project = projects.find(item => item.id === button.dataset.id);
    if (button.dataset.action === 'edit-project' && project) showProjectForm(project);
    if (button.dataset.action === 'delete-project') {
      projects = projects.filter(item => item.id !== button.dataset.id); write(STORAGE.projects, projects); renderProjects(); toast('项目已删除。');
    }
  });

  $('#noteDate').addEventListener('change', event => { clearTimeout(noteTimer); loadNote(event.target.value); });
  $('#dailyNote').addEventListener('input', () => {
    clearTimeout(noteTimer);
    $('#saveStatus').textContent = '正在保存…'; $('#saveStatus').classList.remove('saved');
    noteTimer = setTimeout(saveNote, 500);
  });
  window.addEventListener('beforeunload', () => { if (noteTimer) { clearTimeout(noteTimer); saveNote(); } });

  function init() {
    updateHeader(); setInterval(updateHeader, 1000);
    const quoteIndex = Number(todayKey().replaceAll('-', '')) % quotes.length;
    $('#quote').textContent = quotes[quoteIndex];
    $('#eventDate').min = '';
    $('#noteDate').value = todayKey();
    loadNote(todayKey());
    initWeather(); initMusic(); renderTodos(); renderHabits(); renderEvents(); renderLinks(); renderProjects(); updateSummary(); renderMonthlyReview();
  }

  window.PersonalDashboardCloudBridge = {
    getSnapshot: backupSnapshot,
    notify: toast,
    getDirtyAt: () => localStorage.getItem(SYNC_DIRTY_AT_KEY),
    clearDirty: () => localStorage.removeItem(SYNC_DIRTY_AT_KEY),
    applySnapshot(data) {
      const error = validateBackup({ app: 'Personal Dashboard', version: 1, data });
      if (error) throw new Error(error);
      storeDashboardData(data);
      localStorage.removeItem(SYNC_DIRTY_AT_KEY);
      location.reload();
    }
  };

  init();
  dashboardInitialized = true;
  window.dispatchEvent(new CustomEvent('dashboard:ready'));
})();
