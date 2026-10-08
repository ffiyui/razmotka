/* Голосовое сопровождение «626»: говорит о ходе задания и слушает команды.
   Только сообщает и нажимает те же кнопки, что и человек: учёт и задания работают без него так же. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const synth = window.speechSynthesis || null;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const V = {log: [], heard: [], rec: null, want: false, live: false, awake: 0, voice: null, male: false, micErr: ''};
  window.VOICE = V;
  const on = () => !PREFS || PREFS.voice !== false;
  const micOn = () => on() && (!PREFS || PREFS.voice_mic !== false);
  const MALE = /yuri|юрий|pavel|павел|dmitr|дмитр|maxim|максим|aleksandr|александр|artem|артём|артем|ivan|иван|male|муж/i;
  const FEMALE = /milena|милена|katya|катя|irina|ирина|alena|алёна|алена|svetlana|светлана|anna|анна|female|жен/i;

  function pickVoice() {
    if (!synth) return;
    const ru = synth.getVoices().filter(v => /^ru/i.test(v.lang));
    const m = ru.find(v => MALE.test(v.name));
    V.voice = m || ru.find(v => !FEMALE.test(v.name)) || ru[0] || null;
    V.male = !!m;
    note();
  }
  if (synth) { pickVoice(); try { synth.addEventListener('voiceschanged', pickVoice); } catch (e) { synth.onvoiceschanged = pickVoice; } }

  /* Сказать. Сообщения идут по очереди, новое не обрывает прежнее */
  V.say = (text, force) => {
    if (!force && !on()) return false;
    V.log.push(text);
    if (V.log.length > 200) V.log.shift();
    if (!synth) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      if (V.voice) u.voice = V.voice;
      u.pitch = V.male ? 0.9 : 0.55;                // мужского голоса в телефоне нет - имеющийся звучит ниже
      u.rate = 1;
      synth.speak(u);
    } catch (e) { return false; }
    return true;
  };

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
  function startRec() {
    if (!Rec || V.live || !V.want || !micOn() || document.hidden) return;
    let r;
    try {
      r = new Rec(); r.lang = 'ru-RU'; r.continuous = true; r.interimResults = false; r.maxAlternatives = 3;
      r.onresult = e => {
        if (synth && synth.speaking) return;         // себя не слушаем
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
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && V.want) startRec(); });

  // ---------------------------------------------------------------- настройки
  function note() {
    const n = $('vcNote'); if (!n) return;
    const parts = [];
    if (!synth) parts.push('Этот телефон не умеет говорить из браузера.');
    else if (!V.voice) parts.push('Русского голоса в телефоне нет: добавьте его в настройках телефона.');
    else parts.push('Голос: ' + V.voice.name + (V.male ? '' : ' — мужского русского голоса в телефоне нет, поэтому этот звучит ниже. Мужской голос «Юрий» добавляется в Настройках iPhone: Универсальный доступ → Устный контент → Голоса → Русский'));
    if (!Rec) parts.push('Команды голосом здесь недоступны: телефон не даёт приложению распознавание речи. Кнопки работают как обычно.');
    else if (V.micErr) parts.push(V.micErr);
    else if (V.live) parts.push('Микрофон слушает.');
    n.textContent = parts.join(' ');
  }
  async function init() {
    try { if (typeof colorsReady !== 'undefined') await colorsReady; } catch (e) { /* без настроек */ }
    $('vcOn').checked = on(); $('vcMic').checked = PREFS.voice_mic !== false; $('vcMic').disabled = !Rec || !on();
    $('vcOn').onchange = () => {
      PREFS.voice = $('vcOn').checked;
      fetch('/api/prefs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({voice: PREFS.voice})}).catch(() => {});
      $('vcMic').disabled = !Rec || !PREFS.voice;
      if (!PREFS.voice) { V.listen(false); if (synth) synth.cancel(); }
      else { V.say('Голосовое сопровождение включено'); if (window.workCmd && workCmd.active()) V.listen(true); }
    };
    $('vcMic').onchange = () => {
      PREFS.voice_mic = $('vcMic').checked;
      fetch('/api/prefs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({voice_mic: PREFS.voice_mic})}).catch(() => {});
      V.listen(PREFS.voice_mic && window.workCmd && workCmd.active());
    };
    $('vcTest').onclick = () => { pickVoice(); if (!V.say('Меня зовут 626. Я буду сопровождать тебя до конца маршрута.', true)) note(); };
    note();
  }
  init();
})();
