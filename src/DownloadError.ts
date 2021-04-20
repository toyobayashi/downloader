/** @public */
export enum DownloadErrorCode {
  OK = 0,
  UNKNOWN = 1,
  TIMEOUT = 2,
  RES_NOT_FOUND = 3,
  NETWORK = 6,
  FILE_EXISTS = 13,
  RENAME_FAILED = 14,
  CREATE_FILE_FAILED = 16,
  FILE_IO = 17,
  MKDIR_FAILED = 18,
  MAX_REDIRECTS = 23,
  AUTH_FAILED = 24,
  CUSTOM = 31
}

/** @public */
export function getErrorMessage (code: DownloadErrorCode): string {
  switch (code) {
    case DownloadErrorCode.OK: return ''
    case DownloadErrorCode.UNKNOWN: return 'Unknown error occurred'
    case DownloadErrorCode.TIMEOUT: return 'Timeout occurred'
    case DownloadErrorCode.RES_NOT_FOUND: return 'Resource was not found'
    case DownloadErrorCode.NETWORK: return 'Network problem occurred'
    case DownloadErrorCode.FILE_EXISTS: return 'File already existed'
    case DownloadErrorCode.RENAME_FAILED: return 'Renaming file failed'
    case DownloadErrorCode.CREATE_FILE_FAILED: return 'Can not create new file'
    case DownloadErrorCode.FILE_IO: return 'File I/O error occurred'
    case DownloadErrorCode.MKDIR_FAILED: return 'Can not create directory'
    case DownloadErrorCode.MAX_REDIRECTS: return 'Too many redirects occurred'
    case DownloadErrorCode.AUTH_FAILED: return 'Authorization failed'
    default: return 'Unknown error'
  }
}

/** @public */
export class DownloadError extends Error {
  private readonly _code: DownloadErrorCode

  public constructor (code: DownloadErrorCode, message?: string) {
    super(message ?? getErrorMessage(code))
    this._code = code
  }

  public get code (): DownloadErrorCode {
    return this._code
  }

  public getErrorMessage (): string {
    return getErrorMessage(this._code)
  }
}
