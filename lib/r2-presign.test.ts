import { describe, it, expect, beforeEach } from 'vitest'
import { deriveR2KeyFromUrl } from './r2-presign'

describe('deriveR2KeyFromUrl（公开直链 → R2 对象键）', () => {
  beforeEach(() => {
    process.env.R2_PUBLIC_URL = 'https://assets.example.com'
    process.env.R2_ENDPOINT = 'https://abc.r2.cloudflarestorage.com'
    process.env.R2_BUCKET = 'magiviz'
  })

  it('识别 public base 形式的直链', () => {
    expect(deriveR2KeyFromUrl('https://assets.example.com/projects/p1/final-video/f.mp4'))
      .toBe('projects/p1/final-video/f.mp4')
  })

  it('识别 endpoint/bucket 形式的直链', () => {
    expect(deriveR2KeyFromUrl('https://abc.r2.cloudflarestorage.com/magiviz/uploads/image/a.png'))
      .toBe('uploads/image/a.png')
  })

  it('基座本身（无键）不误判', () => {
    expect(deriveR2KeyFromUrl('https://assets.example.com/')).toBeNull()
    expect(deriveR2KeyFromUrl('https://assets.example.com')).toBeNull()
  })

  it('非 R2 地址（Kie 临时 URL 等）返回 null', () => {
    expect(deriveR2KeyFromUrl('https://kie.ai/temp/abc.jpg')).toBeNull()
    expect(deriveR2KeyFromUrl('')).toBeNull()
  })

  it('只匹配完整基座前缀，不接受相似域名', () => {
    expect(deriveR2KeyFromUrl('https://assets.example.com.evil.io/x.mp4')).toBeNull()
  })
})
