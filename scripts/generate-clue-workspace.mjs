import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const config = parseArgs(process.argv.slice(2));
if (config.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  const quiz = JSON.parse(await readFile(config.input, 'utf8'));
  const works = extractWorks(quiz)
    .filter((work) => !config.type || normalize(work.type) === normalize(config.type))
    .slice(0, config.limit || undefined);
  const root = resolve(config.output);
  const worksRoot = join(root, 'oeuvres');

  await mkdir(worksRoot, { recursive: true });

  const rows = [];
  const plan = [];
  for (const work of works) {
    const folderName = uniqueFolderName(work, rows.map((row) => row.folderName));
    const folder = join(worksRoot, folderName);
    await mkdir(join(folder, 'sources'), { recursive: true });
    await mkdir(join(folder, 'assets'), { recursive: true });

    const cluePlan = cluePlanFor(work);
    const downloadedSources = config.downloadFreeSources
      ? await downloadFreeSources(work, folder)
      : [];
    const webSuggestions = config.discoverWebSources
      ? await discoverWebSources(work, folder)
      : [];
    const providerAssets = config.downloadProviderAssets
      ? await downloadProviderAssets(work, folder)
      : [];
    const processedAssets = config.mediaRoot
      ? await processLocalMedia(work, cluePlan, folderName, folder)
      : [];
    const manifest = {
      title: work.title,
      answer: work.answer,
      type: work.type,
      year: work.year,
      attribution: work.attribution,
      occurrences: work.occurrences,
      folder: relativePath(root, folder),
      plannedClues: cluePlan,
      downloadedSources,
      webSuggestions,
      providerAssets,
      processedAssets,
      notes: [
        config.downloadFreeSources
          ? "Sources telechargees depuis Wikimedia Commons quand une correspondance libre a ete trouvee."
          : "Le script ne recupere pas automatiquement de contenus proteges.",
        config.discoverWebSources
          ? "Suggestions specialisees generees depuis TMDB, jeuxvideo.com ou YouTube selon le type d'oeuvre."
          : "",
        config.downloadProviderAssets
          ? "Assets telecharges depuis des fournisseurs API quand disponibles."
          : "",
        "Verifiez toujours la pertinence, la licence et l'attribution avant d'utiliser une source dans le quiz.",
      ].filter(Boolean),
    };

    await writeFile(join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(join(folder, 'README.md'), workReadme(work, cluePlan, processedAssets, downloadedSources, webSuggestions, providerAssets), 'utf8');
    await writeFile(join(folder, 'assets', '.gitkeep'), '', 'utf8');
    await writeFile(join(folder, 'sources', '.gitkeep'), '', 'utf8');

    rows.push({
      title: work.title,
      answer: work.answer,
      type: work.type,
      year: work.year,
      attribution: work.attribution,
      occurrences: work.occurrences.length,
      folderName,
      folder: relativePath(process.cwd(), folder),
      plannedClues: cluePlan.length,
      downloadedSources: downloadedSources.length,
      webSuggestions: webSuggestions.length,
      providerAssets: providerAssets.length,
      processedAssets: processedAssets.length,
    });
    plan.push(manifest);
  }

  await writeFile(join(root, 'index.csv'), toCsv(rows), 'utf8');
  await writeFile(join(root, 'index.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'README.md'), workspaceReadme(quiz, rows), 'utf8');

  console.log(`Espace d'indices genere : ${root}`);
  console.log(`${rows.length} oeuvre(s) unique(s).`);
  if (config.downloadFreeSources) console.log(`${rows.reduce((sum, row) => sum + row.downloadedSources, 0)} source(s) libre(s) telechargee(s) depuis Wikimedia Commons.`);
  if (config.discoverWebSources) console.log(`${rows.reduce((sum, row) => sum + row.webSuggestions, 0)} suggestion(s) web specialisee(s) generee(s).`);
  if (config.downloadProviderAssets) console.log(`${rows.reduce((sum, row) => sum + row.providerAssets, 0)} asset(s) fournisseur telecharge(s).`);
  if (config.mediaRoot) console.log(`${rows.reduce((sum, row) => sum + row.processedAssets, 0)} asset(s) genere(s) depuis ${config.mediaRoot}.`);
}

function extractWorks(quiz) {
  const byAnswer = new Map();
  for (const [roundIndex, round] of (quiz.rounds ?? []).entries()) {
    for (const [workIndex, work] of (round.works ?? []).entries()) {
      const answer = answerForWork(work);
      const parsed = parseAnswer(answer, work);
      const key = normalize(answer || parsed.title);
      const current = byAnswer.get(key) ?? {
        ...parsed,
        answer,
        occurrences: [],
      };
      current.occurrences.push({
        round: roundIndex + 1,
        work: workIndex + 1,
        person: round.person?.name ?? '',
      });
      byAnswer.set(key, current);
    }
  }
  return Array.from(byAnswer.values()).sort((a, b) => `${a.type}:${a.title}`.localeCompare(`${b.type}:${b.title}`));
}

function answerForWork(work) {
  if (typeof work.correctAnswer === 'string' && work.correctAnswer.trim()) return work.correctAnswer.trim();
  if (Array.isArray(work.options) && Number.isInteger(work.correctOptionIndex)) {
    return String(work.options[work.correctOptionIndex] ?? work.title ?? '').trim();
  }
  return String(work.title ?? '').trim();
}

function parseAnswer(answer, work) {
  const match = /^(.*?)\s*\((.*)\)\s*$/.exec(answer);
  const title = clean(match?.[1] ?? work.title ?? answer);
  const metadata = match?.[2] ?? '';
  const parts = metadata.split(',').map(clean).filter(Boolean);
  const type = normalizeType(parts[0] || typeFromClues(work.clues) || work.kind || 'oeuvre');
  const year = parts.find((part) => /^\d{4}/.test(part))?.match(/\d{4}/)?.[0] ?? '';
  const attribution = parts.slice(2).join(', ');
  return { title, type, year, attribution };
}

function typeFromClues(clues = []) {
  const clue = clues.find((item) => typeof item.content === 'string' && item.content.toLowerCase().startsWith('type'));
  return clue?.content?.split(':').slice(1).join(':').trim() ?? '';
}

function cluePlanFor(work) {
  if (work.type === 'musique') {
    return [
      audioClue('Extrait tres court', 'assets/01-extrait-1s.mp3', '1 seconde, idealement un passage reconnaissable sans paroles trop evidentes.'),
      audioClue('Extrait court', 'assets/02-extrait-5s.mp3', '5 secondes, meme passage ou passage plus identifiable.'),
      audioClue('Extrait long', 'assets/03-extrait-10s.mp3', '10 secondes, dernier indice avant revelation.'),
    ];
  }
  if (work.type === 'film') {
    return [
      imageClue('Plan discret', 'assets/01-scene-discrete.jpg', 'Screenshot d un decor, objet, silhouette ou plan non spoiler.'),
      imageClue('Plan reconnaissable', 'assets/02-scene-reconnaissable.jpg', 'Screenshot plus caracteristique, sans afficher le titre.'),
      videoClue('Extrait bande annonce', 'assets/03-bande-annonce-10s.mp4', 'Court extrait de bande annonce, sans titre incruste si possible.'),
    ];
  }
  if (work.type === 'livre') {
    return [
      textClue('Citation courte', 'Court extrait connu, a limiter a une phrase breve.'),
      textClue('Indice narratif', 'Theme, lieu, objet ou situation centrale sans donner le titre.'),
      textClue('Indice auteur ou epoque', 'Auteur, mouvement, epoque ou contexte, selon la difficulte voulue.'),
    ];
  }
  if (work.type === 'jeu video') {
    return [
      audioClue('Son iconique', 'assets/01-son-iconique.mp3', 'Effet sonore, jingle ou ambiance tres courte.'),
      audioClue('Theme musical', 'assets/02-bo-8s.mp3', 'Extrait de bande originale, environ 8 secondes.'),
      imageClue('Screenshot', 'assets/03-screenshot.jpg', 'Image de gameplay ou environnement sans interface trop explicite.'),
    ];
  }
  return [
    textClue('Indice discret', 'Indice vague pour lancer la recherche.'),
    textClue('Indice contextuel', 'Annee, createur, genre ou contexte.'),
    textClue('Indice fort', 'Element tres reconnaissable avant revelation.'),
  ];
}

function audioClue(label, target, instruction) {
  return { label, kind: 'audio', target, instruction };
}

function imageClue(label, target, instruction) {
  return { label, kind: 'image', target, instruction };
}

function videoClue(label, target, instruction) {
  return { label, kind: 'video', target, instruction };
}

function textClue(label, instruction) {
  return { label, kind: 'text', content: '', instruction };
}

async function processLocalMedia(work, cluePlan, folderName, folder) {
  const sourceFolder = join(resolve(config.mediaRoot), folderName);
  if (!existsSync(sourceFolder)) return [];
  const processed = [];
  for (const clue of cluePlan) {
    if (clue.kind === 'text') continue;
    const source = findSourceFor(sourceFolder, clue.kind);
    if (!source) continue;
    const target = join(folder, clue.target);
    await mkdir(dirname(target), { recursive: true });
    const args = ffmpegArgsFor(clue, source, target);
    if (!args) continue;
    try {
      await execFileAsync('ffmpeg', args, { windowsHide: true });
      processed.push({ label: clue.label, source: relativePath(process.cwd(), source), target: relativePath(process.cwd(), target) });
    } catch (error) {
      processed.push({ label: clue.label, source: relativePath(process.cwd(), source), target: relativePath(process.cwd(), target), error: error.message });
    }
  }
  return processed;
}

function findSourceFor(sourceFolder, kind) {
  const candidates = [
    kind === 'image' ? 'source-image' : '',
    kind === 'audio' ? 'source-audio' : '',
    kind === 'video' ? 'source-video' : '',
    'source',
  ].filter(Boolean);
  const extensions = kind === 'image' ? ['.jpg', '.jpeg', '.png', '.webp'] : kind === 'audio' ? ['.mp3', '.wav', '.m4a', '.aac', '.flac'] : ['.mp4', '.mov', '.mkv', '.webm'];
  for (const name of candidates) {
    for (const extension of extensions) {
      const path = join(sourceFolder, `${name}${extension}`);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}

function ffmpegArgsFor(clue, source, target) {
  if (clue.kind === 'audio') {
    const seconds = /(\d+)s/.exec(clue.target)?.[1] ?? (clue.label.includes('long') ? '10' : clue.label.includes('court') ? '5' : '1');
    return ['-y', '-i', source, '-t', seconds, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', target];
  }
  if (clue.kind === 'image') {
    return ['-y', '-ss', '00:00:05', '-i', source, '-frames:v', '1', '-q:v', '3', target];
  }
  if (clue.kind === 'video') {
    return ['-y', '-i', source, '-t', '10', '-an', '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', target];
  }
  return undefined;
}

async function downloadFreeSources(work, folder) {
  const sourcesFolder = join(folder, 'sources');
  const mediaTypes = freeSourceMediaTypes(work.type);
  const downloaded = [];
  for (const mediaType of mediaTypes) {
    const candidates = await searchWikimediaCommons(work, mediaType);
    for (const candidate of candidates.slice(0, config.maxDownloadsPerType)) {
      const downloadedSource = await downloadWikimediaCandidate(candidate, sourcesFolder, downloaded.length + 1);
      if (downloadedSource) downloaded.push(downloadedSource);
      await delay(config.downloadDelayMs);
    }
  }
  if (downloaded.length > 0) {
    await writeFile(join(sourcesFolder, 'attribution-wikimedia-commons.json'), `${JSON.stringify(downloaded, null, 2)}\n`, 'utf8');
  }
  return downloaded;
}

function freeSourceMediaTypes(type) {
  if (type === 'musique') return ['audio', 'image'];
  if (type === 'film') return ['image', 'video'];
  if (type === 'jeu video') return ['image', 'audio'];
  if (type === 'livre') return ['image'];
  return ['image'];
}

async function searchWikimediaCommons(work, mediaType) {
  const candidates = [];
  for (const query of commonsSearchQueries(work, mediaType)) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', String(config.maxDownloadsPerType * 6));
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|mime|size|extmetadata');

    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'quizz-teammates-clue-workspace/1.0 (local script)' },
      });
      if (!response.ok) continue;
      const payload = await response.json();
      candidates.push(
        ...Object.values(payload.query?.pages ?? {})
          .map((page) => wikimediaCandidateFromPage(page, mediaType))
          .filter(Boolean)
          .filter((candidate) => candidate.mediaType === mediaType)
          .filter((candidate) => !candidate.size || candidate.size <= config.maxSourceBytes)
          .filter((candidate) => isAllowedWikimediaLicense(candidate.licenseShortName)),
      );
      if (candidates.length >= config.maxDownloadsPerType) break;
    } catch {
      continue;
    }
  }
  return uniqueCandidates(candidates);
}

function commonsSearchQueries(work, mediaType) {
  const mediaHints = mediaType === 'image'
    ? ['poster', 'cover', 'screenshot', 'logo']
    : mediaType === 'audio'
      ? ['audio', 'music', 'theme']
      : ['trailer', 'video'];
  const attribution = work.attribution.replace(/^[^:]+:\s*/, '');
  return [
    `"${work.title}" ${work.year || ''} ${mediaHints[0]}`.trim(),
    `"${work.title}" ${mediaHints[1] ?? ''}`.trim(),
    attribution ? `"${work.title}" "${attribution}"` : '',
    `"${work.title}"`,
  ].filter(Boolean);
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wikimediaCandidateFromPage(page, expectedMediaType) {
  const info = page.imageinfo?.[0];
  if (!info?.url) return undefined;
  const mime = String(info.mime ?? '');
  const mediaType = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('audio/')
      ? 'audio'
      : mime.startsWith('video/')
        ? 'video'
        : '';
  if (!mediaType || mediaType !== expectedMediaType) return undefined;
  const metadata = info.extmetadata ?? {};
  return {
    title: clean(page.title?.replace(/^File:/, '') ?? ''),
    url: info.url,
    descriptionUrl: info.descriptionurl,
    mime,
    mediaType,
    size: info.size,
    width: info.width,
    height: info.height,
    licenseShortName: stripHtml(metadata.LicenseShortName?.value ?? ''),
    licenseUrl: metadata.LicenseUrl?.value ?? '',
    artist: stripHtml(metadata.Artist?.value ?? ''),
    credit: stripHtml(metadata.Credit?.value ?? ''),
    attributionRequired: stripHtml(metadata.AttributionRequired?.value ?? ''),
  };
}

function isAllowedWikimediaLicense(license) {
  const normalized = normalize(license);
  if (!normalized) return false;
  if (normalized.includes('fair use') || normalized.includes('non-free')) return false;
  return [
    'public domain',
    'cc0',
    'cc by',
    'cc-by',
    'cc by-sa',
    'cc-by-sa',
    'gfdl',
  ].some((allowed) => normalized.includes(allowed));
}

async function downloadWikimediaCandidate(candidate, folder, index) {
  try {
    const response = await fetch(candidate.url, {
      headers: { 'user-agent': 'quizz-teammates-clue-workspace/1.0 (local script)' },
    });
    if (!response.ok) return undefined;
    const extension = extensionFromMime(candidate.mime) || extname(new URL(candidate.url).pathname) || '.bin';
    const fileName = `free-source-${String(index).padStart(2, '0')}-${slugify(candidate.title).slice(0, 50)}${extension}`;
    const target = join(folder, fileName);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(target, buffer);
    return {
      ...candidate,
      localPath: relativePath(process.cwd(), target),
      source: 'Wikimedia Commons',
      verificationRequired: true,
    };
  } catch {
    return undefined;
  }
}

function extensionFromMime(mime) {
  const extensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
    'video/ogg': '.ogv',
    'video/webm': '.webm',
  };
  return extensions[mime] ?? '';
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function stripHtml(value) {
  return clean(String(value ?? '').replace(/<[^>]*>/g, ' '));
}

async function discoverWebSources(work, folder) {
  const suggestions = work.type === 'film'
    ? await discoverMovieSources(work, folder)
    : work.type === 'jeu video'
      ? discoverGameSources(work)
      : work.type === 'musique'
        ? discoverMusicSources(work)
        : discoverBookSources(work);
  if (suggestions.length > 0) {
    await writeFile(join(folder, 'sources', 'suggestions-web.json'), `${JSON.stringify(suggestions, null, 2)}\n`, 'utf8');
  }
  return suggestions;
}

async function discoverMovieSources(work, folder) {
  if (!hasTmdbCredentials()) {
    return [
      suggestion('TMDB', 'search', tmdbSearchUrl(work), 'Ajoutez TMDB_READ_ACCESS_TOKEN ou TMDB_API_KEY pour obtenir poster, backdrop et bande annonce via API.'),
    ];
  }
  const searchResult = await tmdbSearchMovie(work);
  if (!searchResult) return [suggestion('TMDB', 'search', tmdbSearchUrl(work), 'Aucune correspondance API fiable trouvee.')];
  const details = await tmdbMovieDetails(searchResult.id);
  const sources = [
    suggestion('TMDB', 'movie', `https://www.themoviedb.org/movie/${searchResult.id}?language=fr`, 'Page TMDB du film.', {
      title: searchResult.title,
      releaseDate: searchResult.release_date,
      overview: searchResult.overview,
    }),
  ];
  const imageSources = await downloadTmdbImages(searchResult, folder);
  sources.push(...imageSources);
  for (const trailer of tmdbTrailers(details).slice(0, 3)) {
    sources.push(suggestion('TMDB/YouTube', 'trailer', `https://www.youtube.com/watch?v=${trailer.key}`, trailer.name, {
      site: trailer.site,
      type: trailer.type,
    }));
  }
  return sources;
}

function hasTmdbCredentials() {
  return Boolean(config.tmdbReadAccessToken || config.tmdbApiKey);
}

function applyTmdbAuth(url) {
  if (!config.tmdbReadAccessToken && config.tmdbApiKey) url.searchParams.set('api_key', config.tmdbApiKey);
  return config.tmdbReadAccessToken
    ? { headers: { authorization: `Bearer ${config.tmdbReadAccessToken}` } }
    : {};
}

async function tmdbSearchMovie(work) {
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('query', work.title);
  if (work.year) url.searchParams.set('year', work.year);
  try {
    const response = await fetch(url, applyTmdbAuth(url));
    if (!response.ok) return undefined;
    const payload = await response.json();
    return payload.results?.[0];
  } catch {
    return undefined;
  }
}

async function tmdbMovieDetails(movieId) {
  const url = new URL(`https://api.themoviedb.org/3/movie/${movieId}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('append_to_response', 'videos');
  try {
    const response = await fetch(url, applyTmdbAuth(url));
    if (!response.ok) return undefined;
    return response.json();
  } catch {
    return undefined;
  }
}

async function downloadTmdbImages(movie, folder) {
  const imageBase = 'https://image.tmdb.org/t/p/original';
  const images = [
    movie.backdrop_path ? { label: 'Backdrop TMDB', path: movie.backdrop_path, file: 'tmdb-backdrop.jpg' } : undefined,
    movie.poster_path ? { label: 'Poster TMDB', path: movie.poster_path, file: 'tmdb-poster.jpg' } : undefined,
  ].filter(Boolean);
  const sources = [];
  for (const image of images) {
    try {
      const url = `${imageBase}${image.path}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const target = join(folder, 'sources', image.file);
      await writeFile(target, Buffer.from(await response.arrayBuffer()));
      sources.push(suggestion('TMDB', 'image', url, image.label, {
        localPath: relativePath(process.cwd(), target),
        rightsNote: 'Image issue de TMDB. Verifier les droits avant usage public.',
      }));
    } catch {
      continue;
    }
  }
  return sources;
}

function tmdbTrailers(details) {
  return (details?.videos?.results ?? [])
    .filter((video) => video.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip'].includes(video.type));
}

function discoverGameSources(work) {
  const query = encodeURIComponent(`${work.title} ${work.year || ''}`.trim());
  return [
    suggestion('jeuxvideo.com', 'search', `https://www.jeuxvideo.com/recherche.php?q=${query}`, 'Recherche jeuxvideo.com pour page, images ou videos du jeu.'),
    suggestion('jeuxvideo.com', 'google-search', `https://www.google.com/search?q=site%3Ajeuxvideo.com+${query}`, 'Recherche ciblee si la recherche interne ne suffit pas.'),
  ];
}

function discoverMusicSources(work) {
  const artist = work.attribution.replace(/^[^:]+:\s*/, '');
  const query = encodeURIComponent(`${work.title} ${artist}`.trim());
  return [
    suggestion('YouTube', 'search', `https://www.youtube.com/results?search_query=${query}`, 'Recherche YouTube. Selectionner une video officielle ou exploitable legalement.'),
    suggestion('YouTube', 'google-search', `https://www.google.com/search?q=site%3Ayoutube.com+${query}`, 'Recherche ciblee YouTube. Le script ne telecharge pas l audio.'),
  ];
}

function discoverBookSources(work) {
  const query = encodeURIComponent(`${work.title} ${work.attribution}`.trim());
  return [
    suggestion('Google Books', 'search', `https://www.google.com/search?q=site%3Abooks.google.com+${query}`, 'Recherche de notice ou apercu livre.'),
    suggestion('Wikisource', 'search', `https://www.google.com/search?q=site%3Afr.wikisource.org+${query}`, 'Recherche texte libre si l oeuvre est dans le domaine public.'),
  ];
}

function tmdbSearchUrl(work) {
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(work.title)}&language=fr`;
}

function suggestion(provider, kind, url, note, extra = {}) {
  return {
    provider,
    kind,
    url,
    note,
    verificationRequired: true,
    ...extra,
  };
}

async function downloadProviderAssets(work, folder) {
  const assets = work.type === 'livre'
    ? await downloadOpenLibraryAssets(work, folder)
    : work.type === 'jeu video'
      ? await downloadRawgAssets(work, folder)
      : [];
  if (assets.length > 0) {
    await writeFile(join(folder, 'sources', 'provider-assets.json'), `${JSON.stringify(assets, null, 2)}\n`, 'utf8');
  }
  return assets;
}

async function downloadOpenLibraryAssets(work, folder) {
  const assets = [];
  const author = work.attribution.replace(/^[^:]+:\s*/, '');
  const searchUrl = new URL('https://openlibrary.org/search.json');
  searchUrl.searchParams.set('title', work.title);
  if (author) searchUrl.searchParams.set('author', author);
  searchUrl.searchParams.set('limit', '1');
  try {
    const response = await fetch(searchUrl);
    if (!response.ok) return [];
    const payload = await response.json();
    const doc = payload.docs?.[0];
    if (!doc) return [];
    if (doc.cover_i) {
      const coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
      const target = join(folder, 'sources', 'openlibrary-cover.jpg');
      const downloaded = await downloadFile(coverUrl, target);
      if (downloaded) {
        assets.push(providerAsset('Open Library', 'image', coverUrl, target, 'Couverture Open Library.', {
          openLibraryKey: doc.key,
          title: doc.title,
          authorName: doc.author_name,
          firstPublishYear: doc.first_publish_year,
        }));
      }
    }
    const textTarget = join(folder, 'assets', 'indices-livre.txt');
    await writeFile(textTarget, bookTextClues(work, doc), 'utf8');
    assets.push(providerAsset('Open Library', 'text', `https://openlibrary.org${doc.key}`, textTarget, 'Fichier texte avec indices de travail.'));
  } catch {
    return assets;
  }
  return assets;
}

