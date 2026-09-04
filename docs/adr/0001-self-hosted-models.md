# ADR-0001: 自建模型接入——统一契约、运营无感、云端回退

- Status: Accepted
- Date: 2026-09-04
- Decided via: /grill-with-docs 会话（五步流程全模型自建接入功能）

## Context

五步成片流程中，剧本/分镜（ZenMux Gemini 系）、图像（Kie nano-banana-2）、视频（Kie 12 档）全部依赖云端供应商；合成已是自托管 Trigger+ffmpeg。动机（用户确认全选）：省成本（视频占 ~85% 成本）、供应商去风险（Kie/ZenMux 单点）、数据隐私、战略能力。硬件：用户持有 DGX Spark（MoE 文案/图像已验证，视频慢但可跑）。现状：`provider_routes` 表（迁移 0011）有读取无写入方，文本/图像模型 id 散落硬编码在各 route。

## Decision

1. **定位：运营全局无感**。管理后台配置每步的生效模型（云端默认或自建端点），成片 UI 与计费同价不变，用户无感知。
2. **统一契约**。文本/图像：自建侧暴露 OpenAI 兼容接口（vLLM/Ollama 原生，ComfyUI 前挂兼容网关）；视频（二期）：submit/poll 异步任务契约，对齐现有 taskType/轮询形状。新接自建服务只写一份 adapter。
3. **自动云端回退**。自建失败/超时自动改用该步云端默认模型，任务照常成功；回退事件进 trackFunnelEvent。不做 fail-closed（moderation 人质教训的镜像）。
4. **密钥存 DB、掩码返回**。admin API 永远只返回 key 末 4 位；后台改 key 即时生效不重部署。实现须带列级防护+测试（admin 曾有敏感列泄漏 P0）。
5. **健康检查一期只做手动「测试连接」**，不做定时探活/自动摘除。
6. **全量切，不做灰度**。DGX 单机并发有限，高峰超时回退兜底，接受。
7. **两期**：一期文本两步+图像（FLUX.2 via ComfyUI+网关）；二期视频。合成步已自建，不在范围。

## Consequences

- `provider_routes` 获得首个写入方；散落硬编码的文本/图像模型 id 收敛到路由表。
- DGX 生产暴露方案未定（家宽/内网）——base_url 可配置不阻塞开发，一期验收先本地 dev 指局域网 DGX，生产验收等暴露方案落地（Cloudflare Tunnel 候选）。
- 无感全量切下，自建容量即全站容量上限；回退率是观察容量的核心指标。
- 视频二期动工前须先解决时长/分辨率计费口径在自建契约下的映射（video-pricing 唯一事实源不许旁路）。
