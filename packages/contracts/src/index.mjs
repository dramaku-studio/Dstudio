export const NODE_TYPES = Object.freeze(['STORY_PARSE','DNA_LOCK','SHOT_PLAN','IMAGE_GENERATE','I2V_COMPILE','VIDEO_GENERATE','QA_EVALUATE','TAKE_SELECT','EXPORT_PACKAGE']);
export const RUN_STATES = Object.freeze(['draft','awaiting_approval','scheduled','running','paused','awaiting_review','completed','failed','canceled']);
export const ERROR_CODES = Object.freeze(['DAG_INVALID','PLAN_STALE','APPROVAL_REQUIRED','RUN_BUDGET_EXCEEDED','SHOT_RETRY_LIMIT','QUALITY_GATE_BLOCKED','UPSTREAM_ASSET_STALE','CAPABILITY_UNVERIFIED','RUN_PAUSED','EXPORT_NOT_APPROVED']);
export const OPERATION_MODES = Object.freeze(['assisted','supervised_batch','bounded_autonomous']);
