/* Приложение для Android (оболочка Capacitor, папка native/): возможности телефона, которых нет у страницы в браузере.
   - GPS фоновой службой: положение приходит и при погасшем экране и свёрнутом приложении (в шторке висит уведомление);
   - голос и распознавание речи - системные (в оболочке у страницы их нет);
   - сохранение файла - через системное меню «Поделиться».
   В браузере (iPhone, Android, компьютер) NATIVE = null и всё работает как раньше. */
(() => {
  'use strict';
  const C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform() || typeof C.registerPlugin !== 'function') { window.NATIVE = null; return; }
  const plugin = name => { try { return C.registerPlugin(name); } catch (e) { return null; } };
  const has = name => (typeof C.isPluginAvailable === 'function' ? C.isPluginAvailable(name) : true);
  const BG = has('BackgroundGeolocation') ? plugin('BackgroundGeolocation') : null;
  const TTS = has('TextToSpeech') ? plugin('TextToSpeech') : null;
  const STT = has('SpeechRecognition') ? plugin('SpeechRecognition') : null;
  const FS = has('Filesystem') ? plugin('Filesystem') : null;
  const SHARE = has('Share') ? plugin('Share') : null;
  const APP = has('App') ? plugin('App') : null;
  const N = {platform: C.getPlatform ? C.getPlatform() : 'android'};

  // ---------------------------------------------------------------- GPS
  /* onFix и onErr получают то же, что у navigator.geolocation: {coords, timestamp} и {code, message} */
  N.watchGeo = async (onFix, onErr) => {
    if (!BG) {                                    // плагина нет: обычная геолокация страницы
      return navigator.geolocation.watchPosition(onFix, onErr, {enableHighAccuracy: true, maximumAge: 1000, timeout: 30000});
    }
    return BG.addWatcher({
      backgroundTitle: 'Размотка СП10',
      backgroundMessage: 'Определяется положение: задание или запись трека',
      requestPermissions: true, stale: false, distanceFilter: 0,
    }, (loc, err) => {
      if (err) return onErr({code: err.code === 'NOT_AUTHORIZED' ? 1 : 2, message: err.message || ''});
      if (!loc) return;
      onFix({coords: {latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
        heading: Number.isFinite(loc.bearing) ? loc.bearing : null, speed: Number.isFinite(loc.speed) ? loc.speed : null}, timestamp: loc.time || Date.now()});
    });
  };
  N.clearGeo = id => {
    if (!BG) { navigator.geolocation.clearWatch(id); return; }
    BG.removeWatcher({id}).catch(() => {});
  };
  N.openSettings = () => (BG ? BG.openSettings() : Promise.resolve());

  // ---------------------------------------------------------------- голос
  N.tts = TTS ? {
    speak: (text, o = {}) => TTS.speak({text, lang: 'ru-RU', rate: 1, pitch: o.pitch || 1, volume: 1, voice: o.voice, category: 'playback', queueStrategy: 1}),
    voices: async () => ((await TTS.getSupportedVoices()) || {}).voices || [],
    stop: () => TTS.stop().catch(() => {}),
  } : null;
  /* Одна фраза: массив вариантов распознанного текста; null - микрофон запрещён */
  N.stt = STT ? {
    listen: async () => {
      const av = await STT.available().catch(() => ({available: false}));
      if (!av.available) return null;
      let perm = await STT.checkPermissions().catch(() => ({speechRecognition: 'prompt'}));
      if (perm.speechRecognition !== 'granted') perm = await STT.requestPermissions().catch(() => ({speechRecognition: 'denied'}));
      if (perm.speechRecognition !== 'granted') return null;
      const r = await STT.start({language: 'ru-RU', maxResults: 3, partialResults: false, popup: false});
      return (r && r.matches) || [];
    },
    stop: () => STT.stop().catch(() => {}),
  } : null;

  // ---------------------------------------------------------------- файлы
  const base64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  N.saveFile = async (blob, name) => {
    if (!FS || !SHARE) throw new Error('нет доступа к файлам');
    const safe = String(name).replace(/[\\/:*?"<>|]+/g, '_');
    const w = await FS.writeFile({path: safe, data: await base64(blob), directory: 'CACHE'});
    try { await SHARE.share({title: safe, files: [w.uri], dialogTitle: 'Сохранить или отправить файл'}); }
    catch (e) { if (!/cancel/i.test(String(e && e.message || e))) throw e; }
  };

  /* Файл, открытый в приложении из другого («Открыть с помощью»): приходит адресом content:// или file://.
     cb получает File; вызывается и для файла, с которым приложение запустили */
  N.onOpenFile = cb => {
    if (!APP || !FS) return;
    const take = async url => {
      if (!url || !/^(content|file):/i.test(url)) return;
      try {
        const r = await FS.readFile({path: url});
        const bin = atob(typeof r.data === 'string' ? r.data : ''), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        let name = decodeURIComponent(url.split(/[\\/]/).pop() || '').replace(/[?#].*$/, '');
        if (!/\.(rzm|zip)$/i.test(name)) name = 'Файл проекта.rzm';
        cb(new File([bytes], name, {type: 'application/octet-stream'}));
      } catch (e) { if (window.toast) toast('Файл не открылся: ' + (e && e.message || e)); }
    };
    APP.addListener('appUrlOpen', e => take(e && e.url));
    APP.getLaunchUrl().then(r => take(r && r.url)).catch(() => {});
  };
  window.NATIVE = N;
  document.documentElement.classList.add('native');
})();
