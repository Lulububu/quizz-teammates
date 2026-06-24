import https from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const config = parseArgs(process.argv.slice(2));
const categories = [
  {
    name: 'jeux-video',
    type: 'jeu vidéo',
    roots: ['Q7889'],
    target: config.videoGames,
  },
  {
    name: 'films',
    type: 'film',
    roots: ['Q11424'],
    target: config.films,
  },
  {
    name: 'livres',
    type: 'livre',
    roots: ['Q571', 'Q7725634'],
    target: config.books,
  },
  {
    name: 'musiques',
    type: 'musique',
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
  const query = buildQuery(category.roots, Math.ceil(category.target * 1.35));
  const url = new URL(endpoint);
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');

  const data = await fetchJson(url);
  const seenItems = new Set();
  const values = [];
  for (const binding of data.results.bindings) {
    const itemId = binding.item?.value;
    if (typeof itemId !== 'string' || seenItems.has(itemId)) continue;
    seenItems.add(itemId);
    const value = formatValue(binding, category.type);
    if (value) values.push(value);
  }
  return values;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        headers: {
          accept: 'application/sparql-results+json',
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
    request.end();
  });
}

function buildQuery(roots, limit) {
  const values = roots.map((root) => `wd:${root}`).join(' ');
  return `
SELECT DISTINCT ?item ?itemLabel ?year WHERE {
  VALUES ?root { ${values} }
  ?item wdt:P31 ?root.
  ?item (wdt:P577|wdt:P571) ?date.
  BIND(YEAR(?date) AS ?year)
  FILTER(?year >= 0 && ?year <= YEAR(NOW()) + 2)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}
LIMIT ${limit}
`;
}

function formatValue(binding, type) {
  const label = binding.itemLabel?.value;
  const year = Number(binding.year?.value);
  if (typeof label !== 'string' || !isUsefulLabel(label)) return undefined;
  if (!Number.isInteger(year)) return undefined;
  return `${label.replace(/\s+/g, ' ').trim()} (${type}, ${year})`;
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
  const insecure = args.includes('--insecure');
  return {
    output,
    limit,
    videoGames,
    films,
    books,
    music,
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
