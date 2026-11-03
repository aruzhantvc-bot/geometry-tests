// Интерфейс, конвейер генерации и обращение к Claude.
(function () {
  'use strict';
  const { LANGS, LEVELS, TEST_LAYOUT, LETTERS } = Prompts;
  const $ = s => document.querySelector(s);
  const STORE = 'geo-tests-set-v1', KEY = 'geo-tests-api-key', MODEL = 'geo-tests-model';
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const MAX_IMAGES = 20;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
  };

  // ---------- состояние ----------
  const blankSet = () => ({
    grade: 9, lang: 'kk', langName: '', topic: '', videoUrl: '', notes: '', images: [],
    analysis: null, questions: [], steps: {}, targetLetters: null,
    settings: { solutions: true, imgTag: true, imgTemplate: '[img:{file}]' }
  });
  let set = blankSet();
  let filter = 'all';
  let ctrl = null;
  let noFallback = false;

  function save() {
    const copy = Object.assign({}, set, { images: [] });
    copy.steps = {};
    Object.keys(set.steps).forEach(k => { const s = set.steps[k]; copy.steps[k] = Object.assign({}, s, { status: s.status === 'run' ? 'stopped' : s.status }); });
    store.set(STORE, JSON.stringify(copy));
  }
  function load() {
    const raw = store.get(STORE);
    if (!raw) return;
    try { set = Object.assign(blankSet(), JSON.parse(raw)); set.images = []; } catch (e) { /* повреждённое сохранение — начинаем заново */ }
  }

  function toast(msg, ms = 3200) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- Claude ----------
  async function callClaude(prompt, { images = [], effort = 'high', maxTokens = 32000, signal } = {}) {
    const key = store.get(KEY);
    if (!key) { openKeyDialog(); throw new Error('Укажите ключ Anthropic API (кнопка «Ключ API» вверху).'); }
    const content = [];
    images.forEach(im => content.push({ type: 'image', source: { type: 'base64', media_type: im.media, data: im.data } }));
    content.push({ type: 'text', text: prompt.text });
    const body = {
      model: store.get(MODEL) || DEFAULT_MODEL,
      max_tokens: maxTokens,
      system: prompt.system,
      messages: [{ role: 'user', content }],
      output_config: { effort }
    };
    const headers = {
      'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (!noFallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
    let res;
    try { res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal }); }
    catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Нет соединения с api.anthropic.com: ' + e.message); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || res.statusText;
      if (res.status === 400 && !noFallback && /fallback|beta/i.test(msg)) { noFallback = true; return callClaude(prompt, { images, effort, maxTokens, signal }); }
      if (res.status === 401) throw new Error('Ключ API не принят (401). Проверьте ключ.');
      if (res.status === 429) throw new Error('Достигнут лимит запросов (429). Повторите шаг через минуту.');
      if (res.status === 529 || res.status >= 500) throw new Error(`Сервис Claude перегружен (${res.status}). Повторите шаг.`);
      throw new Error(`Ошибка API ${res.status}: ${msg}`);
    }
    if (data.stop_reason === 'refusal') throw new Error('Claude отказался отвечать на этот запрос. Измените материалы и повторите.');
    if (data.stop_reason === 'max_tokens') throw new Error('Ответ оборвался по лимиту длины. Повторите шаг.');
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }
  function parseJSON(text) {
    let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('В ответе нет JSON');
    return JSON.parse(t.slice(a, b + 1));
  }
  async function callJSON(prompt, opts) {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      const text = await callClaude(prompt, opts);
      try { return parseJSON(text); } catch (e) { lastErr = e; }
    }
    throw new Error('Не удалось разобрать ответ Claude: ' + lastErr.message);
  }

  // ---------- нормализация ----------
  function normPlan(plan) {
    plan = (Array.isArray(plan) ? plan : []).map(p => ({ level: LEVELS.includes(p.level) ? p.level : 'medium', idea: p.idea || '', figType: ['stem', 'options', 'none'].includes(p.figType) ? p.figType : 'stem', figure: p.figure || '' }));
    const need = { easy: 5, medium: 10, hard: 5, super: 5 };
    const by = {}; LEVELS.forEach(l => { by[l] = plan.filter(p => p.level === l); });
    const spare = [];
    LEVELS.forEach(l => { while (by[l].length > need[l]) spare.push(by[l].pop()); });
    LEVELS.forEach(l => { while (by[l].length < need[l]) { const p = spare.shift() || { idea: 'вопрос по теме урока', figType: 'stem', figure: '' }; by[l].push(Object.assign({}, p, { level: l })); } });
    const all = LEVELS.flatMap(l => by[l]);
    // не менее 19 вопросов с рисунком: переводим «без чертежа» в «чертёж в условии»
    let withFig = all.filter(p => p.figType !== 'none').length;
    const order = ['medium', 'hard', 'easy', 'super'];
    for (const l of order) for (const p of all) {
      if (withFig >= 19) break;
      if (p.level === l && p.figType === 'none') { p.figType = 'stem'; p.figure = p.figure || 'чертёж к условию'; withFig++; }
    }
    // компоновка: тест t получает easy[t], medium[2t], medium[2t+1], hard[t], super[t]
    const tests = [0, 1, 2, 3, 4].map(t => [by.easy[t], by.medium[2 * t], by.medium[2 * t + 1], by.hard[t], by.super[t]]);
    return tests;
  }
  function normQuestion(q, level, figType) {
    q = q || {};
    let options = Array.isArray(q.options) ? q.options.slice(0, 5) : [];
    options = options.map(o => (typeof o === 'string' ? { text: o, figure: null } : { text: o.text || '', figure: o.figure || null }));
    while (options.length < 5) options.push({ text: '—', figure: null });
    let correct = Number.isInteger(+q.correct) ? +q.correct : LETTERS.indexOf(String(q.correct).toUpperCase());
    if (!(correct >= 0 && correct < 5)) correct = 0;
    const ft = ['stem', 'options', 'none'].includes(q.figType) ? q.figType : (figType || (q.figure ? 'stem' : 'none'));
    return {
      id: Math.random().toString(36).slice(2, 10), level: LEVELS.includes(q.level) ? q.level : level, figType: ft,
      text: q.text || '', figure: ft === 'stem' ? (q.figure || null) : null,
      options: options.map(o => ({ text: o.text, figure: ft === 'options' ? o.figure : null })),
      correct, solution: q.solution || '', qa: { status: 'none', note: '' }
    };
  }
  // Сбалансировать позицию верного ответа под заданную букву
  function moveCorrect(q, target) {
    if (target == null || target === q.correct) return;
    const o = q.options; [o[q.correct], o[target]] = [o[target], o[q.correct]]; q.correct = target;
  }
  function makeTargets() {
    const a = []; for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) a.push(k);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------- шаги конвейера ----------
  const STEP_NAMES = { analysis: 'Разбор урока и план 25 вопросов' };
  for (let t = 1; t <= 5; t++) { STEP_NAMES['gen' + t] = `Тест ${t}: генерация вопросов`; STEP_NAMES['qa' + t] = `Тест ${t}: независимая проверка`; }
  const STEP_ORDER = ['analysis', 'gen1', 'qa1', 'gen2', 'qa2', 'gen3', 'qa3', 'gen4', 'qa4', 'gen5', 'qa5'];

  function setStep(id, patch) {
    set.steps[id] = Object.assign(set.steps[id] || {}, patch);
    renderSteps(); save();
  }
  async function runStep(id, fn) {
    setStep(id, { status: 'run', t0: Date.now(), t1: null, error: '' });
    try { await fn(); setStep(id, { status: 'done', t1: Date.now() }); return true; }
    catch (e) {
      const stopped = e.name === 'AbortError';
      setStep(id, { status: stopped ? 'stopped' : 'error', t1: Date.now(), error: stopped ? 'Остановлено' : e.message });
      return false;
    }
  }

  async function stepAnalysis(signal) {
    const res = await callJSON(Prompts.analysisPrompt(set), { images: set.images, effort: 'medium', signal });
    set.analysis = { topic: res.topic || set.topic || '', summary: res.summary || '', facts: res.facts || [], board: res.board || [] };
    if (set.lang === 'other' && res.labels) set.labels = res.labels;
    set.plan = normPlan(res.plan);
    set.targetLetters = makeTargets();
    renderResult();
  }
  async function stepGen(t, signal) {
    const plan = set.plan[t - 1];
    const others = set.questions.filter(q => q.test !== t).map(q => q.text.slice(0, 140));
    const res = await callJSON(Prompts.testPrompt(set, t - 1, plan, others), { effort: 'high', signal });
    const qs = (res.questions || []).slice(0, 5);
    if (qs.length < 5) throw new Error(`Получено ${qs.length} вопросов из 5`);
    const made = qs.map((q, i) => {
      const n = normQuestion(q, TEST_LAYOUT[i], plan[i] && plan[i].figType);
      n.test = t; n.pos = i; n.level = TEST_LAYOUT[i];
      moveCorrect(n, set.targetLetters[(t - 1) * 5 + i]);
      return n;
    });
    set.questions = set.questions.filter(q => q.test !== t).concat(made);
    renderResult();
  }
  async function stepQA(t, signal) {
    const qs = set.questions.filter(q => q.test === t).sort((a, b) => a.pos - b.pos);
    await review(qs, signal);
  }
  async function review(qs, signal) {
    qs.forEach(q => { q.qa = { status: 'pending', note: '' }; });
    renderResult();
    try {
      const res = await callJSON(Prompts.reviewPrompt(set, qs), { effort: 'high', signal });
      const results = res.results || [];
      qs.forEach((q, i) => {
        const r = results.find(x => +x.n === i + 1) || results[i];
        if (!r) { q.qa = { status: 'none', note: '' }; return; }
        const ans = LETTERS.indexOf(String(r.answer || '').trim().toUpperCase().slice(0, 1));
        const issues = String(r.issues || '').trim();
        const notes = [];
        if (ans !== q.correct) notes.push(ans >= 0 ? `Проверяющий получил ответ ${LETTERS[ans]}, а отмечен ${LETTERS[q.correct]}.` : 'Проверяющий не смог однозначно решить вопрос.');
        if (issues) notes.push(issues);
        const figErr = figureErrors(q);
        if (figErr) notes.push('Чертёж не строится: ' + figErr);
        q.qa = notes.length ? { status: 'warn', note: notes.join(' ') } : { status: 'ok', note: '' };
      });
    } catch (e) {
      qs.forEach(q => { if (q.qa.status === 'pending') q.qa = { status: 'none', note: '' }; });
      throw e;
    } finally { renderResult(); save(); }
  }
  function figureErrors(q) {
    const errs = [];
    if (q.figure) { const e = Figure.validate(q.figure); if (e) errs.push(e); }
    q.options.forEach((o, i) => { if (o.figure) { const e = Figure.validate(o.figure); if (e) errs.push(`${LETTERS[i]}: ${e}`); } });
    return errs.join('; ');
  }

  async function runPipeline(from) {
    if (ctrl) return;
    ctrl = new AbortController();
    const signal = ctrl.signal;
    $('#progressCard').classList.remove('hidden');
    $('#btnStop').disabled = false;
    tick.start();
    try {
      if (from === 'all' || !set.analysis || !set.plan) {
        set.steps = {}; set.questions = []; STEP_ORDER.forEach(id => { set.steps[id] = { status: 'wait' }; });
        renderSteps();
        if (!await runStep('analysis', () => stepAnalysis(signal))) return;
      }
      // тесты по 2 параллельно; проверка каждого — сразу после его генерации
      const todo = [1, 2, 3, 4, 5].filter(t => set.steps['gen' + t].status !== 'done' || set.steps['qa' + t].status !== 'done');
      const worker = async () => {
        while (todo.length && !signal.aborted) {
          const t = todo.shift();
          if (set.steps['gen' + t].status !== 'done' && !await runStep('gen' + t, () => stepGen(t, signal))) continue;
          if (set.steps['qa' + t].status !== 'done') await runStep('qa' + t, () => stepQA(t, signal));
        }
      };
      await Promise.all([worker(), worker()]);
      const failed = STEP_ORDER.filter(id => set.steps[id].status !== 'done');
      if (!failed.length) toast('Набор готов: 25 вопросов. Проверьте помеченные.');
    } finally {
      ctrl = null; tick.stop(); $('#btnStop').disabled = true; renderSteps(); renderResult(); save();
    }
  }
  async function retryStep(id) {
    if (ctrl) return toast('Дождитесь окончания текущих шагов');
    if (id === 'analysis') return runPipeline('all');
    if (id.startsWith('qa')) {
      ctrl = new AbortController(); tick.start();
      try { await runStep(id, () => stepQA(+id.slice(2), ctrl.signal)); } finally { ctrl = null; tick.stop(); renderSteps(); }
      return;
    }
    set.steps[id] = { status: 'wait' }; set.steps['qa' + id.slice(3)] = { status: 'wait' };
    return runPipeline('rest');
  }

  const tick = {
    h: null,
    start() { if (!this.h) this.h = setInterval(() => document.querySelectorAll('.step.run .time').forEach(el => { const s = set.steps[el.dataset.id]; if (s && s.t0) el.textContent = fmt(Date.now() - s.t0); }), 1000); },
    stop() { clearInterval(this.h); this.h = null; }
  };
  const fmt = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function renderSteps() {
    const ol = $('#steps');
    ol.innerHTML = STEP_ORDER.filter(id => set.steps[id]).map(id => {
      const s = set.steps[id], st = s.status || 'wait';
      const ico = { done: '✓', error: '!', stopped: '■', wait: '', run: '' }[st] || '';
      const time = s.t0 ? fmt((s.t1 || Date.now()) - s.t0) : '';
      const retry = (st === 'error' || st === 'stopped') && !ctrl ? `<button class="btn small ghost" data-retry="${id}" type="button">Повторить</button>` : '<span></span>';
      return `<li class="step ${st}"><span class="ico">${ico}</span><span>${STEP_NAMES[id]}</span><span class="time" data-id="${id}">${time}</span>${retry}${s.error ? `<span class="msg">${escH(s.error)}</span>` : ''}</li>`;
    }).join('');
  }

  // ---------- результат ----------
  const escH = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const LEVEL_RU = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', super: 'Суперсложный' };
  const STATUS_RU = { ok: 'Ответ подтверждён', warn: 'Требует проверки', pending: 'Проверяется…', none: 'Не проверен' };

  function numbered() { return Exporter.ordered(set).map((q, i) => Object.assign(q, { n: i + 1 })); }

  function renderResult() {
    const has = set.questions.length > 0 || !!set.analysis;
    $('#resultSection').classList.toggle('hidden', !has);
    $('#bottombar').classList.toggle('hidden', !set.questions.length);
    if (!has) return;
    const a = set.analysis || {};
    $('#resultTitle').textContent = a.topic || set.topic || 'Набор';
    const L = Prompts.langInfo(set);
    $('#resultMeta').textContent = `${set.grade} класс · ${L ? (L.name || L.english) : ''} · ${set.questions.length} из 25 вопросов · с рисунком: ${set.questions.filter(q => q.figType !== 'none').length}`;
    const warn = set.questions.filter(q => q.qa.status === 'warn').length;
    const tests = [...new Set(set.questions.map(q => q.test))].sort();
    const fb = (v, label) => `<button type="button" data-f="${v}" aria-pressed="${filter === v}">${label}</button>`;
    $('#segFilter').innerHTML = fb('all', 'Все') + tests.map(t => fb('t' + t, 'Тест ' + t)).join('') + fb('warn', `Проверить${warn ? `<span class="count">${warn}</span>` : ''}`);
    const list = numbered().filter(q => filter === 'all' || (filter === 'warn' ? q.qa.status === 'warn' : 't' + q.test === filter));
    let html = '', cur = 0;
    list.forEach(q => {
      if (q.test !== cur && filter !== 'warn') { cur = q.test; html += `<div class="test-title">Тест ${cur}</div>`; }
      html += `<article class="q" id="q-${q.id}" data-id="${q.id}">${cardInner(q)}</article>`;
    });
    if (!list.length) html = `<div class="card muted">${filter === 'warn' ? 'Вопросов с замечаниями нет.' : 'Вопросы появятся здесь по мере генерации.'}</div>`;
    $('#questions').innerHTML = html;
    document.querySelectorAll('#questions textarea.edit').forEach(autoGrow);
    const pending = set.questions.filter(q => q.qa.status === 'pending' || q.qa.status === 'none').length;
    $('#reviewCount').innerHTML = warn ? `<span class="warn">Требуют проверки: ${warn}</span>` : (pending ? `<span class="muted">Не проверено: ${pending}</span>` : `<span class="ok">Все ответы подтверждены</span>`);
  }

  function cardInner(q) {
    const fig = f => { const r = Figure.render(f); return `<div class="fig">${r.svg}</div>`; };
    const figS = f => { const r = Figure.render(f, { small: true }); return `<div class="fig">${r.svg}</div>`; };
    const withFig = q.options.some(o => o.figure);
    const opts = q.options.map((o, k) => `<div class="opt ${k === q.correct ? 'correct' : ''}"><div class="opt-row"><button type="button" class="letter" data-correct="${k}" title="Сделать верным">${LETTERS[k]}</button><textarea class="edit" rows="1" data-opt="${k}">${escH(o.text)}</textarea></div>${o.figure ? figS(o.figure) : ''}</div>`).join('');
    return `<div class="q-head"><span class="q-num">№${q.n}</span><span class="chip ${q.level}">${LEVEL_RU[q.level]}</span><span class="chip">Тест ${q.test}</span><span class="status ${q.qa.status}">${STATUS_RU[q.qa.status]}</span></div>
      ${q.qa.status === 'warn' && q.qa.note ? `<div class="note"><b>Замечание:</b> ${escH(q.qa.note)}</div>` : ''}
      <textarea class="edit q-text" rows="1" data-field="text">${escH(q.text)}</textarea>
      ${q.figure ? fig(q.figure) : ''}
      <div class="opts ${withFig ? 'with-fig' : ''}">${opts}</div>
      <details class="sol"><summary>Решение</summary><textarea class="edit" rows="1" data-field="solution">${escH(q.solution)}</textarea></details>
      <div class="q-actions">
        ${q.qa.status === 'warn' ? '<button type="button" class="btn small primary" data-act="fixnote">Исправить по замечанию</button>' : ''}
        <button type="button" class="btn small" data-act="ask">Исправить с Claude</button>
        <button type="button" class="btn small" data-act="replace">Заменить вопрос</button>
        <button type="button" class="btn small" data-act="code">Код рисунка</button>
        ${q.qa.status === 'none' || q.qa.status === 'warn' ? '<button type="button" class="btn small ghost" data-act="recheck">Проверить снова</button>' : ''}
      </div>
      <div class="ask hidden"><input class="input" type="text" placeholder="Например: подпиши угол B = 50°"><button type="button" class="btn small primary" data-act="asksend">Исправить</button></div>`;
  }
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  function refreshCard(q) {
    numbered();
    const el = document.getElementById('q-' + q.id);
    if (el) { el.innerHTML = cardInner(q); el.querySelectorAll('textarea.edit').forEach(autoGrow); }
    renderResult();
  }
  const findQ = id => set.questions.find(q => q.id === id);

  async function questionAction(q, kind, extra) {
    if (ctrl) return toast('Дождитесь окончания генерации');
    const el = document.getElementById('q-' + q.id);
    if (el) el.classList.add('busy');
    const signal = (ctrl = new AbortController()).signal;
    try {
      let res;
      if (kind === 'replace') {
        const others = set.questions.filter(x => x.id !== q.id).map(x => x.text.slice(0, 140));
        res = await callJSON(Prompts.replacePrompt(set, q, others), { effort: 'high', signal });
      } else {
        res = await callJSON(Prompts.fixPrompt(set, q, extra), { effort: 'high', signal });
      }
      const n = normQuestion(res.question || res, q.level, q.figType);
      const target = q.correct;
      Object.assign(q, { text: n.text, figure: n.figure, options: n.options, correct: n.correct, solution: n.solution, figType: n.figType });
      moveCorrect(q, target); // сохраняем баланс букв
      save(); renderResult();
      ctrl = null;
      await recheck(q);
      toast(kind === 'replace' ? 'Вопрос заменён и проверен' : 'Вопрос исправлен и проверен');
    } catch (e) {
      toast(e.name === 'AbortError' ? 'Остановлено' : e.message, 6000);
    } finally { ctrl = null; renderResult(); }
  }
  async function recheck(q) {
    ctrl = new AbortController();
    try { await review([q], ctrl.signal); } catch (e) { toast('Проверка не удалась: ' + e.message, 6000); } finally { ctrl = null; }
  }

  // ---------- код рисунка ----------
  let codeQ = null;
  function openCode(q) {
    codeQ = q;
    const targets = [];
    if (q.figure || q.figType === 'stem') targets.push(['stem', 'Рисунок к условию']);
    q.options.forEach((o, k) => { if (o.figure || q.figType === 'options') targets.push(['opt' + k, 'Вариант ' + LETTERS[k]]); });
    if (!targets.length) targets.push(['stem', 'Рисунок к условию (добавить)']);
    $('#codeTarget').innerHTML = targets.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    loadCode();
    $('#dlgCode').showModal();
  }
  function curFig() { const v = $('#codeTarget').value; return v === 'stem' ? codeQ.figure : codeQ.options[+v.slice(3)].figure; }
  function loadCode() {
    const f = curFig();
    $('#codeText').value = f ? JSON.stringify(f, null, 2) : JSON.stringify({ view: 'plane', points: { A: [0, 0], B: [4, 0], C: [1, 3] }, elements: [{ type: 'polygon', points: ['A', 'B', 'C'] }] }, null, 2);
    previewCode();
  }
  function previewCode() {
    const txt = $('#codeText').value.trim();
    if (!txt) { $('#codePreview').innerHTML = ''; $('#codeErr').textContent = 'Пусто — рисунок будет удалён'; return null; }
    let spec; try { spec = JSON.parse(txt); } catch (e) { $('#codeErr').textContent = 'JSON: ' + e.message; return undefined; }
    const v = $('#codeTarget').value, r = Figure.render(spec, { small: v !== 'stem' });
    $('#codePreview').innerHTML = r.svg; $('#codeErr').textContent = r.error || '';
    return r.error ? undefined : spec;
  }

  // ---------- ввод ----------
  function syncInputs() {
    document.querySelectorAll('#segGrade button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === +set.grade)));
    document.querySelectorAll('#segLang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === set.lang)));
    $('#langName').classList.toggle('hidden', set.lang !== 'other');
    $('#langName').value = set.langName || '';
    $('#topic').value = set.topic || '';
    $('#videoUrl').value = set.videoUrl || '';
    $('#notes').value = set.notes || '';
    updateHint(); renderThumbs();
  }
  function updateHint() {
    const n = (set.notes || '').trim().length;
    $('#notesCount').textContent = `${n} символов`;
    const ok = n >= 300 || set.images.length > 0;
    const langOk = set.lang !== 'other' || (set.langName || '').trim();
    $('#btnGenerate').disabled = !ok || !langOk || !!ctrl;
    $('#genHint').textContent = !ok ? 'Нужен конспект от 300 символов или хотя бы один скрин доски.' : !langOk ? 'Укажите название языка.' : 'Займёт 3–6 минут.';
  }
  function renderThumbs() {
    $('#thumbs').innerHTML = set.images.map((im, i) => `<div class="thumb"><img alt="Скрин ${i + 1}" src="data:${im.media};base64,${im.data}"><button type="button" data-del="${i}" aria-label="Удалить">✕</button></div>`).join('')
      + (set.analysis && set.analysis.board && set.analysis.board.length && !set.images.length ? `<span class="muted small">Сохранены описания ${set.analysis.board.length} чертежей с доски.</span>` : '');
  }
  function addImages(files) {
    const list = [...files].filter(f => /^image\//.test(f.type));
    if (!list.length) return;
    const room = MAX_IMAGES - set.images.length;
    if (room <= 0) return toast(`Не больше ${MAX_IMAGES} изображений`);
    if (list.length > room) toast(`Добавлено ${room} из ${list.length}: лимит ${MAX_IMAGES}`);
    list.slice(0, room).forEach(f => {
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => {
        const k = Math.min(1, 2000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/jpeg', 0.9).split(',')[1];
        set.images.push({ media: 'image/jpeg', data });
        URL.revokeObjectURL(url); renderThumbs(); updateHint();
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast('Не удалось прочитать изображение ' + f.name); };
      img.src = url;
    });
  }
  async function readNotesFile(f) {
    try {
      let text;
      if (/\.docx$/i.test(f.name)) {
        const zip = await JSZip.loadAsync(f);
        const xmlText = await zip.file('word/document.xml').async('string');
        text = xmlText.split(/<\/w:p>/).map(p => (p.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')).join('\n')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
      } else text = await f.text();
      set.notes = (set.notes ? set.notes + '\n\n' : '') + text;
      $('#notes').value = set.notes; updateHint(); save();
      toast(`Загружено: ${f.name}`);
    } catch (e) { toast('Не удалось прочитать файл: ' + e.message, 6000); }
  }

  function openKeyDialog() {
    $('#apiKey').value = store.get(KEY) || '';
    $('#apiModel').value = store.get(MODEL) || DEFAULT_MODEL;
    $('#dlgKey').showModal();
  }

  // ---------- события ----------
  function bind() {
    $('#segGrade').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set.grade = +b.dataset.v; syncInputs(); save(); });
    $('#segLang').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set.lang = b.dataset.v; syncInputs(); save(); if (set.lang === 'other') $('#langName').focus(); });
    $('#langName').addEventListener('input', e => { set.langName = e.target.value; updateHint(); save(); });
    $('#topic').addEventListener('input', e => { set.topic = e.target.value; save(); });
    $('#videoUrl').addEventListener('input', e => { set.videoUrl = e.target.value; save(); });
    $('#notes').addEventListener('input', e => { set.notes = e.target.value; updateHint(); save(); });
    $('#notesFile').addEventListener('change', e => { if (e.target.files[0]) readNotesFile(e.target.files[0]); e.target.value = ''; });
    $('#imgFile').addEventListener('change', e => { addImages(e.target.files); e.target.value = ''; });
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addImages(e.dataTransfer.files));
    document.addEventListener('paste', e => {
      if ($('#inputCard').classList.contains('hidden')) return;
      const files = [...(e.clipboardData || {}).items || []].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addImages(files); }
    });
    $('#thumbs').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; set.images.splice(+b.dataset.del, 1); renderThumbs(); updateHint(); });

    $('#btnGenerate').addEventListener('click', () => {
      if (!store.get(KEY)) return openKeyDialog();
      if (set.questions.length && !confirm('Текущий набор будет заменён новым. Продолжить?')) return;
      filter = 'all';
      $('#inputCard').classList.add('hidden');
      runPipeline('all').then(updateHint);
      updateHint();
      $('#progressCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#btnStop').addEventListener('click', () => { if (ctrl) ctrl.abort(); });
    $('#steps').addEventListener('click', e => { const b = e.target.closest('[data-retry]'); if (b) retryStep(b.dataset.retry); });
    $('#btnShowInput').addEventListener('click', () => { $('#inputCard').classList.toggle('hidden'); });
    $('#btnNew').addEventListener('click', () => {
      if (ctrl) return toast('Сначала остановите генерацию');
      if ((set.questions.length || set.notes) && !confirm('Начать новый набор? Текущий будет удалён из браузера.')) return;
      const keep = set.settings; set = blankSet(); set.settings = keep; store.del(STORE);
      $('#progressCard').classList.add('hidden'); $('#inputCard').classList.remove('hidden');
      syncInputs(); renderResult(); window.scrollTo({ top: 0 });
    });
    $('#btnSettings').addEventListener('click', openKeyDialog);
    $('#saveKey').addEventListener('click', () => {
      const k = $('#apiKey').value.trim(), m = $('#apiModel').value.trim();
      if (k) store.set(KEY, k); else store.del(KEY);
      if (m && m !== DEFAULT_MODEL) store.set(MODEL, m); else store.del(MODEL);
      toast(k ? 'Ключ сохранён в этом браузере' : 'Ключ удалён');
      updateHint();
    });

    $('#segFilter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; renderResult(); });

    const qs = $('#questions');
    qs.addEventListener('input', e => {
      const t = e.target; if (!t.matches('textarea.edit')) return;
      autoGrow(t);
      const q = findQ(t.closest('.q').dataset.id);
      if (t.dataset.field) q[t.dataset.field] = t.value; else q.options[+t.dataset.opt].text = t.value;
      q.edited = true; save();
    });
    qs.addEventListener('change', e => {
      const t = e.target; if (!t.matches('textarea.edit')) return;
      const q = findQ(t.closest('.q').dataset.id);
      if (q.qa.status === 'ok') { q.qa = { status: 'none', note: '' }; refreshCard(q); save(); }
    });
    qs.addEventListener('click', e => {
      const card = e.target.closest('.q'); if (!card) return;
      const q = findQ(card.dataset.id);
      const letter = e.target.closest('[data-correct]');
      if (letter) {
        const k = +letter.dataset.correct; if (k === q.correct) return;
        q.correct = k; q.qa = { status: 'none', note: '' }; save(); refreshCard(q);
        return toast(`Верный вариант: ${LETTERS[k]}. Нажмите «Проверить снова», чтобы перепроверить.`);
      }
      const act = e.target.closest('[data-act]'); if (!act) return;
      const a = act.dataset.act;
      if (a === 'fixnote') questionAction(q, 'fix', q.qa.note);
      else if (a === 'ask') { const box = card.querySelector('.ask'); box.classList.toggle('hidden'); box.querySelector('input').focus(); }
      else if (a === 'asksend') { const v = card.querySelector('.ask input').value.trim(); if (!v) return; questionAction(q, 'fix', v); }
      else if (a === 'replace') { if (confirm('Заменить вопрос новым того же уровня?')) questionAction(q, 'replace'); }
      else if (a === 'code') openCode(q);
      else if (a === 'recheck') { if (ctrl) return toast('Дождитесь окончания текущих шагов'); recheck(q).then(() => renderResult()); }
    });
    qs.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.ask input')) { e.preventDefault(); e.target.closest('.ask').querySelector('[data-act="asksend"]').click(); } });

    $('#codeTarget').addEventListener('change', loadCode);
    $('#codeText').addEventListener('input', () => { clearTimeout(previewCode.h); previewCode.h = setTimeout(previewCode, 250); });
    $('#codeApply').addEventListener('click', () => {
      const spec = previewCode();
      if (spec === undefined) return;
      const v = $('#codeTarget').value;
      if (v === 'stem') { codeQ.figure = spec; if (spec && codeQ.figType === 'none') codeQ.figType = 'stem'; }
      else codeQ.options[+v.slice(3)].figure = spec;
      codeQ.qa = { status: 'none', note: '' };
      save(); $('#dlgCode').close(); refreshCard(codeQ); toast('Рисунок обновлён');
    });

    document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', async () => {
      if (!set.questions.length) return;
      const busy = set.questions.filter(q => q.qa.status === 'warn').length;
      if (busy && !confirm(`${busy} вопрос(ов) требуют проверки. Всё равно выгрузить?`)) return;
      set.labelsResolved = labels();
      b.disabled = true;
      try { await Exporter.exportFile(set, b.dataset.export); } catch (e) { toast('Ошибка экспорта: ' + e.message, 6000); } finally { b.disabled = false; }
    }));
    $('#btnExportSettings').addEventListener('click', () => {
      $('#optSolutions').checked = set.settings.solutions !== false;
      $('#optTag').checked = set.settings.imgTag !== false;
      $('#optTemplate').value = set.settings.imgTemplate || '[img:{file}]';
      $('#dlgExport').showModal();
    });
    $('#dlgExport').addEventListener('close', () => {
      set.settings.solutions = $('#optSolutions').checked;
      set.settings.imgTag = $('#optTag').checked;
      set.settings.imgTemplate = $('#optTemplate').value.includes('{file}') ? $('#optTemplate').value : '[img:{file}]';
      save();
    });
  }

  // Подписи Word на языке, на котором созданы вопросы
  function labels() {
    if (set.lang !== 'other') return LANGS[set.lang].labels;
    const base = LANGS.ru.labels, l = set.labels || {};
    return Object.assign({}, base, l, { levels: Object.assign({}, base.levels, l.levels || {}) });
  }

  // ---------- старт ----------
  load();
  bind();
  syncInputs();
  if (Object.keys(set.steps).length) { $('#progressCard').classList.remove('hidden'); $('#btnStop').disabled = true; renderSteps(); }
  if (set.questions.length) $('#inputCard').classList.add('hidden');
  renderResult();
  window.__geo = { get set() { return set; }, set _set(v) { set = v; renderResult(); } };
})();
