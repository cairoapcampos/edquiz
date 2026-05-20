import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const codeQuizPath = path.join(__dirname, '..', 'data', 'code_quiz.json');
const data = JSON.parse(await fs.readFile(codeQuizPath, 'utf8'));

function normCode(code) {
  return String(code || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ');
}

function countMatches(re, s) {
  const m = s.match(re);
  return m ? m.length : 0;
}

function inferComplexityFromPython(codeRaw) {
  const code = normCode(codeRaw);
  const lines = code.split('\n');

  // Very lightweight heuristic:
  // - detect exponential: two recursive calls in same function to itself (common subset/knapsack), or explicit 2^n generation
  // - detect n^k: recursion with branching over n for k depth (permutation combinations) -> approximate
  // - detect nested loops depth
  // - detect log loops: i*=2 or n//=2 in while
  // - detect m*n: nested loops over different variables (rough)

  const hasRecursion = /\bdef\s+(\w+)\s*\(/.test(code) && /return\s+\1|\b\1\s*\(/.test(code);

  // try to find function name for recursion checks
  let fnName = null;
  for (const l of lines) {
    const m = l.trim().match(/^def\s+([A-Za-z_]\w*)\s*\(/);
    if (m) {
      fnName = m[1];
      break;
    }
  }

  if (fnName) {
    // Count direct self-calls
    const calls = countMatches(new RegExp(`\\b${fnName}\\s*\\(`, 'g'), code);
    // If there are at least 2 self-calls, and no for-loop controlling it, likely exponential
    if (calls >= 2) {
      // Distinguish 2^n vs n^k: if there's a for loop iterating over a set and recursing, often n^k
      const forRecurse = new RegExp(`for\\s+\\w+\\s+in\\s+[^:]+:\\s*\\n(?:[ \\t]+.*\\n)*[ \\t]+${fnName}\\s*\\(`, 'm');
      if (forRecurse.test(code)) return 'O(n^k)';
      return 'O(2^n)';
    }
  }

  // log patterns
  const logWhile = /while\s+.*:\s*(?:\n[ \t]+.*)*(?:\n[ \t]+.*(\/\/=\s*2|\*=\s*2))/m.test(code) || /(n\s*\/\/=\s*2|i\s*\*=\s*2)/.test(code);
  if (logWhile && /while\b/.test(code)) return 'O(log n)';

  // nested loops (count indentation-based blocks roughly)
  const loopLines = lines.map((l) => l.replace(/\s+$/g, ''));
  const loopStack = [];
  let maxDepth = 0;

  for (const l of loopLines) {
    const indent = (l.match(/^(\s*)/)?.[1]?.length) ?? 0;
    while (loopStack.length && indent <= loopStack[loopStack.length - 1].indent) loopStack.pop();
    const t = l.trim();
    const isLoop = /^for\s+.+\s+in\s+.+:/.test(t) || /^while\s+.+:/.test(t);
    if (isLoop) {
      loopStack.push({ indent });
      maxDepth = Math.max(maxDepth, loopStack.length);
    }
  }

  // m*n heuristic: two loops but over different bounds hints m*n
  const hasMN = maxDepth >= 2 && /\bfor\s+\w+\s+in\s+range\(\s*m\s*\)/.test(code) && /\bfor\s+\w+\s+in\s+range\(\s*n\s*\)/.test(code);
  if (hasMN) return 'O(m*n)';

  if (maxDepth >= 3) return 'O(n^3)';
  if (maxDepth === 2) return 'O(n^2)';
  if (maxDepth === 1) return 'O(n)';

  // if no loops/recursion, assume O(1)
  return 'O(1)';
}

/** @type {{n:number, declared:string, inferred:string, title:string}[]} */
const mismatches = [];

for (const q of data.quiz) {
  const inferred = inferComplexityFromPython(q.code);
  if (inferred !== q.answerKey) {
    mismatches.push({ n: q.number, declared: q.answerKey, inferred, title: q.title });
  }
}

console.log(JSON.stringify({ total: data.count, mismatches: mismatches.length, items: mismatches.slice(0, 50) }, null, 2));

