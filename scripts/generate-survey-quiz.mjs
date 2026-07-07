import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const config = parseArgs(process.argv.slice(2));

async function main() {
  const surveyRows = readSurveyRows(config.input);
  const dictionary = await readDictionary(config.dictionary);
  const generated = buildQuiz(surveyRows, dictionary);

  await mkdir(dirname(config.output), { recursive: true });
  await mkdir(dirname(config.control), { recursive: true });
  await writeFile(config.output, `${JSON.stringify(generated.quiz, null, 2)}\n`, 'utf8');
  await writeFile(config.control, toCsv(generated.controlRows), 'utf8');
  await writeFile(config.summary, `${JSON.stringify(generated.summary, null, 2)}\n`, 'utf8');
  await writeFile(config.workDictionaryOutput, `${generated.workDictionaryValues.join('\n')}\n`, 'utf8');

  console.log(`Quiz genere : ${config.output}`);
  console.log(`Controle genere : ${config.control}`);
  console.log(`Resume genere : ${config.summary}`);
  console.log(`Dictionnaire oeuvres genere : ${config.workDictionaryOutput}`);
  console.log(`${generated.summary.roundCount} manche(s), ${generated.summary.questionCount} question(s), ${generated.summary.reviewCount} point(s) a verifier.`);
}

function buildQuiz(rows, dictionary) {
  const surveyWorks = rows.flatMap((row) => row.works);
  const people = rows.map((row) => row.person);
  const controlRows = [];
  const reviewItems = [];
  const workDictionaryValues = [];

  const rounds = rows.map((row, roundIndex) => {
    const personOptions = buildOptions(row.person, people, `person-${roundIndex}`);
    return {
      title: `Manche ${roundIndex + 1}`,
      person: {
        name: row.person,
        answerMode: 'choices',
        options: personOptions.options,
        correctOptionIndex: personOptions.correctIndex,
      },
      works: row.works.map((work, workIndex) => {
        const normalized = normalizeWork(work, dictionary);
        const workOptions = buildWorkOptions(normalized.title, normalized.type, surveyWorks, dictionary, `${roundIndex}-${workIndex}`);
        const needsReview = normalized.needsReview || !normalized.dictionaryMatch;
        const expectedAnswer = normalized.dictionaryValue || normalized.title;
        workDictionaryValues.push(expectedAnswer);
        if (needsReview) reviewItems.push(`${row.person} / ${work.rawTitle}`);
        controlRows.push({
          person: row.person,
          workNumber: workIndex + 1,
          rawType: work.rawType,
          normalizedType: normalized.type,
          rawTitle: work.rawTitle,
          normalizedTitle: normalized.title,
          dictionaryMatch: normalized.dictionaryMatch,
          needsReview: needsReview ? 'oui' : 'non',
          note: normalized.note,
        });
        return {
          title: normalized.title,
          kind: 'other',
          answerMode: config.answerMode,
          ...(config.answerMode === 'autocomplete'
            ? {
                dictionaryId: config.dictionaryId,
                correctAnswer: expectedAnswer,
              }
            : {
                options: workOptions.options,
                correctOptionIndex: workOptions.correctIndex,
              }),
          clues: buildClues(normalized),
        };
      }),
    };
  });

  return {
    quiz: {
      title: 'Quiz sondage - 3 œuvres préférées',
      description: `Généré automatiquement depuis ${basename(config.input)}. Les indices sont à relire avant animation.`,
      sequenceMode: 'works-first',
      hidePlayerNames: true,
      rounds,
    },
    controlRows,
    workDictionaryValues: uniqueByNormalized(workDictionaryValues),
    summary: {
      source: config.input,
      dictionary: config.dictionary,
      answerMode: config.answerMode,
      dictionaryId: config.dictionaryId,
      roundCount: rounds.length,
      questionCount: rounds.length * 4,
      workCount: surveyWorks.length,
      reviewCount: reviewItems.length,
      reviewItems,
      workDictionaryValueCount: uniqueByNormalized(workDictionaryValues).length,
      generatedAt: new Date().toISOString(),
    },
  };
}

