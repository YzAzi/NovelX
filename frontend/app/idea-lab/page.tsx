"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Lightbulb,
  Sparkles,
} from "lucide-react"

import {
  AUTH_EXPIRED_EVENT,
  createOutline,
  createOutlineChannel,
  formatUserErrorMessage,
  generateIdeaLabStage,
  getAuthToken,
  getCurrentUser,
  updateProjectTitle,
} from "@/src/lib/api"
import { WebSocketClient } from "@/src/lib/websocket"
import { useProjectStore } from "@/src/stores/project-store"
import type { AuthUser, IdeaLabStage, IdeaLabStageOption, IdeaLabStageResponse } from "@/src/types/models"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const IDEA_STAGES: IdeaLabStage[] = ["concept", "protagonist", "conflict", "outline"]

const IDEA_STAGE_LABELS: Record<IdeaLabStage, string> = {
  concept: "故事方向",
  protagonist: "主角方案",
  conflict: "核心冲突",
  outline: "成稿方向",
}

function parseStyleTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function IdeaLabPage() {
  const router = useRouter()
  const { projects, loadProjects, setOutlineProgressStage, setProject } = useProjectStore()

  const [authChecking, setAuthChecking] = useState(true)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [seedInput, setSeedInput] = useState("")
  const [worldView, setWorldView] = useState("")
  const [styleTagsText, setStyleTagsText] = useState("")
  const [baseProjectId, setBaseProjectId] = useState("")
  const [stageFeedback, setStageFeedback] = useState("")
  const [activeStageIndex, setActiveStageIndex] = useState(0)
  const [stageResults, setStageResults] = useState<Partial<Record<IdeaLabStage, IdeaLabStageResponse>>>({})
  const [selectedIndices, setSelectedIndices] = useState<Partial<Record<IdeaLabStage, number>>>({})
  const [stageError, setStageError] = useState<string | null>(null)
  const [isGeneratingStage, setIsGeneratingStage] = useState(false)
  const [isCreatingProject, setIsCreatingProject] = useState(false)

  const wsRef = useRef<WebSocketClient | null>(null)
  const outlineProgressUnsubRef = useRef<(() => void) | null>(null)

  const activeStage = IDEA_STAGES[activeStageIndex]
  const activeResponse = stageResults[activeStage] ?? null
  const activeSelectedIndex = selectedIndices[activeStage]
  const activeSelectedOption =
    activeResponse && activeSelectedIndex !== undefined
      ? activeResponse.options[activeSelectedIndex] ?? null
      : null
  const previousStage = activeStageIndex > 0 ? IDEA_STAGES[activeStageIndex - 1] : null
  const previousSelectedOption =
    previousStage !== null
      ? (() => {
          const response = stageResults[previousStage]
          const index = selectedIndices[previousStage]
          if (!response || index === undefined) {
            return null
          }
          return response.options[index] ?? null
        })()
      : null

  const selectedPath = useMemo(
    () =>
      IDEA_STAGES.map((stage) => {
        const response = stageResults[stage]
        const index = selectedIndices[stage]
        if (!response || index === undefined) {
          return null
        }
        return {
          stage,
          label: IDEA_STAGE_LABELS[stage],
          option: response.options[index] ?? null,
        }
      }).filter((item): item is { stage: IdeaLabStage; label: string; option: IdeaLabStageOption } => Boolean(item?.option)),
    [selectedIndices, stageResults],
  )

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      if (!getAuthToken()) {
        router.replace("/")
        return
      }

      try {
        const user = await getCurrentUser()
        if (cancelled) {
          return
        }
        setAuthUser(user)
        await loadProjects()
      } catch {
        if (!cancelled) {
          router.replace("/")
        }
      } finally {
        if (!cancelled) {
          setAuthChecking(false)
        }
      }
    }

    const handleAuthExpired = () => {
      router.replace("/")
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    void bootstrap()

    return () => {
      cancelled = true
      outlineProgressUnsubRef.current?.()
      outlineProgressUnsubRef.current = null
      wsRef.current?.disconnect()
      wsRef.current = null
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    }
  }, [loadProjects, router, setOutlineProgressStage])

  const clearStagesAfter = (stageIndex: number) => {
    setStageResults((prev) => {
      const next = { ...prev }
      IDEA_STAGES.slice(stageIndex + 1).forEach((stage) => {
        delete next[stage]
      })
      return next
    })
    setSelectedIndices((prev) => {
      const next = { ...prev }
      IDEA_STAGES.slice(stageIndex + 1).forEach((stage) => {
        delete next[stage]
      })
      return next
    })
  }

  const requestStage = async (stage: IdeaLabStage, selectedOption?: IdeaLabStageOption | null) => {
    setIsGeneratingStage(true)
    setStageError(null)
    try {
      const response = await generateIdeaLabStage({
        stage,
        seed_input: seedInput.trim() || undefined,
        world_view: worldView.trim() || undefined,
        style_tags: parseStyleTags(styleTagsText),
        base_project_id: baseProjectId || undefined,
        feedback: stageFeedback.trim() || undefined,
        selected_option: selectedOption ?? undefined,
      })
      setStageResults((prev) => ({ ...prev, [stage]: response }))
      setSelectedIndices((prev) => {
        const next = { ...prev }
        delete next[stage]
        return next
      })
      setActiveStageIndex(IDEA_STAGES.indexOf(stage))
      setStageFeedback("")
    } catch (error) {
      setStageError(formatUserErrorMessage(error, "生成阶段方案失败，请稍后重试。"))
    } finally {
      setIsGeneratingStage(false)
    }
  }

  const handleStart = async () => {
    setActiveStageIndex(0)
    setStageError(null)
    setStageFeedback("")
    clearStagesAfter(-1)
    await requestStage("concept", null)
  }

  const handleSelectOption = (index: number) => {
    setSelectedIndices((prev) => ({ ...prev, [activeStage]: index }))
    clearStagesAfter(activeStageIndex)
    setStageError(null)
  }

  const handleNext = async () => {
    if (!activeSelectedOption) {
      setStageError("请先从当前阶段的 3 个方向中选一个。")
      return
    }

    const nextStage = IDEA_STAGES[activeStageIndex + 1]
    if (!nextStage) {
      return
    }
    await requestStage(nextStage, activeSelectedOption)
  }

  const handleBack = () => {
    setStageError(null)
    setStageFeedback("")
    setActiveStageIndex((current) => Math.max(current - 1, 0))
  }

  const handleRegenerateStage = async () => {
    if (activeStage !== "concept" && !previousSelectedOption) {
      setStageError("请先完成上一步选择，再重新生成当前阶段。")
      return
    }
    await requestStage(activeStage, previousSelectedOption)
  }

  const handleCreateProject = async () => {
    if (!activeSelectedOption) {
      setStageError("请先选择最终成稿方向。")
      return
    }

    setIsCreatingProject(true)
    setStageError(null)
    try {
      const outlineChannel = await createOutlineChannel()
      const wsClient = new WebSocketClient()
      wsRef.current = wsClient
      outlineProgressUnsubRef.current = wsClient.on("outline_progress", (progress) => {
        if (!progress || typeof progress !== "object") {
          return
        }
        const stage = (progress as { stage?: string }).stage
        if (stage) {
          setOutlineProgressStage(stage)
        }
      })
      wsClient.connect(outlineChannel.request_id, getAuthToken(), {
        route: "outline",
        queryParams: { channel_token: outlineChannel.channel_token },
      })

      let project = await createOutline({
        world_view: activeSelectedOption.world_view,
        style_tags: activeSelectedOption.style_tags,
        initial_prompt: activeSelectedOption.initial_prompt,
        base_project_id: baseProjectId || undefined,
        request_id: outlineChannel.request_id,
      })

      if (activeSelectedOption.project_title.trim()) {
        project = await updateProjectTitle(project.id, {
          title: activeSelectedOption.project_title.trim(),
        })
      }

      setProject(project)
      await loadProjects()
      router.push("/")
    } catch (error) {
      setStageError(formatUserErrorMessage(error, "创建项目失败，请稍后重试。"))
    } finally {
      outlineProgressUnsubRef.current?.()
      outlineProgressUnsubRef.current = null
      wsRef.current?.disconnect()
      wsRef.current = null
      setOutlineProgressStage(null)
      setIsCreatingProject(false)
    }
  }

  if (authChecking) {
    return (
      <div className="app-backdrop flex min-h-screen items-center justify-center px-4 text-foreground">
        <div className="panel-shell-strong w-full max-w-md px-6 py-6 text-center">
          <div className="text-base font-semibold">正在准备灵感空间</div>
          <div className="mt-2 text-sm text-muted-foreground">正在验证会话并准备你的创作环境。</div>
        </div>
      </div>
    )
  }

  if (!authUser) {
    return null
  }

  return (
    <div className="app-backdrop min-h-screen text-foreground">
      <div className="mx-auto max-w-[1400px] px-3 py-3 sm:px-4 sm:py-4">
        <header className="panel-shell px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost" size="icon-sm" className="rounded-xl">
                  <Link href="/">
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                </Button>
                <div className="status-pill">
                  <Lightbulb className="h-3.5 w-3.5 text-primary" />
                  Idea Lab
                </div>
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                  分阶段孵化你的小说方向
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  从一个模糊念头开始，按阶段收敛故事方向。每一步我都会给你 3 个大致方向，选中后继续推进，直到形成可直接生成大纲的项目方案。
                </p>
              </div>
            </div>
            <div className="rounded-[24px] border border-border/60 bg-background/55 px-4 py-3 text-sm text-muted-foreground">
              当前账号：<span className="font-medium text-foreground">{authUser.username}</span>
            </div>
          </div>
        </header>

        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_380px]">
          <main className="panel-shell-strong overflow-hidden">
            <div className="border-b border-border/60 px-4 py-4 sm:px-6">
              <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">你现在的模糊想法</label>
                    <Textarea
                      value={seedInput}
                      onChange={(event) => setSeedInput(event.target.value)}
                      rows={4}
                      placeholder="例如：我想写一个现代悬疑故事，但我只有一位女记者和一封匿名信。"
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">世界观或背景补充</label>
                    <Textarea
                      value={worldView}
                      onChange={(event) => setWorldView(event.target.value)}
                      rows={4}
                      placeholder="例如：城市被大型财团和媒体集团控制，很多旧案被系统性掩盖。"
                      className="mt-2"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">风格标签</label>
                    <Input
                      value={styleTagsText}
                      onChange={(event) => setStyleTagsText(event.target.value)}
                      placeholder="悬疑, 冷感现实, 慢燃"
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">继承项目（可选）</label>
                    <select
                      value={baseProjectId}
                      onChange={(event) => setBaseProjectId(event.target.value)}
                      className="form-select mt-2"
                    >
                      <option value="">不继承</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-[24px] border border-border/60 bg-background/55 px-4 py-4">
                    <div className="text-sm font-medium">使用方式</div>
                    <div className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
                      <div>1. 先生成第一步的 3 个故事方向。</div>
                      <div>2. 每一轮选中一个，再进入下一步。</div>
                      <div>3. 最后一步会得到可直接生成大纲的成稿方向。</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleStart}
                  disabled={isGeneratingStage || isCreatingProject}
                  className="rounded-xl"
                >
                  {isGeneratingStage && !activeResponse ? "启动中..." : "开始第一步"}
                </Button>
                <Button asChild variant="outline" className="rounded-xl">
                  <Link href="/">返回工作台</Link>
                </Button>
              </div>
            </div>

            <div className="border-b border-border/60 px-4 py-4 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {IDEA_STAGES.map((stage, index) => {
                  const isActive = index === activeStageIndex
                  const isDone = index < activeStageIndex && selectedIndices[stage] !== undefined
                  return (
                    <div
                      key={stage}
                      className={cn(
                        "rounded-[24px] border px-4 py-4 transition-colors",
                        isActive
                          ? "border-primary/30 bg-primary/8"
                          : isDone
                            ? "border-emerald-500/25 bg-emerald-500/8"
                            : "border-border/60 bg-background/55",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{IDEA_STAGE_LABELS[stage]}</div>
                        <div
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                            isDone
                              ? "bg-emerald-500 text-white"
                              : isActive
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="px-4 py-4 sm:px-6 sm:py-6">
              {activeResponse ? (
                <div className="space-y-5">
                  <div className="rounded-[28px] border border-border/60 bg-background/55 px-4 py-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-lg font-semibold">{activeResponse.stage_title}</div>
                        <div className="mt-1 text-sm leading-6 text-muted-foreground">
                          {activeResponse.stage_instruction}
                        </div>
                      </div>
                      <div className="min-w-0 lg:w-[320px]">
                        <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          对下一次生成的额外要求
                        </label>
                        <Textarea
                          value={stageFeedback}
                          onChange={(event) => setStageFeedback(event.target.value)}
                          rows={3}
                          placeholder="例如：我希望这一轮更偏人物关系，少一点世界规则。"
                          className="mt-2"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    {activeResponse.options.map((option, index) => {
                      const isSelected = activeSelectedIndex === index
                      return (
                        <button
                          key={`${activeResponse.stage}-${index}-${option.project_title}`}
                          type="button"
                          onClick={() => handleSelectOption(index)}
                          className={cn(
                            "rounded-[28px] border p-5 text-left transition-all",
                            isSelected
                              ? "border-primary/35 bg-primary/7 shadow-[0_18px_48px_rgba(77,102,177,0.12)] ring-1 ring-primary/20"
                              : "border-border/70 bg-background/72 hover:border-primary/25 hover:bg-background",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-serif text-2xl leading-tight text-foreground">
                                {option.project_title}
                              </div>
                              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                                {option.hook}
                              </div>
                            </div>
                            <div
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border/70 text-muted-foreground",
                              )}
                            >
                              {index + 1}
                            </div>
                          </div>

                          <div className="mt-4 space-y-3 text-sm">
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">故事前提</div>
                              <div className="mt-1 leading-6 text-foreground/90">{option.premise}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">主角方案</div>
                              <div className="mt-1 leading-6 text-foreground/90">{option.protagonist}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">核心冲突</div>
                              <div className="mt-1 leading-6 text-foreground/90">{option.conflict}</div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {option.style_tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border border-border/60 bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {stageError ? (
                    <div className="rounded-[24px] border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                      {stageError}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                    <div className="text-sm text-muted-foreground">
                      {activeSelectedOption
                        ? `已选中：${activeSelectedOption.project_title}`
                        : "先从本阶段的 3 个方向中选一个。"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={handleRegenerateStage}
                        disabled={isGeneratingStage || isCreatingProject}
                      >
                        {isGeneratingStage ? "重生成中..." : "换一组本步方向"}
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={handleBack}
                        disabled={activeStageIndex === 0 || isGeneratingStage || isCreatingProject}
                      >
                        <ArrowLeft className="h-4 w-4" />
                        上一步
                      </Button>
                      {activeResponse.is_final_stage ? (
                        <Button
                          className="rounded-xl"
                          onClick={handleCreateProject}
                          disabled={!activeSelectedOption || isGeneratingStage || isCreatingProject}
                        >
                          <BookOpenText className="h-4 w-4" />
                          {isCreatingProject ? "创建中..." : "创建项目并生成大纲"}
                        </Button>
                      ) : (
                        <Button
                          className="rounded-xl"
                          onClick={handleNext}
                          disabled={!activeSelectedOption || isGeneratingStage || isCreatingProject}
                        >
                          {isGeneratingStage ? "生成下一步..." : "进入下一步"}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[28px] border border-dashed border-border/70 bg-background/45 px-6 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[22px] bg-primary/10 text-primary">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div className="text-xl font-semibold">先启动第一步</div>
                  <div className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    先给我一个模糊念头、一个人物、一种氛围，甚至一个场景。我会先给出 3 个故事方向，之后再一步步收敛到可生成大纲的版本。
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="space-y-3">
            <div className="panel-shell px-4 py-4 sm:px-5">
              <div className="text-sm font-semibold">已选路径</div>
              <div className="mt-1 text-sm text-muted-foreground">
                每一阶段的已选结果会在这里累积，方便你回看整条创意收敛路径。
              </div>
            </div>

            <div className="panel-shell-strong px-4 py-4 sm:px-5">
              {selectedPath.length === 0 ? (
                <div className="text-sm text-muted-foreground">还没有已选方案。</div>
              ) : (
                <div className="space-y-4">
                  {selectedPath.map((item) => (
                    <div key={item.stage} className="rounded-[24px] border border-border/60 bg-background/55 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{item.label}</div>
                        <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
                          {item.option.project_title}
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">Hook：</span>
                          {item.option.hook}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">主角：</span>
                          {item.option.protagonist}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">冲突：</span>
                          {item.option.conflict}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
