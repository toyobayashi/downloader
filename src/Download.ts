/* eslint-disable @typescript-eslint/method-signature-style */

import { ObjectId } from '@tybys/oid'
import { EventEmitter } from 'events'
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
  INIT,
  ACTIVE,
  WAITING,
  PAUSED,
  ERROR,
  COMPLETE,
  REMOVED
}

/** @public */
export type DownloadEvent = 'complete' | 'fail' | 'pause' | 'unpause' | 'remove' | 'done'

/** @public */
export interface IDownload extends EventEmitter {
  readonly gid: string
  readonly status: DownloadStatus
  readonly totalLength: number
  readonly completedLength: number
  readonly downloadSpeed: number
  readonly error: DownloadError | null
  readonly path: string
  readonly url: string

  on (event: 'progress', listener: (downloadProgress: IDownloadProgress) => void): this
  on (event: DownloadEvent, listener: () => void): this
  on (event: string, listener: () => void): this

  once (event: 'progress', listener: (downloadProgress: IDownloadProgress) => void): this
  once (event: DownloadEvent, listener: () => void): this
  once (event: string, listener: (...args: any[]) => void): this

  off (event: 'progress', listener: (downloadProgress: IDownloadProgress) => void): this
  off (event: DownloadEvent, listener: () => void): this
  off (event: string, listener: (...args: any[]) => void): this

  whenStopped (): Promise<void>
}

/** @public */
export interface IDownloadProgress {
  gid: string
  totalLength: number
  completedLength: number
  downloadSpeed: number
  path: string
  url: string
  percent: number
}

export class Download extends EventEmitter implements IDownload {
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
    super()
    this.dir = dir
    this.status = status
    this.url = url
  }

  public whenStopped (): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = (): boolean => {
        if (this.status === DownloadStatus.ERROR || this.status === DownloadStatus.REMOVED) {
          reject(this.error)
          return false
        }
        if (this.status === DownloadStatus.COMPLETE) {
          resolve()
          return false
        }
        return true
      }

      if (handler()) {
        this.once('done', handler)
      }
    })
  }
}
