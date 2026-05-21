const el = (id) => document.getElementById(id);

const metaEl = el('meta');
const progressEl = el('progress');
const hitsEl = el('hits');
const missesEl = el('misses');
const skipsEl = el('skips');
const qtitleEl = el('qtitle');
const qtextEl = el('qtext');
const codeBoxEl = el('codeBox');
const choicesEl = el('choices');
const actionsEl = el('actions');
const feedbackEl = el('feedback');
const resultEl = el('result');
const explainTextEl = el('explainText');
const progressBarEl = el('progressBar');
const progressTextEl = el('progressText');
const randomToggleEl = el('randomToggle');
const complexityOrderToggleEl = el('complexityOrderToggle');
const timerToggleEl = el('timerToggle');
const timerBadgeEl = el('timerBadge');

let current = null;
let locked = false;
let options = [];
let consecutiveErrors = 0;

let timerInterval = null;
let timerStartedAt = null;

function triggerToasty() {
  const toastyEl = document.getElementById('toasty');
  const audio = document.getElementById('toasty-audio');
  if (!toastyEl) return;
  toastyEl.classList.remove('show');
  void toastyEl.offsetWidth;
  toastyEl.classList.add('show');
  if (audio) { audio.currentTime = 0; audio.play().catch(() => { }); }
  toastyEl.addEventListener('animationend', () => toastyEl.classList.remove('show'), { once: true });
}

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
  const show = localStorage.getItem('quiz_timer_show_code');
  return { show: show === '1' };
}

