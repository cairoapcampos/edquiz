let cachedApp;

module.exports = async (req, res) => {
  if (!cachedApp) {
    const mod = await import('../app.mjs');
    cachedApp = mod.createApp();
  }
  return cachedApp(req, res);
};

