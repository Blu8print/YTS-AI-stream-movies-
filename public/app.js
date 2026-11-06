// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function setStatus(msg, type = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = type;
}

function pickTorrent(torrents) {
  const priority = [
    t => t.quality === '1080p' && t.video_codec === 'x264',
    t => t.quality === '720p'  && t.video_codec === 'x264',
    t => t.video_codec === 'x264',
    t => t.quality === '1080p',
    t => t.quality === '720p',
    () => true,
  ];
  for (const fn of priority) {
    const found = torrents.find(fn);
    if (found) return found;
  }
  return torrents[0];
}

function fmtSpeed(bytesPerSec) {
  if (bytesPerSec > 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSec > 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}

function fmtSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${bytes} B`;
}

// ── Watchlist state ───────────────────────────────────────────────────────────
let watchlist = { watched: [], watchLater: [] };

async function loadWatchlist() {
  try { watchlist = await fetch('/api/watchlist').then(r => r.json()); }
  catch (_) {}
}

function isWatched(imdbId)    { return watchlist.watched.some(m => m.imdbId === imdbId); }
function isWatchLater(imdbId) { return watchlist.watchLater.some(m => m.imdbId === imdbId); }

async function addWatchLater(movie, suggestion) {
  const s = suggestion || {};
  const plot = movie.overview || s.plot || null;
  const director = s.director || null;
  const actors = s.actors || [];
  await fetch('/api/watchlist/later', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imdbId: movie.imdb_id, title: movie.title, year: movie.year, poster: movie.poster, rating: movie.rating, trailerKey: movie.trailerKey || null, plot, director, actors }),
  });
  if (!watchlist.watchLater.find(m => m.imdbId === movie.imdb_id)) {
    watchlist.watchLater.push({ imdbId: movie.imdb_id, title: movie.title, year: movie.year, poster: movie.poster, rating: movie.rating, trailerKey: movie.trailerKey || null, plot, director, actors });
  }
}

async function removeWatchLater(imdbId) {
  await fetch(`/api/watchlist/later/${encodeURIComponent(imdbId)}`, { method: 'DELETE' });
  watchlist.watchLater = watchlist.watchLater.filter(m => m.imdbId !== imdbId);
}

// ── Render movie card ─────────────────────────────────────────────────────────
function renderCard(movie, torrent, suggestion) {
  const card = document.createElement('div');
  card.className = 'movie-card';

  const s = suggestion || {};
  const actors = Array.isArray(s.actors) ? s.actors.join(', ') : '';
  const trailerSection = (suggestion && movie.trailerKey)
    ? `<div class="card-trailer"><iframe src="https://www.youtube.com/embed/${movie.trailerKey}" frameborder="0" allowfullscreen allow="encrypted-media"></iframe></div>`
    : '';
  const wlQueued  = suggestion && movie.imdb_id && isWatchLater(movie.imdb_id);
  const wlWatched = suggestion && movie.imdb_id && isWatched(movie.imdb_id);
  const wlBtnHtml = (suggestion && movie.imdb_id)
    ? `<div class="suggestion-actions">
        <button class="suggestion-wl-btn${wlQueued ? ' active' : ''}">${wlQueued ? '✓ Queued' : '⬇ Watch Later'}</button>
        <button class="suggestion-watched-btn${wlWatched ? ' active' : ''}">${wlWatched ? '✓ Watched' : '○ Watched'}</button>
       </div>`
    : '';

  card.innerHTML = `
    <div class="poster-wrap">
      <img src="${movie.poster || ''}" alt="${movie.title}" loading="lazy" />
      <div class="play-overlay">▶</div>
    </div>
    <div class="card-body">
      <div class="card-title">${movie.title}</div>
      <div class="card-meta">
        <span>${movie.year}</span>
        <span class="rating">★ ${movie.rating}</span>
        <span class="badge">${torrent.quality}</span>
        <span class="badge codec">${torrent.video_codec}</span>
        ${s.language ? `<span class="badge lang">${s.language}</span>` : ''}
      </div>
      ${s.director ? `<div class="card-director">Dir. ${s.director}</div>` : ''}
      ${actors ? `<div class="card-actors">${actors}</div>` : ''}
      ${s.plot ? `<div class="card-plot">${s.plot}</div>` : ''}
      ${wlBtnHtml}
    </div>
    ${trailerSection}
  `;

  if (suggestion && movie.imdb_id) {
    const wlBtn = card.querySelector('.suggestion-wl-btn');
    wlBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isWatchLater(movie.imdb_id)) {
        await removeWatchLater(movie.imdb_id);
        wlBtn.textContent = '⬇ Watch Later';
        wlBtn.classList.remove('active');
      } else {
        await addWatchLater(movie, suggestion);
        wlBtn.textContent = '✓ Queued';
        wlBtn.classList.add('active');
      }
    });

    const watchedBtn = card.querySelector('.suggestion-watched-btn');
    watchedBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isWatched(movie.imdb_id)) {
        await fetch(`/api/watchlist/watched/${encodeURIComponent(movie.imdb_id)}`, { method: 'DELETE' });
        watchlist.watched = watchlist.watched.filter(m => m.imdbId !== movie.imdb_id);
        watchedBtn.textContent = '○ Watched';
        watchedBtn.classList.remove('active');
      } else {
        await fetch('/api/watchlist/watched', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imdbId: movie.imdb_id, title: movie.title, year: movie.year, poster: movie.poster, rating: movie.rating }),
        });
        watchlist.watched.push({ imdbId: movie.imdb_id, title: movie.title, year: movie.year, poster: movie.poster, rating: movie.rating });
        watchedBtn.textContent = '✓ Watched';
        watchedBtn.classList.add('active');
      }
    });
  }

  card.addEventListener('click', () => openInfoModal(movie, torrent, suggestion));
  return card;
}

// ── Render download card ──────────────────────────────────────────────────────
function renderDownloadCard(dl) {
  const card = document.createElement('div');
  card.className = 'dl-card';
  card.dataset.hash = dl.infoHash;

  const pct = (dl.progress * 100).toFixed(1);
  const statusText = dl.done
    ? 'Complete'
    : dl.paused
      ? `Paused · ${pct}%`
      : dl.ready
        ? `${pct}% · ${fmtSpeed(dl.downloadSpeed)} · ${dl.numPeers} peers`
        : 'Fetching metadata…';

  const actors = Array.isArray(dl.actors) && dl.actors.length ? dl.actors.slice(0, 3).join(', ') : '';

  card.innerHTML = `
    ${dl.poster ? `<img class="dl-poster" src="${dl.poster}" alt="${dl.name}" />` : ''}
    <div class="dl-body">
      <div class="dl-name" title="${dl.name}">${dl.name}</div>
      ${dl.director ? `<div class="dl-director">Dir. ${dl.director}</div>` : ''}
      ${actors ? `<div class="dl-actors">${actors}</div>` : ''}
      ${dl.plot ? `<div class="dl-plot">${dl.plot}</div>` : ''}
      <div class="dl-progress-wrap">
        <div class="dl-progress-bar ${dl.done ? 'done' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="dl-meta">
        <span class="dl-status">${statusText}</span>
        ${dl.length ? `<span>${fmtSize(dl.length)}</span>` : ''}
      </div>
      <div class="dl-actions">
        ${dl.ready ? `<button class="dl-watch-btn">▶ Watch Now</button>` : ''}
        ${!dl.done && !dl.paused ? `<button class="dl-pause-btn">⏸ Pause</button>` : ''}
        ${!dl.done && dl.paused ? `<button class="dl-resume-btn">▶ Resume</button>` : ''}
        <button class="dl-delete-btn">✕ Delete</button>
      </div>
    </div>
  `;

  const watchBtn = card.querySelector('.dl-watch-btn');
  if (watchBtn) {
    watchBtn.addEventListener('click', () => {
      $('video-player').src = `/api/stream/${dl.infoHash}`;
      $('modal-title').textContent = dl.name;
      $('modal-meta').textContent = dl.done ? 'Complete' : `${pct}%`;
      $('progress-bar').style.width = `${pct}%`;
      $('stats').textContent = statusText;
      $('player-modal').classList.remove('hidden');
      $('video-player').play().catch(() => {});
    });
  }

  const pauseBtn = card.querySelector('.dl-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => fetch(`/api/torrent/${dl.infoHash}/pause`, { method: 'POST' }));
  }

  const resumeBtn = card.querySelector('.dl-resume-btn');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => fetch(`/api/torrent/${dl.infoHash}/resume`, { method: 'POST' }));
  }

  card.querySelector('.dl-delete-btn').addEventListener('click', async () => {
    await fetch(`/api/download/${dl.infoHash}`, { method: 'DELETE' });
    card.remove();
    if (!$('downloads-list').children.length) $('downloads-empty').classList.remove('hidden');
  });

  return card;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
let downloadsPoller = null;

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('browse-view').classList.toggle('hidden', name !== 'browse');
  $('downloads-view').classList.toggle('hidden', name !== 'downloads');
  $('watchlater-view').classList.toggle('hidden', name !== 'watchlater');
  $('watched-view').classList.toggle('hidden', name !== 'watched');
  $('settings-view').classList.toggle('hidden', name !== 'settings');

  if (name === 'downloads') {
    loadDownloads();
    downloadsPoller = setInterval(loadDownloads, 2000);
  } else {
    clearInterval(downloadsPoller);
  }

  if (name === 'watched') loadWatched();
  if (name === 'watchlater') loadWatchLater();
  if (name === 'settings') loadSettings();
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ── Load latest movies ────────────────────────────────────────────────────────
async function loadLatest() {
  setStatus('Loading latest movies…');
  try {
    const movies = await fetch('/api/latest').then(r => r.json());
    $('movies').innerHTML = '';
    $('movies').classList.remove('suggestions');
    movies.forEach(movie => {
      const torrent = pickTorrent(movie.torrents);
      $('movies').appendChild(renderCard(movie, torrent));
    });
    setStatus(`${movies.length} latest movies — click any to stream`);
  } catch (err) {
    setStatus(`Failed to load latest: ${err.message}`, 'error');
  }
}

// ── Load downloads tab ────────────────────────────────────────────────────────
async function loadDownloads() {
  try {
    const list = await fetch('/api/downloads').then(r => r.json());
    const container = $('downloads-list');
    const empty = $('downloads-empty');

    if (!list.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      $('downloads-count').textContent = '';
      return;
    }

    empty.classList.add('hidden');
    $('downloads-count').textContent = `${list.length} active download${list.length !== 1 ? 's' : ''}`;

    // Update existing cards or add new ones
    const existing = new Set([...container.querySelectorAll('.dl-card')].map(c => c.dataset.hash));
    const incoming = new Set(list.map(d => d.infoHash));

    // Remove stale
    existing.forEach(hash => {
      if (!incoming.has(hash)) container.querySelector(`[data-hash="${hash}"]`)?.remove();
    });

    list.forEach(dl => {
      const pct = (dl.progress * 100).toFixed(1);
      const statusText = dl.done
        ? 'Complete'
        : dl.paused
          ? `Paused · ${pct}%`
          : dl.ready
            ? `${pct}% · ${fmtSpeed(dl.downloadSpeed)} · ${dl.numPeers} peers`
            : 'Fetching metadata…';

      if (existing.has(dl.infoHash)) {
        const card = container.querySelector(`[data-hash="${dl.infoHash}"]`);
        if (card) {
          const bar = card.querySelector('.dl-progress-bar');
          bar.style.width = `${pct}%`;
          if (dl.done) bar.classList.add('done');
          card.querySelector('.dl-status').textContent = statusText;

          // Re-render if button state changed (ready/paused/done)
          const hasWatch  = !!card.querySelector('.dl-watch-btn');
          const hasPause  = !!card.querySelector('.dl-pause-btn');
          const hasResume = !!card.querySelector('.dl-resume-btn');
          if (hasWatch !== dl.ready || hasPause !== (!dl.done && !dl.paused) || hasResume !== (!dl.done && !!dl.paused)) {
            card.replaceWith(renderDownloadCard(dl));
          }
        }
      } else {
        container.appendChild(renderDownloadCard(dl));
      }
    });
  } catch (_) {}
}

// ── Watched sort ──────────────────────────────────────────────────────────────
let watchedSort = 'recent';

function sortWatched(movies, sort) {
  const copy = [...movies];
  switch (sort) {
    case 'title':
      return copy.sort((a, b) => {
        const ta = a.title.replace(/^(the |a |an )\s*/i, '');
        const tb = b.title.replace(/^(the |a |an )\s*/i, '');
        return ta.localeCompare(tb);
      });
    case 'year':
      return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    case 'rating':
      return copy.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
    default:
      return copy.reverse();
  }
}

function getWatchedGroup(m, sort) {
  switch (sort) {
    case 'title': {
      const stripped = m.title.replace(/^(the |a |an )\s*/i, '');
      return stripped[0]?.toUpperCase() || '#';
    }
    case 'year':
      return String(m.year || 'Unknown');
    case 'rating': {
      const r = parseFloat(m.rating) || 0;
      if (r >= 9) return '★ 9.0+';
      if (r >= 8) return '★ 8.0 – 8.9';
      if (r >= 7) return '★ 7.0 – 7.9';
      if (r >= 6) return '★ 6.0 – 6.9';
      return '★ Below 6.0';
    }
    default:
      return null;
  }
}

// ── Load watched tab ──────────────────────────────────────────────────────────
async function loadWatched() {
  await loadWatchlist();
  const container = $('watched-list');
  const empty = $('watched-empty');
  container.innerHTML = '';

  if (!watchlist.watched.length) {
    empty.classList.remove('hidden');
    $('watched-count').textContent = '';
    return;
  }
  empty.classList.add('hidden');
  const wLen = watchlist.watched.length;
  $('watched-count').textContent = `${wLen} movie${wLen !== 1 ? 's' : ''} watched`;

  const sorted = sortWatched(watchlist.watched, watchedSort);
  const grouped = watchedSort !== 'recent';
  let lastGroup = null;

  sorted.forEach(m => {
    if (grouped) {
      const group = getWatchedGroup(m, watchedSort);
      if (group !== lastGroup) {
        lastGroup = group;
        const header = document.createElement('div');
        header.className = 'watched-group-header';
        header.textContent = group;
        container.appendChild(header);
      }
    }

    const card = document.createElement('div');
    card.className = 'movie-card';
    card.style.cursor = 'pointer';
    card.innerHTML = `
      <div class="poster-wrap">
        <img src="${m.poster || ''}" alt="${m.title}" loading="lazy" />
        <div class="watched-badge">✓</div>
        <div class="play-overlay">▶</div>
      </div>
      <div class="card-body">
        <div class="card-title">${m.title}</div>
        <div class="card-meta"><span>${m.year}</span><span class="rating">★ ${m.rating}</span></div>
        <button class="unwatch-btn">× Unwatch</button>
      </div>
    `;
    card.querySelector('.unwatch-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch(`/api/watchlist/watched/${encodeURIComponent(m.imdbId)}`, { method: 'DELETE' });
      watchlist.watched = watchlist.watched.filter(w => w.imdbId !== m.imdbId);
      card.remove();
      if (!watchlist.watched.length) empty.classList.remove('hidden');
    });
    card.addEventListener('click', async () => {
      const movie = await fetchMovie(m.title, m.year).catch(() => null);
      if (!movie?.torrents?.length) return;
      const torrent = pickTorrent(movie.torrents);
      openInfoModal(movie, torrent, null);
    });
    container.appendChild(card);
  });
}

// ── Quality picker ────────────────────────────────────────────────────────────
function openQualityPicker(title, torrents, onSelect) {
  $('quality-modal-title').textContent = `Download: ${title}`;
  const opts = $('quality-options');
  opts.innerHTML = '';
  torrents.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'quality-opt-btn';
    btn.textContent = `${t.quality} · ${t.video_codec} · ${t.size}`;
    btn.addEventListener('click', () => {
      closeQualityPicker();
      onSelect(t);
    });
    opts.appendChild(btn);
  });
  $('quality-modal').classList.remove('hidden');
}

function closeQualityPicker() {
  $('quality-modal').classList.add('hidden');
  $('quality-options').innerHTML = '';
}

$('quality-modal-backdrop').addEventListener('click', closeQualityPicker);
$('quality-cancel-btn').addEventListener('click', closeQualityPicker);

// ── Watch Later tab ───────────────────────────────────────────────────────────
function renderWatchLaterCard(m) {
  const card = document.createElement('div');
  card.className = 'movie-card';
  card.dataset.imdbId = m.imdbId;

  const trailerSection = m.trailerKey
    ? `<div class="card-trailer"><iframe src="https://www.youtube.com/embed/${m.trailerKey}" frameborder="0" allowfullscreen allow="encrypted-media"></iframe></div>`
    : '';

  const actors = Array.isArray(m.actors) && m.actors.length ? m.actors.slice(0, 3).join(', ') : '';

  card.innerHTML = `
    <div class="poster-wrap">
      <img src="${m.poster || ''}" alt="${m.title}" loading="lazy" />
    </div>
    <div class="card-body">
      <div class="card-title">${m.title}</div>
      <div class="card-meta">
        <span>${m.year}</span>
        <span class="rating">★ ${m.rating}</span>
      </div>
      ${m.director ? `<div class="card-director">Dir. ${m.director}</div>` : ''}
      ${actors ? `<div class="card-actors">${actors}</div>` : ''}
      ${m.plot ? `<div class="card-plot">${m.plot}</div>` : ''}
      <div class="wl-actions">
        <button class="wl-watch-now-btn">▶ Watch Now</button>
        <button class="wl-download-btn">⬇ Download</button>
        <button class="wl-watched-btn">✓ Watched</button>
        <button class="wl-remove-btn">× Remove</button>
      </div>
    </div>
    ${trailerSection}
  `;

  card.querySelector('.wl-watch-now-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Loading…';
    const movie = await fetchMovie(m.title, m.year).catch(() => null);
    btn.textContent = '▶ Watch Now';
    btn.disabled = false;
    if (!movie?.torrents?.length) return;
    const torrent = pickTorrent(movie.torrents);
    openPlayer(movie, torrent);
  });

  card.querySelector('.wl-download-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Loading…';
    const movie = await fetchMovie(m.title, m.year).catch(() => null);
    if (!movie?.torrents?.length) {
      btn.textContent = 'Not found';
      btn.disabled = false;
      return;
    }
    openQualityPicker(m.title, movie.torrents, async (torrent) => {
      await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: torrent.hash, title: `${m.title} (${m.year})`, poster: m.poster || null }),
      });
      await removeWatchLater(m.imdbId);
      card.remove();
      if (!$('watchlater-list').children.length) $('watchlater-empty').classList.remove('hidden');
    });
    btn.textContent = '⬇ Download';
    btn.disabled = false;
  });

  card.querySelector('.wl-watched-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await fetch('/api/watchlist/watched', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imdbId: m.imdbId, title: m.title, year: m.year, poster: m.poster, rating: m.rating }),
    });
    watchlist.watched.push({ imdbId: m.imdbId, title: m.title, year: m.year, poster: m.poster, rating: m.rating });
    await removeWatchLater(m.imdbId);
    card.remove();
    if (!$('watchlater-list').children.length) $('watchlater-empty').classList.remove('hidden');
  });

  card.querySelector('.wl-remove-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await removeWatchLater(m.imdbId);
    card.remove();
    if (!$('watchlater-list').children.length) $('watchlater-empty').classList.remove('hidden');
  });

  return card;
}

async function loadWatchLater() {
  await loadWatchlist();
  const container = $('watchlater-list');
  const empty = $('watchlater-empty');
  container.innerHTML = '';

  if (!watchlist.watchLater.length) {
    empty.classList.remove('hidden');
    $('watchlater-count').textContent = '';
    return;
  }
  empty.classList.add('hidden');
  const wlLen = watchlist.watchLater.length;
  $('watchlater-count').textContent = `${wlLen} movie${wlLen !== 1 ? 's' : ''} in queue`;
  watchlist.watchLater.slice().reverse().forEach(m => container.appendChild(renderWatchLaterCard(m)));
}

// ── AI Loader ─────────────────────────────────────────────────────────────────
const AI_TICKER_MSGS = [
  'analyzing cinematography vibes...',
  'cross-referencing hidden gems...',
  'filtering out obvious blockbusters...',
  'consulting the cult classics vault...',
  'calculating obscurity scores...',
  'scanning imdb basement archives...',
  'sourcing foreign-language masterpieces...',
  'verifying festival circuit credentials...',
  'detecting slow-burn potential...',
  'fact-checking the neural oracle...',
  'avoiding mediocre takes...',
  'hunting down underrated directors...',
  'compiling niche genre expertise...',
  'stress-testing the recommendation engine...',
];

let _aiTickerInterval = null;
let _aiTickerIdx = 0;

function showAiLoader(phase, detail, orb) {
  $('ai-phase-text').textContent = phase;
  $('ai-phase-detail').textContent = detail || '';
  if (orb) $('ai-orb').textContent = orb;
  $('ai-loader').classList.remove('hidden');

  _aiTickerIdx = Math.floor(Math.random() * AI_TICKER_MSGS.length);
  const ticker = $('ai-ticker');
  ticker.textContent = AI_TICKER_MSGS[_aiTickerIdx];
  ticker.className = 'ai-ticker-enter';

  _aiTickerInterval = setInterval(() => {
    _aiTickerIdx = (_aiTickerIdx + 1) % AI_TICKER_MSGS.length;
    ticker.className = '';
    // force reflow to restart animation
    void ticker.offsetWidth;
    ticker.textContent = AI_TICKER_MSGS[_aiTickerIdx];
    ticker.className = 'ai-ticker-enter';
  }, 2400);
}

function updateAiLoader(phase, detail, orb) {
  $('ai-phase-text').textContent = phase;
  $('ai-phase-detail').textContent = detail || '';
  if (orb) $('ai-orb').textContent = orb;
}

function hideAiLoader() {
  $('ai-loader').classList.add('hidden');
  clearInterval(_aiTickerInterval);
}

// ── Fetch suggestions from AI ─────────────────────────────────────────────────
async function fetchSuggestions(prompt) {
  const r = await fetch(`/api/suggest?prompt=${encodeURIComponent(prompt)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Fetch movie from TMDb + YTS torrent ───────────────────────────────────────
async function fetchMovie(title, year) {
  const params = new URLSearchParams({ title });
  if (year) params.set('year', year);
  const r = await fetch(`/api/movie?${params}`);
  if (!r.ok) return null;
  return r.json();
}

// ── Main suggest handler ──────────────────────────────────────────────────────
async function handleSuggest() {
  const prompt = $('prompt').value.trim();
  if (!prompt) return loadLatest();

  $('movies').innerHTML = '';
  $('movies').classList.add('suggestions');
  $('suggest-btn').disabled = true;
  setStatus('');

  // Make sure Browse tab is active
  switchTab('browse');

  showAiLoader('Consulting the oracle', 'sending your vibe to the AI\u2026', '\uD83E\uDDE0');

  try {
    const suggestions = await fetchSuggestions(prompt);

    updateAiLoader(
      `Hunting down ${suggestions.length} films`,
      `0 / ${suggestions.length} movies fetched`,
      '\uD83C\uDFAC'
    );

    let fetchedCount = 0;
    const movies = await Promise.all(suggestions.map(async (s) => {
      const result = await fetchMovie(s.title, s.year).catch(() => null);
      fetchedCount++;
      updateAiLoader(
        `Hunting down ${suggestions.length} films`,
        `${fetchedCount} / ${suggestions.length} movies fetched`
      );
      return result;
    }));

    let count = 0;
    movies.forEach((movie, i) => {
      if (!movie?.torrents?.length) return;
      const torrent = pickTorrent(movie.torrents);
      const card = renderCard(movie, torrent, suggestions[i]);
      $('movies').appendChild(card);
      count++;
    });

    setStatus(count ? `${count} results for "${prompt}" \u2014 click any to stream` : 'No results found.');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    hideAiLoader();
    $('suggest-btn').disabled = false;
  }
}

// ── Info modal ────────────────────────────────────────────────────────────────
let currentInfoMovie = null;
let currentInfoTorrent = null;
let currentInfoSuggestion = null;

function openInfoModal(movie, torrent, suggestion) {
  currentInfoMovie = movie;
  currentInfoTorrent = torrent;
  currentInfoSuggestion = suggestion || null;

  const s = suggestion || {};
  $('info-poster').src = movie.poster || '';
  $('info-poster').alt = movie.title;
  $('info-title').textContent = `${movie.title} (${movie.year})`;

  const actors = Array.isArray(s.actors) ? s.actors.join(', ') : '';
  $('info-meta').innerHTML = `
    <span class="rating">★ ${movie.rating}</span>
    <span class="badge">${torrent.quality}</span>
    <span class="badge codec">${torrent.video_codec}</span>
    ${s.language ? `<span class="badge lang">${s.language}</span>` : ''}
  `;

  let extraHtml = '';
  if (s.director) extraHtml += `<div class="info-director">Dir. ${s.director}</div>`;
  if (actors)     extraHtml += `<div class="info-actors">${actors}</div>`;
  if (s.reason)   extraHtml += `<div class="info-reason">"${s.reason}"</div>`;
  $('info-extra').innerHTML = extraHtml;

  $('info-plot').textContent = movie.overview || s.plot || '';

  const wrap = $('info-trailer-wrap');
  if (movie.trailerKey) {
    $('info-trailer-frame').src = `https://www.youtube.com/embed/${movie.trailerKey}?autoplay=1`;
    wrap.classList.remove('hidden');
  } else {
    $('info-trailer-frame').src = '';
    wrap.classList.add('hidden');
  }

  $('info-modal').classList.remove('hidden');

  const hasId = !!movie.imdb_id;
  $('info-watch-later-btn').classList.toggle('hidden', !hasId);
  $('info-watched-btn').classList.toggle('hidden', !hasId);
  if (hasId) {
    const queued  = isWatchLater(movie.imdb_id);
    const watched = isWatched(movie.imdb_id);
    $('info-watch-later-btn').textContent = queued  ? '✓ Queued'       : '⬇ Watch Later';
    $('info-watch-later-btn').classList.toggle('active', queued);
    $('info-watched-btn').textContent     = watched ? '✓ Watched'      : '○ Mark Watched';
    $('info-watched-btn').classList.toggle('active', watched);
  }
}

function closeInfoModal() {
  $('info-modal').classList.add('hidden');
  $('info-trailer-frame').src = '';
}

// ── Player ────────────────────────────────────────────────────────────────────
let progressInterval = null;

async function openPlayer(movie, torrent, suggestion) {
  $('modal-title').textContent = `${movie.title} (${movie.year})`;
  $('modal-meta').textContent = `${torrent.quality} · ${torrent.video_codec} · ${torrent.size}`;
  $('progress-bar').style.width = '0%';
  $('stats').textContent = 'Starting download…';
  $('video-player').src = '';
  $('player-modal').classList.remove('hidden');

  const s = suggestion || {};
  let infoHash;
  try {
    const r = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: torrent.hash,
        title: `${movie.title} (${movie.year})`,
        poster: movie.poster || null,
        plot: movie.overview || s.plot || null,
        director: s.director || null,
        actors: s.actors || [],
      }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    infoHash = data.infoHash;
  } catch (err) {
    $('stats').textContent = `Failed to start: ${err.message}`;
    return;
  }

  clearInterval(progressInterval);
  let videoSet = false;

  progressInterval = setInterval(async () => {
    try {
      const r = await fetch(`/api/progress/${infoHash}`);
      const p = await r.json();

      if (!p.found) return;

      const pct = (p.progress * 100).toFixed(1);
      $('progress-bar').style.width = `${pct}%`;

      if (p.ready && !videoSet) {
        videoSet = true;
        $('video-player').src = `/api/stream/${infoHash}`;
        $('video-player').play().catch(() => {});
      }

      if (p.done) {
        $('stats').textContent = `Complete · ${p.name || ''}`;
        clearInterval(progressInterval);
      } else if (p.ready) {
        $('stats').textContent = `${pct}% · ${fmtSpeed(p.downloadSpeed)} · ${p.numPeers} peers`;
      } else {
        $('stats').textContent = `Fetching metadata… (${p.numPeers} peers)`;
      }
    } catch (_) {}
  }, 1000);
}

function closePlayer() {
  $('player-modal').classList.add('hidden');
  clearInterval(progressInterval);
  const v = $('video-player');
  v.pause();
  v.src = '';
}

// ── Event listeners ───────────────────────────────────────────────────────────
$('info-close-btn').addEventListener('click', closeInfoModal);
$('info-watch-btn').addEventListener('click', () => {
  closeInfoModal();
  openPlayer(currentInfoMovie, currentInfoTorrent, currentInfoSuggestion);
});

$('info-watch-later-btn').addEventListener('click', async () => {
  const movie = currentInfoMovie;
  if (!movie?.imdb_id) return;
  if (isWatchLater(movie.imdb_id)) {
    await removeWatchLater(movie.imdb_id);
  } else {
    await addWatchLater(currentInfoMovie, currentInfoSuggestion);
  }
  closeInfoModal();
});

$('info-watched-btn').addEventListener('click', async () => {
  const movie = currentInfoMovie;
  if (!movie?.imdb_id) return;
  if (isWatched(movie.imdb_id)) {
    await fetch(`/api/watchlist/watched/${encodeURIComponent(movie.imdb_id)}`, { method: 'DELETE' });
    watchlist.watched = watchlist.watched.filter(m => m.imdbId !== movie.imdb_id);
  } else {
    await fetch('/api/watchlist/watched', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imdbId: movie.imdb_id, title: movie.title, year: movie.year, poster: movie.poster, rating: movie.rating }),
    });
    watchlist.watched.push({ imdbId: movie.imdb_id, title: movie.title, year: movie.year, poster: movie.poster, rating: movie.rating });
  }
  closeInfoModal();
});

