import { readFileSync } from 'fs'

export function readAudioFile(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}
