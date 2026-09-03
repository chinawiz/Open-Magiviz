import { describe, it, expect } from 'vitest'
import { tryParsePossiblyMalformedJson } from './json-parse'

describe('tryParsePossiblyMalformedJson', () => {
  it('解析去 ``` 包裹的 JSON(含 ```json 变体)', () => {
    expect(tryParsePossiblyMalformedJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(tryParsePossiblyMalformedJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('直接解析合法 JSON', () => {
    expect(tryParsePossiblyMalformedJson('{"scenes":[]}')).toEqual({ scenes: [] })
  })
  it('从前后噪声文本中括号匹配提取首个对象', () => {
    expect(tryParsePossiblyMalformedJson('结果如下:{"a":{"b":2}} 请查收')).toEqual({ a: { b: 2 } })
  })
  it('完全非法输入返回 null', () => {
    expect(tryParsePossiblyMalformedJson('not json at all')).toBeNull()
    expect(tryParsePossiblyMalformedJson('')).toBeNull()
  })
})
