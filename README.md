# Quiz de Estrutura de Dados

O quiz lê as perguntas de `data/quiz.json`.

## Rodar

```bash
npm install
npm start
```

Abra:

- http://localhost:3050

## Regerar o JSON do quiz

```bash
PERGUNTAS_PDF="/caminho/perguntas.pdf" GABARITO_PDF="/caminho/gabarito.pdf" npm run build:quiz
```

Saída:

- `data/quiz.json`

## Quiz de complexidade de código

Gera os exercícios a partir de `Codigos.pdf`:

```bash
CODIGOS_PDF="/caminho/Codigos.pdf" npm run build:code
```

Saída:

- `data/code_quiz.json`

## Formato das perguntas

`data/quiz.json` deve ter:

- `quiz`: array de itens com `id`, `question`, `answer` (boolean) e opcionalmente `explanation`, `parte`, `chapter`, `section`, `number`.

## Deploy na Vercel

- A Vercel usa `api/index.js` como Serverless Function e roteia tudo para ela via `vercel.json`.
- Commite `data/quiz.json`.
- O Bootstrap é servido localmente em `public/vendor/bootstrap/` (sem CDN).
