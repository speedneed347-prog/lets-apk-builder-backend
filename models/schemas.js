/**
 * Shape of builds/{buildId} document in Firestore.
 * Provided as JSDoc for reference. No runtime validation here (see validationService).
 */
module.exports = {
  BuildStatus: Object.freeze({
    QUEUED: "queued",
    BUILDING: "building",
    SIGNING: "signing",
    UPLOADING: "uploading",
    COMPLETED: "completed",
    FAILED: "failed",
  }),
};
