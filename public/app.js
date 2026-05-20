const el = (id) => document.getElementById(id);

const metaEl = el('meta');
const progressEl = el('progress');
const hitsEl = el('hits');
const missesEl = el('misses');
const skipsEl = el('skips');
const qtitleEl = el('qtitle');
const qtextEl = el('qtext');
const diagramEl = el('diagram');
const actionsEl = el('actions');
const feedbackEl = el('feedback');
const resultEl = el('result');
const explainTextEl = el('explainText');
const progressBarEl = document.getElementById('progressBar');
const progressTextEl = document.getElementById('progressText');
const randomToggleEl = document.getElementById('randomToggle');
const partSelectEl = document.getElementById('partSelect');
const timerToggleEl = document.getElementById('timerToggle');
const timerBadgeEl = document.getElementById('timerBadge');

let current = null;
let locked = false;

let timerInterval = null;
let timerStartedAt = null;

const DIAGRAMS = {
  84: { src: '/diagrams/tree-84.svg', alt: 'Árvore da questão 84' },
  85: { src: '/diagrams/tree-85-87.svg', alt: 'Árvore da questão 85' },
  87: { src: '/diagrams/tree-85-87.svg', alt: 'Árvore da questão 87' },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    throw new Error((data && data.error) || 'Erro inesperado');
  }
  return data;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function readTimerPrefs() {
  const show = localStorage.getItem('quiz_timer_show');
  return {
    show: show === '1',
  };
}

function writeTimerPrefs({ show }) {
  localStorage.setItem('quiz_timer_show', show ? '1' : '0');
}

function updateTimerUI() {
  if (!timerBadgeEl) return;
  const show = timerToggleEl ? !!timerToggleEl.checked : false;
  timerBadgeEl.hidden = !show;
  if (!timerStartedAt) {
    timerBadgeEl.textContent = `⏱ 00:00:00`;
    timerBadgeEl.className = 'badge text-bg-dark';
    return;
  }
  const elapsed = Date.now() - timerStartedAt;
  timerBadgeEl.textContent = `⏱ ${formatMs(elapsed)}`;
  timerBadgeEl.className = 'badge text-bg-dark';
}

function startTimer() {
  timerStartedAt = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerUI, 250);
  updateTimerUI();
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  timerStartedAt = null;
  updateTimerUI();
}

function setButtons(buttons) {
  actionsEl.innerHTML = '';
  for (const b of buttons) actionsEl.appendChild(b);
}