$('suggest-btn').addEventListener('click', handleSuggest);
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter') handleSuggest(); });

// Clear search → restore latest
$('prompt').addEventListener('input', () => {
  if ($('prompt').value === '') loadLatest();
});

$('logo').addEventListener('click', () => {
  $('prompt').value = '';
  switchTab('browse');
  loadLatest();
});

$('close-btn').addEventListener('click', closePlayer);
$('modal-backdrop').addEventListener('click', closePlayer);

// ── Movie search ──────────────────────────────────────────────────────────────
let _searchAbort = null;
let _searchTimer = null;

const movieSearchInput    = $('movie-search-input');
const movieSearchDropdown = $('movie-search-dropdown');

function closeSearchDropdown() {
  movieSearchDropdown.classList.add('hidden');
  movieSearchDropdown.innerHTML = '';
}

function showSearchDropdown(html) {
  movieSearchDropdown.innerHTML = html;
  movieSearchDropdown.classList.remove('hidden');
}

movieSearchInput.addEventListener('input', () => {
  const q = movieSearchInput.value.trim();
  clearTimeout(_searchTimer);
  if (_searchAbort) { _searchAbort.abort(); _searchAbort = null; }

  if (q.length < 3) { closeSearchDropdown(); return; }

  showSearchDropdown('<div class="search-result-loading">Searching…</div>');

  _searchTimer = setTimeout(async () => {
    const ctrl = new AbortController();
    _searchAbort = ctrl;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      const results = await r.json();
      if (!results.length) {
        showSearchDropdown('<div class="search-result-empty">No results</div>');
        return;
      }
      const html = results.map((m, i) => {
        const poster = m.poster
          ? `<img class="search-result-poster" src="${m.poster}" alt="" loading="lazy" />`
          : `<div class="search-result-poster-placeholder">🎬</div>`;
        return `<div class="search-result-item" data-idx="${i}">
          ${poster}
          <div class="search-result-info">
            <div class="search-result-title">${m.title}</div>
            ${m.year ? `<div class="search-result-year">${m.year}</div>` : ''}
          </div>
        </div>`;
      }).join('');
      showSearchDropdown(html);

      movieSearchDropdown.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', async () => {
          const m = results[Number(el.dataset.idx)];
          closeSearchDropdown();
          movieSearchInput.value = '';
          setStatus('Loading…');
          const movie = await fetchMovie(m.title, m.year).catch(() => null);
          if (!movie?.torrents?.length) {
            setStatus('No torrent found for this movie.', 'error');
            return;
          }
          setStatus('');
          const torrent = pickTorrent(movie.torrents);
          openInfoModal(movie, torrent, null);
        });
      });
    } catch (err) {
      if (err.name !== 'AbortError') showSearchDropdown('<div class="search-result-empty">Search failed</div>');
    }
  }, 300);
});

movieSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSearchDropdown(); movieSearchInput.blur(); }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.movie-search')) closeSearchDropdown();
});

// ── Watched sort buttons ──────────────────────────────────────────────────────
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    watchedSort = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
    loadWatched();
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    $('setting-tmdb-token').value = '';
    $('setting-tmdb-key').value = '';
    $('setting-openrouter-key').value = '';
    $('setting-openrouter-model').value = s.OPENROUTER_MODEL || '';

    $('status-tmdb-token').textContent   = s.TMDB_READ_ACCESS_TOKEN ? '✓ Set' : 'Not set';
    $('status-tmdb-token').className     = 'settings-status ' + (s.TMDB_READ_ACCESS_TOKEN ? 'set' : 'unset');
    $('status-tmdb-key').textContent     = s.TMDB_API_KEY ? '✓ Set' : 'Not set';
    $('status-tmdb-key').className       = 'settings-status ' + (s.TMDB_API_KEY ? 'set' : 'unset');
    $('status-openrouter-key').textContent = s.OPENROUTER_API_KEY ? '✓ Set' : 'Not set';
    $('status-openrouter-key').className   = 'settings-status ' + (s.OPENROUTER_API_KEY ? 'set' : 'unset');
  } catch (_) {}
}

$('settings-save-btn').addEventListener('click', async () => {
  const payload = {};
  const tmdbToken = $('setting-tmdb-token').value.trim();
  const tmdbKey   = $('setting-tmdb-key').value.trim();
  const orKey     = $('setting-openrouter-key').value.trim();
  const orModel   = $('setting-openrouter-model').value.trim();
  if (tmdbToken) payload.TMDB_READ_ACCESS_TOKEN = tmdbToken;
  if (tmdbKey)   payload.TMDB_API_KEY           = tmdbKey;
  if (orKey)     payload.OPENROUTER_API_KEY      = orKey;
  if (orModel)   payload.OPENROUTER_MODEL        = orModel;

  if (!Object.keys(payload).length) {
    showSettingsMsg('Nothing to save — fill in at least one field.', false);
    return;
  }

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showSettingsMsg('Settings saved.', true);
    loadSettings();
  } catch (_) {
    showSettingsMsg('Failed to save.', false);
  }
});