function readSurveyRows(path) {
  const sharedStrings = readSharedStrings(path);
  const sheetXml = unzipText(path, 'xl/worksheets/sheet1.xml');
  const rows = [];
  const rowPattern = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(sheetXml))) {
    const cells = {};
    const cellPattern = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      cells[ref] = readCellValue(attrs, body, sharedStrings);
    }
    if (cells.A === 'ID') continue;
    const person = clean(cells.G || cells.E);
    if (!person) continue;
    rows.push({
      person,
      works: [
        { rawType: clean(cells.H), rawTitle: clean(cells.I) },
        { rawType: clean(cells.J), rawTitle: clean(cells.K) },
        { rawType: clean(cells.L), rawTitle: clean(cells.M) },
      ].filter((work) => work.rawType && work.rawTitle),
    });
  }
  return rows;
}

function readSharedStrings(path) {
  const entries = [];
  let xml = '';
  try {
    xml = unzipText(path, 'xl/sharedStrings.xml');
  } catch {
    return entries;
  }
  const itemPattern = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let match;
  while ((match = itemPattern.exec(xml))) {
    const text = Array.from(match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g))
      .map((part) => decodeXml(part[1]))
      .join('');
    entries.push(text);
  }
  return entries;
}

function readCellValue(attrs, body, sharedStrings) {
  const type = /t="([^"]+)"/.exec(attrs)?.[1];
  if (type === 's') {
    const index = Number(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1] ?? -1);
    return sharedStrings[index] ?? '';
  }
  if (type === 'inlineStr') {
    return decodeXml(Array.from(body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)).map((part) => part[1]).join(''));
  }
  return decodeXml(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1] ?? '');
}

async function readDictionary(path) {
  const content = await readFile(path, 'utf8');
  const byType = new Map();
  for (const line of content.split(/\r?\n/)) {
    const value = clean(line);
    if (!value) continue;
    const parsed = parseDictionaryLine(value);
    if (!parsed) continue;
    const entries = byType.get(parsed.type) ?? [];
    entries.push(parsed);
    byType.set(parsed.type, entries);
  }
  const byTitleAndType = new Map();
  for (const [type, entries] of byType.entries()) {
    for (const entry of entries) {
      const key = `${type}:${normalize(entry.title)}`;
      if (!byTitleAndType.has(key)) byTitleAndType.set(key, entry);
    }
  }
  return { byType, byTitleAndType };
}

function normalizeWork(work, dictionary) {
  const type = normalizeType(work.rawType);
  const alias = aliases.get(normalize(work.rawTitle));
  const candidateTitle = alias?.title ?? cleanupSubmittedTitle(work.rawTitle);
  const lookupType = alias?.type ?? type;
  const match = findDictionaryMatch(candidateTitle, lookupType, dictionary);
  const title = match?.title ?? candidateTitle;
  return {
    type: lookupType,
    title,
    dictionaryMatch: match?.value ?? '',
    dictionaryValue: match?.value ?? alias?.dictionaryValue ?? dictionaryValueFor(title, lookupType),
    metadata: match ? metadataFromDictionary(match) : '',
    needsReview: Boolean(alias?.review) || !match,
    note: alias?.note ?? (match ? '' : 'Aucune correspondance fiable trouvée dans le dictionnaire.'),
  };
}

function findDictionaryMatch(title, type, dictionary) {
  const key = `${type}:${normalize(title)}`;
  if (dictionary.byTitleAndType.has(key)) return dictionary.byTitleAndType.get(key);
  const entries = dictionary.byType.get(type) ?? [];
  const normalizedTitle = normalize(title);
  return entries.find((entry) => normalize(entry.title) === normalizedTitle);
}

function buildClues(work) {
  const clues = [{ kind: 'text', content: `Type : ${work.type}` }];
  if (work.metadata) clues.push({ kind: 'text', content: work.metadata });
  else clues.push({ kind: 'text', content: 'Indice à compléter' });
  return clues;
}

