/* Запуск движка: открывает хранилище и подменяет fetch для адресов /api/...
   При адресе вида ?remote подмена не включается: страница ходит на настоящий сервер (настольная версия, проверки). */
globalThis.RZ = globalThis.RZ || {};
(function (RZ) {
  'use strict';
  if (typeof window === 'undefined' || /[?&]remote\b/.test(location.search)) { RZ.ready = Promise.resolve(); return; }

  const origFetch = window.fetch.bind(window);
  let ctx = null;

  RZ.ready = (async () => {
    let kv;
    let first;
    try { kv = RZ.kv_idb(); first = await kv.load(); }                 // хранилище доступно? (в частном режиме бывает нет)
    catch (e) { console.warn('IndexedDB недоступна, данные не сохранятся', e); kv = RZ.kv_memory(); first = await kv.load(); RZ.volatile = true; }
    const cfg = RZ.config.from_saved(first.get('config'));
    const db = await RZ.Database.open(kv, cfg.rules.same_day, first);
    ctx = RZ.ctx = {db, cfg, kv};
    RZ.db = db;
    // данные сохраняются при сворачивании и закрытии: iOS может выгрузить страницу без предупреждения
    const save = () => db.flush();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    window.addEventListener('pagehide', save);
    // просим систему не вычищать данные приложения при нехватке места
    try { if (navigator.storage && navigator.storage.persist) RZ.persisted = await navigator.storage.persist(); } catch (e) { /* не критично */ }
  })();

  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.includes('/api/')) return origFetch(input, init);
    const path = url.pathname.slice(url.pathname.indexOf('/api/'));
    await RZ.ready;
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const args = Object.fromEntries(url.searchParams);
    const body = init && init.body !== undefined ? init.body : null;
    return RZ.api.to_response(await RZ.api.dispatch(ctx, method, path, args, body));
  };
})(globalThis.RZ);
