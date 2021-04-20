const { Downloader } = require('..')

const downloader = new Downloader()

downloader.on('done', (download) => {
  console.log('done')
  console.log(download)
  console.log(downloader.tellStopped())
})

downloader.on('error', (err) => {
  console.log('error')
  console.log(err)
})

downloader.on('progress', (downloadProgress) => {
  // console.log(downloadProgress)
  process.stdout.clearLine(0)
  process.stdout.cursorTo(0)
  process.stdout.write(`percent: ${downloadProgress.percent}, speed: ${downloadProgress.downloadSpeed}`)
})

const gid = downloader.add('https://npm.taobao.org/mirrors/electron/12.0.4/electron-v12.0.4-win32-x64.zip', {
  dir: __dirname,
  out: 'electron-v12.0.4-win32-x64.zip'
})
const gid2 = downloader.add('https://npm.taobao.org/mirrors/electron/12.0.3/electron-v12.0.3-win32-x64.zip', {
  dir: __dirname,
  out: 'electron-v12.0.3-win32-x64.zip'
})
console.log(gid)
console.log(gid2)

