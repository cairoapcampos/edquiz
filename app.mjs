import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const quizPath = path.join(__dirname, 'data', 'quiz.json');
const codeQuizPath = path.join(__dirname, 'data', 'code_quiz.json');

/** @type {{generatedAt:string,count:number}} */
let quizMeta = { generatedAt: new Date().toISOString(), count: 0 };

/** @type {{id:string,partNumber:number,partTitle:string,number:number,question:string,answer:boolean,explanation:string}[]} */
let quiz = [];
/** @type {{generatedAt:string,count:number,options:{key:string,label:string}[],quiz:any[]}} */
let codeQuizData = { generatedAt: new Date().toISOString(), count: 0, options: [], quiz: [] };

const assetVersion = process.env.ASSET_VERSION || String(Date.now());

async function loadQuiz() {
  const quizData = JSON.parse(await fs.readFile(quizPath, 'utf8'));
  const q = quizData.quiz;
  if (!Array.isArray(q)) throw new Error('data/quiz.json inválido: campo "quiz" deve ser array.');
  quiz = q;
  quizMeta = { generatedAt: quizData.generatedAt ?? new Date().toISOString(), count: quizData.count ?? q.length };
}

await loadQuiz();
try {
  codeQuizData = JSON.parse(await fs.readFile(codeQuizPath, 'utf8'));
} catch {
  // opcional
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  /** @type {Record<string,string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

/** @type {Map<string,{order:number[],index:number,hits:number,misses:number,skips:number,answers:{id:string,type:'answer'|'skip',answer?:boolean,correct?:boolean}[]}>} */
const sessions = new Map();
/** @type {Map<string,{order:number[],index:number,mode:'normal'|'complexity',hits:number,misses:number,skips:number,answers:{id:string,type:'answer'|'skip',choiceKey?:string,correct?:boolean}[]}>} */
const codeSessions = new Map();

function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (!sid) return null;
  return { sid, session: sessions.get(sid) ?? null };
}

function makePublicQuestion(q) {
  return {
    id: q.id,
    partNumber: q.partNumber,
    partTitle: q.partTitle,
    number: q.number,
    question: q.question,
  };
}

function currentQuestion(session) {
  const idx = session.order[session.index];
  if (idx === undefined) return null;
  return quiz[idx] ?? null;
}

function buildOrder({ random, part }) {
  /** @type {number[]} */
  let indices = [...Array(quiz.length).keys()];

  const wantPart = part === 'all' ? null : Number(part);
  if (wantPart && Number.isFinite(wantPart)) {
    indices = indices.filter((i) => quiz[i]?.partNumber === wantPart);
  }

  indices.sort((a, b) => {
    const qa = quiz[a];
    const qb = quiz[b];
    if (!qa || !qb) return 0;
    if (qa.partNumber !== qb.partNumber) return qa.partNumber - qb.partNumber;
    return qa.number - qb.number;
  });

  if (random) shuffle(indices);
  return indices;
}

function shuffleIndices(arr) {
  return shuffle(arr);
}

function makePublicCodeQuestion(q, mode) {
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    statement: q.statement,
    code: q.code,
    ...(mode === 'complexity' ? { correctChoiceKey: q.answerKey } : null),
  };
}

function buildCodeOrder({ random }) {
  const indices = [...Array((codeQuizData.quiz || []).length).keys()];
  const complexityRank = {
    'O(1)': 1,
    'O(log n)': 2,
    'O(n)': 3,
    'O(n log n)': 4,
    'O(n^2)': 5,
    'O(m*n)': 6,
    'O(n^3)': 7,
    'O(n^k)': 8,
    'O(2^n)': 9,
  };
  indices.sort((a, b) => (codeQuizData.quiz[a]?.number ?? 0) - (codeQuizData.quiz[b]?.number ?? 0));
  if (random) shuffleIndices(indices);
  return indices;
}

