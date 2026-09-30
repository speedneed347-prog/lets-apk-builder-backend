function sanitizeBuild(build) {
  if (!build) return null;
  const { config, ...safe } = build;
  return {
    ...safe,
    config: config ? { ...config, iconBase64: undefined } : null,
  };
}

function formatEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

module.exports = { sanitizeBuild, formatEvent };
