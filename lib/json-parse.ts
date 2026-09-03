/**
 * 容错解析模型输出中的 JSON:依次尝试去 ``` 包裹、完整解析、
 * 括号匹配提取首个对象/数组、正则逐段解析,全部失败返回 null。
 * (自 operate.tsx 两处重复定义提取,T16 随 handleSend 迁入本模块;
 *  清理票将其落为纯函数模块并补测。)
 */
export function tryParsePossiblyMalformedJson(text: string): unknown {
  if (!text || typeof text !== 'string') return null

  // 去掉 ``` 或 ```json 包裹
  let clean = text.trim()
  clean = clean.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // 直接尝试完整解析
  try {
    return JSON.parse(clean)
  } catch (e) {}

  // 尝试定位第一个 JSON 对象/数组并做括号匹配提取
  const firstBrace = (() => {
    const i1 = clean.indexOf('{')
    const i2 = clean.indexOf('[')
    if (i1 === -1 && i2 === -1) return -1
    if (i1 === -1) return i2
    if (i2 === -1) return i1
    return Math.min(i1, i2)
  })()

  if (firstBrace >= 0) {
    const openChar = clean[firstBrace]
    const closeChar = openChar === '{' ? '}' : ']'
    let depth = 0
    for (let i = firstBrace; i < clean.length; i++) {
      if (clean[i] === openChar) depth++
      else if (clean[i] === closeChar) {
        depth--
        if (depth === 0) {
          const candidate = clean.slice(firstBrace, i + 1)
          try {
            return JSON.parse(candidate)
          } catch (e) {
            break
          }
        }
      }
    }
  }

  // 最后尝试匹配所有 {...} 或 [...] 片段逐一解析
  const objectRegex = /\{[\s\S]*?\}/g
  let m
  while ((m = objectRegex.exec(clean)) !== null) {
    try {
      return JSON.parse(m[0])
    } catch (e) {}
  }
  const arrayRegex = /\[[\s\S]*?\]/g
  while ((m = arrayRegex.exec(clean)) !== null) {
    try {
      return JSON.parse(m[0])
    } catch (e) {}
  }

  return null
}
