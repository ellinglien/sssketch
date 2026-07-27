import type { RifffApi } from './index'

declare global {
  interface Window {
    rifffApi: RifffApi
  }
}
