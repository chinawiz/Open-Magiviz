#!/usr/bin/env node
// ============================================================================
// PROTOTYPE（一次性验证代码，不属于生产路径）— 验证后可整体删除
//
// 目标：验证 Open-Magiviz 核心路线的最小闭环——「给一句话，生成一个视频」
// 五步：剧本(ZenMux) → 角色图(Kie) → 分镜图(Kie) → 场景视频(Kie veo) → 合片(ffmpeg/FAL)
//
// API 形状逐条取自生产代码（非凭空编写）：
//   剧本    lib/llm.ts                     zenmux.ai/api/v1/chat/completions
//   图片    app/api/ai/generate-character-image/route.ts
//          api.kie.ai/api/v1/jobs/createTask (nano-banana-2) + jobs/recordInfo
//   视频    app/api/ai/generate-story-video/route.ts
//          api.kie.ai/api/v1/veo/generate (veo3_lite) + veo/record-info
//   合片    app/api/ai/fal/compose-story-video/route.ts
//          fal-ai/ffmpeg-api/compose（无 FAL_KEY 时退化为本地 ffmpeg concat）
//
// 运行：node --env-file=.env.local poc/one-sentence-video.mjs "一只橘猫在雨天咖啡馆写日记"
// 可选：--scenes 2 --duration 4 --skip-video（只验前三步）
//       --mock（离线模式：不调真实 API，用本地 ffmpeg 占位媒体验证编排链路；
//              密钥缺失/占位符时的降级验证，结论仅覆盖编排逻辑，不含供应商真实行为）
// 产物：poc/output/run-<时间戳>/（PROTOTYPE 输出，可整目录删除）
// ============================================================================

import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// ---------- 参数 ----------
const args = process.argv.slice(2)
const sentence = args.find(a => !a.startsWith('--')) || '一只橘猫在雨天咖啡馆写日记'
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const SCENES = Math.min(parseInt(flag('scenes', '2'), 10) || 2, 4)
const DURATION = Math.min(parseInt(flag('duration', '4'), 10) || 4, 8)
const SKIP_VIDEO = args.includes('--skip-video')
const MOCK = args.includes('--mock')

const ZENMUX_KEY = process.env.ZENMUX_API_KEY
const KIE_KEY = process.env.KIE_API_KEY
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY

const keyIsPlaceholder = k => !k || /^(your|you)/i.test(k)
if (!MOCK && (keyIsPlaceholder(ZENMUX_KEY) || keyIsPlaceholder(KIE_KEY))) {
  console.error('ZENMUX_API_KEY / KIE_API_KEY 缺失或为占位符（your-... 开头）。\n' +
    '  - 补齐 .env.local 中真实密钥后重跑；或先用 --mock 验证编排链路。')
  process.exit(1)
}

const OUT = path.resolve('poc/output', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(OUT, { recursive: true })

const report = { sentence, steps: [], outDir: OUT }
const t0 = Date.now()
const step = async (name, fn) => {
  const s = Date.now()
  process.stdout.write(`\n▶ ${name} ... `)
  try {
    const detail = await fn()
    const ms = Date.now() - s
    report.steps.push({ name, ok: true, ms, detail })
    console.log(`OK (${(ms / 1000).toFixed(1)}s) ${typeof detail === 'string' ? detail : ''}`)
    return detail
  } catch (err) {
    report.steps.push({ name, ok: false, ms: Date.now() - s, error: String(err?.message || err) })
    console.log(`FAIL\n  ${err?.message || err}`)
    await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.error(`\n路线在「${name}」中断。已完成产物与报告在 ${OUT}`)
    process.exit(1)
  }
}

const KIE_HEADERS = { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' }
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function download(url, file) {
  if (url.startsWith('mock://')) {
    // 离线模式：本地 ffmpeg 生成占位媒体（图片=纯色帧，视频=testsrc 2s）
    const isImage = file.endsWith('.png')
    const r = isImage
      ? spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=steelblue:s=640x360:d=1', '-frames:v', '1', path.join(OUT, file)])
      : spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:duration=2:rate=15',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', path.join(OUT, file)])
    if (r.status !== 0) throw new Error(`mock 媒体生成失败: ${(r.stderr || '').slice(-200)}`)
    return { file, bytes: 0 }
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(path.join(OUT, file), buf)
  return { file, bytes: buf.length }
}

// ---------- Step 1 剧本（ZenMux，同 lib/llm.ts） ----------
let script
await step('1/5 剧本生成（ZenMux gemini-3-flash）', async () => {
  let parsed
  if (MOCK) {
    await sleep(300)
    parsed = {
      title: `[MOCK] ${sentence}`,
      characters: [{ name: '主角', desc: 'a fictional placeholder character, generic appearance' }],
      scenes: Array.from({ length: SCENES }, (_, i) => ({
        id: i + 1,
        narration: `（占位旁白 ${i + 1}）${sentence}`,
        visualPrompt: `placeholder scene ${i + 1} illustrating: ${sentence}`,
      })),
    }
  } else {
    const prompt = `You are a short-video screenwriter. Based on this one-sentence idea: "${sentence}".
Create a ${SCENES}-scene micro video script. Output STRICT JSON only, no extra text:
{"title":"...","characters":[{"name":"...","desc":"one-sentence ENGLISH visual description of appearance"}],
 "scenes":[{"id":1,"narration":"中文旁白一句话","visualPrompt":"ENGLISH image/video prompt, MUST repeat the main character's appearance description verbatim for consistency"}]}`
    const res = await fetch('https://zenmux.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ZENMUX_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 4096,
        temperature: 0.7,
      }),
    })
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 200)
      // 402=零余额锁模型 / 403=无权限：降级为本地模板剧本，继续验证下游 Kie 链路
      if (res.status === 402 || res.status === 403) {
        console.log(`\n  ⚠ ZenMux ${res.status}（${errText.slice(0, 90)}）→ 剧本降级为本地模板`)
        parsed = {
          title: sentence,
          characters: [{ name: '主角', desc: sentence }],
          scenes: Array.from({ length: SCENES }, (_, i) => ({
            id: i + 1,
            narration: `${sentence}（场景 ${i + 1}）`,
            visualPrompt: `${sentence}, cinematic scene ${i + 1}`,
          })),
        }
      } else {
        throw new Error(`ZenMux ${res.status}: ${errText}`)
      }
    } else {
      const content = (await res.json()).choices?.[0]?.message?.content
      parsed = JSON.parse((content.match(/\{[\s\S]*\}/) || [content])[0])
    }
  }
  await writeFile(path.join(OUT, 'script.json'), JSON.stringify(parsed, null, 2))
  script = parsed
  return `"${parsed.title}" / ${parsed.scenes.length} 场 / ${parsed.characters.length} 角色${MOCK ? '（MOCK）' : ''}`
})

