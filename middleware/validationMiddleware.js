const { validateConfig, ValidationError } = require("../services/validationService");

function validateBuildBody(req, _res, next) {
  try {
    req.validatedConfig = validateConfig(req.body);
    next();
  } catch (err) {
    next(err instanceof ValidationError ? err : new ValidationError(err.message));
  }
}

module.exports = { validateBuildBody };
