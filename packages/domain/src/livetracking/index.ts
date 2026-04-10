/**
 * livetracking
 * ------------
 * Public sub-entry for LiveTracking domain model, ids and schema helpers.
 */

export {
  LIVE_TRACKING_DOC_PREFIX,
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingSetupDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingResultsDocId,
  parseLiveTrackingDocId,
  type LiveTrackingDocKind,
  type LiveTrackingDocRef,
} from "./ids.js";

export {
  createLiveTrackingParticipantPoolDocument,
  isLiveTrackingAthlete,
  isLiveTrackingParticipantPoolDocument,
  type LiveTrackingAthlete,
  type LiveTrackingParticipantPoolDocument,
} from "./participantPool.js";

export {
  createLiveTrackingSetupDocument,
  normalizeTimingPoints,
  validateLiveTrackingTrack,
  isLiveTrackingTimingPoint,
  isLiveTrackingTrack,
  isLiveTrackingSetupDocument,
  type LiveTrackingTimingPointRole,
  type LiveTrackingTimingPoint,
  type LiveTrackingTrack,
  type LiveTrackingSetupDocument,
  type LiveTrackingSetupValidationIssue,
} from "./setup.js";

export {
  createLiveTrackingSessionDocument,
  canTransitionLiveTrackingSessionState,
  getLiveTrackingCommandTargetState,
  canIssueLiveTrackingCommand,
  createLiveTrackingCommand,
  enqueueLiveTrackingCommand,
  getRunningLiveTrackingCommand,
  getNextQueuedLiveTrackingCommand,
  startLiveTrackingCommand,
  transitionLiveTrackingSessionState,
  completeLiveTrackingCommand,
  failLiveTrackingCommand,
  rejectLiveTrackingCommand,
  isLiveTrackingSessionState,
  isLiveTrackingCommandIntent,
  isLiveTrackingCommandStatus,
  isLiveTrackingParticipantSource,
  isLiveTrackingCommand,
  isLiveTrackingSessionDocument,
  type LiveTrackingMode,
  type LiveTrackingSessionState,
  type LiveTrackingCommandIntent,
  type LiveTrackingCommandStatus,
  type LiveTrackingCommandTargetState,
  type LiveTrackingParticipantSource,
  type LiveTrackingCommand,
  type LiveTrackingSessionDocument,
} from "./session.js";

export {
  createLiveTrackingRuntimeDocument,
  isLiveTrackingRuntimeDecoderState,
  isLiveTrackingRuntimePassingEvent,
  isLiveTrackingRuntimeRawPayload,
  isLiveTrackingRuntimeDocument,
  type LiveTrackingWorkerStatus,
  type LiveTrackingRuntimeDecoderState,
  type LiveTrackingRuntimePassingEvent,
  type LiveTrackingRuntimeRawPayload,
  type LiveTrackingRuntimeDocument,
} from "./runtime.js";

export {
  createLiveTrackingResultsDocument,
  isLiveTrackingPassingEvent,
  isLiveTrackingAthleteLiveState,
  isLiveTrackingResultsDocument,
  type LiveTrackingPassingEvent,
  type LiveTrackingCurrentSplit,
  type LiveTrackingCompletedLap,
  type LiveTrackingActivityStatus,
  type LiveTrackingAthleteLiveState,
  type LiveTrackingQualifyingEntry,
  type LiveTrackingInvalidEvent,
  type LiveTrackingResultsDocument,
} from "./results.js";

export {
  DEFAULT_LIVE_TRACKING_TIMING_ENGINE_OPTIONS,
  buildLiveTrackingResultsProjection,
  type LiveTrackingTimingEngineOptions,
} from "./timingEngine.js";

export {
  createInitialLiveTrackingDocument,
  isLiveTrackingDocument,
  type LiveTrackingDocument,
} from "./documents.js";