async function downloadRawgAssets(work, folder) {
  if (!config.rawgApiKey) {
    const steamAssets = await downloadSteamAssets(work, folder);
    if (steamAssets.length > 0) return steamAssets;
    const noticeTarget = join(folder, 'sources', 'game-assets-provider-required.json');
    await writeFile(noticeTarget, `${JSON.stringify({
      providers: ['RAWG', 'Steam'],
      requiredEnv: 'RAWG_API_KEY',
      message: "Aucun asset Steam trouve. Ajoutez RAWG_API_KEY pour telecharger des screenshots et backgrounds de jeux video plus largement.",
    }, null, 2)}\n`, 'utf8');
    return [];
  }
  const assets = [];
  const searchUrl = new URL('https://api.rawg.io/api/games');
  searchUrl.searchParams.set('key', config.rawgApiKey);
  searchUrl.searchParams.set('search', work.title);
  searchUrl.searchParams.set('page_size', '1');
  if (work.year) searchUrl.searchParams.set('dates', `${work.year}-01-01,${work.year}-12-31`);
  try {
    const response = await fetch(searchUrl);
    if (!response.ok) return [];
    const payload = await response.json();
    const game = payload.results?.[0];
    if (!game) return [];
    if (game.background_image) {
      const target = join(folder, 'sources', 'rawg-background.jpg');
      const downloaded = await downloadFile(game.background_image, target);
      if (downloaded) {
        assets.push(providerAsset('RAWG', 'image', game.background_image, target, 'Background RAWG.', {
          gameId: game.id,
          slug: game.slug,
          released: game.released,
        }));
      }
    }
    const screenshotsUrl = new URL(`https://api.rawg.io/api/games/${game.id}/screenshots`);
    screenshotsUrl.searchParams.set('key', config.rawgApiKey);
    const screenshotsResponse = await fetch(screenshotsUrl);
    if (screenshotsResponse.ok) {
      const screenshots = await screenshotsResponse.json();
      for (const [index, screenshot] of (screenshots.results ?? []).slice(0, 2).entries()) {
        const target = join(folder, 'sources', `rawg-screenshot-${index + 1}.jpg`);
        const downloaded = await downloadFile(screenshot.image, target);
        if (downloaded) assets.push(providerAsset('RAWG', 'image', screenshot.image, target, 'Screenshot RAWG.', { gameId: game.id }));
      }
    }
  } catch {
    return assets;
  }
  return assets;
}

