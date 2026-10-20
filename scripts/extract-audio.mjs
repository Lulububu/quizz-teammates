import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const usage = `Usage : npm run audio:extract -- <URL YouTube> [options]

Options :
  --start SECONDES       Debut de l'extrait (defaut : 0)
  --duration SECONDES    Duree de l'extrait (defaut : 7)
  --output FICHIER.mp3   Fichier de sortie (defaut : output/extraits/<id>-<debut>-<duree>.mp3)
  --input FICHIER        Decouper un fichier local au lieu de le telecharger
  --yt-dlp FICHIER       Executable yt-dlp a utiliser (defaut : yt-dlp)
  --overwrite            Remplacer un fichier de sortie existant

Exemple :
  npm run audio:extract -- 'https://www.youtube.com/watch?v=2HJCN3upMHE' --duration 7
`;

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }

  const options = { start: 0, duration: 7, ytDlp: 'yt-dlp', overwrite: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (['--start', '--duration', '--output', '--input', '--yt-dlp'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour ${arg}.`);
      if (arg === '--yt-dlp') options.ytDlp = value;
      else options[arg.slice(2)] = value;
    } else if (!arg.startsWith('-') && !options.url) {
      options.url = arg;
    } else {
      throw new Error(`Argument inconnu : ${arg}`);
    }
  }

  if (Boolean(options.url) === Boolean(options.input)) {
    throw new Error('Indiquez une URL ou --input FICHIER, mais pas les deux.');
  }
  if (options.url) {
    const url = new URL(options.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Utilisez une URL HTTP(S).');
  }
  for (const key of ['start', 'duration']) {
    options[key] = Number(options[key]);
    if (!Number.isFinite(options[key]) || options[key] < (key === 'duration' ? 0.1 : 0)) {
      throw new Error(`${key} doit etre un nombre de secondes ${key === 'duration' ? 'superieur a 0' : 'positif'}.`);
    }
  }

  const id = options.url ? videoId(options.url) : basename(options.input).replace(/\.[^.]+$/, '');
  options.output = resolve(options.output ?? `output/extraits/${id}-${options.start}s-${options.duration}s.mp3`);
  if (!options.output.toLowerCase().endsWith('.mp3')) throw new Error('Le fichier de sortie doit se terminer par .mp3.');
  if (options.input && options.output === resolve(options.input)) {
    throw new Error('Le fichier de sortie doit etre different du fichier source.');
  }
  return options;
}

function videoId(value) {
  const url = new URL(value);
  const id = url.searchParams.get('v') ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1) : '');
  return (id || 'audio').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function run(command, args) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (error) => reject(new Error(`Impossible de lancer ${command} : ${error.message}`)));
    child.on('close', (code) => code === 0 ? done() : reject(new Error(`${command} a echoue (code ${code}).`)));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (existsSync(options.output) && !options.overwrite) {
    throw new Error(`Le fichier existe deja : ${options.output} (ajoutez --overwrite pour le remplacer).`);
  }
  if (options.input && !existsSync(options.input)) throw new Error(`Fichier introuvable : ${options.input}`);

  let temporary;
  try {
    let source = options.input ? resolve(options.input) : '';
    if (options.url) {
      temporary = await mkdtemp(join(tmpdir(), 'quizz-audio-'));
      console.log('Telechargement de la piste audio complete...');
      await run(options.ytDlp, [
        '--no-playlist', '--no-progress', '-f', 'ba',
        '-o', join(temporary, 'source.%(ext)s'), options.url,
      ]);
      const files = (await readdir(temporary)).filter((name) => /^source\.[^.]+$/.test(name) && !name.endsWith('.part'));
      if (files.length !== 1) throw new Error(`Piste audio introuvable apres telechargement dans ${temporary}.`);
      source = join(temporary, files[0]);
    }

    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', source,
    ]);
    const sourceDuration = Number(stdout.trim());
    if (!Number.isFinite(sourceDuration) || options.start + options.duration > sourceDuration + 0.1) {
      throw new Error(`Extrait demande hors de la piste (${sourceDuration.toFixed(1)}s).`);
    }

    await mkdir(dirname(options.output), { recursive: true });
    console.log(`Decoupage de ${options.start}s a ${options.start + options.duration}s...`);
    try {
      await run('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-i', source, '-ss', String(options.start), '-t', String(options.duration),
        '-vn', '-c:a', 'libmp3lame', '-q:a', '2',
        options.overwrite ? '-y' : '-n', options.output,
      ]);
      console.log(`Extrait cree : ${options.output}`);
    } catch (error) {
      if (!options.overwrite) await rm(options.output, { force: true });
      throw error;
    }
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Erreur : ${error.message}`);
  if (/yt-dlp.*echoue/.test(error.message)) {
    console.error('Essayez une version recente de yt-dlp et verifiez que Deno est installe.');
  }
  process.exitCode = 1;
});
