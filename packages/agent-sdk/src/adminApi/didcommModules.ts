import type { DidcommModule } from '../types'

export function moduleOf(modules: readonly DidcommModule[], protocol: string): string | undefined {
  return modules.find(({ prefixes }) => prefixes.some(prefix => protocol.startsWith(prefix)))?.module
}
