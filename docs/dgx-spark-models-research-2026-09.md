# DGX Spark 模型选型调研（2026-09）

> 调研日期：2026-09-05。针对 NVIDIA DGX Spark（GB10 Grace Blackwell，128GB 统一 LPDDR5x，273GB/s 带宽，ARM64，DGX OS 7）单机单用户、隐私优先、单并发可接受的视频生产流水线：剧本 LLM → 分镜 LLM → 文生图 → 图生视频 → ffmpeg 合成。
> 调研方法：以一手来源为主（官方模型卡、官方 GitHub、NVIDIA 官方文档/playbooks）。无法从一手来源核实的内容显式标注「未核实」。

---

## 0. 平台事实（DGX Spark）

| 项目 | 事实 | 来源 |
| --- | --- | --- |
| 芯片 | GB10 Grace Blackwell Superchip，20 核 Arm CPU（10× Cortex-X925 + 10× Cortex-A725） | [NVIDIA 官方产品页](https://www.nvidia.com/en-us/products/workstations/dgx-spark/) |
| 内存 | 128GB LPDDR5x，256-bit，一致统一内存，带宽 273GB/s | 同上 |
| 算力 | FP4 理论峰值 1 PFLOP（官方脚注注明为"使用稀疏特性的理论 FP4 TOPS"） | 同上 |
| 官方模型规模口径 | 推理最大 200B 参数模型；微调最大 70B；4 台 ConnectX 互联可到 700B | 同上 |
| 存储 | 4TB 自加密 NVMe M.2 | 同上 |
| OS | DGX OS 7（Ubuntu 24.04 底座）；Spark 出厂 7.2.3，2026-02 发布 7.4.0（CUDA 13.0 Update 2） | [DGX OS 7 Release Notes](https://docs.nvidia.com/dgx/dgx-os-7-user-guide/release_notes.html)、[NVIDIA 论坛 7.4.0 公告](https://forums.developer.nvidia.com/t/new-dgx-os-7-4-0/359550)（版本号 7.2.3/7.4.0 具体值来自 NVIDIA 论坛，属半官方，官方文档页只写"DGX OS"） |
| 模型安装官方机制 | ① 官方 playbooks 仓库 `NVIDIA/dgx-spark-playbooks`（含 ollama / vllm / sglang / comfy-ui / trt-llm / llama-cpp / lm-studio / nvfp4-quantization 等 30+ 篇）；② Ollama 与 NVIDIA 官方合作、Spark 开箱即用；③ NGC 容器（`nvcr.io/nvidia/vllm`、`nvcr.io/nvidia/sglang`） | [dgx-spark-playbooks](https://github.com/nvidia/dgx-spark-playbooks)、[Ollama 官方博客](https://ollama.com/blog/nvidia-spark)、[NGC vLLM 容器](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm) |
| 统一内存（UMA）坑 | 官方多个 playbook 明确提示：即使内存没满也可能 OOM，需手动清 buffer cache：`sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'` | [ComfyUI playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/comfy-ui/README.md) |

PyTorch/ComfyUI 轮子口径：官方 ComfyUI playbook 用 `pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu130`（CUDA 13.0，2025-11 更新），arm64 原生支持。来源：[ComfyUI playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/comfy-ui/README.md)。

---

## 1. 视频（主选，用户已定）：MiniMax H3

**「H3」确为真实开源发布**，不是俗称：官方名 `MiniMax H3`（Hailuo 产品线第三代，Hailuo 01 / Hailuo 02 之后首个开放权重版本）。

### 事实清单

- **HF 仓库**：[`MiniMaxAI/MiniMax-H3`](https://huggingface.co/MiniMaxAI/MiniMax-H3)，许可证 `minimax-h3-community-license-agreement`（社区许可，非标准 OSI；具体商用条款见仓库 License 章节，官方提供 Q&A 与申请表）。
- **架构**：H3-Omni-Transformer 为 33B dense 单流 DiT（约 13B 参数在 AdaLN 分支，纯推理可不加载）；文本编码器复用 Qwen3-VL-32B 全量预训练权重（取第 50 层 hidden states）。开源发布为 CFG 蒸馏权重，BF16。
- **能力**：输出 4–15 秒、24FPS、默认短边 768p、原生立体声 32kHz；支持多种宽高比（21:9…9:16）。三个模块中仅 **H3-Base** 开源；**H3-Context-IR**（指令精修）与 **H3-Regenerate-2K**（2K 重生成）官方明确不开源，只能走 MiniMax API。
- **图生视频**：两个任务 checkpoint——
  - `FL2VA`：零/一/两张图输入 → 纯文生视频 / **首帧→视频 / 尾帧→视频 / 首+尾帧→视频**（fl2va 任务），满足流水线的 first-frame 与 first/last-frame I2V 需求；
  - `Ref2VA`：≤9 图 + ≤3 视频 + ≤3 音频参考（omni-reference，可做角色/动作/音色延续）。
- **官方推荐推理栈**（模型卡原文）：SGLang（附 cookbook）、vLLM（附 recipes）、diffusers（`ModularPipeline.from_pretrained`）、ComfyUI（官方模板 T2V/I2V/R2V）。SGLang 示例为多卡命令（`--num-gpus 4`），单卡 128GB 场景主要走 ComfyUI/diffusers。

### 量化形态

- **ComfyUI 官方重打包**：[`Comfy-Org/MiniMax-H3`](https://huggingface.co/Comfy-Org/MiniMax-H3)。ComfyUI Day-0 支持（2026-08-03）：把 AdaLN 调制权重（约 40% 参数）替换为等价查找表 + **int8 convrot 量化** + 自定义 kernel，内存占用从 123.6GB 降到 **42.5GB**（最小变体），配合动态 offload 官方称 RTX 3060 都能跑。128GB Spark 上 42.5GB 可常驻。来源：[ComfyUI 官方博客 Day-0](https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui)。
- **GGUF**：社区多个版本（如 [`unsloth/MiniMax-H3-GGUF`](https://huggingface.co/unsloth/MiniMax-H3-GGUF)（Q2–Q8）、[`leejet/MiniMax-H3-GGUF`](https://huggingface.co/leejet/MiniMax-H3-GGUF)（stable-diffusion.cpp 路线 + ComfyUI 自定义节点教程））。注意 `city96/ComfyUI-GGUF` 官方支持仍是 [open issue #471](https://github.com/city96/ComfyUI-GGUF/issues/471)，文本编码器（Qwen3-VL-32B）也需一起量化。HF 模型树显示共 59 个量化版本。
- **加速 LoRA**：官方 Space 有 `MiniMaxAI/MiniMax-H3-Turbo-Lora` 及多个 4-step 快速变体（fasth3-4step 等，质量未核实）。
- FP8/INT8 官方量化：官方仓库仅 BF16；int8 convrot 是 ComfyUI 官方重打包内置（见上）；独立 FP8 官方发布未核实。

### Spark 级硬件耗时参考

- 一手耗时数据无；二手基准：单张 RTX 5090 上 15 秒 1080p 片段 625s（~10.4 分钟），经 14 步采样 + SageAttention 2.2.0 + 离线 VSR 放大优化后 314s（~5.2 分钟）。来源：[ai-muninn 基准](https://ai-muninn.com/en/blog/minimax-h3-rtx5090-speedup-vsr)（二手，未核实）。Spark 的 FP16/BF16 算力显著低于 5090（无张量稀疏时差距更大），实际耗时应按更慢估计，**未核实**。

### 安装方式（推荐：ComfyUI 官方路径）

```bash
# Spark 上按官方 playbook 装 ComfyUI（venv + cu130 torch）
python3 -m venv comfyui-env && source comfyui-env/bin/activate
pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu130
git clone https://github.com/comfyanonymous/ComfyUI.git && cd ComfyUI && pip install -r requirements.txt
# 升级 ComfyUI ≥ 0.30.0 后，模板库直接搜 MiniMax H3（T2V / I2V / R2V 模板）
python main.py --listen 0.0.0.0   # 端口 8188
# 模型：从 Comfy-Org/MiniMax-H3 按 workflow 内说明下载到对应目录
```

来源：[ComfyUI playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/comfy-ui/README.md)、[ComfyUI Day-0 博客](https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui)。

---

## 2. 视频（备选）：LTX-2（Lightricks）

- **权重+代码开放**：官方 PR 定位"first production-ready open-source AI video foundation model with truly open weights"；LICENSE 定义覆盖"trained model weights, parameters, machine-learning model code"及推理/训练/微调代码。来源：[PR Newswire 官方通稿](https://www.prnewswire.com/news-releases/lightricks-releases-ltx-2-the-first-complete-open-source-ai-video-foundation-model-302593012.html)、[HF LICENSE](https://huggingface.co/Lightricks/LTX-2/blob/main/LICENSE)。
- **许可**：`ltx-2-community-license-agreement`（非 OSI 开源）。年营收 < $10M 的主体免 fees 可商用（含输出）；≥ $10M 须购买商业许可，违规有双倍赔偿金条款；另有 20 条使用限制（不得训练其他模型、不得用于竞品等）。对本项目（单用户自用）无障碍。来源：[HF LICENSE 全文](https://huggingface.co/Lightricks/LTX-2/blob/main/LICENSE)。
- **同步音频**：DiT 单模型联合生成同步视频+音频（论文：[LTX-2: Efficient Joint Audio-Visual Foundation Model](https://arxiv.org/html/2601.03233v1)），另有 audio-only 模式节点（LTXVAudioOnlyModel）。
- **规格**：HF 模型卡仅给约束（宽高被 32 整除、帧数 8n+1）；diffusers 示例 768×512@121 帧/24fps（~5 秒）；"4K@50fps、10 秒"来自官方通稿口径（[PR Newswire](https://www.prnewswire.com/news-releases/lightricks-releases-ltx-2-the-first-complete-open-source-ai-video-foundation-model-302593012.html)）；社区长视频方案称 60 秒+（[Lightricks/ltx-video 官方仓库](https://github.com/Lightricks/ltx-video)，二手口径，未核实）。
- **变体与量化**：`ltx-2-19b-dev`（bf16，另有 **fp8 与 nvfp4/fp4** 官方量化）、`ltx-2-19b-distilled`（8 步 CFG=1）、distilled-LoRA-384、空间/时间 ×2 上采样器。19B fp8 ≈ 19GB 级，128GB Spark 轻松容纳。来源：[HF Lightricks/LTX-2](https://huggingface.co/Lightricks/LTX-2)。
- **ComfyUI**：原生内置 LTXVideo 节点（ComfyUI Manager 可装），官方模板含 T2V/I2V 等 6 种工作流；支持 I2V。首尾帧模式在 LTX-2.3 的社区 Space 有（"LTX-2-3-First-Last-Frame"），主模型卡未文档化首尾帧条件输入——**未核实**。来源：[ComfyUI 官方教程](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3)、[Lightricks/ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo)。
- 现有更新版本 LTX-2.3 / LTX-2.5（HF 有 `Lightricks/LTX-2.3`），ComfyUI 模板以 2.3 为准。

---

## 3. 文本（用户已跑 "qwen3.8-27b"，实为 Qwen3-30B-A3B MoE）

**结论：DGX Spark 上官方推荐路径是 Ollama（与 NVIDIA 官方合作、开箱预装）**；vLLM/SGLang 官方 Spark playbook 的支持矩阵截至 playbook 更新日均未列 Qwen3-30B-A3B（vLLM 矩阵只有 Qwen3-8B/14B/32B 密稠模型 + NVFP4 量化）。

- **Ollama 官方支持 Spark**：[Ollama 官方博客](https://ollama.com/blog/nvidia-spark)（"Ollama has partnered with NVIDIA to ensure it runs fast and efficiently out-of-the-box"，128GB 可跑 Qwen/DeepSeek/Llama 等）。官方 playbook 首步即为检查预装 Ollama。来源：[dgx-spark-playbooks ollama](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/ollama/README.md)。
- **安装/运行**：

```bash
curl -fsSL https://ollama.com/install.sh | sh   # 若未预装
ollama pull qwen3:30b-a3b-instruct-2507         # MoE，q4_K_M 19GB，256K 上下文
# OpenAI 兼容端点：http://localhost:11434/v1/chat/completions
```

  Ollama 库页：`qwen3:30b-a3b-instruct-2507`（q4_K_M 19GB / q8_0 32GB / fp16 61GB，256K ctx）。来源：[ollama.com/library/qwen3/tags](https://ollama.com/library/qwen3/tags)、[playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/ollama/README.md)。
- **严格 JSON（流水线硬需求）**：Ollama 原生 `/api/chat` 用 `format` 字段传 JSON Schema；OpenAI 兼容端点经 `response_format` 支持结构化输出（官方文档原文："Structured outputs work through the OpenAI-compatible API via `response_format`"，并建议温度 0 + prompt 内同样附 schema）。来源：[Ollama 结构化输出文档](https://docs.ollama.com/capabilities/structured-outputs)。
- **vLLM（备选）**：官方 Spark playbook 用 NGC 容器 `nvcr.io/nvidia/vllm:<ver>`，OpenAI 兼容 `/v1/chat/completions` 原生支持，结构化输出为 vLLM 内建（structured outputs / guided json）。矩阵未列 Qwen3-30B-A3B，但 playbook 提示可用 [nvfp4-quantization playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/nvfp4-quantization/README.md) 自行量化模型。来源：[vLLM playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/vllm/README.md)。
- **SGLang（备选）**：NGC 容器 `nvcr.io/nvidia/sglang:26.02-py3`，矩阵同样未列 Qwen3-30B-A3B。来源：[SGLang playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/sglang/README.md)。
- 注意：用户口中的 "qwen3.8-27b" 无此官方型号；最接近的官方型号为 Qwen3-30B-A3B（MoE，激活 3B）。Ollama tag `qwen3:30b-a3b` 已指向 2507 版。未发现 "Qwen3.8" 官方发布——按用户实际跑的 tag 核对即可。

---

## 4. 图像（需选型）：三个候选 + OpenAI-images 兼容服务方案

### 候选对比

| 模型 | 规模/显存 | 许可 | 中文渲染 | 角色一致性 | ComfyUI | 量化 |
| --- | --- | --- | --- | --- | --- | --- |
| [FLUX.2-dev](https://huggingface.co/black-forest-labs/FLUX.2-dev)（BFL） | 32B BF16（权重 ~64GB 级），128GB Spark 可全量；官方示范 4-bit 加载 | **FLUX [dev] Non-Commercial License**（权重非商用，输出可商用，gated） | 模型卡以示例演示文字渲染（hex 色卡文字），未列中文专项能力（未核实） | 模型卡提及 editing/多图组合；PuLID/IPAdapter 生态未核实 | 官方确认支持（"available in both ComfyUI and Diffusers"） | HF 模型树 15 个量化（含官方 diffusers bnb-4bit） |
| [Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)（阿里 Tongyi-MAI） | 6B，"fits comfortably within 16G VRAM"，8 NFE 准亚秒级（H800 口径） | **Apache-2.0** | 明确强项："excels at accurately rendering complex Chinese and English text" | 家族有 Z-Image-Edit；官方教程提供 ControlNet Union（Canny/Depth/Pose 等，`Z-Image-Turbo-Fun-Controlnet-Union`） | 原生支持（官方模板库） | 73 个社区量化 |
| [Qwen-Image](https://huggingface.co/Qwen/Qwen-Image)（阿里 Qwen） | 20B MMDiT；ComfyUI 官方分发 **bf16 40.9GB / fp8 20.4GB** + Qwen2.5-VL-7B fp8 文本编码器 | **Apache-2.0** | 官方主推卖点："exceptional performance in text rendering, especially for Chinese" | InstantX Union ControlNet（pose/canny/depth…）+ Lightx2v 8-step Lightning LoRA + DiffSynth patches；Qwen-Image-Edit 独立模型 ComfyUI 原生支持（2509 版，[ComfyUI 官方博客](https://blog.comfy.org/p/wan22-animate-qwen-image-edit-2509-native-support-in-comfyui)） | 原生支持（模板库搜 Qwen-Image） | 官方 fp8 直接可用；HF 模型树 30 个量化 |

推荐：**首选 Qwen-Image（fp8）**——Apache-2.0 + 中文渲染第一梯队 + 角色一致性工具链齐全 + 128GB 内全组件常驻无压力；**次选 Z-Image-Turbo**（快、轻、Apache-2.0，用于草稿/批量）；FLUX.2-dev 因权重非商用许可 + 中文未核实，仅作质量上限参考。

### OpenAI-images 兼容端点（关键风险区）

- **vLLM 核心：不支持 `/v1/images/generations`**。该端点在 **vLLM-Omni**（扩散流水线扩展）里：`/v1/images/generations`、`/v1/videos`、`/v1/audio/speech`，支持 `Qwen/Qwen-Image` 等。**但 NVIDIA Dynamo 官方文档明示："vLLM-Omni is currently only installed on `amd64` builds"，arm64 容器构建会跳过安装、功能不可用** → **DGX Spark（ARM64）上此路官方不通**。来源：[NVIDIA Dynamo vLLM-Omni 文档](https://docs.nvidia.com/dynamo/v1.3.0/backends/v-llm/v-llm-omni)、[vLLM-Omni GLM-Image 示例](https://docs.vllm.ai/projects/vllm-omni/en/v0.18.0/user_guide/examples/online_serving/glm_image/)。
- **ComfyUI 原生无 OpenAI 兼容 API**（官方 repo 有 [feature 讨论issue #15310](https://github.com/Comfy-Org/ComfyUI/issues/15310)，未落地）。社区 shim：[`pnyxai/comfyui-openai-api`](https://github.com/pnyxai/comfyui-openai-api)——Rust/Axum 反向代理，`POST /v1/images/generations` → ComfyUI workflow JSON（`model` 字段选 workflow，自动 patch 宽高/prompt 节点），仅返回 `b64_json`；支持 prompt/negative_prompt/size/n。**风险：无 LICENSE 文件、7 commits、15 stars，极早期**。自建薄 FastAPI 包装（ComfyUI `/prompt` API 提交 workflow + 轮询 `/history`）是更稳的等价方案（方案本身为工程常识，非官方来源）。
- **NVIDIA 官方 recipe：无**针对 Spark 的图像 OpenAI 兼容服务 playbook（playbooks 仓库只有 ComfyUI 网页 UI 用法）。未核实到其他官方方案。

---

## 5. 可选：中文旁白 TTS

**唯一推荐：Qwen3-TTS**（官方开源，Apache-2.0）。

- [`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)（另有 0.6B 与 Base 变体；Base 支持 3 秒快速音色克隆）。覆盖含中文在内的 10 语言。
- 安装：`pip install -U qwen-tts`（官方推荐路径）；vLLM Day-0 支持经 vLLM-Omni 但**当前仅 offline inference**（且 vLLM-Omni 不支持 arm64，见上）。128GB Spark 用 transformers/qwen-tts 路径绰绰有余。

---

## 6. 总结表

| 能力 | 选型 | 量化形态 | 服务栈 | 安装方式 | 关键风险 |
| --- | --- | --- | --- | --- | --- |
| 视频（主） | **MiniMax H3**（`MiniMaxAI/MiniMax-H3`，FL2VA checkpoint） | ComfyUI 官方重打包 int8 convrot（42.5GB，`Comfy-Org/MiniMax-H3`）；社区 GGUF Q2–Q8 | ComfyUI ≥0.30.0（T2V/I2V/R2V 模板）；备选 diffusers/SGLang/vLLM | ComfyUI playbook（cu130 torch）+ 模板库 | H3-Context-IR/2K 不开源（仅 768p 本地）；社区许可非 OSI；Spark 实际耗时未核实（5090 二手口径 5–10 分钟/15s 片段） |
| 视频（备） | **LTX-2**（`Lightricks/LTX-2`，19B） | 官方 bf16/fp8/nvfp4 + distilled 8 步 | ComfyUI 原生 LTXVideo 节点 | ComfyUI Manager / [HF 模型卡](https://huggingface.co/Lightricks/LTX-2) | 社区许可：年营收 ≥$10M 须付费许可；首尾帧条件输入未核实 |
| 文本（剧本+分镜） | **Qwen3-30B-A3B-Instruct-2507** | q4_K_M（19GB）可升 q8_0（32GB） | **Ollama**（官方合作预装），OpenAI 兼容 `/v1/chat/completions` + `response_format` JSON Schema | `ollama pull qwen3:30b-a3b-instruct-2507` | "qwen3.8-27b" 非官方型号名；Ollama OpenAI 兼容层覆盖面小于原生 API（用 `format` 字段最稳） |
| 文生图 | **Qwen-Image**（20B，Apache-2.0）；草稿用 Z-Image-Turbo（6B） | 官方 fp8（20.4GB）+ fp8 文本编码器；或 bf16（40.9GB） | ComfyUI 原生（模板库） | 下载 Comfy-Org 分发文件至 `models/diffusion_models|text_encoders|vae` | OpenAI-images 兼容端点无官方方案：vLLM-Omni 不支持 arm64；pnyxai shim 无 LICENSE 且极早期 → 建议自建薄包装或直接用 ComfyUI `/prompt` API |
| 可选 TTS | **Qwen3-TTS-12Hz-1.7B-CustomVoice**（Apache-2.0） | BF16（~2B 参数，无需量化） | `qwen-tts` pip 包 / transformers | `pip install -U qwen-tts` | vLLM 在线 serving 不可用（arm64）；克隆用 Base 变体 |
| 平台 | DGX OS 7（Ubuntu 24.04，CUDA 13.0） | — | Ollama 预装；NGC 容器（vllm/sglang）；playbooks 仓库 | `NVIDIA/dgx-spark-playbooks` | UMA 内存需手动 `drop_caches`；官方口径推理上限 200B / 微调 70B |

---

## 附：主要来源索引

- MiniMax H3：[HF 模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3) · [MiniMax 官方博客](https://www.minimax.io/blog/minimax-h3) · [ComfyUI Day-0 博客](https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui) · [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) · [unsloth GGUF](https://huggingface.co/unsloth/MiniMax-H3-GGUF) · [city96 issue #471](https://github.com/city96/ComfyUI-GGUF/issues/471) · [5090 基准（二手）](https://ai-muninn.com/en/blog/minimax-h3-rtx5090-speedup-vsr)
- LTX-2：[HF 模型卡](https://huggingface.co/Lightricks/LTX-2) · [LICENSE](https://huggingface.co/Lightricks/LTX-2/blob/main/LICENSE) · [官方通稿](https://www.prnewswire.com/news-releases/lightricks-releases-ltx-2-the-first-complete-open-source-ai-video-foundation-model-302593012.html) · [ComfyUI 教程](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3) · [Lightricks/ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo)
- 文本：[Ollama×NVIDIA 博客](https://ollama.com/blog/nvidia-spark) · [qwen3 tags](https://ollama.com/library/qwen3/tags) · [结构化输出文档](https://docs.ollama.com/capabilities/structured-outputs) · [vLLM playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/vllm/README.md) · [SGLang playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/sglang/README.md)
- 图像：[FLUX.2-dev](https://huggingface.co/black-forest-labs/FLUX.2-dev) · [Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) · [Z-Image ComfyUI 教程](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) · [Qwen-Image](https://huggingface.co/Qwen/Qwen-Image) · [Qwen-Image ComfyUI 教程](https://docs.comfy.org/tutorials/image/qwen/qwen-image) · [Dynamo vLLM-Omni（arm64 不支持）](https://docs.nvidia.com/dynamo/v1.3.0/backends/v-llm/v-llm-omni) · [pnyxai/comfyui-openai-api](https://github.com/pnyxai/comfyui-openai-api) · [ComfyUI issue #15310](https://github.com/Comfy-Org/ComfyUI/issues/15310) · [FLUX.2-klein-4B（Apache-2.0）](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- TTS：[Qwen3-TTS-12Hz-1.7B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)
- 平台：[DGX Spark 产品页](https://www.nvidia.com/en-us/products/workstations/dgx-spark/) · [dgx-spark-playbooks](https://github.com/nvidia/dgx-spark-playbooks) · [ComfyUI playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/master/nvidia/comfy-ui/README.md) · [DGX OS 7 release notes](https://docs.nvidia.com/dgx/dgx-os-7-user-guide/release_notes.html) · [7.4.0 论坛公告](https://forums.developer.nvidia.com/t/new-dgx-os-7-4-0/359550)
