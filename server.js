require('dotenv').config();
const express = require('express');
const WebTorrent = require('webtorrent');
const path = require('path');
const fs = require('fs');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p';

const app = express();
const wtClient = new WebTorrent();
const activeTorrents = new Map(); // normalizedHash -> torrent

const YTS_BASE = 'https://movies-api.accel.li/api/v2';
const BAD_TYPES = new Set(['hdts', 'cam', 'ts', 'tc', 'scr', 'dvdscr']);

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker1.bt.moack.co.kr:80/announce',
  'https://tracker.gbitt.info/announce',
];

function buildMagnet(hash, title) {
  const trackerStr = TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${trackerStr}`;
}

// Ensure downloads dir exists
if (!fs.existsSync('./downloads')) fs.mkdirSync('./downloads');

const DATA_DIR = './data';
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(WATCHLIST_FILE)) fs.writeFileSync(WATCHLIST_FILE, JSON.stringify({ watched: [], watchLater: [] }));
if (!fs.existsSync(SETTINGS_FILE))  fs.writeFileSync(SETTINGS_FILE, '{}');

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch (_) { return {}; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); }

function getConfig(key) {
  const s = readSettings();
  return s[key] || process.env[key] || '';
}

function readWatchlist() {
  try { return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')); }
  catch (_) { return { watched: [], watchLater: [] }; }
}
function saveWatchlist(wl) { fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(wl, null, 2)); }

const DOWNLOADS_FILE = path.join(DATA_DIR, 'downloads.json');
if (!fs.existsSync(DOWNLOADS_FILE)) fs.writeFileSync(DOWNLOADS_FILE, '{}');

function readDownloadsMeta() {
  try { return JSON.parse(fs.readFileSync(DOWNLOADS_FILE, 'utf8')); }
  catch (_) { return {}; }
}
function saveDownloadsMeta(meta) { fs.writeFileSync(DOWNLOADS_FILE, JSON.stringify(meta, null, 2)); }

// Restore downloads on startup
const savedDownloads = readDownloadsMeta();
for (const [key, info] of Object.entries(savedDownloads)) {
  const magnet = buildMagnet(info.hash, info.title || info.hash);
  const torrent = wtClient.add(magnet, { path: './downloads' });
  activeTorrents.set(key, torrent);
  torrent.on('error', err => console.error(`Torrent error [${key}]:`, err.message));
  torrent.on('metadata', () => console.log(`Resumed: ${torrent.name}`));
}

app.use(express.json());
app.use(express.static('public'));

// ── Latest movies (no cam/ts, rating > 5.5, TMDb posters) ────────────────────
app.get('/api/latest', async (req, res) => {
  try {
    const r = await fetch(`${YTS_BASE}/list_movies.json?sort_by=date_added&order_by=desc&limit=50&minimum_rating=5.6`);
    const data = await r.json();
    const movies = data?.data?.movies || [];

    const tmdbHeaders = { Authorization: `Bearer ${getConfig('TMDB_READ_ACCESS_TOKEN')}` };

    const candidates = movies
      .map(m => ({ m, goodTorrents: (m.torrents || []).filter(t => !BAD_TYPES.has(t.type)) }))
      .filter(({ goodTorrents }) => goodTorrents.length > 0);

    const results = await Promise.all(candidates.map(async ({ m, goodTorrents }) => {
      let poster = null;
      let overview = null;
      let trailerKey = null;
      try {
        if (m.imdb_code) {
          const tr = await fetch(`${TMDB_BASE}/find/${m.imdb_code}?external_source=imdb_id`, { headers: tmdbHeaders });
          const td = await tr.json();
          const hit = td.movie_results?.[0];
          if (hit?.poster_path) {
            poster = `${TMDB_IMG}/w342${hit.poster_path}`;
            overview = hit.overview || null;
            const vr = await fetch(`${TMDB_BASE}/movie/${hit.id}/videos?language=en-US`, { headers: tmdbHeaders });
            const vd = await vr.json();
            const tv = vd.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
            trailerKey = tv?.key || null;
          }
        }
      } catch (_) {}

      if (!poster) return null;

      return {
        title:      m.title,
        year:       String(m.year),
        rating:     String(m.rating),
        imdb_id:    m.imdb_code || null,
        poster,
        overview,
        trailerKey,
        torrents:   goodTorrents,
      };
    }));

    res.json(results.filter(Boolean).sort((a, b) => Number(b.year) - Number(a.year)));
  } catch (err) {
    console.error('Latest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Active downloads list ──────────────────────────────────────────────────────
app.get('/api/downloads', (_req, res) => {
  const meta = readDownloadsMeta();
  const result = [];
  for (const [hash, torrent] of activeTorrents) {
    const m = meta[hash] || {};
    result.push({
      infoHash:      hash,
      name:          torrent.name || m.title || hash,
      progress:      torrent.progress,
      downloadSpeed: torrent.downloadSpeed,
      numPeers:      torrent.numPeers,
      done:          torrent.done,
      paused:        torrent.paused || false,
      ready:         !!(torrent.files && torrent.files.length > 0),
      length:        torrent.length || 0,
      poster:        m.poster || null,
      plot:          m.plot || null,
      director:      m.director || null,
      actors:        m.actors || [],
    });
  }
  res.json(result);
});

// ── AI suggestions via OpenRouter ─────────────────────────────────────────────
app.get('/api/suggest', async (req, res) => {
  try {
    const model = getConfig('OPENROUTER_MODEL') || 'anthropic/claude-sonnet-4-6';
    const wl = readWatchlist();
    const watchedNote = wl.watched.length
      ? ` The user has already watched these movies, do not suggest them: ${wl.watched.map(m => `${m.title} (${m.year})`).join(', ')}.`
      : '';
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getConfig('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a movie recommendation assistant. The user has watched most mainstream popular movies, so avoid obvious blockbusters and well-known titles. Favor hidden gems, cult classics, underseen films, and foreign-language movies. Only suggest movies with an IMDB score of at least 7. Respond ONLY with a valid JSON array — no markdown fences, no explanation.' + watchedNote },
          { role: 'user', content: `I've asked you often about movies. Which movie are we watching tonight? Pick up to 10 for: "${req.query.prompt || 'something great'}". IMDB score must be at least 7. Return JSON array: [{"title":"...","year":1999,"plot":"one or two sentence summary","director":"...","actors":["actor1","actor2","actor3"],"language":"...","reason":"..."}]` },
        ],
      }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    let text = data.choices[0].message.content.trim();
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('Suggest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Movie search (autocomplete) ───────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 3) return res.json([]);
    const tmdbHeaders = { Authorization: `Bearer ${getConfig('TMDB_READ_ACCESS_TOKEN')}` };
    const params = new URLSearchParams({ query: q.trim(), language: 'en-US', page: '1', include_adult: 'false' });
    const r = await fetch(`${TMDB_BASE}/search/movie?${params}`, { headers: tmdbHeaders });
    const data = await r.json();
    const results = (data.results || []).slice(0, 8).map(m => ({
      title:    m.title,
      year:     m.release_date?.slice(0, 4) || '',
      poster:   m.poster_path ? `${TMDB_IMG}/w92${m.poster_path}` : null,
      tmdb_id:  m.id,
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TMDb + YTS torrent lookup ─────────────────────────────────────────────────
app.get('/api/movie', async (req, res) => {
  try {
    const { title, year } = req.query;
    const tmdbHeaders = { Authorization: `Bearer ${getConfig('TMDB_READ_ACCESS_TOKEN')}` };

    // 1. Search TMDb
    const searchParams = new URLSearchParams({ query: title, language: 'en-US', page: '1' });
    if (year) searchParams.set('year', year);
    const searchRes = await fetch(`${TMDB_BASE}/search/movie?${searchParams}`, { headers: tmdbHeaders });
    const searchData = await searchRes.json();
    const tmdb = searchData.results?.[0];
    if (!tmdb) return res.json(null);

    // 2. Get IMDB ID from TMDb external IDs
    const extRes = await fetch(`${TMDB_BASE}/movie/${tmdb.id}/external_ids`, { headers: tmdbHeaders });
    const extData = await extRes.json();
    const imdbId = extData.imdb_id;

    // 3. Find torrent on YTS + fetch trailer (parallel)
    const ytsQuery = imdbId || title;
    const [ytsRes, vidRes] = await Promise.all([
      fetch(`${YTS_BASE}/list_movies.json?query_term=${encodeURIComponent(ytsQuery)}&limit=1&sort_by=seeds`),
      fetch(`${TMDB_BASE}/movie/${tmdb.id}/videos?language=en-US`, { headers: tmdbHeaders }),
    ]);

    const ytsData = await ytsRes.json();
    const ytsMovie = ytsData?.data?.movies?.[0];
    if (!ytsMovie?.torrents?.length) return res.json(null);

    const vidData = await vidRes.json();
    const trailerVid = vidData.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');

    res.json({
      title:      tmdb.title,
      year:       tmdb.release_date?.slice(0, 4) || String(ytsMovie.year),
      rating:     tmdb.vote_average ? tmdb.vote_average.toFixed(1) : String(ytsMovie.rating),
      overview:   tmdb.overview,
      poster:     tmdb.poster_path ? `${TMDB_IMG}/w342${tmdb.poster_path}` : ytsMovie.medium_cover_image,
      imdb_id:    imdbId,
      trailerKey: trailerVid?.key || null,
      torrents:   ytsMovie.torrents,
    });
  } catch (err) {
    console.error('Movie error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start torrent download ────────────────────────────────────────────────────
app.post('/api/download', (req, res) => {
  const { hash, title, poster, plot, director, actors } = req.body;
  if (!hash) return res.status(400).json({ error: 'hash required' });

  const key = hash.toLowerCase();

  if (!activeTorrents.has(key)) {
    const magnet = buildMagnet(hash, title || hash);
    const torrent = wtClient.add(magnet, { path: './downloads' });
    activeTorrents.set(key, torrent);
    torrent.on('error', err => console.error(`Torrent error [${key}]:`, err.message));
    torrent.on('metadata', () => console.log(`Metadata: ${torrent.name} (${torrent.files.length} files)`));

    const meta = readDownloadsMeta();
    meta[key] = { hash, title, poster: poster || null, plot: plot || null, director: director || null, actors: actors || [] };
    saveDownloadsMeta(meta);
  }

  res.json({ infoHash: key });
});

// ── Pause / Resume / Delete torrent ──────────────────────────────────────────
app.post('/api/torrent/:infoHash/pause', (req, res) => {
  const torrent = activeTorrents.get(req.params.infoHash.toLowerCase());
  if (!torrent) return res.status(404).json({ error: 'not found' });
  torrent.pause();
  res.json({ ok: true });
});

app.post('/api/torrent/:infoHash/resume', (req, res) => {
  const torrent = activeTorrents.get(req.params.infoHash.toLowerCase());
  if (!torrent) return res.status(404).json({ error: 'not found' });
  torrent.resume();
  res.json({ ok: true });
});

app.delete('/api/download/:infoHash', (req, res) => {
  const key = req.params.infoHash.toLowerCase();
  const torrent = activeTorrents.get(key);
  if (torrent) {
    torrent.destroy();
    activeTorrents.delete(key);
  }
  const meta = readDownloadsMeta();
  delete meta[key];
  saveDownloadsMeta(meta);
  res.json({ ok: true });
});

// ── Stream video ──────────────────────────────────────────────────────────────
app.get('/api/stream/:infoHash', (req, res) => {
  const torrent = activeTorrents.get(req.params.infoHash.toLowerCase());
  if (!torrent) return res.status(404).json({ error: 'Torrent not started' });
  if (!torrent.files || torrent.files.length === 0) {
    return res.status(503).set('Retry-After', '2').json({ error: 'Waiting for metadata' });
  }

  // Pick largest file (the video)
  const file = torrent.files.reduce((a, b) => (a.length > b.length ? a : b));
  const fileSize = file.length;

  if (!fileSize) {
    return res.status(503).set('Retry-After', '2').json({ error: 'File size unknown' });
  }

  const ext = path.extname(file.name).toLowerCase();
  const mime = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo' };
  const contentType = mime[ext] || 'video/mp4';

  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    file.createReadStream().pipe(res);
    return;
  }

  const [rawStart, rawEnd] = range.replace('bytes=', '').split('-');
  const start = parseInt(rawStart, 10);
  const end = rawEnd ? parseInt(rawEnd, 10) : Math.min(start + 10 * 1024 * 1024 - 1, fileSize - 1);

  if (start >= fileSize) {
    return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
  }

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
  });

  file.createReadStream({ start, end }).pipe(res);
});

// ── Progress ──────────────────────────────────────────────────────────────────
app.get('/api/progress/:infoHash', (req, res) => {
  const torrent = activeTorrents.get(req.params.infoHash.toLowerCase());
  if (!torrent) return res.json({ found: false });

  res.json({
    found: true,
    ready: torrent.files && torrent.files.length > 0,
    name: torrent.name || null,
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    numPeers: torrent.numPeers,
    done: torrent.done,
  });
});

// ── Watchlist ─────────────────────────────────────────────────────────────────
app.get('/api/watchlist', (req, res) => res.json(readWatchlist()));

app.post('/api/watchlist/watched', (req, res) => {
  const { imdbId, title, year, poster, rating } = req.body;
  if (!imdbId) return res.status(400).json({ error: 'imdbId required' });
  const wl = readWatchlist();
  wl.watched = wl.watched.filter(m => m.imdbId !== imdbId);
  wl.watched.push({ imdbId, title, year, poster, rating, addedAt: new Date().toISOString() });
  saveWatchlist(wl);
  res.json({ ok: true });
});

app.delete('/api/watchlist/watched/:imdbId', (req, res) => {
  const wl = readWatchlist();
  wl.watched = wl.watched.filter(m => m.imdbId !== req.params.imdbId);
  saveWatchlist(wl);
  res.json({ ok: true });
});

app.post('/api/watchlist/later', (req, res) => {
  const { imdbId, title, year, poster, rating, trailerKey, plot, director, actors } = req.body;
  if (!imdbId) return res.status(400).json({ error: 'imdbId required' });
  const wl = readWatchlist();
  if (!wl.watchLater.find(m => m.imdbId === imdbId)) {
    wl.watchLater.push({ imdbId, title, year, poster, rating, trailerKey: trailerKey || null, plot: plot || null, director: director || null, actors: actors || [], addedAt: new Date().toISOString() });
    saveWatchlist(wl);
  }
  res.json({ ok: true });
});

app.delete('/api/watchlist/later/:imdbId', (req, res) => {
  const wl = readWatchlist();
  wl.watchLater = wl.watchLater.filter(m => m.imdbId !== req.params.imdbId);
  saveWatchlist(wl);
  res.json({ ok: true });
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', (_req, res) => {
  const s = readSettings();
  const env = process.env;
  const mask = key => !!(s[key] || env[key]);
  res.json({
    TMDB_READ_ACCESS_TOKEN: mask('TMDB_READ_ACCESS_TOKEN'),
    TMDB_API_KEY:           mask('TMDB_API_KEY'),
    OPENROUTER_API_KEY:     mask('OPENROUTER_API_KEY'),
    OPENROUTER_MODEL:       s['OPENROUTER_MODEL'] || env['OPENROUTER_MODEL'] || 'anthropic/claude-sonnet-4-6',
  });
});

app.post('/api/settings', (req, res) => {
  const s = readSettings();
  const allowed = ['TMDB_READ_ACCESS_TOKEN', 'TMDB_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'];
  for (const key of allowed) {
    if (req.body[key] !== undefined && req.body[key] !== '') {
      s[key] = req.body[key];
    }
  }
  saveSettings(s);
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YTS AI Player → http://localhost:${PORT}`);
});
