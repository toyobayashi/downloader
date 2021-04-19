import { homedir } from 'os'
import { join, basename, dirname } from 'path'
import { mkdirSync, existsSync, statSync, createWriteStream, unlinkSync, renameSync } from 'fs'
import { EventEmitter } from 'events'
import { DownloadStatus, IDownload, Download } from './Download'
import { DownloadList } from './util/DownloadList'
import got from 'got'
import type { Progress } from 'got'
import type { Agent as HttpAgent, ClientRequest } from 'http'
import type { Agent as HttpsAgent } from 'https'

/** @public */
export interface IDownloadOptions {
  dir: string
  out: string
  headers: Record<string, string>
  agent: {
    http?: HttpAgent
    https?: HttpsAgent
    http2?: unknown
  } | false
}

/** @public */
export interface IDownloaderOptions extends Omit<IDownloadOptions, 'out'> {
  maxConcurrentDownloads: number
  progressInterval: number
}

function getErrorMessage (code: number): string {
  switch (code) {
    case 0: return ''
    case 1: return 'Unknown error occurred'
    case 13: return 'File already existed'
    case 14: return 'Renaming file failed'
    default: return 'Unknown error occurred'
  }
}

/** @public */
export class Downloader extends EventEmitter {
  public settings: IDownloaderOptions = {
    dir: join(homedir(), 'Download'),
    maxConcurrentDownloads: 1,
    headers: {},
    agent: false,
    progressInterval: 500
  }

  private readonly _downloadList: DownloadList = new DownloadList()
  private readonly _waitingQueue: DownloadList = new DownloadList()
  private readonly _pausedList: DownloadList = new DownloadList()
  private readonly _completedList: DownloadList = new DownloadList()
  private readonly _errorList: DownloadList = new DownloadList()
  private readonly _downloads: IDownload[] = []

  public constructor () {
    super()
    this.on('done', () => {
      if (this._waitingQueue.size > 0) {
        const nextDownload = this._waitingQueue.shift()!
        nextDownload.remove = null
        this._downloadList.push(nextDownload)
        this._download(nextDownload)
      }
    })
  }

  public add (url: string, options?: IDownloadOptions): string {
    const dir = options?.dir ?? this.settings.dir
    const out = options?.out ?? basename(url)
    const needWait = this._downloadList.size >= this.settings.maxConcurrentDownloads
    const download = new Download(url, dir, out, needWait ? DownloadStatus.WAITING : DownloadStatus.ACTIVE)
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
    this._downloads.push(download)
    if (needWait) {
      download.status = DownloadStatus.WAITING
      this._waitingQueue.push(download)
    } else {
      this._downloadList.push(download)
      this._download(download)
    }
    return download.gid
  }

  public pause (gid: string): void {
    const download: IDownload | undefined = this._downloads.filter(d => d.gid === gid)[0]
    download.req?.abort()
    download.status = DownloadStatus.PAUSED
    this._pausedList.push(download)
  }

  private _error (download: IDownload, code: number, customErrorMessage?: string): void {
    if (download.status !== DownloadStatus.COMPLETE && download.status !== DownloadStatus.ERROR) {
      download.errorCode = code
      download.errorMessage = customErrorMessage ?? getErrorMessage(code)
      download.status = code === 0 ? DownloadStatus.COMPLETE : DownloadStatus.ERROR
      ;(code === 0 ? this._completedList : this._errorList).push(download)
      this.emit('done', download)
    }
  }

  private _download (download: IDownload): void {
    download.status = DownloadStatus.ACTIVE
    const p = download.file.path
    mkdirSync(dirname(p), { recursive: true })
    if (existsSync(p)) {
      this._error(download, 13)
      return
    }

    const headers = download.headers
    let fileLength: number = 0
    if (existsSync(p + '.tmp')) {
      fileLength = statSync(p + '.tmp').size
      if (fileLength > 0) {
        headers.Range = `bytes=${fileLength}-`
      }
    }

    // let rename = true
    // let size = 0
    let rename = true
    let start = 0
    let contentLength = 0

    const targetStream = createWriteStream(p + '.tmp', { flags: 'a+' }).on('close', () => {
      const tmpFileSize = statSync(p + '.tmp').size
      if (tmpFileSize === 0) {
        unlinkSync(p + '.tmp')
        this._error(download, 1)
        return
      }

      if (rename && tmpFileSize === fileLength + contentLength) {
        try {
          renameSync(p + '.tmp', p)
          this._error(download, 0)
        } catch (_) {
          this._error(download, 14)
        }
      }
    }).on('error', (err) => {
      if (err) {
        rename = false
        download.req = null
        this._error(download, 1)
      }
    })

    const downloadStream = got.stream(download.url, {
      method: 'GET',
      headers,
      timeout: {
        response: 10000
      },
      agent: download.agent,
      encoding: 'binary'
    })

    downloadStream.on('error', (err) => {
      rename = false
      download.req = null
      this._error(download, 31, err.message)
      targetStream.close()
    })

    downloadStream.on('request', (request: ClientRequest) => {
      request.abort = function abort () {
        rename = false
        request.destroy()
      }
      download.req = request
      rename = true
    })

    downloadStream.on('response', (res) => {
      contentLength = Number(res.headers['content-length']) || 0
      download.totalLength = contentLength
      download.file.length = contentLength
      start = Date.now()
    })

    downloadStream.on('downloadProgress', (progress: Progress) => {
      download.completedLength = progress.transferred
      download.file.completedLength = progress.transferred
      if (progress.transferred === (progress.total ?? contentLength)) {
        this.emit('progress', {
          path: download.file.path,
          current: fileLength + (progress.transferred),
          max: fileLength + ((progress.total ?? contentLength)),
          loading: 100 * (fileLength + (progress.transferred)) / (fileLength + ((progress.total ?? contentLength)))
        })
      } else {
        const now = Date.now()
        if (now - start > this.settings.progressInterval) {
          start = now
          this.emit('progress', {
            path: download.file.path,
            current: fileLength + (progress.transferred),
            max: fileLength + ((progress.total ?? contentLength)),
            loading: 100 * (fileLength + (progress.transferred)) / (fileLength + ((progress.total ?? contentLength)))
          })
        }
      }
    })

    downloadStream.pipe(targetStream)
  }
}
