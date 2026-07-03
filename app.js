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
  let currentMusicIndex = -1;
  let musicAudioContext = null;
  let musicMaster = null;
  let musicSchedulerTimer = null;
  let musicNoiseBuffer = null;
  let musicNextStepTime = 0;
  let musicStep = 0;
  let musicIsPlaying = false;

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

  function setMusicStatus(message, isError = false) {
    const status = $('#musicStatus');
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function createMusicCatalog() {
    const moods = ['午夜', '丝绒', '霓虹', '月光', '雨夜', '暖风', '琥珀', '蓝调', '迷雾', '星尘', '慢热', '柔光', '海盐', '微醺', '静电', '城市', '深蓝', '余温', '暗香', '晨雾', '暮色', '银色', '低语', '心跳', '漂浮'];
    const scenes = ['回声', '街角', '信号', '旅馆', '天台', '唱片', '来电', '车窗', '梦境', '潮汐', '留声', '侧影', '胶片', '远方', '电台', '灯火', '花园', '沙发', '日记', '轨道'];
    const styles = ['Neo Soul', 'Slow Jam', 'Lo-fi R&B', 'Bedroom R&B', 'Jazz R&B', 'Ambient R&B', 'Funk R&B', 'Soulful R&B'];
    const keys = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
    const catalog = [];
    moods.forEach((mood, moodIndex) => scenes.forEach((scene, sceneIndex) => {
      const number = moodIndex * scenes.length + sceneIndex + 1;
      const seed = number * 7919;
      catalog.push({
        id: `rnb-${String(number).padStart(3, '0')}`,
        trackName: `${mood}${scene}`,
        artistName: 'Dashboard AI Sessions',
        collectionName: styles[(number * 7) % styles.length],
        bpm: 68 + (number * 11) % 29,
        key: keys[(number * 5) % keys.length],
        keyIndex: (number * 5) % keys.length,
        seed
      });
    }));
    return catalog;
  }

  function renderMusicResults() {
    const container = $('#musicResults');
    if (!visibleMusicTracks.length) {
      container.innerHTML = '<p class="music-empty">没有匹配的曲目，换个关键词试试。</p>';
      return;
    }
    container.innerHTML = visibleMusicTracks.map(track => {
      const index = musicTracks.findIndex(item => item.id === track.id);
      return `
      <button class="music-result${index === currentMusicIndex ? ' active' : ''}" type="button" data-music-index="${index}" aria-label="播放 ${esc(track.trackName)}，${esc(track.collectionName)}">
        <span class="music-result-mark" aria-hidden="true">${index === currentMusicIndex && musicIsPlaying ? '■' : '▶'}</span>
        <span class="music-result-copy"><strong>${esc(track.trackName)}</strong><span>#${track.id.slice(-3)} · ${esc(track.collectionName)} · ${track.key} minor</span></span>
        <span class="music-result-duration">${track.bpm} BPM · ∞</span>
      </button>`;
    }).join('');
  }

  function searchMusic(query) {
    const term = String(query || '').trim().toLocaleLowerCase('zh-CN');
    visibleMusicTracks = term ? musicTracks.filter(track =>
      `${track.trackName} ${track.collectionName} ${track.id} ${track.bpm} ${track.key}`.toLocaleLowerCase('zh-CN').includes(term)
    ) : [...musicTracks];
    renderMusicResults();
    setMusicStatus(term ? `找到 ${visibleMusicTracks.length} 首匹配曲目。` : `曲库共 ${musicTracks.length} 首原创生成式 R&B。`, !visibleMusicTracks.length);
  }

  function seededValue(seed, step, salt = 0) {
    const value = Math.sin(seed * 0.001 + step * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function midiFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function createNoiseBuffer() {
    if (musicNoiseBuffer) return musicNoiseBuffer;
    const length = Math.floor(musicAudioContext.sampleRate * 0.5);
    musicNoiseBuffer = musicAudioContext.createBuffer(1, length, musicAudioContext.sampleRate);
    const data = musicNoiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return musicNoiseBuffer;
  }

  function scheduleTone(frequency, start, duration, type, volume, destination = musicMaster) {
    const oscillator = musicAudioContext.createOscillator();
    const gain = musicAudioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function scheduleNoise(start, duration, volume, highpass = 1500) {
    const source = musicAudioContext.createBufferSource();
    const filter = musicAudioContext.createBiquadFilter();
    const gain = musicAudioContext.createGain();
    source.buffer = createNoiseBuffer();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(musicMaster);
    source.start(start);
    source.stop(start + duration);
  }

  function scheduleMusicStep(track, step, start) {
    const beat = 60 / track.bpm;
    const root = 42 + track.keyIndex;
    const progression = [0, 8, 3, 10];
    const chordRoot = root + progression[Math.floor(step / 8) % progression.length];
    if (step % 8 === 0) {
      [0, 3, 7, 10].forEach((interval, voice) => scheduleTone(midiFrequency(chordRoot + 12 + interval), start, beat * 3.7, voice % 2 ? 'sine' : 'triangle', 0.026));
    }
    if (step % 4 === 0 || (step % 4 === 3 && seededValue(track.seed, step, 1) > 0.46)) {
      const bassNote = chordRoot + (seededValue(track.seed, step, 2) > 0.72 ? 7 : 0);
      scheduleTone(midiFrequency(bassNote), start, beat * 0.8, 'sine', 0.12);
    }
    if (step % 8 === 0 || step % 8 === 5) {
      const kick = musicAudioContext.createOscillator();
      const kickGain = musicAudioContext.createGain();
      kick.frequency.setValueAtTime(120, start);
      kick.frequency.exponentialRampToValueAtTime(44, start + 0.16);
      kickGain.gain.setValueAtTime(0.24, start);
      kickGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      kick.connect(kickGain).connect(musicMaster);
      kick.start(start); kick.stop(start + 0.22);
    }
    if (step % 8 === 4) scheduleNoise(start, 0.2, 0.105, 900);
    if (step % 2 === 0) scheduleNoise(start + seededValue(track.seed, step, 3) * 0.012, 0.045, 0.025, 5200);
    if (step % 8 === 6 && seededValue(track.seed, step, 4) > 0.34) {
      const melody = chordRoot + 24 + [0, 3, 7, 10][Math.floor(seededValue(track.seed, step, 5) * 4)];
      scheduleTone(midiFrequency(melody), start, beat * 0.65, 'sine', 0.035);
    }
  }

  function stopMusic(updateStatus = true) {
    if (musicSchedulerTimer) clearInterval(musicSchedulerTimer);
    musicSchedulerTimer = null;
    musicIsPlaying = false;
    if (musicMaster && musicAudioContext) {
      const oldMaster = musicMaster;
      oldMaster.gain.cancelScheduledValues(musicAudioContext.currentTime);
      oldMaster.gain.setTargetAtTime(0.0001, musicAudioContext.currentTime, 0.025);
      setTimeout(() => { try { oldMaster.disconnect(); } catch { /* Already disconnected. */ } }, 180);
      musicMaster = null;
    }
    $('#musicNowPlaying').classList.remove('playing');
    if (updateStatus && currentMusicIndex >= 0) setMusicStatus('已暂停。再次点击播放可重新开始循环。');
    renderMusicResults();
  }

  function startMusic(index) {
    const track = musicTracks[index];
    if (!track) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio unsupported');
      musicAudioContext ||= new AudioContextClass();
      if (musicAudioContext.state === 'suspended') {
        musicAudioContext.resume().catch(() => setMusicStatus('浏览器阻止了声音，请再次点击当前曲目。', true));
      }
      stopMusic(false);
      currentMusicIndex = index;
      musicMaster = musicAudioContext.createGain();
      const compressor = musicAudioContext.createDynamicsCompressor();
      musicMaster.gain.setValueAtTime(0.78, musicAudioContext.currentTime);
      musicMaster.connect(compressor).connect(musicAudioContext.destination);
      musicStep = 0;
      musicNextStepTime = musicAudioContext.currentTime + 0.06;
      musicIsPlaying = true;
      const scheduler = () => {
        while (musicNextStepTime < musicAudioContext.currentTime + 0.14) {
          scheduleMusicStep(track, musicStep, musicNextStepTime);
          musicNextStepTime += (60 / track.bpm) / 2;
          musicStep = (musicStep + 1) % 32;
        }
      };
      scheduler();
      musicSchedulerTimer = setInterval(scheduler, 30);
      $('#musicToggleButton').disabled = false;
      $('#musicNowPlaying').className = 'music-now-playing playing';
      $('#musicNowPlaying').innerHTML = `<div class="music-disc" aria-hidden="true">♪</div><div><strong>${esc(track.trackName)}</strong><span>${esc(track.collectionName)} · ${track.key} minor · ${track.bpm} BPM · 循环中</span></div>`;
      setMusicStatus(`正在循环播放：${track.trackName}。`);
      renderMusicResults();
    } catch (error) {
      setMusicStatus('浏览器无法启动声音。请确认未处于静音模式，并再次点击播放。', true);
    }
  }

  function initMusic() {
    musicTracks = createMusicCatalog();
    visibleMusicTracks = [...musicTracks];
    renderMusicResults();
    $('#musicSearchForm').addEventListener('submit', event => {
      event.preventDefault();
      searchMusic($('#musicSearchInput').value);
    });
    $('#musicResults').addEventListener('click', event => {
      const button = event.target.closest('[data-music-index]');
      if (button) startMusic(Number(button.dataset.musicIndex));
    });
    $('#musicToggleButton').addEventListener('click', () => {
      if (musicIsPlaying) stopMusic();
      else if (currentMusicIndex >= 0) startMusic(currentMusicIndex);
    });
    $('#musicRandomButton').addEventListener('click', () => {
      const index = Math.floor(Math.random() * musicTracks.length);
      startMusic(index);
    });
    $('#musicShowAllButton').addEventListener('click', () => {
      $('#musicSearchInput').value = '';
      searchMusic('');
    });
    window.addEventListener('pagehide', () => stopMusic(false));
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
