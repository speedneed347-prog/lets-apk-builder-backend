require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");

const { initFirebase } = require("./firebase/firestore");
const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const logger = require("./utils/logger");
const { startQueuePump, stopQueuePump } = require("./services/buildQueueService");
const { requestId } = require("./middleware/requestIdMiddleware");
const { requestTimeout } = require("./middleware/timeoutMiddleware");
const { validateRuntimeConfig } = require("./config/production");

const app = express();

// Trust proxy (Render)
app.set("trust proxy", 1);

// Security
app.use(requestId);
app.use(helmet({ crossOriginResourcePolicy: false, hsts: process.env.NODE_ENV === "production" }));
app.disable("x-powered-by");
app.use(requestTimeout(Number(process.env.REQUEST_TIMEOUT_MS || 30000)));

// CORS
const allowed = (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes("*") || allowed.includes(origin)) return cb(null, true);
    cb(Object.assign(new Error(`CORS blocked: ${origin}`), { status: 403 }));
  },
  credentials: true,
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// JSON body — larger limit for build POST (icon base64 + optional offline ZIP base64)
app.use("/api", express.json({
  limit: process.env.BODY_LIMIT || "10mb",
  strict: true,
  parameterLimit: 100,
  verify: (req, _res, buf) => {
    if (req.originalUrl.startsWith("/api/webhook/")) req.rawBody = Buffer.from(buf);
  },
}));

// Runtime configuration + Firebase
const runtimeConfig = validateRuntimeConfig();
if (!runtimeConfig.ok) {
  const message = `Missing/invalid production configuration: ${runtimeConfig.errors.join(", ")}`;
  if (process.env.NODE_ENV === "production") {
    logger.error(message);
    throw new Error(message);
  } else {
    logger.warn(message);
  }
}
initFirebase();

// Routes
app.use("/api", routes);

// Root
app.get("/", (_req, res) => res.json({ name: "Let-S APK Builder API", status: "ok" }));

// Errors
app.use(notFound);
app.use(errorHandler);

// Listen
const port = Number(process.env.PORT || 10000);
const server = app.listen(port, async () => {
  server.requestTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 120000);
  server.headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 65000);
  server.keepAliveTimeout = Number(process.env.SERVER_KEEPALIVE_TIMEOUT_MS || 65000);
  logger.info(`Listening on :${port}`);
  try {
    await startQueuePump();
    logger.info("Build queue pump started");
  } catch (err) {
    logger.error("Build queue startup failed", err.message);
  }
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`${signal} received, closing server...`);
  stopQueuePump();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