async function downloadSteamAssets(work, folder) {
  const assets = [];
  const knownAppId = steamAppIds.get(normalize(work.title));
  if (knownAppId) return downloadSteamCdnAssets(work, folder, knownAppId);

  const searchUrl = new URL('https://store.steampowered.com/api/storesearch/');
  searchUrl.searchParams.set('term', work.title);
  searchUrl.searchParams.set('cc', 'fr');
  searchUrl.searchParams.set('l', 'fr');
  try {
    const response = await fetch(searchUrl);
    if (!response.ok) return [];
    const payload = await response.json();
    const item = (payload.items ?? []).find((candidate) => normalize(candidate.name) === normalize(work.title)) ?? payload.items?.[0];
    if (!item?.id) return [];

    const detailsUrl = new URL('https://store.steampowered.com/api/appdetails');
    detailsUrl.searchParams.set('appids', String(item.id));
    detailsUrl.searchParams.set('cc', 'fr');
    detailsUrl.searchParams.set('l', 'fr');
    const detailsResponse = await fetch(detailsUrl);
    if (!detailsResponse.ok) return [];
    const detailsPayload = await detailsResponse.json();
    const data = detailsPayload[String(item.id)]?.data;
    if (!data) return [];

    if (data.header_image) {
      const target = join(folder, 'sources', 'steam-header.jpg');
      const downloaded = await downloadFile(data.header_image, target);
      if (downloaded) assets.push(providerAsset('Steam', 'image', data.header_image, target, 'Image header Steam.', { appId: item.id, name: data.name }));
    }
    for (const [index, screenshot] of (data.screenshots ?? []).slice(0, 2).entries()) {
      const target = join(folder, 'sources', `steam-screenshot-${index + 1}.jpg`);
      const downloaded = await downloadFile(screenshot.path_full, target);
      if (downloaded) assets.push(providerAsset('Steam', 'image', screenshot.path_full, target, 'Screenshot Steam.', { appId: item.id, name: data.name }));
    }
  } catch {
    return assets;
  }
  return assets;
}