function writeTimerPrefs({ show }) {
  localStorage.setItem('quiz_timer_show_code', show ? '1' : '0');
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

function setDisabledWithFade(elm, disabled) {
  if (!elm) return;
  elm.disabled = !!disabled;
  const wrap = elm.closest('.form-check');
  if (wrap) wrap.classList.toggle('opacity-50', !!disabled);
}

function applyOrderingUIRules() {
  const complexityMode = !!(complexityOrderToggleEl && complexityOrderToggleEl.checked);
  if (complexityMode) {
    if (randomToggleEl) randomToggleEl.checked = false;
    setDisabledWithFade(randomToggleEl, true);
    setDisabledWithFade(timerToggleEl, true);
    if (timerToggleEl) timerToggleEl.checked = false;
    updateTimerUI();
  } else {
    setDisabledWithFade(randomToggleEl, false);
    setDisabledWithFade(timerToggleEl, false);
  }
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
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function btnWithIcon({ label, klass, iconSrc, onClick }) {
  const b = document.createElement('button');
  b.className = `btn ${klass || ''}`.trim();
  b.type = 'button';
  b.innerHTML = `<img src="${iconSrc}" alt="" class="me-2" style="width:18px;height:18px;vertical-align:-3px" />${label}`;
  b.addEventListener('click', onClick);
  return b;
}

function renderChoices() {
  choicesEl.hidden = false;
  choicesEl.innerHTML = '';
  const group = document.createElement('div');
  group.className = 'd-flex flex-wrap gap-3';
  const onlyCorrect = current && typeof current.correctChoiceKey === 'string' ? current.correctChoiceKey : null;

  for (const opt of options) {
    const id = `opt_${opt.key.replace(/[^a-z0-9]+/gi, '_')}`;
    const wrap = document.createElement('div');
    wrap.className = 'form-check form-check-inline';
    wrap.innerHTML = `
      <input class="form-check-input" type="radio" name="complexity" id="${id}" value="${opt.key}">
      <label class="form-check-label" for="${id}">${opt.label}</label>
    `;
    if (onlyCorrect && opt.key !== onlyCorrect) {
      const input = wrap.querySelector('input');
      if (input) input.disabled = true;
      wrap.classList.add('opacity-50');
    }
    if (onlyCorrect && opt.key === onlyCorrect) {
      wrap.classList.add('fw-semibold');
    }
    group.appendChild(wrap);
  }

  choicesEl.appendChild(group);
}

function getSelectedChoice() {
  const checked = document.querySelector('input[name="complexity"]:checked');
  return checked ? checked.value : null;
}

function renderQuestion(q, progress, scoreboard) {
  current = q;
  locked = false;
  feedbackEl.hidden = true;
  resultEl.textContent = '';
  resultEl.className = 'alert';
  explainTextEl.textContent = '';

  progressEl.textContent = `${progress.index}/${progress.total}`;
  progressTextEl.textContent = `${progress.index}/${progress.total}`;
  progressBarEl.style.width = `${Math.round((progress.index / progress.total) * 100)}%`;
  hitsEl.textContent = `Acertos: ${scoreboard.hits}`;
  missesEl.textContent = `Erros: ${scoreboard.misses}`;
  skipsEl.textContent = `Pulos: ${scoreboard.skips ?? 0}`;

  qtitleEl.textContent = `Exercício ${q.number} — ${q.title}`;
  qtextEl.textContent = q.statement ? q.statement : 'Analise o código e marque a complexidade.';

  if (q.code) {
    codeBoxEl.hidden = false;
    codeBoxEl.textContent = q.code;
  } else {
    codeBoxEl.hidden = true;
    codeBoxEl.textContent = '';
  }

  renderChoices();

  const backBtn = btnWithIcon({ label: 'Voltar', klass: 'btn-info', iconSrc: '/icons/arrow-left.svg', onClick: () => back() });
  backBtn.innerHTML += ' <kbd class="kbd-hint">←</kbd>';
  backBtn.disabled = progress.index <= 1;
  const skipBtn = btnWithIcon({ label: 'Pular', klass: 'btn-warning', iconSrc: '/icons/kangaroo.svg', onClick: () => skip() });
  skipBtn.innerHTML += ' <kbd class="kbd-hint">P</kbd>';
  const restartBtn = btn('Reiniciar', 'btn-dark', () => restartToHome());
  restartBtn.innerHTML += ' <kbd class="kbd-hint">R</kbd>';
  const answerBtn = btn('Responder', 'btn-primary', () => submit());
  answerBtn.innerHTML += ' <kbd class="kbd-hint">Enter</kbd>';

  setButtons([backBtn, answerBtn, skipBtn, restartBtn]);
}

function renderHome() {
  current = null;
  locked = false;
  feedbackEl.hidden = true;
  resultEl.textContent = '';
  resultEl.className = 'alert';
  explainTextEl.textContent = '';

  progressEl.textContent = '—';
  progressTextEl.textContent = '—';
  progressBarEl.style.width = '0%';
  hitsEl.textContent = 'Acertos: 0';
  missesEl.textContent = 'Erros: 0';
  skipsEl.textContent = 'Pulos: 0';

  qtitleEl.textContent = 'Pronto?';
  qtextEl.textContent = 'Clique em “Começar” para iniciar.';
  codeBoxEl.hidden = true;
  codeBoxEl.textContent = '';
  choicesEl.hidden = true;
  choicesEl.innerHTML = '';

  stopTimer();
  setButtons([btn('Começar', 'btn-primary px-4', () => start().catch((e) => alert(e.message)))]);
}

function renderDone(scoreboard, total) {
  current = null;
  locked = true;
  feedbackEl.hidden = true;

  progressEl.textContent = `${total}/${total}`;
  progressTextEl.textContent = `${total}/${total}`;
  progressBarEl.style.width = '100%';
  hitsEl.textContent = `Acertos: ${scoreboard.hits}`;
  missesEl.textContent = `Erros: ${scoreboard.misses}`;
  skipsEl.textContent = `Pulos: ${scoreboard.skips ?? 0}`;

  qtitleEl.textContent = total === 0 ? 'Sem exercícios' : 'Fim do quiz';
  qtextEl.textContent =
    total === 0 ? 'Sem exercícios de código.' : `Resultado: ${scoreboard.hits} acertos, ${scoreboard.misses} erros, ${scoreboard.skips ?? 0} pulos (total ${total}).`;

  codeBoxEl.hidden = true;
  choicesEl.hidden = true;
  stopTimer();

  setButtons([btn('Voltar ao início', 'btn-primary', () => renderHome())]);
}

async function start() {
  applyOrderingUIRules();
  const mode = complexityOrderToggleEl && complexityOrderToggleEl.checked ? 'complexity' : 'normal';
  const random = randomToggleEl ? !!randomToggleEl.checked : true;
  const data = await api('/api/code/start', { method: 'POST', body: JSON.stringify({ random, mode }) });
  options = data.options || options;
  if (timerToggleEl && !timerToggleEl.disabled) {
    timerToggleEl.checked = true;
    writeTimerPrefs({ show: true });
    updateTimerUI();
  }
  startTimer();
  if (!data.question) return renderDone(data.scoreboard, data.progress.total);
  return renderQuestion(data.question, data.progress, data.scoreboard);
}

async function submit() {
  if (!current || locked) return;
  const choiceKey = getSelectedChoice();
  if (!choiceKey) {
    alert('Selecione uma opção de complexidade.');
    return;
  }
  locked = true;

  let data;
  try {
    data = await api('/api/code/answer', {
      method: 'POST',
      body: JSON.stringify({ id: current.id, choiceKey }),
    });
  } catch (e) {
    locked = false;
    alert(e.message);
    return;
  }

  feedbackEl.hidden = false;
  resultEl.textContent = data.correct ? 'Correto.' : `Incorreto. Resposta certa: ${data.correctAnswer.label}.`;
  resultEl.className = data.correct ? 'alert alert-success' : 'alert alert-danger';
  explainTextEl.textContent = data.explanation || '—';

  if (data.correct) {
    consecutiveErrors = 0;
  } else {
    consecutiveErrors += 1;
    if (consecutiveErrors >= 5) {
      consecutiveErrors = 0;
      triggerToasty();
    }
  }

  if (data.done) {
    setButtons([btn('Ver resultado', 'btn-primary', () => renderDone(data.scoreboard, data.progress.total))]);
    return;
  }

  setButtons([btn('Próxima', 'btn-primary', () => renderQuestion(data.nextQuestion, data.progress, data.scoreboard))]);
}

async function skip() {
  if (!current || locked) return;
  locked = true;
  let data;
  try {
    data = await api('/api/code/skip', { method: 'POST', body: JSON.stringify({ id: current.id }) });
  } catch (e) {
    locked = false;
    alert(e.message);
    return;
  }
  if (data.done) return renderDone(data.scoreboard, data.progress.total);
  return renderQuestion(data.nextQuestion, data.progress, data.scoreboard);
}

async function back() {
  if (locked) return;
  locked = true;
  try {
    const data = await api('/api/code/back', { method: 'POST', body: JSON.stringify({}) });
    if (!data.question) return renderDone(data.scoreboard, data.progress.total);
    return renderQuestion(data.question, data.progress, data.scoreboard);
  } catch (e) {
    locked = false;
    alert(e.message);
  }
}

async function restartToHome() {
  if (locked) return;
  locked = true;
  applyOrderingUIRules();
  const mode = complexityOrderToggleEl && complexityOrderToggleEl.checked ? 'complexity' : 'normal';
  const random = randomToggleEl ? !!randomToggleEl.checked : true;
  try {
    await api('/api/code/restart', { method: 'POST', body: JSON.stringify({ random, mode }) });
  } catch (e) {
    locked = false;
    alert(e.message);
    return;
  }
  renderHome();
}

async function loadMeta() {
  try {
    const data = await api('/api/code/meta');
    options = data.options || [];
    metaEl.textContent = `${data.count} exercícios`;
  } catch {
    // ignore
  }
}

loadMeta();

// Atalhos de teclado
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!current || locked) return;
  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      submit();
      break;
    case 'p': case 'P':
      e.preventDefault();
      skip();
      break;
    case 'ArrowLeft': {
      const backBtn = actionsEl.querySelector('button.btn-info');
      if (backBtn && !backBtn.disabled) { e.preventDefault(); back(); }
      break;
    }
    case 'r': case 'R':
      e.preventDefault();
      restartToHome();
      break;
  }
});

// Timer prefs
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

if (complexityOrderToggleEl) {
  complexityOrderToggleEl.addEventListener('change', () => {
    applyOrderingUIRules();
  });
}

applyOrderingUIRules();
renderHome();
