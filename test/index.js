const { Downloader, DownloadOverwrite } = require('..')

const downloader = new Downloader()
downloader.settings.maxConcurrentDownloads = 1
downloader.settings.overwrite = DownloadOverwrite.RENAME

const onProgress = (downloadProgress) => {
  if (process.stdout.clearLine) {
    process.stdout.clearLine(0)
    process.stdout.cursorTo(0)
    process.stdout.write(`percent: ${downloadProgress.percent}, speed: ${downloadProgress.downloadSpeed / 1000} KB/s`)
  }
}

const electron1204 = downloader.add('https://npm.taobao.org/mirrors/electron/12.0.4/electron-v12.0.4-win32-x64.zip', {
  dir: __dirname,
  out: 'electron-v12.0.4-win32-x64.zip'
})
const electron1203 = downloader.add('https://npm.taobao.org/mirrors/electron/12.0.3/electron-v12.0.3-win32-x64.zip', {
  dir: __dirname,
  out: 'electron-v12.0.3-win32-x64.zip'
})

electron1204.on('progress', onProgress)
electron1203.on('progress', onProgress)

electron1204.whenStopped().then(download => {
  console.log('whenStopped ' + electron1204.gid)
}).catch(err => {
  console.log(err.message)
})

electron1203.whenStopped().then(download => {
  console.log('whenStopped ' + electron1203.gid)
}).catch(err => {
  console.log(err.message)
})
