import https from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const config = parseArgs(process.argv.slice(2));
const categories = [
  {
    name: 'jeux-video',
    type: 'jeu vidéo',
    attribution: 'studio',
    creatorPath: 'wdt:P178',
    roots: ['Q7889'],
    target: config.videoGames,
  },
  {
    name: 'films',
    type: 'film',
    attribution: 'réalisateur',
    creatorPath: 'wdt:P57',
    roots: ['Q11424'],
    seeds: ['Q134773'],
    target: config.films,
  },
  {
    name: 'livres',
    type: 'livre',
    attribution: 'auteur',
    creatorPath: 'wdt:P50',
    roots: ['Q7725634', 'Q8261'],
    seeds: ['Q753894'],
    target: config.books,
  },
  {
    name: 'musiques',
    type: 'musique',
    attribution: 'artiste',
    creatorPath: '(wdt:P175|wdt:P86)',
    roots: ['Q7366', 'Q482994'],
    target: config.music,
  },
];

const endpoint = 'https://query.wikidata.org/sparql';
const userAgent = 'quizz-teammates-dictionary-generator/1.0 (local script)';
const seen = new Set();
const values = [];

for (const category of categories) {
  if (category.target <= 0) continue;
  const labels = await fetchCategory(category);
  for (const label of labels) addValue(label);
}

await mkdir(dirname(config.output), { recursive: true });
await writeFile(config.output, `${values.slice(0, config.limit).join('\n')}\n`, 'utf8');

console.log(`Dictionnaire genere : ${config.output}`);
console.log(`${Math.min(values.length, config.limit)} valeur(s)`);

async function fetchCategory(category) {
  console.log(`Recuperation ${category.name}...`);
  const items = new Map();

  if (category.seeds?.length) {
    const seedUrl = new URL(endpoint);
    seedUrl.searchParams.set('query', buildSeedQuery(category));
    seedUrl.searchParams.set('format', 'json');
    const data = await fetchJsonWithRetry(seedUrl);
    mergeBindings(items, data.results.bindings, category);
  }

  for (const minSitelinks of config.sitelinkThresholds) {
    if (items.size >= category.target * config.fetchFactor) break;

    for (let offset = 0; items.size < category.target * config.fetchFactor; offset += config.batchSize) {
      const query = buildQuery(category, config.batchSize, offset, minSitelinks);
      const url = new URL(endpoint);
      url.searchParams.set('query', query);
      url.searchParams.set('format', 'json');

      const data = await fetchJsonWithRetry(url);
      const bindings = data.results.bindings;
      if (!bindings.length) break;

      mergeBindings(items, bindings, category);
    }
  }

  const selectedItems = Array.from(items.values())
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'fr'))
    .slice(0, category.target);

  await enrichCreators(selectedItems, category);

  return selectedItems.map(formatItem);
}

function mergeBindings(items, bindings, category) {
  for (const binding of bindings) {
    const itemId = binding.item?.value;
    if (typeof itemId !== 'string') continue;
    const item = readItem(binding, category);
    if (!item) continue;
    const score = Number(binding.sitelinks?.value ?? 0);
    const existing = items.get(itemId);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      if (item.creator) existing.creators.add(item.creator);
      if (item.year < existing.year) existing.year = item.year;
    } else {
      items.set(itemId, {
        id: itemId,
        title: item.title,
        type: category.type,
        attribution: category.attribution,
        year: item.year,
        score,
        creators: item.creator ? new Set([item.creator]) : new Set(),
      });
    }
  }
}

