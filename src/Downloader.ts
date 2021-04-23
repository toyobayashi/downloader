import { homedir } from 'os'
import { join, basename, dirname, parse } from 'path'
import { mkdirSync, existsSync, statSync, createWriteStream, unlinkSync, renameSync, WriteStream } from 'fs'
import { EventEmitter } from 'events'
import type { Agent as HttpAgent, ClientRequest } from 'http'
import type { Agent as HttpsAgent } from 'https'
import type { Progress, Response, RequestError } from 'got'
import got from 'got'
import { DownloadStatus, Download, DownloadOverwrite } from './Download'
import type { IDownload, DownloadEvent } from './Download'
import { DownloadList } from './util/DownloadList'
import { DownloadErrorCode, DownloadError } from './DownloadError'
import { definePrivate, definePublic } from './util/def'

/** @public */
export interface IDownloadOptions {
  dir: string
  out: string
  headers: Record<string, string>
  overwrite: DownloadOverwrite
  agent: {
    http?: HttpAgent
    https?: HttpsAgent
    http2?: unknown
  } | false
}

/** @public */
export interface IDownloaderOptions extends Omit<IDownloadOptions, 'out'> {
  maxConcurrentDownloads: number
  speedUpdateInterval: number
}

/** @public */
export class Downloader extends EventEmitter {
  public static getVersion (): string {
    return __VERSION__
  }

  public static download (url: string, options?: IDownloadOptions): IDownload {
    const downloader = new Downloader()
    downloader.settings.maxConcurrentDownloads = 1
    const downloadObject = downloader.add(url, options)
    downloadObject.once('done', () => {
      process.nextTick(() => {
        downloader.dispose()
      })
    })
    return downloadObject
  }

  public readonly settings!: IDownloaderOptions

  private _lock!: boolean
  private _disposed!: boolean

  private readonly _downloadList: DownloadList = new DownloadList()
  private readonly _waitingQueue: DownloadList = new DownloadList()
  private readonly _pausedList: DownloadList = new DownloadList()
  private readonly _completedList: DownloadList = new DownloadList()
  private readonly _errorList: DownloadList = new DownloadList()
  private readonly _downloads: Map<string, Download> = new Map()

  public constructor () {
    super()
    definePrivate(this, '_lock', false, true)
    definePrivate(this, '_disposed', false, true)
    const defaultSettings = {
      dir: join(homedir(), 'Download'),
      headers: {},
      agent: false,
      speedUpdateInterval: 100,
      overwrite: DownloadOverwrite.NO
    }
    let maxConcurrentDownloads = 1
    Object.defineProperty(defaultSettings, 'maxConcurrentDownloads', {
      configurable: true,
      enumerable: true,
      get () { return maxConcurrentDownloads },
      set: (value: number) => {
        if (this._lock) {
          throw new Error('Can not set maxConcurrentDownloads')
        }
        const currentDownloading = this._downloadList.size
        if (currentDownloading > value) {
          throw new RangeError(`Can not set maxConcurrentDownloads to ${value}, current ${currentDownloading} downloading`)
        }
        maxConcurrentDownloads = value

        let needActivateCount = maxConcurrentDownloads - currentDownloading
        while (needActivateCount > 0) {
          const nextDownload = this._waitingQueue.shift()
          if (nextDownload) {
            this._download(nextDownload)
            needActivateCount--
          } else {
            break
          }
        }
      }
    })
    definePublic(this, 'settings', defaultSettings, false)

    this._downloadList.on('remove', () => {
      if (!this._lock && this._downloadList.size < this.settings.maxConcurrentDownloads) {
        const nextDownload = this._waitingQueue.shift()
        if (nextDownload) {
          this._download(nextDownload)
        }
      }
    })
  }

  private _getDownload (gid: string | IDownload): Download {
    let download: Download | undefined
    if (typeof gid === 'string') {
      download = this._downloads.get(gid)
      if (!download) {
        throw new Error('Can not find download with given gid: ' + gid)
      }
    } else {
      if (!(gid instanceof Download)) {
        throw new TypeError('Requires IDownload object but recieved "' + typeof download + '"')
      }
      download = gid
    }
    return download
  }

