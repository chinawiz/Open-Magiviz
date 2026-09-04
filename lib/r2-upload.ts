import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getS3Client } from './r2-presign'

/**
 * 服务端 R2 上传（自建图像转存公网直链用，ADR-0001）。
 * 自建端点产出的 b64/局域网 URL 必须落到 R2 才能被下游图生视频（Kie 拉取）访问。
 * 键与公开 URL 约定与 upload/migrate 一致：`${R2_PUBLIC_URL}/${key}`，
 * 未配 R2_PUBLIC_URL 时回落 `${R2_ENDPOINT}/${R2_BUCKET}/${key}`。
 */

/** 上传图像字节到 R2，返回公开直链。R2 未配置时抛错（调用方按自建失败回退云端）。 */
export async function uploadImageBufferToR2(
  buffer: Buffer,
  key: string,
  contentType = 'image/png',
): Promise<string> {
  if (!process.env.R2_BUCKET) {
    throw new Error('R2 上传不可用：R2_BUCKET 未配置')
  }
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )

  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, '')
  if (publicBase) return `${publicBase}/${key}`
  const endpoint = process.env.R2_ENDPOINT?.replace(/\/$/, '')
  if (endpoint) return `${endpoint}/${process.env.R2_BUCKET}/${key}`
  throw new Error('R2 上传不可用：R2_PUBLIC_URL / R2_ENDPOINT 均未配置，无法构造公开直链')
}