async function downloadSteamCdnAssets(work, folder, appId) {
  const assets = [];
  const cdnAssets = [
    ['steam-header.jpg', `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`, 'Image header Steam.'],
    ['steam-capsule.jpg', `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`, 'Capsule Steam.'],
    ['steam-library-hero.jpg', `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`, 'Hero Steam.'],
  ];
  for (const [fileName, url, note] of cdnAssets) {
    const target = join(folder, 'sources', fileName);
    const downloaded = await downloadFile(url, target);
    if (downloaded) assets.push(providerAsset('Steam CDN', 'image', url, target, note, { appId, title: work.title }));
  }
  return assets;
}

const steamAppIds = new Map([
  ['elden ring', 1245620],
  ['god of war ragnarok', 2322010],
  ['hollow knight', 367520],
  ['outer wilds', 753640],
  ['red dead redemption 2', 1174180],
  ['stardew valley', 413150],
  ['grand theft auto v', 271590],
]);

async function downloadFile(url, target) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

function providerAsset(provider, kind, url, target, note, extra = {}) {
  return {
    provider,
    kind,
    url,
    localPath: relativePath(process.cwd(), target),
    note,
    verificationRequired: true,
    ...extra,
  };
}

function bookTextClues(work, doc) {
  const author = work.attribution.replace(/^[^:]+:\s*/, '');
  return [
    `Titre : ${work.title}`,
    `Auteur : ${author || 'a verifier'}`,
    `Annee : ${work.year || doc.first_publish_year || 'a verifier'}`,
    '',
    'Indice 1 - court :',
    `Une oeuvre litteraire associee a ${work.attribution || 'son auteur'}.`,
    '',
    'Indice 2 - contexte :',
    doc.first_publish_year ? `Premiere publication referencee : ${doc.first_publish_year}.` : 'Contexte a completer.',
    '',
    'Indice 3 - fort :',
    'A completer avec une citation courte ou un theme distinctif apres verification des droits.',
    '',
  ].join('\n');
}