  private _queue (download: Download): void {
    download.status = DownloadStatus.WAITING
    this._waitingQueue.push(download)
    this._emitDownloadEvent(download, 'queue')
  }

  private _start (download: Download): void {
    process.nextTick(() => {
      const needWait = this._downloadList.size >= this.settings.maxConcurrentDownloads
      if (needWait) {
        this._queue(download)
      } else {
        this._download(download)
      }
    })
  }

  public whenStopped (gid: string | IDownload): Promise<void> {
    const download = this._getDownload(gid)
    return download.whenStopped()
  }

  public add (url: string, options?: Partial<IDownloadOptions>): IDownload {
    const dir = options?.dir ?? this.settings.dir
    const out = options?.out ?? basename(url)
    const headers = {
      ...this.settings.headers,
      ...(options?.headers ?? {})
    }
    const overwrite = options?.overwrite ?? this.settings.overwrite
    const optionsAgent = options?.agent
    const agent = optionsAgent === false
      ? false
      : (this.settings.agent === false
          ? optionsAgent!
          : {
              ...this.settings.agent,
              ...optionsAgent
            })
    const download = new Download(url, dir, out, headers, overwrite, agent)

    if (overwrite === DownloadOverwrite.RENAME) {
      const downloadArray = [...this._downloads.values()]
      const p = parse(download.originPath)
      while (downloadArray.some(d => d.path === download.path)) {
        download.renameCount++
        download.path = join(dirname(download.originPath), p.name + ` (${download.renameCount})` + p.ext)
      }
    }

    this._downloads.set(download.gid, download)
    this._start(download)
    return download
  }

  public pause (gid: string | IDownload): void {
    this._pause(this._getDownload(gid))
  }

  private _pause (download: Download): void {
    download.abort()
    download.status = DownloadStatus.PAUSED
    this._pausedList.push(download)
    this._emitDownloadEvent(download, 'pause')
  }

  public pauseAll (): void {
    this._lock = true
    for (const download of this._waitingQueue.toArray()) {
      this._pause(download)
    }
    for (const download of this._downloadList.toArray()) {
      this._pause(download)
    }
    this._lock = false
  }

  public unpause (gid: string | IDownload): void {
    const download = this._getDownload(gid)
    if (download.status !== DownloadStatus.PAUSED) {
      throw new Error('Not a paused download')
    }
    this._emitDownloadEvent(download, 'unpause')
    this._start(download)
  }

  public unpauseAll (): void {
    this._lock = true
    for (const download of this._pausedList.toArray()) {
      this.unpause(download)
    }
    this._lock = false
  }

  public tellActive (): IDownload[] {
    return this._downloadList.toArray()
  }

  public countActive (): number {
    return this._downloadList.size
  }

  public tellWaiting (): IDownload[] {
    return this._waitingQueue.toArray()
  }

  public countWaiting (): number {
    return this._waitingQueue.size
  }

  public tellStopped (): IDownload[] {
    return [...this._completedList.toArray(), ...this._errorList.toArray()]
  }

  public countStopped (): number {
    return this._completedList.size + this._errorList.size
  }

  public tellCompleted (): IDownload[] {
    return this._completedList.toArray()
  }

  public countCompleted (): number {
    return this._completedList.size
  }

  public tellFailed (): IDownload[] {
    return this._errorList.toArray()
  }

  public countFailed (): number {
    return this._errorList.size
  }

  public tellPaused (): IDownload[] {
    return this._pausedList.toArray()
  }

  public countPaused (): number {
    return this._pausedList.size
  }

