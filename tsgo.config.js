module.exports = function () {
  return {
    tsTransform: {
      define: {
        __VERSION__: JSON.stringify(require('./package.json').version)
      }
    }
  }
}
