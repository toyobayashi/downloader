import { homedir } from 'os'
import { join, basename, dirname, parse } from 'path'
import { mkdirSync, existsSync, statSync, createWriteStream, unlinkSync, renameSync, WriteStream } from 'fs'
import { EventEmitter } from 'events'
import type { Agent as HttpAgent, ClientRequest } from 'http'
import type { Agent as HttpsAgent } from 'https'
import type { Progress, Response, RequestError } from 'got'
import got from 'got'
import { DownloadStatus, IDownload, Download, DownloadOverwrite } from './Download'
import { DownloadList } from './util/DownloadList'
import { DownloadErrorCode, DownloadError } from './DownloadError'

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
export interface IDownloadProgress {
  gid: string
  totalLength: number
  completedLength: number
  downloadSpeed: number
  path: string
  url: string
  percent: number
}

/** @public */
export class Downloader extends EventEmitter {
  public static getVersion (): string {
    return __VERSION__
  }

  public settings: IDownloaderOptions = {
    dir: join(homedir(), 'Download'),
    maxConcurrentDownloads: 1,
    headers: {},
    agent: false,
    speedUpdateInterval: 100,
    overwrite: DownloadOverwrite.NO
  }

  private _lock: boolean = false

  private readonly _downloadList: DownloadList = new DownloadList()
  private readonly _waitingQueue: DownloadList = new DownloadList()
  private readonly _pausedList: DownloadList = new DownloadList()
  private readonly _completedList: DownloadList = new DownloadList()
  private readonly _errorList: DownloadList = new DownloadList()
  private readonly _downloads: Map<string, Download> = new Map()

  public constructor () {
    super()
    this._downloadList.on('remove', () => {
      if (!this._lock && this._downloadList.size < this.settings.maxConcurrentDownloads) {
        const nextDownload = this._waitingQueue.shift()
        if (nextDownload) {
          this._download(nextDownload)
        }
      }
    })
    // this.on('done', () => {
    //   const nextDownload = this._waitingQueue.shift()
    //   if (nextDownload) {
    //     this._downloadList.push(nextDownload)
    //     this._download(nextDownload)
    //   }
    // })
  }

  public whenStopped (gid: string | Readonly<IDownload>): Promise<Readonly<IDownload>> {
    let download: Readonly<IDownload> | undefined
    if (typeof gid === 'string') {
      download = this._downloads.get(gid)
      if (!download) {
        throw new Error('Can not find download with given gid: ' + gid)
      }
    } else {
      download = gid
      if (!(download instanceof Download)) {
        throw new TypeError('whenStopped requires a IDownload object but recieved "' + typeof download + '"')
      }
    }

    return new Promise((resolve, reject) => {
      const handler = (download: Readonly<IDownload>): boolean => {
        if (download.gid !== gid) return true
        this.off('done', handler)
        if (download.status === DownloadStatus.ERROR || download.status === DownloadStatus.REMOVED) {
          reject(download.error)
          return false
        }
        if (download.status === DownloadStatus.COMPLETE) {
          resolve(download)
          return false
        }
        return true
      }

      if (handler(download!)) {
        this.on('done', handler)
      }
    })
  }

  public add (url: string, options?: Partial<IDownloadOptions>): string {
    const dir = options?.dir ?? this.settings.dir
    const out = options?.out ?? basename(url)
    const needWait = this._downloadList.size >= this.settings.maxConcurrentDownloads
    const download = new Download(url, dir, needWait ? DownloadStatus.WAITING : DownloadStatus.ACTIVE)
    download.overwrite = options?.overwrite ?? this.settings.overwrite
    download.path = join(dir, out)

    if (download.overwrite === DownloadOverwrite.RENAME) {
      const downloadArray = [...this._downloads.values()]
      let n = 1
      while (downloadArray.some(d => d.path === download.path)) {
        const p = parse(download.path)
        download.path = join(dirname(download.path), p.name + ` (${n})` + p.ext)
        n++
      }
    }

    download.headers = {
      ...this.settings.headers,
      ...(options?.headers ?? {})
    }
    const optionsAgent = options?.agent
    download.agent = optionsAgent === false
      ? false
      : (this.settings.agent === false
          ? optionsAgent!
          : {
              ...this.settings.agent,
              ...optionsAgent
            })
    this._downloads.set(download.gid, download)
    if (needWait) {
      download.status = DownloadStatus.WAITING
      this._waitingQueue.push(download)
    } else {
      this._download(download)
    }
    return download.gid
  }

  public pause (gid: string): boolean {
    const download: Download | undefined = this._downloads.get(gid)
    if (download) {
      this._pause(download)
      return true
    }
    return false
  }

