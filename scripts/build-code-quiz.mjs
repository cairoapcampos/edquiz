import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outPath = path.join(__dirname, '..', 'data', 'code_quiz.json');
const workTxtPath = path.join(__dirname, '..', 'data', 'codigos.txt');

function normalizeText(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/\u00a0/g, ' ');
}

function compactSpaces(s) {
  return s.replace(/[ \t]+/g, ' ').trim();
}

function normalizeComplexity(raw) {
  const t = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/·/g, '*')
    .replace(/²/g, '^2')
    .trim();

  if (t.includes('o(1)')) return { key: 'O(1)', label: 'O(1)' };
  if (t.includes('o(log n)')) return { key: 'O(log n)', label: 'O(log n)' };
  if (t.includes('o(n log n)')) return { key: 'O(n log n)', label: 'O(n log n)' };
  if (t.includes('o(n^2)') || t.includes('o(n²)')) return { key: 'O(n^2)', label: 'O(n²)' };
  if (t.includes('o(n^3)') || t.includes('o(n³)')) return { key: 'O(n^3)', label: 'O(n³)' };
  if (t.includes('o(2^n)')) return { key: 'O(2^n)', label: 'O(2^n)' };
  if (t.includes('o(n^k)')) return { key: 'O(n^k)', label: 'O(n^k)' };
  if (t.includes('o(m * n)') || t.includes('o(m*n)') || t.includes('o(m · n)')) return { key: 'O(m*n)', label: 'O(m·n)' };
  if (t.includes('o(n)')) return { key: 'O(n)', label: 'O(n)' };
  return { key: raw.trim(), label: raw.trim() };
}

function splitStatementAndCode(lines) {
  const cleaned = lines
    .map((l) => (l ?? '').replace(/\s+$/g, ''))
    .filter((l) => l.trim().length > 0);

  const codeLines = [];
  const statementLines = [];

  for (const l of cleaned) {
    const isCode = /^\s{2,}\S/.test(l) || /^(def |for |while |if |elif |else:|return |print\()/.test(l.trim());
    if (isCode) codeLines.push(l.replace(/^\s{0,3}/, ''));
    else statementLines.push(compactSpaces(l));
  }

  return {
    statement: statementLines.join(' ').trim(),
    code: codeLines.join('\n').trim(),
  };
}

function parseExercises(fullText) {
  const text = normalizeText(fullText);
  const lines = text.split('\n');

  /** @type {Map<number,{number:number,title:string,rawLines:string[]}>} */
  const exercises = new Map();

  let inGabarito = false;
  let currentNum = null;
  let currentTitle = '';
  let currentLines = [];

  const flush = () => {
    if (currentNum === null) return;
    exercises.set(currentNum, { number: currentNum, title: currentTitle.trim(), rawLines: currentLines.slice() });
    currentNum = null;
    currentTitle = '';
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();

    if (/^Gabarito Comentado/i.test(line)) {
      inGabarito = true;
      flush();
      break;
    }

    if (line.length === 0) continue;

    const nMatch = line.match(/^(\d+)\.\s+(.+)$/u);
    if (nMatch) {
      flush();
      currentNum = Number(nMatch[1]);
      currentTitle = nMatch[2];
      continue;
    }

    if (currentNum !== null) currentLines.push(raw);
  }

  flush();
  return exercises;
}

function parseGabarito(fullText) {
  const text = normalizeText(fullText);
  const lines = text.split('\n');

  /** @type {Map<number,{complexityKey:string,complexityLabel:string,explanation:string}>} */
  const out = new Map();

  let inGabarito = false;
  let currentNum = null;
  let currentComplexity = null;
  let buf = [];

  const flush = () => {
    if (currentNum === null || !currentComplexity) return;
    out.set(currentNum, {
      complexityKey: currentComplexity.key,
      complexityLabel: currentComplexity.label,
      explanation: compactSpaces(buf.join('\n')).replace(/\n+/g, '\n').trim(),
    });
    currentNum = null;
    currentComplexity = null;
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();

    if (/^Gabarito Comentado/i.test(line)) {
      inGabarito = true;
      continue;
    }
    if (!inGabarito) continue;

    const exMatch = line.match(/^Exerc\u00edcio\s+(\d+)\s+—\s+.+/u);
    if (exMatch) {
      flush();
      currentNum = Number(exMatch[1]);
      continue;
    }

    if (currentNum === null) continue;

    const cMatch = line.match(/^Complexidade:\s*(.+)$/iu);
    if (cMatch) {
      currentComplexity = normalizeComplexity(cMatch[1]);
      continue;
    }

    const shortMatch = line.match(/^O\(.+\)/u);
    if (shortMatch && !currentComplexity) {
      currentComplexity = normalizeComplexity(shortMatch[0]);
      buf.push(line.slice(shortMatch[0].length).trim());
      continue;
    }

    // comentários / explicação
    if (line.length > 0) buf.push(raw);
  }

  flush();
  return out;
}

async function ensureTxt() {
  try {
    return await fs.readFile(workTxtPath, 'utf8');
  } catch {
    // generate from pdf
  }

  const pdfPath = process.env.CODIGOS_PDF;
  if (!pdfPath) {
    throw new Error('Defina CODIGOS_PDF com o caminho do PDF (ex.: /home/cairo/Downloads/Codigos.pdf).');
  }
  await fs.mkdir(path.join(__dirname, '..', 'data'), { recursive: true });
  await execFileAsync('pdftotext', ['-layout', pdfPath, workTxtPath]);
  return await fs.readFile(workTxtPath, 'utf8');
}

const txt = await ensureTxt();
const exercises = parseExercises(txt);
const gabarito = parseGabarito(txt);

/** @type {any[]} */
const quiz = [];
/** @type {number[]} */
const missing = [];

for (const [num, ex] of [...exercises.entries()].sort((a, b) => a[0] - b[0])) {
  const ga = gabarito.get(num);
  if (!ga) {
    missing.push(num);
    continue;
  }

  const { statement, code } = splitStatementAndCode(ex.rawLines);
  quiz.push({
    id: `C|${num}`,
    number: num,
    title: ex.title,
    statement,
    code,
    answerKey: ga.complexityKey,
    answerLabel: ga.complexityLabel,
    explanation: ga.explanation,
  });
}

if (missing.length) {
  throw new Error(`Faltando gabarito para: ${missing.join(', ')}`);
}

const payload = {
  generatedAt: new Date().toISOString(),
  count: quiz.length,
  options: [
    { key: 'O(1)', label: 'O(1)' },
    { key: 'O(log n)', label: 'O(log n)' },
    { key: 'O(n)', label: 'O(n)' },
    { key: 'O(n log n)', label: 'O(n log n)' },
    { key: 'O(n^2)', label: 'O(n²)' },
    { key: 'O(m*n)', label: 'O(m·n)' },
    { key: 'O(n^3)', label: 'O(n³)' },
    { key: 'O(n^k)', label: 'O(n^k)' },
    { key: 'O(2^n)', label: 'O(2^n)' },
  ],
  quiz,
};

await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`OK: gerado ${quiz.length} exercícios em data/code_quiz.json`);

