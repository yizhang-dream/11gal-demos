const CATEGORY_LABELS = {
  all: '全部',
  interactive: '交互原型',
  art: '美术视觉',
  audio: '音频试听',
  video: '视频片段',
};

const els = {
  title: document.getElementById('site-title'),
  subtitle: document.getElementById('site-subtitle'),
  countChip: document.getElementById('count-chip'),
  updatedChip: document.getElementById('updated-chip'),
  nav: document.getElementById('category-nav'),
  grid: document.getElementById('demo-grid'),
  empty: document.getElementById('empty-state'),
  error: document.getElementById('load-error'),
  dialog: document.getElementById('detail-dialog'),
  dialogCategory: document.getElementById('dialog-category'),
  dialogTitle: document.getElementById('dialog-title'),
  dialogMedia: document.getElementById('dialog-media'),
  dialogSummary: document.getElementById('dialog-summary'),
  dialogNotesWrap: document.getElementById('dialog-notes-wrap'),
  dialogNotes: document.getElementById('dialog-notes'),
  dialogTags: document.getElementById('dialog-tags'),
  dialogOpenLink: document.getElementById('dialog-open-link'),
  dialogCopyLink: document.getElementById('dialog-copy-link'),
  copyFeedback: document.getElementById('copy-feedback'),
  dialogClose: document.getElementById('dialog-close'),
};

let allDemos = [];
let activeCategory = 'all';
let currentDemoId = null;

function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || cat || '其他';
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function renderFilters(demos) {
  if (!demos.length) {
    els.nav.hidden = true;
    els.nav.replaceChildren();
    return;
  }

  const cats = ['all'];
  for (const d of demos) {
    const c = d.category || 'interactive';
    if (!cats.includes(c)) cats.push(c);
  }

  els.nav.hidden = cats.length <= 2;
  const frag = document.createDocumentFragment();
  for (const cat of cats) {
    const count = cat === 'all' ? demos.length : demos.filter((d) => (d.category || 'interactive') === cat).length;
    const btn = makeEl('button', 'filter-btn', `${categoryLabel(cat)} (${count})`);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(activeCategory === cat));
    btn.addEventListener('click', () => {
      activeCategory = cat;
      renderFilters(allDemos);
      renderGrid();
    });
    frag.appendChild(btn);
  }
  els.nav.replaceChildren(frag);
}

function renderGrid() {
  const list = activeCategory === 'all'
    ? allDemos
    : allDemos.filter((d) => (d.category || 'interactive') === activeCategory);

  if (!allDemos.length) {
    els.grid.hidden = true;
    els.empty.hidden = false;
    return;
  }

  els.empty.hidden = true;
  els.grid.hidden = false;

  const frag = document.createDocumentFragment();
  for (const item of list) {
    const card = makeEl('article', 'demo-card');

    const cover = makeEl('div', 'card-cover');
    if (item.cover) {
      const img = document.createElement('img');
      img.src = item.cover;
      img.alt = item.title || 'Demo 封面';
      img.loading = 'lazy';
      cover.appendChild(img);
    } else {
      cover.appendChild(makeEl('span', 'card-cover-placeholder', categoryLabel(item.category)));
    }
    card.appendChild(cover);

    const body = makeEl('div', 'card-body');
    const meta = makeEl('div', 'card-meta');
    meta.appendChild(makeEl('span', 'card-badge', categoryLabel(item.category)));
    if (item.status || item.date) {
      meta.appendChild(makeEl('span', 'card-status', [item.status, item.date].filter(Boolean).join(' · ')));
    }
    body.appendChild(meta);
    body.appendChild(makeEl('h2', 'card-title', item.title || item.id));
    body.appendChild(makeEl('p', 'card-summary', item.summary || ''));

    if (Array.isArray(item.tags) && item.tags.length) {
      const tags = makeEl('div', 'tag-row');
      for (const t of item.tags) {
        tags.appendChild(makeEl('span', 'tag-chip', t));
      }
      body.appendChild(tags);
    }

    const actions = makeEl('div', 'card-actions');
    if (item.url) {
      const link = makeEl('a', 'btn-primary', '打开 Demo');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.appendChild(link);
    }
    const detailBtn = makeEl('button', 'btn-secondary', '讨论详情');
    detailBtn.type = 'button';
    detailBtn.addEventListener('click', () => openDemoDialog(item, true));
    actions.appendChild(detailBtn);

    body.appendChild(actions);
    card.appendChild(body);
    frag.appendChild(card);
  }
  els.grid.replaceChildren(frag);
}

