import { readFile } from 'fs/promises'

export async function readAudioFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path))
}
