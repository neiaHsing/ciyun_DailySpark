(() => {
  'use strict';

  const STORAGE_KEY = 'daily-spark:v1';
  const MAX_THOUGHTS = 1000;
  const MAX_KEYWORDS = 12;
  const STOPWORDS = new Set(`我们 你们 他们 自己 这个 那个 这些 那些 一个 一些 一种 一下 一篇 一份 一本 今天 明天 昨天 现在 最近 以后 之前 之后 因为 所以 如果 但是 而且 或者 以及 还有 已经 还是 可能 应该 可以 需要 想要 希望 觉得 认为 感觉 知道 发现 看到 做个 做一个 做成 进行 开始 继续 关于 通过 使用 其实 这样 那样 什么 怎么 为什么 如何 时候 事情 东西 方面 时候 问题 比较 非常 特别 真的 有点 很多 大家 一起 里面 外面 上面 下面 这里 那里 然后 就是 不是 没有 不能 不会 不用 不要 一个 这个 那个 它们 她们 我的 你的 他的 以及 其中 这件 这次 那些 每天 每个 有些 对于 为了 并且 或是 这样 这个 我想 我们的 一个 想法 记录 关键词 词云 觉得 时候 事情 过的 里的 看的 读过 读了 做了 做的 and the for with from this that have will would could should about into your you are was were been being it's they them their then than just really very more much some something someone one two can not but all any how why what when where doing make made want need like maybe today tomorrow because good idea ideas thing things to of in on a an is it i me my we our at as by or if so do did be`.split(/\s+/));
  const $ = (id) => document.getElementById(id);
  const ui = {
    form: $('thought-form'),
    thought: $('thought-input'),
    keywords: $('keyword-input'),
    manualOnly: $('manual-only-toggle'),
    charCount: $('char-count'),
    saveButton: $('save-button'),
    cancelEdit: $('cancel-edit-button'),
    thoughtsList: $('thoughts-list'),
    thoughtCount: $('thought-count-label'),
    statThoughts: $('stat-thoughts'),
    statKeywords: $('stat-keywords'),
    statFocus: $('stat-focus'),
    cloudStage: $('cloud-stage'),
    canvas: $('wordcloud-canvas'),
    cloudEmpty: $('cloud-empty'),
    cloudStatus: $('cloud-status'),
    keywordRail: $('keyword-rail'),
    focusContent: $('focus-content'),
    today: $('today-label'),
    exportButton: $('export-button'),
    importButton: $('import-button'),
    importInput: $('import-input'),
    toast: $('toast')
  };

  let state = readState();
  let selectedWord = null;
  let editingId = null;
  let toastTimer = null;
  let redrawTimer = null;
  let canvasFallback = null;

  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeKeyword(word) {
    const clean = String(word || '').normalize('NFKC').trim().replace(/^[-#\s]+|[-#\s]+$/g, '').replace(/\s+/g, ' ');
    if (!clean || clean.length > 24) return '';
    if (!/[\p{L}\p{N}]/u.test(clean)) return '';
    return /^[\x00-\x7f]+$/.test(clean) ? clean.toLowerCase() : clean;
  }

  function validKeyword(word) {
    if (!word || STOPWORDS.has(word.toLowerCase())) return false;
    if (/^[\p{Script=Han}]+$/u.test(word)) return word.length >= 2 && word.length <= 10;
    if (/^[a-z\d][a-z\d-]*$/i.test(word)) return word.length >= 2 && !/^\d+$/.test(word);
    return /[\p{L}]/u.test(word);
  }

  function parseManualKeywords(raw) {
    return [...new Set(String(raw || '').split(/[,，、;；\n]+/).map(normalizeKeyword).filter(validKeyword))].slice(0, MAX_KEYWORDS);
  }

  function extractKeywords(text) {
    const source = String(text || '');
    const frequency = new Map();
    const segments = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(source)].filter((part) => part.isWordLike).map((part) => part.segment)
      : source.match(/[\p{Script=Han}]{2,10}|[a-zA-Z][a-zA-Z\d-]+/gu) || [];
    for (const raw of segments) {
      const word = normalizeKeyword(raw);
      if (!validKeyword(word)) continue;
      frequency.set(word, (frequency.get(word) || 0) + 1);
    }
    return [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  function keywordUnion(text, manual, manualOnly = false) {
    return [...new Set(manualOnly ? manual : [...manual, ...extractKeywords(text)])].slice(0, MAX_KEYWORDS);
  }

  function sanitizeThought(record) {
    if (!record || typeof record !== 'object') return null;
    const text = String(record.text || '').trim().slice(0, 3000);
    if (!text) return null;
    const manual = Array.isArray(record.manualKeywords)
      ? [...new Set(record.manualKeywords.map(normalizeKeyword).filter(validKeyword))].slice(0, MAX_KEYWORDS)
      : [];
    const existing = Array.isArray(record.keywords)
      ? [...new Set(record.keywords.map(normalizeKeyword).filter(validKeyword))].slice(0, MAX_KEYWORDS)
      : [];
    const manualOnly = record.manualOnly === true;
    const keywords = record.manualKeywords || !existing.length ? keywordUnion(text, manual, manualOnly) : existing;
    return {
      id: typeof record.id === 'string' && record.id.length < 150 ? record.id : createId(),
      text,
      manualKeywords: manual,
      manualOnly,
      keywords,
      createdAt: Number.isFinite(Date.parse(record.createdAt)) ? record.createdAt : new Date().toISOString(),
      updatedAt: Number.isFinite(Date.parse(record.updatedAt)) ? record.updatedAt : null
    };
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return { thoughts: [], attention: {} };
    const thoughts = Array.isArray(raw.thoughts) ? raw.thoughts.map(sanitizeThought).filter(Boolean).slice(0, MAX_THOUGHTS) : [];
    const attention = {};
    if (raw.attention && typeof raw.attention === 'object' && !Array.isArray(raw.attention)) {
      for (const [key, value] of Object.entries(raw.attention)) {
        const word = normalizeKeyword(key);
        if (validKeyword(word) && Number.isFinite(value)) attention[word] = Math.min(99, Math.max(0, Math.floor(value)));
      }
    }
    return { thoughts, attention };
  }

  function readState() {
    try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch { return { thoughts: [], attention: {} }; }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      notify('浏览器未能保存数据，请先导出备份。');
      return false;
    }
  }

  function notify(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3500);
  }

  function formatDate(iso) {
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  function wordStats() {
    const map = new Map();
    for (const thought of state.thoughts) {
      for (const word of new Set(thought.keywords)) {
        if (!map.has(word)) map.set(word, { word, count: 0, boost: state.attention[word] || 0, thoughts: [] });
        const item = map.get(word);
        item.count += 1;
        item.thoughts.push(thought);
      }
    }
    const baseSize = map.size <= 3 ? 52 : map.size <= 10 ? 40 : map.size <= 20 ? 34 : map.size <= 35 ? 28 : 23;
    return [...map.values()].map((item) => ({
      ...item,
      size: Math.min(82, baseSize + Math.round(8 * Math.sqrt(item.count - 1)) + item.boost * 9),
      score: item.count * 2 + item.boost * 3
    })).sort((a, b) => b.score - a.score || a.word.localeCompare(b.word, 'zh-CN'));
  }

  function pruneAttention() {
    const active = new Set(state.thoughts.flatMap((thought) => thought.keywords));
    for (const word of Object.keys(state.attention)) if (!active.has(word)) delete state.attention[word];
    if (selectedWord && !active.has(selectedWord)) selectedWord = null;
  }

  function textButton(label, className, onClick, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderThoughts() {
    ui.thoughtsList.replaceChildren();
    const sorted = [...state.thoughts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    ui.thoughtCount.textContent = `${sorted.length} 条`;
    if (!sorted.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = '还没有记录。你的第一个想法，会从这里开始。';
      ui.thoughtsList.append(empty);
      return;
    }
    for (const thought of sorted) {
      const card = document.createElement('article');
      card.className = 'thought-card';
      const meta = document.createElement('div');
      meta.className = 'thought-meta';
      meta.textContent = formatDate(thought.createdAt);
      const body = document.createElement('p');
      body.className = 'thought-text';
      body.textContent = thought.text;
      const tags = document.createElement('div');
      tags.className = 'thought-tags';
      for (const word of thought.keywords) {
        tags.append(textButton(`#${word}`, 'tag', () => focusWord(word, true)));
      }
      const actions = document.createElement('div');
      actions.className = 'thought-actions';
      actions.append(
        textButton('编辑', 'mini-button', () => editThought(thought.id)),
        textButton('删除', 'mini-button', () => deleteThought(thought.id))
      );
      card.append(meta, body, tags, actions);
      ui.thoughtsList.append(card);
    }
  }

  function renderFocus(stats) {
    ui.focusContent.replaceChildren();
    const item = stats.find((entry) => entry.word === selectedWord) || stats[0];
    if (!item) {
      const blank = document.createElement('div');
      blank.className = 'focus-empty';
      blank.innerHTML = '<span aria-hidden="true">✳</span><p>点亮词云中的一个词，看看哪些想法与它有关。</p>';
      ui.focusContent.append(blank);
      return;
    }
    selectedWord = item.word;
    const row = document.createElement('div');
    row.className = 'focus-detail';
    const word = document.createElement('strong');
    word.className = 'focus-word';
    word.textContent = item.word;
    const detail = document.createElement('div');
    detail.className = 'focus-caption';
    detail.textContent = `${item.count} 条相关想法 · 已关注 ${item.boost} 次`;
    row.append(word, detail);
    const actions = document.createElement('div');
    actions.className = 'focus-actions';
    actions.append(
      textButton('＋ 再关注一次', 'secondary-button', () => focusWord(item.word, true)),
      textButton('撤回一次', 'text-button', () => adjustAttention(item.word, -1), item.boost === 0)
    );
    const label = document.createElement('h3');
    label.textContent = '与它有关的想法';
    const related = document.createElement('div');
    related.className = 'related-list';
    for (const thought of item.thoughts.slice(0, 5)) {
      const entry = document.createElement('div');
      entry.className = 'related-item';
      const date = document.createElement('span');
      date.textContent = formatDate(thought.createdAt);
      const text = document.createElement('p');
      text.textContent = thought.text;
      entry.append(date, text);
      related.append(entry);
    }
    ui.focusContent.append(row, actions, label, related);
  }

  function renderRail(stats) {
    ui.keywordRail.replaceChildren();
    if (!stats.length) return;
    const label = document.createElement('span');
    label.className = 'rail-label';
    label.textContent = '关键词速览';
    ui.keywordRail.append(label);
    for (const item of stats.slice(0, 15)) {
      const button = textButton(item.word, `keyword-chip${selectedWord === item.word ? ' active' : ''}`, () => focusWord(item.word, true));
      button.setAttribute('aria-label', `关注 ${item.word}，当前已关注 ${item.boost} 次`);
      ui.keywordRail.append(button);
    }
  }

  function cloudColor(word) {
    const palette = ['#1d3a35', '#d9683a', '#a57945', '#596f69', '#bd5847', '#7b5b46'];
    let hash = 0;
    for (let i = 0; i < word.length; i += 1) hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }

  function drawCloud(stats) {
    const hasWords = stats.length > 0;
    ui.cloudEmpty.classList.toggle('hidden', hasWords);
    ui.canvas.classList.toggle('hidden', !hasWords);
    ui.cloudStatus.textContent = hasWords ? `共 ${stats.length} 个关键词 · 点击后放大` : '等待你的第一个想法';
    if (canvasFallback) { canvasFallback.remove(); canvasFallback = null; }
    if (!hasWords) return;
    const width = Math.max(1, Math.floor(ui.cloudStage.clientWidth));
    const height = Math.max(1, Math.floor(ui.cloudStage.clientHeight));
    ui.canvas.width = width;
    ui.canvas.height = height;
    if (typeof window.WordCloud !== 'function' || !window.WordCloud.isSupported) {
      drawFallback(stats);
      return;
    }
    try {
      window.WordCloud.stop();
      window.WordCloud(ui.canvas, {
        list: stats.slice(0, 70).map((item) => [item.word, item.size]),
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
        weightFactor: 1,
        minSize: 11,
        gridSize: 8,
        backgroundColor: '#f9f7f0',
        color: (word) => cloudColor(word),
        shape: 'circle',
        ellipticity: 0.72,
        rotateRatio: 0,
        shuffle: false,
        shrinkToFit: true,
        drawOutOfBound: false,
        click: (item) => { if (item) focusWord(item[0], true); },
        hover: (item) => { ui.canvas.style.cursor = item ? 'pointer' : 'default'; }
      });
    } catch {
      drawFallback(stats);
    }
  }

  function drawFallback(stats) {
    ui.canvas.classList.add('hidden');
    const fallback = document.createElement('div');
    fallback.className = 'cloud-fallback';
    fallback.setAttribute('aria-label', '可点击的想法词云');
    for (const item of stats.slice(0, 35)) {
      const button = textButton(item.word, 'fallback-word', () => focusWord(item.word, true));
      button.style.fontSize = `${Math.max(17, Math.min(52, item.size))}px`;
      button.style.color = cloudColor(item.word);
      fallback.append(button);
    }
    ui.cloudStage.append(fallback);
    canvasFallback = fallback;
  }

  function render() {
    const stats = wordStats();
    if (selectedWord && !stats.some((item) => item.word === selectedWord)) selectedWord = null;
    ui.statThoughts.textContent = state.thoughts.length;
    ui.statKeywords.textContent = stats.length;
    ui.statFocus.textContent = stats.reduce((sum, item) => sum + item.boost, 0);
    renderThoughts();
    renderFocus(stats);
    renderRail(stats);
    drawCloud(stats);
  }

  function adjustAttention(word, delta) {
    const key = normalizeKeyword(word);
    if (!wordStats().some((item) => item.word === key)) return;
    state.attention[key] = Math.max(0, Math.min(99, (state.attention[key] || 0) + delta));
    selectedWord = key;
    persist();
    render();
  }

  function focusWord(word, grow) {
    if (grow) adjustAttention(word, 1);
    else { selectedWord = normalizeKeyword(word); render(); }
  }

  function resetForm() {
    ui.form.reset();
    editingId = null;
    ui.saveButton.innerHTML = '记下这个想法 <span aria-hidden="true">↗</span>';
    ui.cancelEdit.classList.add('hidden');
    ui.charCount.textContent = '0 / 3000';
  }

  function editThought(id) {
    const thought = state.thoughts.find((item) => item.id === id);
    if (!thought) return;
    editingId = id;
    ui.thought.value = thought.text;
    ui.keywords.value = thought.manualKeywords.join('，');
    ui.manualOnly.checked = thought.manualOnly;
    ui.charCount.textContent = `${thought.text.length} / 3000`;
    ui.saveButton.innerHTML = '保存修改 <span aria-hidden="true">↗</span>';
    ui.cancelEdit.classList.remove('hidden');
    ui.thought.focus();
    ui.thought.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function deleteThought(id) {
    if (!window.confirm('确定删除这条想法吗？')) return;
    state.thoughts = state.thoughts.filter((item) => item.id !== id);
    if (editingId === id) resetForm();
    pruneAttention();
    persist();
    render();
    notify('已删除这条想法');
  }

  function saveThought(event) {
    event.preventDefault();
    const text = ui.thought.value.trim();
    if (!text) { ui.thought.focus(); return; }
    const manualKeywords = parseManualKeywords(ui.keywords.value);
    const manualOnly = ui.manualOnly.checked;
    const keywords = keywordUnion(text, manualKeywords, manualOnly);
    if (!keywords.length) {
      notify(manualOnly ? '请填写至少一个手动关键词。' : '暂时无法提取关键词，请在补充关键词中填入一两个词。');
      ui.keywords.focus();
      return;
    }
    const now = new Date().toISOString();
    if (editingId) {
      const thought = state.thoughts.find((item) => item.id === editingId);
      if (thought) Object.assign(thought, { text, manualKeywords, manualOnly, keywords, updatedAt: now });
    } else {
      if (state.thoughts.length >= MAX_THOUGHTS) {
        notify('已达到 1000 条记录上限，请先导出备份整理。');
        return;
      }
      state.thoughts.unshift({ id: createId(), text, manualKeywords, manualOnly, keywords, createdAt: now, updatedAt: null });
    }
    pruneAttention();
    persist();
    resetForm();
    render();
    notify('已记下，想法正在词云里生长');
  }

  function exportBackup() {
    const payload = { app: 'DailySpark', version: 1, exportedAt: new Date().toISOString(), ...state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dailyspark-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('备份已导出');
  }

  async function importBackup(file) {
    if (!file) return;
    if (file.size > 3_000_000) { notify('备份文件过大，请检查是否选择了正确文件。'); return; }
    try {
      const raw = JSON.parse(await file.text());
      if (raw.app !== 'DailySpark' || raw.version !== 1 || !Array.isArray(raw.thoughts)) throw new Error('Invalid backup');
      const imported = normalizeState(raw);
      const byId = new Map(state.thoughts.map((thought) => [thought.id, thought]));
      for (const thought of imported.thoughts) if (!byId.has(thought.id)) byId.set(thought.id, thought);
      const added = byId.size - state.thoughts.length;
      state.thoughts = [...byId.values()].slice(0, MAX_THOUGHTS);
      for (const [word, count] of Object.entries(imported.attention)) state.attention[word] = Math.max(state.attention[word] || 0, count);
      pruneAttention();
      persist();
      render();
      notify(`已导入 ${added} 条新想法，原有记录已保留`);
    } catch {
      notify('导入失败：请选择 DailySpark 导出的 JSON 备份。');
    } finally {
      ui.importInput.value = '';
    }
  }

  ui.today.textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  ui.thought.addEventListener('input', () => { ui.charCount.textContent = `${ui.thought.value.length} / 3000`; });
  ui.form.addEventListener('submit', saveThought);
  ui.cancelEdit.addEventListener('click', resetForm);
  ui.exportButton.addEventListener('click', exportBackup);
  ui.importButton.addEventListener('click', () => ui.importInput.click());
  ui.importInput.addEventListener('change', () => importBackup(ui.importInput.files?.[0]));
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      clearTimeout(redrawTimer);
      redrawTimer = setTimeout(() => drawCloud(wordStats()), 120);
    }).observe(ui.cloudStage);
  } else {
    window.addEventListener('resize', () => {
      clearTimeout(redrawTimer);
      redrawTimer = setTimeout(() => drawCloud(wordStats()), 120);
    });
  }
  render();
})();
