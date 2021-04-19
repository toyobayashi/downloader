import { ObjectId } from '@tybys/oid'
import { join } from 'path'
import type { Agent as HttpAgent, ClientRequest } from 'http'
import type { Agent as HttpsAgent } from 'https'

/** @public */
export interface IFile {
  path: string
  length: number
  completedLength: number
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
  errorCode: number
  errorMessage: string
  dir: string
  file: IFile
  url: string
  req: ClientRequest | null
  headers: Record<string, string>
  agent: {
    http?: HttpAgent
    https?: HttpsAgent
    http2?: unknown
  } | false
  remove: null | (() => void)
}

export class Download implements IDownload {
  public gid = new ObjectId().toHexString()
  public status: DownloadStatus
  public totalLength = 0
  public completedLength = 0
  public downloadSpeed = 0
  public errorCode = 0
  public errorMessage = ''
  public dir: string
  public file: IFile
  public url: string
  public req: ClientRequest | null = null
  public headers!: Record<string, string>
  public agent: {
    http?: HttpAgent
    https?: HttpsAgent
    http2?: unknown
  } | false = false

  public remove: null | (() => void) = null

  public constructor (url: string, dir: string, out: string, status: DownloadStatus) {
    this.dir = dir
    this.status = status
    this.url = url
    this.file = {
      path: join(dir, out),
      length: 0,
      completedLength: 0
    }
  }
}