function btn(label, klass, onClick) {
  const b = document.createElement('button');
  b.className = `btn ${klass || ''}`.trim();
  b.textContent = label;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function btnWithIcon({ label, klass, iconSrc, iconAlt, onClick }) {
  const b = document.createElement('button');
  b.className = `btn ${klass || ''}`.trim();
  b.type = 'button';
  b.innerHTML = `<img src="${iconSrc}" alt="" class="me-2" style="width:18px;height:18px;vertical-align:-3px" />${label}`;
  b.setAttribute('aria-label', label);
  if (iconAlt) b.dataset.iconAlt = iconAlt;
  b.addEventListener('click', onClick);
  return b;
}

function renderQuestion(q, progress, scoreboard) {
  current = q;
  locked = false;
  feedbackEl.hidden = true;
  resultEl.textContent = '';
  resultEl.className = 'alert';
  explainTextEl.textContent = '';

  progressEl.textContent = `${progress.index}/${progress.total}`;
  if (progressTextEl) progressTextEl.textContent = `${progress.index}/${progress.total}`;
  if (progressBarEl) progressBarEl.style.width = `${Math.round((progress.index / progress.total) * 100)}%`;
  hitsEl.textContent = `Acertos: ${scoreboard.hits}`;
  missesEl.textContent = `Erros: ${scoreboard.misses}`;
  skipsEl.textContent = `Pulos: ${scoreboard.skips ?? 0}`;

  const where = q.partTitle || q.section || q.chapter;
  qtitleEl.textContent = where || 'Questões';
  const diagram = DIAGRAMS[q.number];
  const mainText = diagram ? q.question.split('\n')[0] : q.question;
  qtextEl.textContent = `${q.number}. ${mainText}`;

  if (diagram) {
    diagramEl.hidden = false;
    diagramEl.innerHTML = `<img src="${diagram.src}" alt="${diagram.alt}" class="img-fluid rounded border" />`;
  } else {
    diagramEl.hidden = true;
    diagramEl.innerHTML = '';
  }

  const yesBtn = btn('Sim', 'btn-success', () => submit(true));
  const noBtn = btn('Não', 'btn-danger', () => submit(false));
  const skipBtn = btnWithIcon({
    label: 'Pular',
    klass: 'btn-warning',
    iconSrc: '/icons/kangaroo.svg',
    iconAlt: 'Canguru',
    onClick: () => skip(),
  });
  const restartBtn = btn('Reiniciar', 'btn-dark', () => restartToHome());
  const backBtn = btnWithIcon({
    label: 'Voltar',
    klass: 'btn-info',
    iconSrc: '/icons/arrow-left.svg',
    iconAlt: 'Voltar',
    onClick: () => back(),
  });
  backBtn.disabled = progress.index <= 1;
  setButtons([backBtn, yesBtn, noBtn, skipBtn, restartBtn]);
}

function renderDone(scoreboard, total) {
  current = null;
  locked = true;
  feedbackEl.hidden = true;

  progressEl.textContent = `${total}/${total}`;
  if (progressTextEl) progressTextEl.textContent = `${total}/${total}`;
  if (progressBarEl) progressBarEl.style.width = '100%';
  hitsEl.textContent = `Acertos: ${scoreboard.hits}`;
  missesEl.textContent = `Erros: ${scoreboard.misses}`;
  skipsEl.textContent = `Pulos: ${scoreboard.skips ?? 0}`;
  qtitleEl.textContent = total === 0 ? 'Sem perguntas' : 'Fim do quiz';
  qtextEl.textContent =
    total === 0
      ? 'Adicione perguntas em data/quiz.json para começar.'
      : `Resultado: ${scoreboard.hits} acertos e ${scoreboard.misses} erros (total ${total}).`;
  diagramEl.hidden = true;
  diagramEl.innerHTML = '';
  stopTimer();

  setButtons([
    btn(total === 0 ? 'Recarregar' : 'Recomeçar', 'btn-primary', () => restart()),
  ]);
}

function renderHome() {
  current = null;
  locked = false;
  feedbackEl.hidden = true;
  resultEl.textContent = '';
  resultEl.className = 'alert';
  explainTextEl.textContent = '';

  progressEl.textContent = '—';
  if (progressTextEl) progressTextEl.textContent = '—';
  if (progressBarEl) progressBarEl.style.width = '0%';
  hitsEl.textContent = 'Acertos: 0';
  missesEl.textContent = 'Erros: 0';
  skipsEl.textContent = 'Pulos: 0';

  qtitleEl.textContent = 'Pronto?';
  qtextEl.textContent = 'Clique em “Começar” para iniciar.';
  diagramEl.hidden = true;
  diagramEl.innerHTML = '';

  stopTimer();
  setButtons([btn('Começar', 'btn-primary px-4', () => start())]);
}

async function start() {
  const random = randomToggleEl ? !!randomToggleEl.checked : true;
  const part = partSelectEl ? partSelectEl.value : 'all';
  const data = await api('/api/start', { method: 'POST', body: JSON.stringify({ random, part }) });
  if (!data.question) return renderDone(data.scoreboard, data.progress.total);
  if (timerToggleEl) {
    timerToggleEl.checked = true;
    writeTimerPrefs({ show: true });
    updateTimerUI();
  }
  startTimer();
  renderQuestion(data.question, data.progress, data.scoreboard);
}

async function restart() {
  const random = randomToggleEl ? !!randomToggleEl.checked : true;
  const part = partSelectEl ? partSelectEl.value : 'all';
  const data = await api('/api/restart', { method: 'POST', body: JSON.stringify({ random, part }) });
  if (!data.question) return renderDone(data.scoreboard, data.progress.total);
  if (timerToggleEl) {
    timerToggleEl.checked = true;
    writeTimerPrefs({ show: true });
    updateTimerUI();
  }
  startTimer();
  renderQuestion(data.question, data.progress, data.scoreboard);
}

async function submit(answer) {
  if (!current || locked) return;
  locked = true;

  const data = await api('/api/answer', {
    method: 'POST',
    body: JSON.stringify({ id: current.id, answer }),
  });

  feedbackEl.hidden = false;
  resultEl.textContent = data.correct ? 'Correto.' : `Incorreto. Resposta certa: ${data.correctAnswer ? 'Sim' : 'Não'}.`;
  resultEl.className = data.correct ? 'alert alert-success' : 'alert alert-danger';
  explainTextEl.textContent = data.explanation || '—';

  if (data.done) {
    setButtons([
      btn('Ver resultado', 'btn-primary', () => renderDone(data.scoreboard, data.progress.total)),
    ]);
    return;
  }

  setButtons([
    btn('Próxima', 'btn-primary', () => renderQuestion(data.nextQuestion, data.progress, data.scoreboard)),
  ]);
}

async function skip() {
  if (!current || locked) return;
  locked = true;

  const data = await api('/api/skip', {
    method: 'POST',
    body: JSON.stringify({ id: current.id }),
  });

  if (data.done) return renderDone(data.scoreboard, data.progress.total);
  return renderQuestion(data.nextQuestion, data.progress, data.scoreboard);
}

async function back() {
  if (locked) return;
  locked = true;

  let data;
  try {
    data = await api('/api/back', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (e) {
    locked = false;
    alert(e.message);
    return;
  }

  if (!data.question) return renderDone(data.scoreboard, data.progress.total);
  return renderQuestion(data.question, data.progress, data.scoreboard);
}

async function restartToHome() {
  if (locked) return;
  locked = true;

  const random = randomToggleEl ? !!randomToggleEl.checked : true;
  const part = partSelectEl ? partSelectEl.value : 'all';
  try {
    await api('/api/restart', { method: 'POST', body: JSON.stringify({ random, part }) });
  } catch (e) {
    locked = false;
    alert(e.message);
    return;
  }

  renderHome();
}

async function loadMeta() {
  try {
    const res = await fetch('/api/meta');
    const data = await res.json();
    if (!data.ok) return;
    metaEl.textContent = `${data.count} questões`;
  } catch {
    // ignore
  }
}

el('startBtn').addEventListener('click', () => start().catch((e) => alert(e.message)));
loadMeta();

// Timer prefs + UI
(() => {
  if (!timerToggleEl) return;
  const prefs = readTimerPrefs();
  timerToggleEl.checked = prefs.show;
  updateTimerUI();
  timerToggleEl.addEventListener('change', () => {
    writeTimerPrefs({ show: !!timerToggleEl.checked });
    updateTimerUI();
  });
})();

// Garante que a tela inicial exista mesmo se os botões forem recriados
if (actionsEl && actionsEl.children.length === 0) renderHome();
