import { ObjectId } from '@tybys/oid'
import type { Agent as HttpAgent, ClientRequest } from 'http'
import type { Agent as HttpsAgent } from 'https'
import type { DownloadError } from './DownloadError'

/** @public */
export enum DownloadOverwrite {
  NO,
  YES,
  RENAME
}

/** @public */
export enum DownloadStatus {
  ACTIVE,
  WAITING,
  PAUSED,
  ERROR,
  COMPLETE,
  REMOVED
}

/** @public */
export interface IDownload {
  gid: string
  status: DownloadStatus
  totalLength: number
  completedLength: number
  downloadSpeed: number
  error: DownloadError | null
  path: string
  url: string
  // dir: string
  // req: ClientRequest | null
  // headers: Record<string, string>
  // agent: {
  //   http?: HttpAgent
  //   https?: HttpsAgent
  //   http2?: unknown
  // } | false
  // remove: null | (() => void)
}

export class Download implements IDownload {
  public gid = new ObjectId().toHexString()
  public status: DownloadStatus
  public totalLength = 0
  public completedLength = 0
  public downloadSpeed = 0
  public error: DownloadError | null = null
  public dir: string
  public path!: string
  public url: string
  public req: ClientRequest | null = null
  public headers!: Record<string, string>
  public overwrite: DownloadOverwrite = DownloadOverwrite.NO
  public agent: {
    http?: HttpAgent
    https?: HttpsAgent
    http2?: unknown
  } | false = false

  public remove: null | (() => void) = null

  public constructor (url: string, dir: string, status: DownloadStatus) {
    this.dir = dir
    this.status = status
    this.url = url
  }
}