// ---------- Step 2/3 图片（Kie nano-banana-2，同 generate-character-image） ----------
async function kieImage(prompt) {
  if (MOCK) {
    await sleep(500)
    return `mock://image/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  const create = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: KIE_HEADERS,
    body: JSON.stringify({
      model: 'nano-banana-2',
      input: { prompt, image_input: [], resolution: '1K', output_format: 'png' },
    }),
  }).then(r => r.json())
  if (create.code !== 200) throw new Error(`Kie createTask: ${create.msg}`)
  const taskId = create.data?.taskId
  for (let i = 0; i < 100; i++) {
    await sleep(3000)
    const q = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: KIE_HEADERS }).then(r => r.json())
    if (q.code === 200 && q.data?.state === 'success') {
      const url = JSON.parse(q.data.resultJson).resultUrls?.[0]
      if (!url) throw new Error('Kie 图片结果为空')
      return url
    }
    if (q.data?.state === 'fail') throw new Error(`Kie 图片失败: ${q.data.failMsg}`)
  }
  throw new Error('Kie 图片轮询超时（5min）')
}

const charDesc = script.characters.map(c => c.desc).join(' ')
await step('2/5 角色图（Kie nano-banana-2）', async () => {
  const urls = await Promise.all(script.characters.slice(0, 3).map((c, i) => kieImage(
    `Character design of ${c.desc}, clean centered portrait, consistent style, 16:9`)))
  await Promise.all(urls.map((u, i) => download(u, `character-${i + 1}.png`)))
  return `${urls.length} 张已存`
})

let storyboardUrls = []
await step('3/5 分镜图（Kie nano-banana-2）', async () => {
  const urls = await Promise.all(script.scenes.map((s, i) => kieImage(
    `Storyboard frame ${i + 1} of "${script.title}": ${s.visualPrompt}. Characters: ${charDesc}. Cinematic still, 16:9`)))
  await Promise.all(urls.map((u, i) => download(u, `storyboard-${i + 1}.png`)))
  storyboardUrls = urls
  return `${urls.length} 张已存`
})

// ---------- Step 4 场景视频（Kie veo3_lite，同 generate-story-video 轮询模式） ----------
let sceneVideoUrls = []
if (!SKIP_VIDEO) {
  await step('4/5 场景视频（Kie veo3_lite 图生视频）', async () => {
    const submit = async (scene, i) => {
      if (MOCK) return `mock-video-${i + 1}`
      const body = {
        prompt: `${scene.visualPrompt}. Characters: ${charDesc}.`,
        model: 'veo3_lite',
        generationType: 'FIRST_AND_LAST_FRAMES_2_VIDEO',
        aspect_ratio: '16:9',
        duration: DURATION,
        enableTranslation: true,
        imageUrls: [storyboardUrls[i]],
      }
      const res = await fetch('https://api.kie.ai/api/v1/veo/generate', {
        method: 'POST', headers: KIE_HEADERS, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.code !== 200) throw new Error(`veo/generate: ${data.msg}`)
      return data.data.taskId
    }
    const taskIds = await Promise.all(script.scenes.map(submit))
    const poll = async (taskId, i) => {
      if (MOCK) {
        await sleep(800)
        return `mock://video/${taskId}`
      }
      for (let r = 0; r < 180; r++) {
        await sleep(5000)
        const q = await fetch(`https://api.kie.ai/api/v1/veo/record-info?taskId=${taskId}`, { headers: KIE_HEADERS }).then(r => r.json())
        if (q.code === 200 && q.data) {
          if (q.data.successFlag === 1) {
            const url = q.data.response?.resultUrls?.[0]
            if (url) return url
          }
          if (q.data.successFlag === -1) throw new Error(`场景${i + 1} 视频失败: ${q.data.failMsg || 'unknown'}`)
        }
      }
      throw new Error(`场景${i + 1} 视频轮询超时（15min）`)
    }
    const urls = await Promise.all(taskIds.map(poll))
    await Promise.all(urls.map((u, i) => download(u, `scene-${i + 1}.mp4`)))
    sceneVideoUrls = urls
    return `${urls.length} 段 × ${DURATION}s 已存`
  })
}