  public remove (gid: string | IDownload, removeFile?: boolean): void {
    const download = this._getDownload(gid)
    download.abort()
    download.error = new DownloadError(download.gid, download.url, download.path, DownloadErrorCode.ABORT)
    download.status = DownloadStatus.REMOVED
    download.remove?.()
    if (removeFile) {
      try {
        const tmpFile = `${download.path}.tmp`
        if (existsSync(tmpFile) && statSync(tmpFile).isFile()) {
          unlinkSync(tmpFile)
        }
        if (existsSync(download.path) && statSync(download.path).isFile()) {
          unlinkSync(download.path)
        }
      } catch (_) {}
    }
    this._downloads.delete(download.gid)
    this._emitDownloadEvent(download, 'remove')
    this._emitDownloadEvent(download, 'done')
  }

  public removeAll (removeFile?: boolean): void {
    this._lock = true
    const keysIterator = this._downloads.keys()
    for (const gid of keysIterator) {
      this.remove(gid, removeFile)
    }
    this._lock = false
  }

  public tellStatus (gid: string): IDownload | undefined {
    return this._downloads.get(gid)
  }

  private _error (download: Download, code: DownloadErrorCode, customErrorMessage?: string): void {
    if (download.status !== DownloadStatus.COMPLETE && download.status !== DownloadStatus.ERROR) {
      if (code === 0) {
        this._complete(download)
      } else {
        download.downloadSpeed = 0
        download.status = DownloadStatus.ERROR
        download.error = new DownloadError(download.gid, download.url, download.path, code, customErrorMessage)
        this._errorList.push(download)
        this._emitDownloadEvent(download, 'fail')
        this._emitDownloadEvent(download, 'done')
      }
    }
  }

  private _complete (download: Download): void {
    if (download.status !== DownloadStatus.COMPLETE && download.status !== DownloadStatus.ERROR) {
      download.downloadSpeed = 0
      download.status = DownloadStatus.COMPLETE
      download.error = null
      this._completedList.push(download)
      this._emitDownloadEvent(download, 'complete')
      this._emitDownloadEvent(download, 'done')
    }
  }

