const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? 2;

function ts() { return new Date().toISOString(); }

function log(level, ...args) {
  if (LEVELS[level] <= currentLevel) {
    console[level === "debug" ? "log" : level](`[${ts()}] [${level.toUpperCase()}]`, ...args);
  }
}

module.exports = {
  error: (...a) => log("error", ...a),
  warn: (...a) => log("warn", ...a),
  info: (...a) => log("info", ...a),
  debug: (...a) => log("debug", ...a),
};