function buildWorkOptions(correctTitle, type, surveyWorks, dictionary, seed) {
  const surveyPool = surveyWorks
    .filter((work) => normalizeType(work.rawType) === type)
    .map((work) => cleanupSubmittedTitle(work.rawTitle))
    .filter((title) => normalize(title) !== normalize(correctTitle));
  const dictionaryPool = (dictionary.byType.get(type) ?? [])
    .map((entry) => entry.title)
    .filter((title) => normalize(title) !== normalize(correctTitle));
  return buildOptions(correctTitle, [...surveyPool, ...dictionaryPool], seed);
}

function buildOptions(correct, pool, seed) {
  const uniquePool = uniqueByNormalized(pool).filter((value) => normalize(value) !== normalize(correct));
  const distractors = seededShuffle(uniquePool, seed).slice(0, 3);
  while (distractors.length < 3) distractors.push(`Proposition ${distractors.length + 2}`);
  const labels = seededShuffle([correct, ...distractors], `${seed}-options`);
  return {
    options: labels,
    correctIndex: labels.findIndex((label) => normalize(label) === normalize(correct)),
  };
}

function parseDictionaryLine(value) {
  const match = /^(.*?) \((.*)\)$/.exec(value);
  if (!match) return undefined;
  const title = clean(match[1]);
  const details = match[2].split(',').map((part) => clean(part));
  const type = normalizeType(details[0]);
  return { title, type, details, value };
}

function metadataFromDictionary(entry) {
  const usefulDetails = entry.details.filter((detail, index) => index === 0 || /^\d{3,4}$/.test(detail) || detail.includes(':'));
  return usefulDetails.length ? `Repère : ${usefulDetails.join(', ')}` : '';
}

function dictionaryValueFor(title, type) {
  return manualDictionaryValues.get(`${type}:${normalize(title)}`) ?? '';
}

