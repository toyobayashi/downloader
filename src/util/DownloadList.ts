import { IDownload } from '../Download'
import { LinkedList } from './LinkedList'

/** @public */
export class DownloadList<E extends IDownload = IDownload> extends LinkedList<E> {
  public constructor () {
    super()
  }

  // override
  public push (element: E): () => void {
    if (element.remove !== null) {
      element.remove()
    }
    const remove = super.push(element)
    element.remove = function () {
      element.remove = null
      remove()
    }
    return remove
  }
}
