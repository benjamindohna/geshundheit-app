import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const CACHE_FILE = path.join(process.cwd(), 'extraction-cache.json')

export type CachedExtraction = {
  label: string
  categories: string[]
  keywords: string[]
  observations: Record<string, unknown>[]
}

type Cache = Record<string, CachedExtraction>

function readCache(): Cache {
  if (!existsSync(CACHE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as Cache
  } catch {
    return {}
  }
}

export function getCached(hash: string): CachedExtraction | null {
  if (process.env.EXTRACTION_CACHE !== '1') return null
  return readCache()[hash] ?? null
}

export function setCached(hash: string, entry: CachedExtraction): void {
  const cache = readCache()
  cache[hash] = entry
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
}
