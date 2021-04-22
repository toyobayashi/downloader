/**
 * A downloader in Node.js
 *
 * @packageDocumentation
 */

export { DownloadErrorCode, getErrorMessage, DownloadError } from './DownloadError'

export type { IDownload } from './Download'
export { DownloadStatus, DownloadOverwrite } from './Download'

export type {
  IDownloadOptions,
  IDownloaderOptions,
  IDownloadProgress
} from './Downloader'

export {
  Downloader
} from './Downloader'