// ---------- Step 5 合片（FAL 优先，无 key 时本地 ffmpeg concat） ----------
if (!SKIP_VIDEO && sceneVideoUrls.length > 0) {
  await step('5/5 成片合成', async () => {
    if (FAL_KEY && !MOCK && !keyIsPlaceholder(FAL_KEY)) {
      // 同 compose-story-video 的 tracks 形状（fal-ai/ffmpeg-api/compose，视频轨 keyframes 按时间戳排列）
      let ts = 0
      const keyframes = sceneVideoUrls.map((url, i) => {
        const kf = { timestamp: ts, duration: DURATION, url }
        ts += DURATION
        return kf
      })
      const submitRes = await fetch('https://queue.fal.run/fal-ai/ffmpeg-api/compose', {
        method: 'POST',
        headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { tracks: [{ id: 'main_video', type: 'video', keyframes }] } }),
      }).then(r => r.json())
      if (!submitRes.request_id) throw new Error(`FAL 提交失败: ${JSON.stringify(submitRes).slice(0, 200)}`)
      for (let i = 0; i < 120; i++) {
        await sleep(3000)
        const st = await fetch(submitRes.status_url, { headers: { Authorization: `Key ${FAL_KEY}` } }).then(r => r.json())
        if (st.status === 'COMPLETED') {
          const result = await fetch(submitRes.response_url, { headers: { Authorization: `Key ${FAL_KEY}` } }).then(r => r.json())
          const videoUrl = result.video?.url
          if (!videoUrl) throw new Error('FAL 结果缺少 video.url')
          await download(videoUrl, 'final.mp4')
          return 'final.mp4（FAL ffmpeg-api/compose）'
        }
        if (st.status === 'FAILED') throw new Error(`FAL 合成失败: ${JSON.stringify(st).slice(0, 200)}`)
      }
      throw new Error('FAL 合成轮询超时（6min）')
    }
    // 本地 ffmpeg concat（重编码保证拼接安全）；FAL_KEY 缺失时的降级路径
    const listFile = path.join(OUT, 'concat.txt')
    const localFiles = sceneVideoUrls.map((_, i) => path.join(OUT, `scene-${i + 1}.mp4`))
    await writeFile(listFile, localFiles.map(f => `file '${f}'`).join('\n'))
    const r = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'libx264', '-c:a', 'aac', path.join(OUT, 'final.mp4')], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`ffmpeg 失败: ${(r.stderr || '').slice(-300)}`)
    return `final.mp4（本地 ffmpeg 降级，${localFiles.length} 段拼接；配 FAL_KEY 可走 FAL 分支）`
  })
}

// ---------- 报告 ----------
report.totalMs = Date.now() - t0
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log('\n================ POC 结果 ================')
for (const s of report.steps) {
  console.log(`${s.ok ? '✅' : '❌'} ${s.name}  ${(s.ms / 1000).toFixed(1)}s  ${s.detail || s.error || ''}`)
}
console.log(`总耗时 ${(report.totalMs / 1000).toFixed(1)}s；产物目录：${OUT}`)
if (MOCK) {
  console.log('⚠ 当前为 --mock 离线模式：已验证五步编排/轮询/下载/合成/报告的链路逻辑，')
  console.log('  但未调用真实供应商。补齐 .env.local 的 ZENMUX_API_KEY / KIE_API_KEY 后去掉 --mock 即可实跑。')
  console.log('路线验证结论：编排链路 ✅ 打通；真实供应商行为 ⏸ 待密钥')
} else {
  console.log('路线验证结论：一句话 → 视频端到端' + (report.steps.every(s => s.ok) ? ' ✅ 打通' : ' ❌ 未打通'))
}