function renderDialogMedia(item) {
  els.dialogMedia.replaceChildren();
  const media = item.media || null;
  const mediaType = media?.type || (item.cover ? 'image' : null);
  const mediaSrc = media?.src || item.cover;

  if (!mediaSrc || !mediaType) {
    els.dialogMedia.hidden = true;
    return;
  }

  els.dialogMedia.hidden = false;
  if (mediaType === 'video') {
    const v = document.createElement('video');
    v.src = mediaSrc;
    v.controls = true;
    v.playsInline = true;
    v.preload = 'metadata';
    els.dialogMedia.appendChild(v);
  } else if (mediaType === 'audio') {
    const a = document.createElement('audio');
    a.src = mediaSrc;
    a.controls = true;
    a.preload = 'metadata';
    els.dialogMedia.appendChild(a);
  } else {
    const img = document.createElement('img');
    img.src = mediaSrc;
    img.alt = item.title || 'Demo 预览';
    els.dialogMedia.appendChild(img);
  }
}

function openDemoDialog(item, syncHash = false) {
  currentDemoId = item.id;
  els.dialogCategory.textContent = categoryLabel(item.category);
  els.dialogTitle.textContent = item.title || item.id;
  els.dialogSummary.textContent = item.summary || '';
  els.copyFeedback.textContent = '';

  renderDialogMedia(item);

  const notes = Array.isArray(item.notes) ? item.notes : [];
  els.dialogNotes.replaceChildren();
  if (notes.length) {
    els.dialogNotesWrap.hidden = false;
    for (const note of notes) {
      els.dialogNotes.appendChild(makeEl('li', '', note));
    }
  } else {
    els.dialogNotesWrap.hidden = true;
  }

  els.dialogTags.replaceChildren();
  if (Array.isArray(item.tags)) {
    for (const t of item.tags) {
      els.dialogTags.appendChild(makeEl('span', 'tag-chip', t));
    }
  }

  if (item.url) {
    els.dialogOpenLink.href = item.url;
    els.dialogOpenLink.hidden = false;
  } else {
    els.dialogOpenLink.hidden = true;
  }

  if (syncHash && item.id) {
    history.replaceState(null, '', `#demo=${encodeURIComponent(item.id)}`);
  }

  if (!els.dialog.open) {
    els.dialog.showModal();
  }
}

function openByHash() {
  const m = /^#demo=(.+)$/.exec(window.location.hash);
  if (!m) return;
  const targetId = decodeURIComponent(m[1]);
  const found = allDemos.find((d) => d.id === targetId);
  if (found) openDemoDialog(found, false);
}

function setupDialogControls() {
  els.dialogClose.addEventListener('click', () => els.dialog.close());

  // Fallback for browsers without <dialog closedby="any"> support (e.g. Safari)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    els.dialog.addEventListener('click', (event) => {
      if (event.target !== els.dialog) return;
      const rect = els.dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      els.dialog.close();
    });
  }

  els.dialog.addEventListener('close', () => {
    els.dialogMedia.querySelectorAll('video, audio').forEach((m) => m.pause());
    currentDemoId = null;
    if (window.location.hash.startsWith('#demo=')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  });

  els.dialogCopyLink.addEventListener('click', async () => {
    if (!currentDemoId) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}#demo=${encodeURIComponent(currentDemoId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      els.copyFeedback.textContent = '已复制链接';
    } catch {
      els.copyFeedback.textContent = shareUrl;
    }
  });

  window.addEventListener('hashchange', openByHash);
}

async function init() {
  setupDialogControls();
  try {
    const res = await fetch('./demos.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const project = data.project || {};
    if (project.title) {
      els.title.textContent = project.title;
      document.title = project.title;
    }
    if (project.subtitle) els.subtitle.textContent = project.subtitle;
    if (project.updatedAt) els.updatedChip.textContent = `更新于 ${project.updatedAt}`;

    allDemos = Array.isArray(data.demos) ? data.demos : [];
    els.countChip.textContent = `当前收录 ${allDemos.length} 项`;

    renderFilters(allDemos);
    renderGrid();
    openByHash();
  } catch (err) {
    els.error.hidden = false;
    els.error.textContent = `载入 demos.json 失败：${err.message}`;
  }
}

init();