  private _pause (download: Download): void {
    download.req?.abort()
    download.status = DownloadStatus.PAUSED
    this._pausedList.push(download)
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

  public unpause (gid: string): boolean {
    const download: Download | undefined = this._downloads.get(gid)
    if (download && (download.status === DownloadStatus.PAUSED)) {
      const needWait = this._downloadList.size >= this.settings.maxConcurrentDownloads
      if (needWait) {
        download.status = DownloadStatus.WAITING
        this._waitingQueue.push(download)
      } else {
        this._download(download)
      }
      return true
    }
    return false
  }

  public unpauseAll (): void {
    this._lock = true
    for (const download of this._pausedList.toArray()) {
      const needWait = this._downloadList.size >= this.settings.maxConcurrentDownloads
      if (needWait) {
        download.status = DownloadStatus.WAITING
        this._waitingQueue.push(download)
      } else {
        this._download(download)
      }
    }
    this._lock = false
  }

  public tellActive (): Array<Readonly<IDownload>> {
    return this._downloadList.toArray()
  }

  public tellWaiting (): Array<Readonly<IDownload>> {
    return this._waitingQueue.toArray()
  }

  public tellStopped (): Array<Readonly<IDownload>> {
    return [...this._completedList.toArray(), ...this._errorList.toArray()]
  }

  public remove (gid: string, removeFile?: boolean): boolean {
    const download: Download | undefined = this._downloads.get(gid)
    if (download) {
      download.req?.abort()
      download.error = new DownloadError(download.gid, download.url, download.path, DownloadErrorCode.CUSTOM, 'Abort')
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
      this._downloads.delete(gid)
      this.emit('done', download)
      return true
    }
    return false
  }

  public removeAll (removeFile?: boolean): void {
    this._lock = true
    const keysIterator = this._downloads.keys()
    for (const gid of keysIterator) {
      this.remove(gid, removeFile)
    }
    this._lock = false
  }

  public tellStatus (gid: string): Readonly<IDownload> | undefined {
    return this._downloads.get(gid)
  }

  private _error (download: Download, code: DownloadErrorCode, customErrorMessage?: string): void {
    if (download.status !== DownloadStatus.COMPLETE && download.status !== DownloadStatus.ERROR) {
      download.downloadSpeed = 0
      if (code === 0) {
        download.status = DownloadStatus.COMPLETE
        download.error = null
        this._completedList.push(download)
        this.emit('complete', download)
      } else {
        download.status = DownloadStatus.ERROR
        download.error = new DownloadError(download.gid, download.url, download.path, code, customErrorMessage)
        this._errorList.push(download)
        this.emit('fail', download)
        this.emit('error', download.error)
      }
      this.emit('done', download)
    }
  }

  private _complete (download: Download): void {
    if (download.status !== DownloadStatus.COMPLETE && download.status !== DownloadStatus.ERROR) {
      download.downloadSpeed = 0
      download.status = DownloadStatus.COMPLETE
      download.error = null
      this._completedList.push(download)
      this.emit('complete', download)
      this.emit('done', download)
    }
  }

  private _download (download: Download): void {
    download.status = DownloadStatus.ACTIVE
    this._downloadList.push(download)
    const p = download.path
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
      download.req?.abort()
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
      request.abort = function abort () {
        rename = false
        download.req = null
        request.destroy()
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

          if (rename && (tmpFileSize === fileLength + contentLength)) {
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
        // this._error(download, DownloadError.CUSTOM, err.message)
        // return
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

      if (this.listenerCount('progress') > 0) {
        this.emit('progress', {
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

    // downloadStream.pipe(targetStream)
  }

  public on (event: 'progress', listener: (downloadProgress: IDownloadProgress) => void): this
  public on (event: 'complete', listener: (download: Readonly<IDownload>) => void): this
  public on (event: 'fail', listener: (download: Readonly<IDownload>) => void): this
  public on (event: 'error', listener: (err: DownloadError) => void): this
  public on (event: 'done', listener: (download: Readonly<IDownload>) => void): this
  public on (event: string, listener: (...args: any[]) => void): this
  public on (event: string, listener: (...args: any[]) => void): this { return (super.on(event, listener), this) }

  public once (event: 'progress', listener: (downloadProgress: IDownloadProgress) => void): this
  public once (event: 'complete', listener: (download: Readonly<IDownload>) => void): this
  public once (event: 'fail', listener: (download: Readonly<IDownload>) => void): this
  public once (event: 'error', listener: (err: DownloadError) => void): this
  public once (event: 'done', listener: (download: Readonly<IDownload>) => void): this
  public once (event: string, listener: (...args: any[]) => void): this
  public once (event: string, listener: (...args: any[]) => void): this { return (super.once(event, listener), this) }

  public off (event: 'progress', listener: (downloadProgress: IDownloadProgress) => void): this
  public off (event: 'complete', listener: (download: Readonly<IDownload>) => void): this
  public off (event: 'fail', listener: (download: Readonly<IDownload>) => void): this
  public off (event: 'error', listener: (err: DownloadError) => void): this
  public off (event: 'done', listener: (download: Readonly<IDownload>) => void): this
  public off (event: string, listener: (...args: any[]) => void): this
  public off (event: string, listener: (...args: any[]) => void): this { return (super.off(event, listener), this) }
}