function workReadme(work, clues, processedAssets, downloadedSources = [], webSuggestions = [], providerAssets = []) {
  return `# ${work.title}

- Reponse attendue : ${work.answer}
- Type : ${work.type || 'non determine'}
- Annee : ${work.year || 'non determinee'}
- Attribution : ${work.attribution || 'non determinee'}
- Occurrences : ${work.occurrences.map((item) => `manche ${item.round}, oeuvre ${item.work}`).join(' ; ')}

## Indices a preparer

${clues.map((clue, index) => `### ${index + 1}. ${clue.label}

- Type d'indice : ${clue.kind}
- Fichier cible : ${clue.target ?? 'texte a saisir dans le quiz'}
- Consigne : ${clue.instruction}
${clue.kind === 'text' ? '- Texte retenu : ' : ''}
`).join('\n')}

## Fichiers source

Placez vos medias source dans \`sources/\` si vous souhaitez les traiter localement :

- audio : \`sources/source-audio.mp3\`
- video : \`sources/source-video.mp4\`
- image : \`sources/source-image.jpg\`

${downloadedSources.length ? `## Sources libres candidates\n\nLes fichiers ci-dessous viennent de Wikimedia Commons. Verifiez la pertinence et l'attribution avant usage.\n\n${downloadedSources.map((source) => `- ${source.localPath} - ${source.licenseShortName || 'licence a verifier'} - ${source.descriptionUrl}`).join('\n')}\n\n` : ''}
${webSuggestions.length ? `## Suggestions web specialisees\n\nCes pistes ne sont pas automatiquement validees juridiquement. Verifiez les droits et la pertinence avant usage.\n\n${webSuggestions.map((source) => `- ${source.provider} / ${source.kind} : ${source.url}${source.localPath ? ` (${source.localPath})` : ''}`).join('\n')}\n\n` : ''}
${providerAssets.length ? `## Assets telecharges\n\n${providerAssets.map((asset) => `- ${asset.localPath} - ${asset.provider} / ${asset.kind}`).join('\n')}\n\n` : ''}
${processedAssets.length ? `## Assets generes\n\n${processedAssets.map((asset) => `- ${asset.target}${asset.error ? ` : ${asset.error}` : ''}`).join('\n')}\n` : ''}
`;
}

function workspaceReadme(quiz, rows) {
  const byType = rows.reduce((acc, row) => {
    acc[row.type] = (acc[row.type] ?? 0) + 1;
    return acc;
  }, {});
  return `# Indices - ${quiz.title ?? basename(config.input)}

Espace genere automatiquement depuis \`${relativePath(process.cwd(), config.input)}\`.

## Contenu

- \`index.csv\` : suivi rapide des oeuvres.
- \`index.json\` : plan structure des indices.
- \`oeuvres/\` : un dossier par oeuvre avec manifeste et fiche de preparation.
${config.downloadFreeSources ? '- `sources/attribution-wikimedia-commons.json` dans chaque dossier concerne : licences et attributions des sources candidates.' : ''}
${config.discoverWebSources ? '- `sources/suggestions-web.json` dans chaque dossier concerne : suggestions TMDB, jeuxvideo.com, YouTube ou livres.' : ''}
${config.downloadProviderAssets ? '- `sources/provider-assets.json` dans chaque dossier concerne : assets telecharges depuis les APIs fournisseur.' : ''}

## Repartition

${Object.entries(byType).map(([type, count]) => `- ${type} : ${count}`).join('\n')}

## Utilisation conseillee

1. Ouvrir \`index.csv\` pour prioriser les oeuvres.
2. Completer les fichiers ou textes dans chaque dossier d'oeuvre.
3. Uploader les fichiers finaux via l'interface d'edition du quiz.
4. Remplacer les indices temporaires par les URLs Cloudinary ou les textes retenus.

${config.downloadFreeSources
  ? "Le mode de telechargement interroge Wikimedia Commons et conserve les informations de licence. Une validation humaine reste necessaire avant usage."
  : "Le script cree une structure de travail. Il ne telecharge pas automatiquement de contenus sous droits."}
${config.discoverWebSources ? "\nLe mode web specialise peut telecharger des images TMDB si `TMDB_API_KEY` est configure. Les liens YouTube et jeuxvideo.com sont fournis pour selection manuelle." : ''}
${config.downloadProviderAssets ? "\nLe mode assets fournisseur telecharge des couvertures Open Library pour les livres et des images RAWG pour les jeux si `RAWG_API_KEY` est configure." : ''}
`;
}

