const CATEGORY_LABELS = {
  all: '全部卷目',
  interactive: '交互原型',
  art: '美术视觉',
  audio: '音频试听',
  video: '影像片段',
};

const els = {
  empty: document.getElementById('empty-state'),
  gallery: document.getElementById('gallery-stage'),
  title: document.getElementById('site-title'),
  subtitle: document.getElementById('site-subtitle'),
  updatedChip: document.getElementById('updated-chip'),
  galleryTitle: document.getElementById('gallery-title'),
  gallerySubtitle: document.getElementById('gallery-subtitle'),
  galleryUpdatedChip: document.getElementById('gallery-updated-chip'),
  countChip: document.getElementById('count-chip'),
  nav: document.getElementById('category-nav'),
  grid: document.getElementById('demo-grid'),
  error: document.getElementById('load-error'),
  themeToggle: document.getElementById('theme-toggle'),
  motionToggle: document.getElementById('motion-toggle'),
  motionToggleLabel: document.getElementById('motion-toggle-label'),
  canvas: document.getElementById('ambient-canvas'),
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
  dialogForm: document.querySelector('.dialog-dismiss-form'),
};

let allDemos = [];
let activeCategory = 'all';
let currentDemoId = null;

/* ==================================================
   1. Two-State Color Scheme Toggle (dark-mode-toggle)
   ================================================== */
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
const schemeMeta = document.querySelector('meta[name="color-scheme"]');

function getSystemScheme() {
  return darkMedia.matches ? 'dark' : 'light';
}

function getStoredScheme() {
  try {
    const val = localStorage.getItem('color-scheme');
    return val === 'light' || val === 'dark' ? val : null;
  } catch {
    return null;
  }
}

function getRenderedScheme() {
  return getStoredScheme() ?? getSystemScheme();
}

function syncMetaScheme(stored) {
  if (!schemeMeta) return;
  schemeMeta.content = stored ?? 'light dark';
}

let ambientRefreshTheme = () => {};

function setupThemeToggle() {
  syncMetaScheme(getStoredScheme());

  els.themeToggle?.addEventListener('click', () => {
    const system = getSystemScheme();
    const target = getRenderedScheme() === 'dark' ? 'light' : 'dark';
    let nextStored = null;

    if (target !== system) {
      nextStored = target;
      try {
        localStorage.setItem('color-scheme', target);
      } catch {}
    } else {
      try {
        localStorage.removeItem('color-scheme');
      } catch {}
    }

    syncMetaScheme(nextStored);
    ambientRefreshTheme();
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== 'color-scheme' && event.key !== null) return;
    syncMetaScheme(getStoredScheme());
    ambientRefreshTheme();
  });

  // Never erase localStorage overrides when OS theme changes; only refresh canvas colors.
  darkMedia.addEventListener('change', () => {
    ambientRefreshTheme();
  });
}

/* ==================================================
   2. Ambient Ink-Petal & Gold Dust Canvas (motion)
   ================================================== */
function setupAmbientCanvas() {
  const canvas = els.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduceMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = reduceMotionMedia.matches;
  let rafId = null;
  let lastTs = 0;
  let particles = [];
  let palette = { ink: '45, 58, 74', gold: '150, 111, 52' };

  function readPalette() {
    const isDark = getRenderedScheme() === 'dark';
    palette = isDark
      ? { ink: '158, 210, 218', gold: '223, 192, 132' }
      : { ink: '44, 62, 82', gold: '156, 114, 52' };
  }

  ambientRefreshTheme = readPalette;
  readPalette();

  function updateMotionButton() {
    if (!els.motionToggle || !els.motionToggleLabel) return;
    els.motionToggle.dataset.paused = String(userPaused);
    els.motionToggleLabel.textContent = userPaused ? '浮墨 · 启' : '浮墨 · 静';
    els.motionToggle.setAttribute(
      'aria-label',
      userPaused ? '开启背景浮墨动画' : '暂停背景浮墨动画'
    );
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const targetCount = w < 640 ? 14 : 22;
    if (particles.length !== targetCount) {
      particles = Array.from({ length: targetCount }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: -8 - Math.random() * 14,
        vy: 10 + Math.random() * 16,
        size: i % 3 === 0 ? 2.2 + Math.random() * 1.8 : 4.2 + Math.random() * 5.2,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.65,
        phase: Math.random() * Math.PI * 2,
        isGold: i % 3 === 0,
        alpha: i % 3 === 0 ? 0.16 + Math.random() * 0.18 : 0.08 + Math.random() * 0.12,
      }));
    }
  }

  function drawFrame(now) {
    if (userPaused || document.hidden) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.05, (now - lastTs) / 1000) : 0.016;
    lastTs = now;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    for (const p of particles) {
      p.phase += dt * 0.9;
      p.x += (p.vx + Math.sin(p.phase) * 7) * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      if (p.y > h + 24) {
        p.y = -20;
        p.x = Math.random() * (w + 160);
      }
      if (p.x < -30) {
        p.x = w + 24;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.isGold) {
        ctx.fillStyle = `rgba(${palette.gold}, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${palette.ink}, ${p.alpha})`;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.quadraticCurveTo(p.size * 0.72, -p.size * 0.15, 0, p.size * 0.9);
        ctx.quadraticCurveTo(-p.size * 0.65, 0, 0, -p.size);
        ctx.fill();
      }
      ctx.restore();
    }

    rafId = window.requestAnimationFrame(drawFrame);
  }

  function startLoop() {
    if (userPaused || document.hidden || rafId !== null) return;
    lastTs = 0;
    rafId = window.requestAnimationFrame(drawFrame);
  }

  function stopLoop(clear = false) {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (clear) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  resize();
  updateMotionButton();
  if (!userPaused) startLoop();

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop(false);
    else startLoop();
  });

  reduceMotionMedia.addEventListener('change', (e) => {
    userPaused = e.matches;
    updateMotionButton();
    if (userPaused) stopLoop(true);
    else startLoop();
  });

  els.motionToggle?.addEventListener('click', () => {
    userPaused = !userPaused;
    updateMotionButton();
    if (userPaused) stopLoop(true);
    else startLoop();
  });
}

