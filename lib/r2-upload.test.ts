import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadImageBufferToR2 } from './r2-upload'

// R2 上传契约：公开直链构造（publicBase 优先，endpoint/bucket 回落）、
// env 缺失抛错（调用方按自建失败回退云端）、PutObjectCommand 参数齐全。

const send = vi.hoisted(() => vi.fn(async (_cmd: unknown) => ({})))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = (cmd: unknown) => send(cmd)
    constructor(public config: unknown) {}
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}))

function setEnv(env: { bucket?: string; publicUrl?: string; endpoint?: string }) {
  if (env.bucket) process.env.R2_BUCKET = env.bucket
  else delete process.env.R2_BUCKET
  if (env.publicUrl) process.env.R2_PUBLIC_URL = env.publicUrl
  else delete process.env.R2_PUBLIC_URL
  if (env.endpoint) process.env.R2_ENDPOINT = env.endpoint
  else delete process.env.R2_ENDPOINT
}

beforeEach(() => {
  send.mockClear()
  setEnv({ bucket: 'meihao', publicUrl: 'https://assets.example.com', endpoint: 'https://abc.r2.cloudflarestorage.com' })
})

describe('uploadImageBufferToR2', () => {
  it('publicBase 优先：URL = {R2_PUBLIC_URL}/{key}，Put 参数齐全', async () => {
    const url = await uploadImageBufferToR2(Buffer.from('png-bytes'), 'generated/a.png')

    expect(url).toBe('https://assets.example.com/generated/a.png')
    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({
      Bucket: 'meihao',
      Key: 'generated/a.png',
      ContentType: 'image/png',
    })
    expect(Buffer.isBuffer(command.input.Body)).toBe(true)
  })

  it('无 publicBase → 回落 endpoint/bucket/key 形式', async () => {
    setEnv({ bucket: 'meihao', endpoint: 'https://abc.r2.cloudflarestorage.com' })

    const url = await uploadImageBufferToR2(Buffer.from('x'), 'generated/b.png')

    expect(url).toBe('https://abc.r2.cloudflarestorage.com/meihao/generated/b.png')
  })

  it('R2_BUCKET 缺失 → 抛错（调用方按自建失败回退）', async () => {
    setEnv({ publicUrl: 'https://assets.example.com', endpoint: 'https://abc.r2.cloudflarestorage.com' })

    await expect(uploadImageBufferToR2(Buffer.from('x'), 'k.png')).rejects.toThrow('R2_BUCKET')
    expect(send).not.toHaveBeenCalled()
  })

  it('publicBase 与 endpoint 均缺 → 抛错（无法构造公开直链）', async () => {
    setEnv({ bucket: 'meihao' })

    await expect(uploadImageBufferToR2(Buffer.from('x'), 'k.png')).rejects.toThrow('公开直链')
    expect(send).toHaveBeenCalledTimes(1) // 对象已上传，直链构造失败才抛
  })
})
