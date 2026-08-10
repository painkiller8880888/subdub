export const VOICEVOX_ERROR_CODE = {
  httpFailed: "VOICEVOX_HTTP_FAILED",
  connectionFailed: "VOICEVOX_CONNECTION_FAILED",
  timeout: "VOICEVOX_TIMEOUT",
  responseInvalidJson: "VOICEVOX_RESPONSE_INVALID_JSON",
  responseInvalid: "VOICEVOX_RESPONSE_INVALID",
  speakerNotFound: "VOICEVOX_SPEAKER_NOT_FOUND",
  speakerAmbiguous: "VOICEVOX_SPEAKER_AMBIGUOUS",
  styleNotFound: "VOICEVOX_STYLE_NOT_FOUND",
  styleAmbiguous: "VOICEVOX_STYLE_AMBIGUOUS"
} as const;

export type VoicevoxErrorCode =
  (typeof VOICEVOX_ERROR_CODE)[keyof typeof VOICEVOX_ERROR_CODE];

export type VoicevoxAdapterErrorCode =
  | typeof VOICEVOX_ERROR_CODE.httpFailed
  | typeof VOICEVOX_ERROR_CODE.connectionFailed
  | typeof VOICEVOX_ERROR_CODE.timeout
  | typeof VOICEVOX_ERROR_CODE.responseInvalidJson
  | typeof VOICEVOX_ERROR_CODE.responseInvalid;

export type VoicevoxResolutionErrorCode =
  | typeof VOICEVOX_ERROR_CODE.speakerNotFound
  | typeof VOICEVOX_ERROR_CODE.speakerAmbiguous
  | typeof VOICEVOX_ERROR_CODE.styleNotFound
  | typeof VOICEVOX_ERROR_CODE.styleAmbiguous;

export type VoicevoxAdapterErrorOptions = {
  readonly upstreamStatus?: number;
};

export class VoicevoxAdapterError extends Error {
  readonly code: VoicevoxAdapterErrorCode;
  readonly upstreamStatus: number | undefined;

  constructor(
    code: VoicevoxAdapterErrorCode,
    options: VoicevoxAdapterErrorOptions = {}
  ) {
    super(code);
    this.name = "VoicevoxAdapterError";
    this.code = code;
    this.upstreamStatus = options.upstreamStatus;
  }
}

export class VoicevoxResolutionError extends Error {
  readonly code: VoicevoxResolutionErrorCode;

  constructor(code: VoicevoxResolutionErrorCode) {
    super(code);
    this.name = "VoicevoxResolutionError";
    this.code = code;
  }
}

export type VoicevoxFailureCode =
  VoicevoxAdapterErrorCode | VoicevoxResolutionErrorCode;
