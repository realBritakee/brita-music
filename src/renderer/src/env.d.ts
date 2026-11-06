import type { BritaApi } from '../../shared/types'

declare global {
  interface Window {
    brita: BritaApi
  }
}
