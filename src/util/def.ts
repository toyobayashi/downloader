export function definePrivate (obj: any, key: string, value: any, writable: boolean = false): void {
  Object.defineProperty(obj, key, {
    configurable: true,
    writable: writable,
    enumerable: false,
    value: value
  })
}

export function definePublic (obj: any, key: string, value: any, writable: boolean = false): void {
  Object.defineProperty(obj, key, {
    configurable: true,
    writable: writable,
    enumerable: true,
    value: value
  })
}
