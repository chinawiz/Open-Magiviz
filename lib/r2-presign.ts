import { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * T-05：R2 资产预签名下载 URL。
 *
 * 现状资产 URL 是桶公开直链（upload/migrate 构造的 public base URL），
 * 本模块提供短期签名 URL（默认 300s，安全设计 §3.3.4 基线），
 * 签发方（路由）必须先校验资源归属，本模块不负责鉴权。
 */

const DEFAULT_EXPIRES_SEC = 300

let s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY || '',
        secretAccessKey: process.env.R2_SECRET_KEY || '',
      },
    })
  }
  return s3Client
}

/**
 * 从公开直链反推 R2 对象键。
 * 覆盖 upload/migrate-assets 构造 URL 的已知基座：
 *   `${R2_PUBLIC_URL}/${key}` 与 `${R2_ENDPOINT}/${R2_BUCKET}/${key}`。
 * 非 R2 地址（如 Kie 临时 URL）返回 null。
 */
export function deriveR2KeyFromUrl(url: string): string | null {
  if (!url) return null
  const bases: string[] = []
  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, '')
  if (publicBase) bases.push(publicBase)
  if (process.env.R2_ENDPOINT && process.env.R2_BUCKET) {
    bases.push(`${process.env.R2_ENDPOINT.replace(/\/$/, '')}/${process.env.R2_BUCKET}`)
  }
  for (const base of bases) {
    if (url.startsWith(`${base}/`)) {
      const key = url.slice(base.length + 1)
      return key.length > 0 ? key : null
    }
  }
  return null
}

/** 为 R2 对象键签发短期 GET URL（默认 300 秒） */
export async function createPresignedGetUrl(key: string, expiresSec = DEFAULT_EXPIRES_SEC): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
  })
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresSec })
}