async function enrichCreators(items, category) {
  if (!category.creatorPath || !items.length) return;

  const byId = new Map(items.map((item) => [item.id, item]));
  for (let index = 0; index < items.length; index += config.creatorBatchSize) {
    const chunk = items.slice(index, index + config.creatorBatchSize);
    const url = new URL(endpoint);
    url.searchParams.set('query', buildCreatorQuery(category, chunk));
    url.searchParams.set('format', 'json');

    const data = await fetchJsonWithRetry(url);
    for (const binding of data.results.bindings) {
      const itemId = binding.item?.value;
      const creatorLabel = binding.creatorLabel?.value;
      if (typeof itemId !== 'string' || typeof creatorLabel !== 'string') continue;
      if (!isUsefulLabel(creatorLabel)) continue;
      byId.get(itemId)?.creators.add(cleanLabel(creatorLabel));
    }
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const body = url.searchParams.toString();
    const requestUrl = new URL(url);
    requestUrl.search = '';
    const request = https.request(
      requestUrl,
      {
        method: 'POST',
        headers: {
          accept: 'application/sparql-results+json',
          'content-length': Buffer.byteLength(body),
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': userAgent,
        },
        rejectUnauthorized: !config.insecure,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Wikidata: ${response.statusCode} ${response.statusMessage}\n${body.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

async function fetchJsonWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      if (attempt === config.retries) break;
      const delayMs = attempt * config.retryDelayMs;
      console.warn(`Wikidata indisponible, nouvelle tentative ${attempt + 1}/${config.retries} dans ${delayMs}ms.`);
      await wait(delayMs);
    }
  }
  throw lastError;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildQuery(category, limit, offset, minSitelinks) {
  const values = category.roots.map((root) => `wd:${root}`).join(' ');
  return `
SELECT DISTINCT ?item ?itemLabel ?year ?sitelinks ?creatorLabel WHERE {
  VALUES ?root { ${values} }
  ?item wdt:P31 ?root.
  ?item (wdt:P577|wdt:P571) ?date.
  ?item wikibase:sitelinks ?sitelinks.
  BIND(YEAR(?date) AS ?year)
  FILTER(?year >= 0 && ?year <= YEAR(NOW()) + 2)
  FILTER(?sitelinks >= ${minSitelinks})
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}
LIMIT ${limit}
OFFSET ${offset}
`;
}

function buildSeedQuery(category) {
  const values = category.seeds.map((seed) => `wd:${seed}`).join(' ');
  return `
SELECT DISTINCT ?item ?itemLabel ?year ?sitelinks ?creatorLabel WHERE {
  VALUES ?item { ${values} }
  ?item (wdt:P577|wdt:P571) ?date.
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks. }
  BIND(YEAR(?date) AS ?year)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}
`;
}

function buildCreatorQuery(category, items) {
  const values = items.map((item) => sparqlEntity(item.id)).join(' ');
  return `
SELECT DISTINCT ?item ?creatorLabel WHERE {
  VALUES ?item { ${values} }
  ?item ${category.creatorPath} ?creator.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}
`;
}

function sparqlEntity(value) {
  return value.startsWith('http') ? `<${value}>` : `wd:${value}`;
}

function readItem(binding, category) {
  const label = binding.itemLabel?.value;
  const year = Number(binding.year?.value);
  if (typeof label !== 'string' || !isUsefulLabel(label)) return undefined;
  if (!Number.isInteger(year)) return undefined;
  const creatorLabel = binding.creatorLabel?.value;
  return {
    title: cleanLabel(label),
    year,
    creator: typeof creatorLabel === 'string' && isUsefulLabel(creatorLabel) ? cleanLabel(creatorLabel) : '',
  };
}

function formatItem(item) {
  const creators = Array.from(item.creators).sort((left, right) => left.localeCompare(right, 'fr')).slice(0, 3);
  const attribution = creators.length ? `, ${item.attribution} : ${creators.join(', ')}` : '';
  return `${item.title} (${item.type}, ${item.year}${attribution})`;
}

function cleanLabel(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function addValue(value) {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  const key = normalize(cleaned);
  if (!key || seen.has(key)) return;
  seen.add(key);
  values.push(cleaned);
}

function isUsefulLabel(value) {
  const cleaned = value.trim();
  if (cleaned.length < 2 || cleaned.length > 90) return false;
  if (/^Q\d+$/.test(cleaned)) return false;
  if (/[\t\n\r]/.test(cleaned)) return false;
  return true;
}

function normalize(value) {
  return value
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function parseArgs(args) {
  const output = resolve(readArg(args, '--output') ?? 'data/dictionnaires/oeuvres-wikidata.txt');
  const limit = readNumber(args, '--limit', 10_000);
  const videoGames = readNumber(args, '--video-games', 3_000);
  const films = readNumber(args, '--films', 3_000);
  const books = readNumber(args, '--books', 3_000);
  const music = readNumber(args, '--music', 3_000);
  const batchSize = readNumber(args, '--batch-size', 5_000);
  const minSitelinks = readNumber(args, '--min-sitelinks', 1);
  const fetchFactor = readNumber(args, '--fetch-factor', 1.15);
  const creatorBatchSize = readNumber(args, '--creator-batch-size', 250);
  const retries = readNumber(args, '--retries', 5);
  const retryDelayMs = readNumber(args, '--retry-delay-ms', 2_000);
  const insecure = args.includes('--insecure');
  return {
    output,
    limit,
    videoGames,
    films,
    books,
    music,
    batchSize,
    minSitelinks,
    fetchFactor,
    creatorBatchSize,
    retries,
    retryDelayMs,
    sitelinkThresholds: [minSitelinks],
    insecure,
  };
}

function readArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readNumber(args, name, fallback) {
  const value = Number(readArg(args, name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
