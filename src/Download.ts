/* eslint-disable @typescript-eslint/method-signature-style */

import { ObjectId } from '@tybys/oid'
import { EventEmitter } from 'events'
import type { Agent as HttpAgent, ClientRequest } from 'http'
import type { Agent as HttpsAgent } from 'https'
import { join } from 'path'
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
export type DownloadEvent = 'queue' | 'activate' | 'complete' | 'fail' | 'pause' | 'unpause' | 'remove' | 'done'

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

  abort (): void
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

function def (obj: any, key: string, value: any, writable: boolean = true): void {
  Object.defineProperty(obj, key, {
    configurable: true,
    writable: writable,
    enumerable: false,
    value: value
  })
}

type AgentType = {
  http?: HttpAgent
  https?: HttpsAgent
  http2?: unknown
} | false

export class Download extends EventEmitter implements IDownload {
  public readonly gid = new ObjectId().toHexString()
  public status: DownloadStatus = DownloadStatus.INIT
  public totalLength = 0
  public completedLength = 0
  public downloadSpeed = 0
  public error: DownloadError | null = null
  public path: string
  public readonly url: string

  public readonly dir!: string
  public readonly out!: string
  public readonly originPath!: string
  public renameCount!: number
  public req!: ClientRequest | null
  public readonly headers!: Record<string, string>
  public readonly overwrite!: DownloadOverwrite
  public readonly agent!: AgentType

  public remove!: null | (() => void)

  public constructor (url: string, dir: string, out: string, headers: Record<string, string>, overwrite: DownloadOverwrite, agent: AgentType) {
    super()
    this.url = url
    const p = join(dir, out)
    this.path = p
    def(this, 'dir', dir, false)
    def(this, 'out', out, false)
    def(this, 'originPath', p, false)
    def(this, 'renameCount', 0, true)
    def(this, 'req', null, true)
    def(this, 'headers', headers, false)
    def(this, 'overwrite', overwrite, false)
    def(this, 'agent', agent, false)
    def(this, 'remove', null, true)
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

  public abort (): void {
    this.req?.abort()
  }
}