/* ==================================================
   3. Top-Layer Animated Dialog Close & Fallbacks
   ================================================== */
let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay());
}

async function closeTopLayer(dialog) {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

/* ==================================================
   4. Demo Registry Rendering & Deep-Link Dialog
   ================================================== */
function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || cat || '其他试作';
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
    const count =
      cat === 'all'
        ? demos.length
        : demos.filter((d) => (d.category || 'interactive') === cat).length;
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
  if (!allDemos.length) {
    els.gallery.hidden = true;
    els.empty.hidden = false;
    return;
  }

  els.empty.hidden = true;
  els.gallery.hidden = false;

  const list =
    activeCategory === 'all'
      ? allDemos
      : allDemos.filter((d) => (d.category || 'interactive') === activeCategory);

  const frag = document.createDocumentFragment();
  for (const item of list) {
    const card = makeEl('article', 'demo-card glass-surface');

    const cover = makeEl('div', 'card-cover');
    if (item.cover) {
      const img = document.createElement('img');
      img.src = item.cover;
      img.alt = item.title || '试作封面';
      img.loading = 'lazy';
      cover.appendChild(img);
    } else {
      cover.appendChild(makeEl('span', 'card-cover-placeholder', categoryLabel(item.category)));
    }
    card.appendChild(cover);

    const body = makeEl('div', 'card-body');
    const meta = makeEl('div', 'card-meta');
    meta.appendChild(makeEl('span', 'seal-tag', categoryLabel(item.category)));
    if (item.status || item.date) {
      meta.appendChild(
        makeEl('span', 'card-status', [item.status, item.date].filter(Boolean).join(' · '))
      );
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
      const link = makeEl('a', 'btn-ink', '进入试作');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.appendChild(link);
    }
    const detailBtn = makeEl('button', 'btn-glass', '展卷商榷');
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
    img.alt = item.title || '试作预览';
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

  els.dialog.removeAttribute('data-closing');
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
  els.dialogClose?.addEventListener('click', () => closeTopLayer(els.dialog));

  els.dialogForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    closeTopLayer(els.dialog);
  });

  // Route native close requests (Esc, closedby="any" backdrop dismiss) through exit transition
  els.dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeTopLayer(els.dialog);
  });

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
      closeTopLayer(els.dialog);
    });
  }

  els.dialog.addEventListener('close', () => {
    els.dialogMedia.querySelectorAll('video, audio').forEach((m) => m.pause());
    currentDemoId = null;
    if (window.location.hash.startsWith('#demo=')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  });

  els.dialogCopyLink?.addEventListener('click', async () => {
    if (!currentDemoId) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}#demo=${encodeURIComponent(currentDemoId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      els.copyFeedback.textContent = '已复制讨论锚点';
    } catch {
      els.copyFeedback.textContent = shareUrl;
    }
  });

  window.addEventListener('hashchange', openByHash);
}

async function init() {
  setupThemeToggle();
  setupAmbientCanvas();
  setupDialogControls();

  try {
    const res = await fetch('./demos.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const project = data.project || {};
    if (project.title) {
      els.title.textContent = project.title;
      els.galleryTitle.textContent = project.title;
      document.title = `${project.title} | 11gal Demo Gallery`;
    }
    if (project.subtitle) {
      els.subtitle.textContent = project.subtitle;
      els.gallerySubtitle.textContent = project.subtitle;
    }
    if (project.updatedAt) {
      const updatedText = `更新于 ${project.updatedAt}`;
      els.updatedChip.textContent = updatedText;
      els.galleryUpdatedChip.textContent = updatedText;
    }

    allDemos = Array.isArray(data.demos) ? data.demos : [];
    els.countChip.textContent = `收录 ${allDemos.length} 卷`;

    renderFilters(allDemos);
    renderGrid();
    openByHash();
  } catch (err) {
    els.error.hidden = false;
    els.error.textContent = `载入 demos.json 失败：${err.message}`;
  }
}

init();