function cleanupSubmittedTitle(value) {
  return clean(value)
    .replace(/^l['’]album\s*:\s*/i, '')
    .replace(/\s+sur\s+(ps2|ps3|ps4|ps5|xbox|switch|pc)$/i, '')
    .replace(/\s+-\s*(disney|pixar)$/i, '')
    .replace(/\s+de\s+David Ayer$/i, '')
    .replace(/\s+-\s+Jules Vernes?$/i, '')
    .replace(/\s*\(.*?\)\s*$/g, '')
    .trim();
}

function normalizeType(value) {
  const normalized = normalize(value);
  if (normalized.includes('jeu')) return 'jeu vidéo';
  if (normalized.includes('film') || normalized.includes('serie')) return 'film';
  if (normalized.includes('livre')) return 'livre';
  if (normalized.includes('musique')) return 'musique';
  return clean(value).toLocaleLowerCase('fr-FR') || 'autre';
}

function uniqueByNormalized(values) {
  const seen = new Set();
  const result = [];
  for (const value of values.map(clean).filter(Boolean)) {
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function seededShuffle(values, seed) {
  const result = [...values];
  let state = hash(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function toCsv(rows) {
  const headers = ['person', 'workNumber', 'rawType', 'normalizedType', 'rawTitle', 'normalizedTitle', 'dictionaryMatch', 'needsReview', 'note'];
  return [
    headers.join(';'),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(';')),
  ].join('\n') + '\n';
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function unzipText(path, entry) {
  return execFileSync('unzip', ['-p', path, entry], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value)
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseArgs(args) {
  const answerMode = readArg(args, '--answer-mode') === 'autocomplete' ? 'autocomplete' : 'choices';
  const defaultPrefix = answerMode === 'autocomplete' ? 'quiz-sondage-autocomplete' : 'quiz-sondage';
  const input = resolve(readArg(args, '--input') ?? 'data/Vos 3 oeuvres préférés(1-18).xlsx');
  const output = resolve(readArg(args, '--output') ?? `data/generated/${defaultPrefix}-preview.json`);
  const control = resolve(readArg(args, '--control') ?? `data/generated/${defaultPrefix}-controle.csv`);
  const summary = resolve(readArg(args, '--summary') ?? `data/generated/${defaultPrefix}-summary.json`);
  const workDictionaryOutput = resolve(readArg(args, '--work-dictionary-output') ?? `data/generated/${defaultPrefix}-oeuvres-dictionnaire.txt`);
  const dictionary = resolve(readArg(args, '--dictionary') ?? 'data/dictionnaires/oeuvres-wikidata.txt');
  const dictionaryId = readArg(args, '--dictionary-id') ?? '';
  return { input, output, control, summary, workDictionaryOutput, dictionary, answerMode, dictionaryId };
}

function readArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const aliases = new Map([
  ['le cycle de fondation asimov', { title: 'Fondation', type: 'livre', note: 'Alias sondage vers Fondation, à valider si la réponse attendue doit être le cycle complet.' }],
  ['l album deamon days de gorillaz', { title: 'Demon Days', type: 'musique', note: 'Correction orthographique Deamon -> Demon.' }],
  ['deamon days de gorillaz', { title: 'Demon Days', type: 'musique', note: 'Correction orthographique Deamon -> Demon.' }],
  ['fury de david ayer', { title: 'Fury', type: 'film' }],
  ['gran turismo 4 sur ps2', { title: 'Gran Turismo 4', type: 'jeu vidéo' }],
  ['gta 5', { title: 'Grand Theft Auto V', type: 'jeu vidéo' }],
  ['deux ans de vacances jules vernes', { title: 'Deux ans de vacances', type: 'livre', note: 'Correction Jules Vernes -> Jules Verne.' }],
  ['summertime ella fitzgerald et louis armstrong', { title: 'Summertime', type: 'musique' }],
  ['aladin disney', { title: 'Aladdin', type: 'film', note: 'Alias vers le film Disney.' }],
  ['django unchained', { title: 'Django Unchained', type: 'film' }],
  ['millenium', { title: 'Millénium', type: 'livre', review: true, note: 'Titre de série : vérifier le tome attendu.' }],
  ['titanic', { title: 'Titanic', type: 'film' }],
  ['red dead redemption ii', { title: 'Red Dead Redemption 2', type: 'jeu vidéo' }],
  ['muse knights of cydonia', { title: 'Knights of Cydonia', type: 'musique' }],
  ['princesse mononoke hayao miyazaki studio ghibli', { title: 'Princesse Mononoké', type: 'film' }],
  ['diablo ii', { title: 'Diablo II', type: 'jeu vidéo' }],
  ['the scientist coldplay', { title: 'The Scientist', type: 'musique' }],
  ['concerto pour clarinette mozart', { title: 'Concerto pour clarinette de Mozart', type: 'musique', review: true, note: 'Œuvre classique : libellé à confirmer.' }],
  ['les cahier d ester riad satouf', { title: "Les Cahiers d'Esther", type: 'livre', review: true, note: 'Correction orthographique à valider.' }],
  ['friends', { title: 'Friends', type: 'film', review: true, note: 'Série classée comme film dans le sondage.' }],
  ['la haut pixar les 4 premieres minutes', { title: 'Là-haut', type: 'film' }],
  ['slipping through my fingers abba', { title: 'Slipping Through My Fingers', type: 'musique' }],
  ['i can do it with a broken heart taylor swift', { title: 'I Can Do It with a Broken Heart', type: 'musique' }],
  ['god of war ragnarok', { title: 'God of War Ragnarök', type: 'jeu vidéo' }],
  ['avicii the nights', { title: 'The Nights', type: 'musique' }],
  ['gossip girl tome 8', { title: 'Gossip Girl', type: 'film', review: true, note: 'Le sondage indique film mais le libellé mentionne un tome.' }],
  ['friends saison 5', { title: 'Friends', type: 'film', review: true, note: 'Saison précise : vérifier si la réponse attendue doit être Friends ou Saison 5.' }],
  ['le crime de l orient express', { title: "Le Crime de l'Orient-Express", type: 'livre' }],
]);

const manualDictionaryValues = new Map([
  ['musique:demon days', 'Demon Days (musique, 2005, artiste : Gorillaz)'],
  ['film:fury', 'Fury (film, 2014, réalisateur : David Ayer)'],
  ['jeu vidéo:elden ring', 'Elden Ring (jeu vidéo, 2022, studio : FromSoftware)'],
  ['musique:summertime', 'Summertime (musique, 1958, artiste : Ella Fitzgerald, Louis Armstrong)'],
  ['musique:jungle tash sultana', 'Jungle (musique, 2016, artiste : Tash Sultana)'],
  ['jeu vidéo:stardew valley', 'Stardew Valley (jeu vidéo, 2016, studio : ConcernedApe)'],
  ['livre:plus malin que le diable', 'Plus malin que le diable (livre, 1938, auteur : Napoleon Hill)'],
  ['musique:killing me softly with his song', 'Killing Me Softly with His Song (musique, 1973, artiste : Roberta Flack)'],
  ['jeu vidéo:red dead redemption 2', 'Red Dead Redemption 2 (jeu vidéo, 2018, studio : Rockstar Studios)'],
  ['jeu vidéo:outer wilds', 'Outer Wilds (jeu vidéo, 2019, studio : Mobius Digital)'],
  ['musique:knights of cydonia', 'Knights of Cydonia (musique, 2006, artiste : Muse)'],
  ['film:princesse mononoke', 'Princesse Mononoké (film, 1997, réalisateur : Hayao Miyazaki)'],
  ['livre:la horde du contrevent', 'La Horde du Contrevent (livre, 2004, auteur : Alain Damasio)'],
  ['musique:marillion', 'Marillion (musique, 1979, artiste : Marillion)'],
  ['film:star wars', 'Star Wars (film, 1977, réalisateur : George Lucas)'],
  ['jeu vidéo:pokemon', 'Pokémon (jeu vidéo, 1996, studio : Game Freak)'],
  ['livre:harry potter', 'Harry Potter (livre, 1997, auteur : J. K. Rowling)'],
  ['musique:the scientist', 'The Scientist (musique, 2002, artiste : Coldplay)'],
  ['musique:concerto pour clarinette de mozart', 'Concerto pour clarinette de Mozart (musique, 1791, artiste : Wolfgang Amadeus Mozart)'],
  ['livre:les cahiers d esther', "Les Cahiers d'Esther (livre, 2016, auteur : Riad Sattouf)"],
  ['musique:delivery babyshambles', 'Delivery (musique, 2007, artiste : Babyshambles)'],
  ['film:friends', 'Friends (film, 1994, réalisateur : David Crane, Marta Kauffman)'],
  ['livre:les sept soeurs lucinda riley', 'Les Sept Sœurs (livre, 2014, auteur : Lucinda Riley)'],
  ['film:la haut', 'Là-haut (film, 2009, réalisateur : Pete Docter)'],
  ['musique:slipping through my fingers', 'Slipping Through My Fingers (musique, 1981, artiste : ABBA)'],
  ['musique:i can do it with a broken heart', 'I Can Do It with a Broken Heart (musique, 2024, artiste : Taylor Swift)'],
  ['jeu vidéo:god of war ragnarok', 'God of War Ragnarök (jeu vidéo, 2022, studio : Santa Monica Studio)'],
  ['livre:et il me parla de cerisiers de poussieres et d une montagne', "Et il me parla de cerisiers, de poussières et d'une montagne (livre, 2016, auteur : Antoine Paje)"],
  ['musique:the nights', 'The Nights (musique, 2014, artiste : Avicii)'],
  ['film:gossip girl', 'Gossip Girl (film, 2007, réalisateur : Josh Schwartz, Stephanie Savage)'],
  ['film:hamnet', 'Hamnet (film, 2025, réalisateur : Chloé Zhao)'],
  ['jeu vidéo:hollow knight', 'Hollow Knight (jeu vidéo, 2017, studio : Team Cherry)'],
]);

await main();
