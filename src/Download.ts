/* eslint-disable @typescript-eslint/method-signature-style */

import { ObjectId } from '@tybys/oid'
import { EventEmitter } from 'events'
import type { Agent as HttpAgent, ClientRequest } from 'http'
import type { Agent as HttpsAgent } from 'https'
import { join } from 'path'
import type { DownloadError } from './DownloadError'
import { definePrivate, definePublic } from './util/def'

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

type AgentType = {
  http?: HttpAgent
  https?: HttpsAgent
  http2?: unknown
} | false

export class Download extends EventEmitter implements IDownload {
  public readonly gid!: string
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

  private _disposed!: boolean

  public constructor (url: string, dir: string, out: string, headers: Record<string, string>, overwrite: DownloadOverwrite, agent: AgentType) {
    super()
    this.url = url
    const p = join(dir, out)
    this.path = p
    definePublic(this, 'gid', new ObjectId().toHexString(), false)
    definePrivate(this, 'dir', dir, false)
    definePrivate(this, 'out', out, false)
    definePrivate(this, 'originPath', p, false)
    definePrivate(this, 'renameCount', 0, true)
    definePrivate(this, 'req', null, true)
    definePrivate(this, 'headers', headers, false)
    definePrivate(this, 'overwrite', overwrite, false)
    definePrivate(this, 'agent', agent, false)
    definePrivate(this, 'remove', null, true)
    definePrivate(this, '_disposed', false, true)
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

  public dispose (): void {
    if (this._disposed) return
    this._disposed = true
    this.removeAllListeners()
    this.remove?.()
    this.remove = null
    this.abort()
    this.req = null
  }
}