function uniqueFolderName(work, existing) {
  const base = slugify(`${work.type}-${work.title}-${work.year || 'sans-annee'}`);
  let candidate = base || 'oeuvre';
  let suffix = 2;
  while (existing.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function toCsv(rows) {
  const headers = ['title', 'answer', 'type', 'year', 'attribution', 'occurrences', 'folder', 'plannedClues', 'downloadedSources', 'webSuggestions', 'providerAssets', 'processedAssets'];
  return [
    headers.join(';'),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(';')),
  ].join('\n') + '\n';
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseArgs(args) {
  const input = readArg(args, '--input') ?? 'data/generated/quiz-sondage-autocomplete-preview.json';
  const output = readArg(args, '--output') ?? `data/generated/indices-${basename(input, extname(input))}`;
  const mediaRoot = readArg(args, '--media-root');
  const type = readArg(args, '--type') ?? '';
  const limit = Number(readArg(args, '--limit') ?? 0);
  const maxDownloadsPerType = Number(readArg(args, '--max-downloads-per-type') ?? 1);
  const downloadDelayMs = Number(readArg(args, '--download-delay-ms') ?? 350);
  const maxSourceMb = Number(readArg(args, '--max-source-mb') ?? 25);
  return {
    input: resolve(input),
    output: resolve(output),
    mediaRoot,
    type,
    downloadFreeSources: args.includes('--download-free-sources'),
    discoverWebSources: args.includes('--discover-web-sources'),
    downloadProviderAssets: args.includes('--download-provider-assets'),
    insecure: args.includes('--insecure'),
    tmdbApiKey: readArg(args, '--tmdb-api-key') ?? process.env.TMDB_API_KEY ?? '',
    tmdbReadAccessToken: readArg(args, '--tmdb-read-access-token') ?? process.env.TMDB_READ_ACCESS_TOKEN ?? '',
    rawgApiKey: readArg(args, '--rawg-api-key') ?? process.env.RAWG_API_KEY ?? '',
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    maxDownloadsPerType: Number.isFinite(maxDownloadsPerType) && maxDownloadsPerType > 0 ? maxDownloadsPerType : 1,
    downloadDelayMs: Number.isFinite(downloadDelayMs) && downloadDelayMs >= 0 ? downloadDelayMs : 350,
    maxSourceBytes: (Number.isFinite(maxSourceMb) && maxSourceMb > 0 ? maxSourceMb : 25) * 1024 * 1024,
  };
}

function readArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeType(value) {
  const normalized = normalize(value);
  if (normalized.includes('jeu')) return 'jeu video';
  if (normalized.includes('film') || normalized.includes('serie')) return 'film';
  if (normalized.includes('livre') || normalized.includes('roman') || normalized.includes('bd')) return 'livre';
  if (normalized.includes('musique') || normalized.includes('chanson') || normalized.includes('album')) return 'musique';
  return clean(value) || 'oeuvre';
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function relativePath(from, to) {
  return resolve(to).replace(resolve(from) + '/', '');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