  private _download (download: Download): void {
    download.status = DownloadStatus.ACTIVE
    this._downloadList.push(download)
    this._emitDownloadEvent(download, 'activate')
    let p = download.path
    try {
      mkdirSync(dirname(p), { recursive: true })
    } catch (_) {
      this._error(download, DownloadErrorCode.MKDIR_FAILED)
      return
    }

    if (download.overwrite === DownloadOverwrite.NO) {
      if (existsSync(p)) {
        this._error(download, DownloadErrorCode.FILE_EXISTS)
        return
      }
    } else if (download.overwrite === DownloadOverwrite.YES) {
      if (existsSync(p)) {
        try {
          unlinkSync(p)
        } catch (_) {
          this._error(download, DownloadErrorCode.FILE_IO)
          return
        }
      }
    } else if (download.overwrite === DownloadOverwrite.RENAME) {
      const obj = parse(download.originPath)
      while (existsSync(p)) {
        download.renameCount++
        download.path = join(dirname(download.originPath), obj.name + ` (${download.renameCount})` + obj.ext)
        p = download.path
      }
    }

    let loaded = 0

    const headers = download.headers
    let fileLength: number = 0
    if (existsSync(p + '.tmp')) {
      fileLength = statSync(p + '.tmp').size
      if (fileLength > 0) {
        loaded = fileLength
        headers.Range = `bytes=${fileLength}-`
      }
    }

    // let rename = true
    // let size = 0
    let rename = true
    let start = 0
    let contentLength = 0

    let targetStream: WriteStream | undefined

    const downloadStream = got.stream(download.url, {
      method: 'GET',
      headers,
      timeout: {
        response: 10000
      },
      // throwHttpErrors: false,
      agent: download.agent,
      encoding: 'binary'
    })

    downloadStream.on('error', (err: RequestError) => {
      rename = false
      // download.abort()
      download.req = null
      targetStream?.close()
      if (err instanceof got.TimeoutError) {
        this._error(download, DownloadErrorCode.TIMEOUT)
      } else if (err instanceof got.HTTPError) {
        if (err.response.statusCode === 403) {
          this._error(download, DownloadErrorCode.AUTH_FAILED)
        } else if (err.response.statusCode === 404) {
          this._error(download, DownloadErrorCode.RES_NOT_FOUND)
        } else {
          this._error(download, DownloadErrorCode.NETWORK, err.message)
        }
      } else if (err instanceof got.MaxRedirectsError) {
        this._error(download, DownloadErrorCode.MAX_REDIRECTS)
      } else {
        this._error(download, DownloadErrorCode.NETWORK, err.message)
      }
    })

    downloadStream.on('request', (request: ClientRequest) => {
      request.abort = () => {
        rename = false
        download.req = null
        request.destroy()
        if (download.status === DownloadStatus.ACTIVE) {
          this._error(download, DownloadErrorCode.ABORT)
        }
      }
      download.req = request
      rename = true
    })

    downloadStream.on('response', (res: Response<any>) => {
      contentLength = Number(res.headers['content-length']) || 0
      download.totalLength = contentLength + fileLength
      start = Date.now()

      try {
        targetStream = createWriteStream(p + '.tmp', { flags: 'a+' }).on('close', () => {
          download.req = null
          const tmpFileSize = statSync(p + '.tmp').size
          if (tmpFileSize === 0) {
            try {
              unlinkSync(p + '.tmp')
            } catch (_) {}
            this._error(download, DownloadErrorCode.UNKNOWN)
            return
          }

          if (rename && (res.headers['content-length'] != null ? (tmpFileSize === (fileLength + contentLength)) : true)) {
            try {
              renameSync(p + '.tmp', p)
              this._complete(download)
            } catch (_) {
              this._error(download, DownloadErrorCode.RENAME_FAILED)
            }
          }
        }).on('error', (err) => {
          if (err) {
            rename = false
            download.req = null
            this._error(download, DownloadErrorCode.FILE_IO, err.message)
          }
        })
        downloadStream.pipe(targetStream)
      } catch (err) {
        this._error(download, DownloadErrorCode.CREATE_FILE_FAILED)
      }
    })

    downloadStream.on('downloadProgress', (progress: Progress) => {
      if (targetStream == null) return
      const now = Date.now()
      const interval = now - start
      const current = progress.transferred + fileLength
      download.completedLength = current
      if ((interval > this.settings.speedUpdateInterval) || download.downloadSpeed === 0 || (progress.transferred === (progress.total ?? contentLength))) {
        download.downloadSpeed = Math.floor((current - loaded) / (interval / 1000))
        start = now
        loaded = current
      }

      if (download.listenerCount('progress') > 0) {
        download.emit('progress', {
          gid: download.gid,
          totalLength: download.totalLength,
          completedLength: download.completedLength,
          downloadSpeed: download.downloadSpeed,
          path: download.path,
          url: download.url,
          percent: download.totalLength === 0 ? 0 : (100 * (download.completedLength) / (download.totalLength))
        })
      }
    })
  }

  public on (event: DownloadEvent, listener: (download: IDownload) => void): this
  public on (event: string, listener: (...args: any[]) => void): this
  public on (event: string, listener: (...args: any[]) => void): this { return (super.on(event, listener), this) }

  public once (event: DownloadEvent, listener: (download: IDownload) => void): this
  public once (event: string, listener: (...args: any[]) => void): this
  public once (event: string, listener: (...args: any[]) => void): this { return (super.once(event, listener), this) }

  public off (event: DownloadEvent, listener: (download: IDownload) => void): this
  public off (event: string, listener: (...args: any[]) => void): this
  public off (event: string, listener: (...args: any[]) => void): this { return (super.off(event, listener), this) }

  private _emitDownloadEvent (download: IDownload, event: DownloadEvent, ...args: any[]): this {
    download.emit(event, ...args)
    this.emit(event, download, ...args)
    return this
  }

  public dispose (): void {
    if (this._disposed) return
    this._disposed = true
    this.removeAllListeners()
    for (const download of this._downloads.values()) {
      download.dispose()
    }
    this._downloadList.dispose()
    this._waitingQueue.dispose()
    this._pausedList.dispose()
    this._completedList.dispose()
    this._errorList.dispose()
    this._downloads.clear()
  }
}
