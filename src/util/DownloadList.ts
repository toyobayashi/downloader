import { EventEmitter } from 'events'
import type { Download, IDownload } from '../Download'
import { LinkedList } from './LinkedList'

export type EventType = 'push' | 'unshift' | 'pop' | 'shift' | 'clear' | 'remove'

export class DownloadList extends LinkedList<Download> {
  private readonly _event: EventEmitter = new EventEmitter()

  public constructor () {
    super()
  }

  // override
  public push (element: Download): () => void {
    if (element.remove !== null) {
      element.remove()
    }
    const remove = super.push(element)
    element.remove = () => {
      element.remove = null
      remove()
      this._event.emit('remove', element)
    }
    this._event.emit('push', element)
    return remove
  }

  // override
  public unshift (element: Download): () => void {
    if (element.remove !== null) {
      element.remove()
    }
    const remove = super.unshift(element)
    element.remove = () => {
      element.remove = null
      remove()
      this._event.emit('remove', element)
    }
    this._event.emit('unshift', element)
    return remove
  }

  // override
  public pop (): Download | undefined {
    const element = super.pop()
    if (element) {
      element.remove = null
      this._event.emit('pop', element)
    }
    return element
  }

  // override
  public shift (): Download | undefined {
    const element = super.shift()
    if (element) {
      element.remove = null
      this._event.emit('shift', element)
    }
    return element
  }

  // override
  public clear (): void {
    if (this.isEmpty()) {
      return
    }
    super.clear()
    this._event.emit('clear')
  }

  public toArray (): Download[] {
    const arr: Download[] = []
    for (const download of this) {
      arr.push(download)
    }
    return arr
  }

  public on (event: Exclude<EventType, 'clear'>, listener: (element: IDownload) => void): this
  public on (event: 'clear', listener: () => void): this
  public on (event: string, listener: (...args: any[]) => void): this {
    this._event.on(event, listener)
    return this
  }

  public once (event: Exclude<EventType, 'clear'>, listener: (element: IDownload) => void): this
  public once (event: 'clear', listener: () => void): this
  public once (event: string, listener: (...args: any[]) => void): this {
    this._event.once(event, listener)
    return this
  }

  public off (event: Exclude<EventType, 'clear'>, listener: (element: IDownload) => void): this
  public off (event: 'clear', listener: () => void): this
  public off (event: string, listener: (...args: any[]) => void): this {
    this._event.off(event, listener)
    return this
  }

  public dispose (): void {
    this._event.removeAllListeners()
    this.clear()
  }
}