function buildCodeOrderByComplexity() {
  const indices = [...Array((codeQuizData.quiz || []).length).keys()];
  const complexityRank = {
    'O(1)': 1,
    'O(log n)': 2,
    'O(n)': 3,
    'O(n log n)': 4,
    'O(n^2)': 5,
    'O(m*n)': 6,
    'O(n^3)': 7,
    'O(n^k)': 8,
    'O(2^n)': 9,
  };
  indices.sort((a, b) => {
    const qa = (codeQuizData.quiz || [])[a];
    const qb = (codeQuizData.quiz || [])[b];
    const ra = complexityRank[qa?.answerKey] ?? 999;
    const rb = complexityRank[qb?.answerKey] ?? 999;
    if (ra !== rb) return ra - rb;
    return (qa?.number ?? 0) - (qb?.number ?? 0);
  });
  return indices;
}

function currentCodeQuestion(session) {
  const idx = session.order[session.index];
  if (idx === undefined) return null;
  return (codeQuizData.quiz || [])[idx] ?? null;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.locals.assetVersion = assetVersion;

  app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0, cacheControl: false }));
  app.use(express.json());

  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.render('home');
  });

  app.get('/simnao', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.render('index', { title: 'Quiz de Estrutura de Dados' });
  });

  app.get('/codigo', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.render('code', { title: 'Quiz de Complexidade de Código' });
  });

  app.get('/api/meta', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, generatedAt: quizMeta.generatedAt, count: quizMeta.count });
  });

  app.get('/api/code/meta', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, generatedAt: codeQuizData.generatedAt, count: codeQuizData.count, options: codeQuizData.options });
  });

  app.post('/api/code/start', (req, res) => {
    const sid = crypto.randomBytes(16).toString('hex');
    const random = req.body?.random !== undefined ? !!req.body.random : true;
    const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'normal';
    const order = mode === 'complexity' ? buildCodeOrderByComplexity() : buildCodeOrder({ random });
    const session = { order, index: 0, mode: mode === 'complexity' ? 'complexity' : 'normal', hits: 0, misses: 0, skips: 0, answers: [] };
    codeSessions.set(sid, session);
    res.setHeader('Set-Cookie', `code_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);

    const q = currentCodeQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      progress: { index: 1, total: order.length },
      scoreboard: { hits: 0, misses: 0, skips: 0 },
      options: codeQuizData.options,
      question: q ? makePublicCodeQuestion(q, session.mode) : null,
    });
  });

  app.post('/api/code/restart', (req, res) => {
    const cookies = parseCookies(req);
    const sid = cookies.code_sid;
    const session = sid ? codeSessions.get(sid) : null;
    if (!sid || !session) return res.status(400).json({ ok: false, error: 'Sessão inválida. Clique em "Começar".' });

    const random = req.body?.random !== undefined ? !!req.body.random : true;
    const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'normal';
    const order = mode === 'complexity' ? buildCodeOrderByComplexity() : buildCodeOrder({ random });
    session.order = order;
    session.index = 0;
    session.mode = mode === 'complexity' ? 'complexity' : 'normal';
    session.hits = 0;
    session.misses = 0;
    session.skips = 0;
    session.answers = [];

    const q = currentCodeQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      progress: { index: 1, total: order.length },
      scoreboard: { hits: 0, misses: 0, skips: 0 },
      options: codeQuizData.options,
      question: q ? makePublicCodeQuestion(q, session.mode) : null,
    });
  });

  app.post('/api/code/answer', (req, res) => {
    const cookies = parseCookies(req);
    const sid = cookies.code_sid;
    const session = sid ? codeSessions.get(sid) : null;
    if (!sid || !session) return res.status(400).json({ ok: false, error: 'Sessão inválida. Clique em "Começar".' });

    const body = req.body;
    if (!body || typeof body.id !== 'string' || typeof body.choiceKey !== 'string') {
      return res.status(400).json({ ok: false, error: 'Body inválido. Esperado { id: string, choiceKey: string }.' });
    }

    const q = currentCodeQuestion(session);
    if (!q) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        done: true,
        scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
        total: session.order.length,
      });
    }

    if (body.id !== q.id) {
      return res.status(400).json({ ok: false, error: 'Questão fora de ordem (recarregue a página e comece de novo).' });
    }

    const correct = body.choiceKey === q.answerKey;
    if (correct) session.hits += 1;
    else session.misses += 1;
    session.answers.push({ id: q.id, type: 'answer', choiceKey: body.choiceKey, correct });
    session.index += 1;

    const next = currentCodeQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      correct,
      correctAnswer: { key: q.answerKey, label: q.answerLabel },
      explanation: q.explanation,
      scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
      progress: { index: Math.min(session.index + 1, session.order.length), total: session.order.length },
      done: next === null,
      nextQuestion: next ? makePublicCodeQuestion(next, session.mode) : null,
    });
  });

  app.post('/api/code/skip', (req, res) => {
    const cookies = parseCookies(req);
    const sid = cookies.code_sid;
    const session = sid ? codeSessions.get(sid) : null;
    if (!sid || !session) return res.status(400).json({ ok: false, error: 'Sessão inválida. Clique em "Começar".' });

    const body = req.body;
    if (!body || typeof body.id !== 'string') {
      return res.status(400).json({ ok: false, error: 'Body inválido. Esperado { id: string }.' });
    }

    const q = currentCodeQuestion(session);
    if (!q) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        done: true,
        scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
        total: session.order.length,
      });
    }

    if (body.id !== q.id) {
      return res.status(400).json({ ok: false, error: 'Questão fora de ordem (recarregue a página e comece de novo).' });
    }

    session.skips += 1;
    session.answers.push({ id: q.id, type: 'skip' });
    session.index += 1;

    const next = currentCodeQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
      progress: { index: Math.min(session.index + 1, session.order.length), total: session.order.length },
      done: next === null,
      nextQuestion: next ? makePublicCodeQuestion(next, session.mode) : null,
    });
  });

  app.post('/api/code/back', (req, res) => {
    const cookies = parseCookies(req);
    const sid = cookies.code_sid;
    const session = sid ? codeSessions.get(sid) : null;
    if (!sid || !session) return res.status(400).json({ ok: false, error: 'Sessão inválida. Clique em "Começar".' });

    if (session.index <= 0 || session.answers.length === 0) {
      return res.status(400).json({ ok: false, error: 'Não há questão anterior.' });
    }

    const last = session.answers[session.answers.length - 1];
    const prevIdx = session.order[session.index - 1];
    if (prevIdx === undefined) return res.status(400).json({ ok: false, error: 'Não há questão anterior.' });
    const prevQuestion = (codeQuizData.quiz || [])[prevIdx];
    if (!prevQuestion) return res.status(400).json({ ok: false, error: 'Questão anterior inválida.' });

    if (last?.id !== prevQuestion.id) {
      session.index -= 1;
    } else {
      session.answers.pop();
      session.index -= 1;
      if (last.type === 'skip') session.skips = Math.max(0, session.skips - 1);
      if (last.type === 'answer') {
        if (last.correct) session.hits = Math.max(0, session.hits - 1);
        else session.misses = Math.max(0, session.misses - 1);
      }
    }

    const q = currentCodeQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
      progress: { index: Math.min(session.index + 1, session.order.length), total: session.order.length },
      question: q ? makePublicCodeQuestion(q, session.mode) : null,
      done: q === null,
    });
  });

  app.post('/api/start', (req, res) => {
    const sid = crypto.randomBytes(16).toString('hex');
    const random = req.body?.random !== undefined ? !!req.body.random : true;
    const part = typeof req.body?.part === 'string' ? req.body.part : 'all';
    const order = buildOrder({ random, part });
    const session = { order, index: 0, hits: 0, misses: 0, skips: 0, answers: [] };
    sessions.set(sid, session);
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);

    const q = currentQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      progress: { index: 1, total: order.length },
      scoreboard: { hits: 0, misses: 0, skips: 0 },
      question: q ? makePublicQuestion(q) : null,
    });
  });

  app.post('/api/answer', (req, res) => {
    const info = getSession(req);
    if (!info || !info.session) return res.status(400).json({ ok: false, error: 'Sessão inválida. Clique em "Começar".' });

    const body = req.body;
    if (!body || typeof body.id !== 'string' || typeof body.answer !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Body inválido. Esperado { id: string, answer: boolean }.' });
    }

    const session = info.session;
    const q = currentQuestion(session);
    if (!q) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        done: true,
        scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
        total: session.order.length,
      });
    }

    if (body.id !== q.id) {
      return res.status(400).json({ ok: false, error: 'Questão fora de ordem (recarregue a página e comece de novo).' });
    }

    const correct = body.answer === q.answer;
    if (correct) session.hits += 1;
    else session.misses += 1;
    session.answers.push({ id: q.id, type: 'answer', answer: body.answer, correct });
    session.index += 1;

    const next = currentQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      correct,
      correctAnswer: q.answer,
      explanation: q.explanation,
      scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
      progress: { index: Math.min(session.index + 1, session.order.length), total: session.order.length },
      done: next === null,
      nextQuestion: next ? makePublicQuestion(next) : null,
    });
  });

  app.post('/api/restart', (req, res) => {
    const info = getSession(req);
    if (!info || !info.session) return res.status(400).json({ ok: false, error: 'Sessão inválida.' });

    const random = req.body?.random !== undefined ? !!req.body.random : true;
    const part = typeof req.body?.part === 'string' ? req.body.part : 'all';
    const order = buildOrder({ random, part });
    info.session.order = order;
    info.session.index = 0;
    info.session.hits = 0;
    info.session.misses = 0;
    info.session.skips = 0;
    info.session.answers = [];

    const q = currentQuestion(info.session);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      progress: { index: 1, total: order.length },
      scoreboard: { hits: 0, misses: 0, skips: 0 },
      question: q ? makePublicQuestion(q) : null,
    });
  });

  app.post('/api/skip', (req, res) => {
    const info = getSession(req);
    if (!info || !info.session) return res.status(400).json({ ok: false, error: 'Sessão inválida. Clique em "Começar".' });

    const body = req.body;
    if (!body || typeof body.id !== 'string') {
      return res.status(400).json({ ok: false, error: 'Body inválido. Esperado { id: string }.' });
    }

    const session = info.session;
    const q = currentQuestion(session);
    if (!q) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        done: true,
        scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
        total: session.order.length,
      });
    }

    if (body.id !== q.id) {
      return res.status(400).json({ ok: false, error: 'Questão fora de ordem (recarregue a página e comece de novo).' });
    }

    session.skips += 1;
    session.answers.push({ id: q.id, type: 'skip' });
    session.index += 1;

    const next = currentQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
      progress: { index: Math.min(session.index + 1, session.order.length), total: session.order.length },
      done: next === null,
      nextQuestion: next ? makePublicQuestion(next) : null,
    });
  });

  app.post('/api/back', (req, res) => {
    const info = getSession(req);
    if (!info || !info.session) return res.status(400).json({ ok: false, error: 'Sessão inválida. Clique em "Começar".' });

    const session = info.session;
    if (session.index <= 0 || session.answers.length === 0) {
      return res.status(400).json({ ok: false, error: 'Não há questão anterior.' });
    }

    const last = session.answers[session.answers.length - 1];
    const currentIdx = session.order[session.index];
    const prevIdx = session.order[session.index - 1];

    // desfaz apenas se o "último registro" corresponde à questão anterior na ordem atual
    if (prevIdx === undefined) {
      return res.status(400).json({ ok: false, error: 'Não há questão anterior.' });
    }

    const prevQuestion = quiz[prevIdx];
    if (!prevQuestion) {
      return res.status(400).json({ ok: false, error: 'Questão anterior inválida.' });
    }

    if (last?.id !== prevQuestion.id) {
      // Se o usuário ainda não respondeu a questão anterior, apenas volta o índice.
      session.index -= 1;
    } else {
      session.answers.pop();
      session.index -= 1;

      if (last?.type === 'skip') {
        session.skips = Math.max(0, session.skips - 1);
      } else if (last?.type === 'answer') {
        if (last.correct) session.hits = Math.max(0, session.hits - 1);
        else session.misses = Math.max(0, session.misses - 1);
      }
    }

    const q = currentQuestion(session);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      scoreboard: { hits: session.hits, misses: session.misses, skips: session.skips },
      progress: { index: Math.min(session.index + 1, session.order.length), total: session.order.length },
      question: q ? makePublicQuestion(q) : null,
      done: q === null,
    });
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  return app;
}

export default createApp();
