module.exports = async (req, res) => {
  const { default: app } = await import('../app.mjs');
  return app(req, res);
};