function showSettingsMsg(text, ok) {
  const el = $('settings-save-msg');
  el.textContent = text;
  el.className = 'settings-save-msg ' + (ok ? 'ok' : 'err');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

document.querySelectorAll('.settings-eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.target);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
  });
});

// ── Update toast ──────────────────────────────────────────────────────────────
let _updatePending = null;

function showUpdateToast(version, url) {
  const playerVisible = !$('player-modal').classList.contains('hidden');
  const video = $('video-player');
  const isPlaying = playerVisible && !video.paused && !video.ended;

  if (isPlaying) {
    _updatePending = { version, url };
    return;
  }

  const toast = $('update-toast');
  toast.innerHTML = `Update available: ${version} &mdash; <a href="${url}" target="_blank" rel="noopener">Download</a> <button id="update-toast-close">✕</button>`;
  toast.classList.remove('hidden');
  $('update-toast-close').addEventListener('click', () => toast.classList.add('hidden'));
}

async function checkForUpdate() {
  try {
    const info = await fetch('/api/update-info').then(r => r.json());
    if (info.available) showUpdateToast(info.version, info.url);
  } catch (_) {}
}

// Show queued update toast when video pauses or ends
$('video-player').addEventListener('pause', () => {
  if (_updatePending) { showUpdateToast(_updatePending.version, _updatePending.url); _updatePending = null; }
});
$('video-player').addEventListener('ended', () => {
  if (_updatePending) { showUpdateToast(_updatePending.version, _updatePending.url); _updatePending = null; }
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadWatchlist();
loadLatest();
checkForUpdate();
setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
