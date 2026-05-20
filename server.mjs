import { createApp } from './app.mjs';

const PORT = Number(process.env.PORT || 3050);
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Quiz web rodando em http://localhost:${PORT}`);
});
