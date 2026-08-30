import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

/**
 * 生产（Neon）走 neon-http；本地 Postgres（127.0.0.1/localhost）走 node-postgres——
 * neon 驱动无法连接本机地址（ERR_INVALID_URL）。pg 为 devDependency 且动态 import，
 * 生产打包不加载本地驱动；两个 drizzle 实例共享同一套查询构建器接口。
 */
async function createDb(url: string): Promise<NeonHttpDatabase<typeof schema>> {
  const isLocalDb = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)
  if (isLocalDb) {
    const { Pool } = await import('pg')
    const { drizzle: pgDrizzle } = await import('drizzle-orm/node-postgres')
    return pgDrizzle(new Pool({ connectionString: url }), { schema }) as unknown as NeonHttpDatabase<typeof schema>
  }
  return drizzle(neon(url), { schema })
}

export const db = await createDb(databaseUrl)
