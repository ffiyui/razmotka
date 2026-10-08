/* Голосовое сопровождение «626»: говорит о ходе задания и слушает команды.
   Только сообщает и нажимает те же кнопки, что и человек: учёт и задания работают без него так же.
   Голос: в браузере - speechSynthesis, в приложении для Android - системный синтез речи (js/native.js).
   Голос выбирается в «Данные» → «Голосовое сопровождение»; если не выбран, берётся мужской русский, какой найдётся. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NAT = window.NATIVE || null;
  const synth = NAT && NAT.tts ? null : (window.speechSynthesis || null);
  const Rec = NAT && NAT.stt ? null : (window.SpeechRecognition || window.webkitSpeechRecognition || null);
  const canSay = !!(synth || (NAT && NAT.tts)), canHear = !!(Rec || (NAT && NAT.stt));
  const V = {log: [], heard: [], rec: null, want: false, live: false, awake: 0, voices: [], voice: null, male: false, micErr: '', speaking: false};
  window.VOICE = V;
  const on = () => !PREFS || PREFS.voice !== false;
  /* На Android микрофон при каждом включении может подавать сигнал, поэтому там команды голосом включает сам человек */
  const micPref = () => (PREFS && PREFS.voice_mic !== undefined ? PREFS.voice_mic !== false : !ANDROID);
  const micOn = () => on() && micPref();
  const MALE = /yuri|юрий|pavel|павел|dmitr|дмитр|maxim|максим|aleksandr|александр|artem|артём|артем|ivan|иван|male|муж|ru-ru-x-ruc|ru-ru-x-rud|ru-ru-x-dfc/i;
  const FEMALE = /milena|милена|katya|катя|irina|ирина|alena|алёна|алена|svetlana|светлана|anna|анна|female|жен/i;

  /* Список русских голосов: [{name, id}] - id для системы (в приложении Android - номер голоса) */
  async function loadVoices() {
    let list = [];
    try {
      if (NAT && NAT.tts) list = (await NAT.tts.voices()).map((v, i) => ({name: v.name || v.voiceURI || 'Голос ' + (i + 1), lang: v.lang || '', id: i}));
      else if (synth) list = synth.getVoices().map(v => ({name: v.name, lang: v.lang, id: v}));
    } catch (e) { list = []; }
    V.voices = list.filter(v => /^ru/i.test(v.lang));
    pickVoice();
  }
  function pickVoice() {
    const ru = V.voices, want = PREFS && PREFS.voice_name;
    const chosen = want && ru.find(v => v.name === want);
    const m = ru.find(v => MALE.test(v.name));
    V.voice = chosen || m || ru.find(v => !FEMALE.test(v.name)) || ru[0] || null;
    V.male = !!(V.voice && (MALE.test(V.voice.name) || chosen));
    fillSelect(); note();
  }
  if (synth) { try { synth.addEventListener('voiceschanged', loadVoices); } catch (e) { synth.onvoiceschanged = loadVoices; } }

  /* Сказать. Сообщения идут по очереди, новое не обрывает прежнее */
  V.say = (text, force) => {
    if (!force && !on()) return false;
    V.log.push(text);
    if (V.log.length > 200) V.log.shift();
    const pitch = V.male ? 1 : 0.6;                 // мужского голоса в телефоне нет - имеющийся звучит ниже
    try {
      if (NAT && NAT.tts) {
        V.speaking = true;
        NAT.tts.speak(text, {voice: V.voice ? V.voice.id : undefined, pitch}).catch(() => {}).finally(() => { V.speaking = false; });
        return true;
      }
      if (!synth) return false;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      if (V.voice) u.voice = V.voice.id;
      u.pitch = pitch; u.rate = 1;
      synth.speak(u);
    } catch (e) { return false; }
    return true;
  };
  const busy = () => V.speaking || !!(synth && synth.speaking);

  // ---------------------------------------------------------------- команды
  const WAKE = /(?:626|6\s*2\s*6|шесть\s*сот\s+двадцать\s+шесть|шестьсот\s+двадцать\s+шесть|шесть\s+два\s+шесть|шесть\s+двадцать\s+шесть)/;
  function command(t) {
    if (/(сним|снят|сня[лт]|зафиксир|постав|отмет).*(точк|пикет)|(точк|пикет).*(здесь|тут)/.test(t)) return 'snap';
    if (/продолж|дальше|поехали/.test(t)) return 'resume';
    if (/пауз|стоп|останов|подожди/.test(t)) return 'pause';
    if (/заверш|законч|конец/.test(t)) return 'finish';
    return null;
  }
  function run(cmd) {
    const c = window.workCmd;
    if (!c || !c.active()) { V.say('Задание не идёт.'); return; }
    if (cmd === 'snap') c.snap();
    else if (cmd === 'pause') { c.pause(); V.say('Пауза'); }
    else if (cmd === 'resume') { c.resume(); V.say('Продолжаю'); }
    else if (cmd === 'finish') { V.say('Подтверди на экране'); c.finish(); }
  }
  /* Услышанная фраза. Без слова «626» команды не выполняются: разговор рядом ничего не нажмёт */
  V.hear = (text) => {
    const t = String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:«»"-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || !on()) return null;
    V.heard.push(t); if (V.heard.length > 50) V.heard.shift();
    const m = t.match(WAKE), now = Date.now();
    if (!m && now > V.awake) return null;
    const rest = m ? t.slice(m.index + m[0].length).trim() : t, cmd = command(rest);
    if (cmd) { V.awake = 0; run(cmd); return cmd; }
    if (m && !rest) { V.awake = now + 10000; V.say('Слушаю'); return 'wake'; }
    V.awake = now + 10000;
    V.say('Не понял. Скажи: снять точку здесь, пауза, продолжить или завершить.');
    return 'unknown';
  };

  // ---------------------------------------------------------------- микрофон
  async function nativeLoop() {                     // приложение Android: распознавание фразами, пока задание идёт
    if (V.live) return;
    V.live = true; note();
    while (V.want && micOn() && !document.hidden) {
      if (busy()) { await new Promise(r => setTimeout(r, 400)); continue; }
      try {
        const got = await NAT.stt.listen();
        if (got === null) { V.micErr = 'Микрофон запрещён: разрешите его приложению в настройках телефона.'; V.want = false; break; }
        for (const t of got) if (V.hear(t)) break;
      } catch (e) { await new Promise(r => setTimeout(r, 1500)); }
    }
    V.live = false; note();
  }
  function startRec() {
    if (!V.want || !micOn() || document.hidden) return;
    if (NAT && NAT.stt) return void nativeLoop();
    if (!Rec || V.live) return;
    let r;
    try {
      r = new Rec(); r.lang = 'ru-RU'; r.continuous = true; r.interimResults = false; r.maxAlternatives = 3;
      r.onresult = e => {
        if (busy()) return;                          // себя не слушаем
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          for (let k = 0; k < e.results[i].length; k++) if (V.hear(e.results[i][k].transcript)) break;
        }
      };
      r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { V.micErr = 'Микрофон запрещён: разрешите его для этого сайта в настройках телефона.'; V.want = false; } note(); };
      r.onend = () => { V.live = false; V.rec = null; note(); if (V.want) setTimeout(startRec, 400); };
      r.start(); V.rec = r; V.live = true; V.micErr = '';
    } catch (e) { V.live = false; }
    note();
  }
  /* Слушать команды, пока задание идёт */
  V.listen = (want) => {
    V.want = !!want && micOn();
    if (V.want) startRec();
    else if (V.rec) { try { V.rec.stop(); } catch (e) { /* уже остановлен */ } }
    else if (NAT && NAT.stt && V.live) NAT.stt.stop();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && V.want) startRec(); });

  // ---------------------------------------------------------------- настройки
  function fillSelect() {
    const s = $('vcVoice'); if (!s) return;
    const html = V.voices.length ? V.voices.map(v => `<option value="${esc(v.name)}"${V.voice && v.name === V.voice.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')
      : '<option value="">Русских голосов нет</option>';
    if (s.dataset.html !== html) { s.innerHTML = html; s.dataset.html = html; }
    s.disabled = !V.voices.length;
  }
  function note() {
    const n = $('vcNote'); if (!n) return;
    const parts = [];
    if (!canSay) parts.push('Этот телефон не умеет говорить из приложения.');
    else if (!V.voice) parts.push('Русского голоса в телефоне нет: добавьте его в настройках телефона.');
    else if (!V.male) parts.push('Мужской голос не найден, поэтому этот звучит ниже. Выберите голос в списке или добавьте мужской: ' +
      (ANDROID ? 'Настройки телефона → Специальные возможности → Синтез речи → настройки синтезатора → русский язык.' : 'Настройки iPhone → Универсальный доступ → Устный контент → Голоса → Русский → «Юрий».'));
    if (!canHear) parts.push('Команды голосом здесь недоступны: телефон не даёт приложению распознавание речи. Кнопки работают как обычно.');
    else if (V.micErr) parts.push(V.micErr);
    else if (V.live) parts.push('Микрофон слушает.');
    else if (ANDROID && !micPref()) parts.push('Команды голосом выключены: на Android микрофон может подавать сигнал при каждом включении. Включите галочку, если это не мешает.');
    n.textContent = parts.join(' ');
  }
  const savePref = j => post('/api/prefs', j).catch(() => {});
  async function init() {
    try { if (typeof colorsReady !== 'undefined') await colorsReady; } catch (e) { /* без настроек */ }
    await loadVoices();
    $('vcOn').checked = on(); $('vcMic').checked = micPref(); $('vcMic').disabled = !canHear || !on();
    $('vcOn').onchange = () => {
      PREFS.voice = $('vcOn').checked; savePref({voice: PREFS.voice});
      $('vcMic').disabled = !canHear || !PREFS.voice;
      if (!PREFS.voice) { V.listen(false); try { if (synth) synth.cancel(); else if (NAT && NAT.tts) NAT.tts.stop(); } catch (e) { /* молчит */ } }
      else { V.say('Голосовое сопровождение включено'); if (window.workCmd && workCmd.active()) V.listen(true); }
    };
    $('vcMic').onchange = () => {
      PREFS.voice_mic = $('vcMic').checked; savePref({voice_mic: PREFS.voice_mic});
      V.listen(PREFS.voice_mic && window.workCmd && workCmd.active());
    };
    $('vcVoice').onchange = () => { PREFS.voice_name = $('vcVoice').value; savePref({voice_name: PREFS.voice_name}); pickVoice(); V.say('Разбивка начата', true); };
    $('vcTest').onclick = async () => { await loadVoices(); if (!V.say('Разбивка начата. ' + spokenNumber(5105) + ', ' + spokenNumber(1497), true)) note(); };
    note();
  }
  init();
})();
