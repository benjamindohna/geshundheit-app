import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const CACHE_FILE = path.join(process.cwd(), 'descriptions-cache.json')

type DescriptionsCache = Record<string, string>

function readCache(): DescriptionsCache {
  if (!existsSync(CACHE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as DescriptionsCache
  } catch {
    return {}
  }
}

export function getCachedDescriptions(names: string[]): Record<string, string> {
  const cache = readCache()
  const result: Record<string, string> = {}
  for (const name of names) {
    if (cache[name]) result[name] = cache[name]
  }
  return result
}

export function setCachedDescriptions(entries: Record<string, string>): void {
  const cache = readCache()
  Object.assign(cache, entries)
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
}
