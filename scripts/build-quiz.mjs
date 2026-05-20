import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function normalizeText(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

function joinLines(lines) {
  return lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function formatQuestion(lines) {
  const cleaned = lines.map((l) => (l ?? '').replace(/\s+$/g, ''));

  const diagramish = (line) => {
    const hasDigit = /\d/.test(line);
    const onlyDiagramChars = /^[\s\d/\\|_\-.,\[\](){}]+$/.test(line);
    const hasSlashes = /[\\/]/.test(line);
    return hasDigit && (onlyDiagramChars || hasSlashes) && line.trim().length > 0;
  };

  const outLines = [];
  let buf = [];

  const flushBuf = () => {
    const t = joinLines(buf);
    if (t) outLines.push(t);
    buf = [];
  };

  for (const raw of cleaned) {
    const line = raw;
    if (line.trim().length === 0) {
      flushBuf();
      continue;
    }
    if (diagramish(line)) {
      flushBuf();
      outLines.push(line); // preserva espaços para diagramas
      continue;
    }
    buf.push(line);
  }
  flushBuf();

  return outLines.join('\n').trim();
}

function parsePerguntas(perguntasTxt) {
  const text = normalizeText(perguntasTxt);
  const lines = text.split('\n').map((l) => l.replace(/\s+$/g, ''));

  /** @type {{id:string, partNumber:number, partTitle:string, number:number, text:string}[]} */
  const out = [];

  let partNumber = null;
  let partTitle = null;

  /** @type {null | {partNumber:number, partTitle:string, number:number, lines:string[]}} */
  let current = null;

  function flush() {
    if (!current) return;
    const qText = formatQuestion(current.lines);
    if (qText.length === 0) {
      current = null;
      return;
    }

    const id = `Q|${current.number}`;

    out.push({
      id,
      partNumber: current.partNumber,
      partTitle: current.partTitle,
      number: current.number,
      text: qText,
    });
    current = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();

    const partMatch = line.match(/^Parte\s+(\d+)\s+—\s+.+/u);
    if (partMatch) {
      flush();
      partNumber = Number(partMatch[1]);
      partTitle = partMatch[0];
      continue;
    }

    const nMatch = line.match(/^(\d+)\.\s*(.+)?$/u);
    if (nMatch) {
      flush();
      const num = Number(nMatch[1]);
      const first = (nMatch[2] ?? '').trim();
      if (!partNumber || !partTitle) {
        // tenta inferir parte caso o PDF esteja sem cabeçalho no começo
        partNumber = 0;
        partTitle = 'Parte ?';
      }
      current = { partNumber, partTitle, number: num, lines: [] };
      if (first) current.lines.push(first);
      continue;
    }

    if (current) current.lines.push(raw);
  }

  flush();
  return out;
}

function parseGabarito(gabaritoTxt) {
  const text = normalizeText(gabaritoTxt);
  const lines = text.split('\n').map((l) => l.replace(/\s+$/g, ''));

  /** @type {Map<string,{answer:boolean, explanation:string}>} */
  const map = new Map();

  /** @type {null | {key:string, answer:boolean|null, lines:string[]}} */
  let current = null;

  function flush() {
    if (!current) return;
    if (current.answer === null) {
      current = null;
      return;
    }
    map.set(current.key, {
      answer: current.answer,
      explanation: joinLines(current.lines),
    });
    current = null;
  }

  function parseSimNao(word) {
    if (!word) return null;
    const w = word.toLowerCase();
    if (w.startsWith('sim')) return true;
    if (w.startsWith('não') || w.startsWith('nao')) return false;
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();

    // linhas do tipo: "26. Resposta: Sim. ..." ou "11. Sim. ..."
    const aMatch = line.match(/^(\d+)\.\s*(?:Resposta:\s*)?(Sim|N\u00e3o)\.\s*(.*)$/u);
    if (aMatch) {
      flush();
      const num = Number(aMatch[1]);
      const ans = parseSimNao(aMatch[2]);
      const rest = (aMatch[3] ?? '').trim();
      const key = `Q|${num}`;
      current = { key, answer: ans, lines: [] };
      if (rest) current.lines.push(rest);
      continue;
    }

    if (current) current.lines.push(raw);
  }

  flush();
  return map;
}

const perguntasPath = new URL('../data/perguntas.txt', import.meta.url);
const gabaritoPath = new URL('../data/gabarito.txt', import.meta.url);
const outPath = new URL('../data/quiz.json', import.meta.url);

async function ensureTxtFromPdf() {
  const perguntasPdf = process.env.PERGUNTAS_PDF;
  const gabaritoPdf = process.env.GABARITO_PDF;
  if (!perguntasPdf || !gabaritoPdf) return false;

  await fs.mkdir(new URL('../data', import.meta.url), { recursive: true });
  await execFileAsync('pdftotext', ['-layout', perguntasPdf, fileURLToPath(perguntasPath)]);
  await execFileAsync('pdftotext', ['-layout', gabaritoPdf, fileURLToPath(gabaritoPath)]);
  return true;
}

import { fileURLToPath } from 'node:url';

let perguntasTxt;
let gabaritoTxt;
try {
  [perguntasTxt, gabaritoTxt] = await Promise.all([
    fs.readFile(perguntasPath, 'utf8'),
    fs.readFile(gabaritoPath, 'utf8'),
  ]);
} catch {
  const ok = await ensureTxtFromPdf();
  if (!ok) {
    throw new Error(
      'Não achei data/perguntas.txt e data/gabarito.txt.\n' +
        'Defina as variáveis de ambiente PERGUNTAS_PDF e GABARITO_PDF apontando para os PDFs e rode novamente.'
    );
  }
  [perguntasTxt, gabaritoTxt] = await Promise.all([
    fs.readFile(perguntasPath, 'utf8'),
    fs.readFile(gabaritoPath, 'utf8'),
  ]);
}

const perguntas = parsePerguntas(perguntasTxt);
const gabarito = parseGabarito(gabaritoTxt);

/** @type {any[]} */
const merged = [];
/** @type {string[]} */
const missing = [];

for (const q of perguntas) {
  const ga = gabarito.get(q.id);
  if (!ga) {
    missing.push(q.id);
    continue;
  }
  merged.push({
    id: q.id,
    partNumber: q.partNumber,
    partTitle: q.partTitle,
    number: q.number,
    question: q.text,
    answer: ga.answer,
    explanation: ga.explanation,
  });
}

if (missing.length > 0) {
  const sample = missing.slice(0, 20).join('\n');
  throw new Error(`Faltando gabarito para ${missing.length} questões. Primeiras:\n${sample}`);
}

await fs.writeFile(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: merged.length,
      quiz: merged,
    },
    null,
    2
  ) + '\n',
  'utf8'
);

console.log(`OK: gerado ${merged.length} questões em data/quiz.json`);
