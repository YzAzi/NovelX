"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  History,
  Lightbulb,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import {
  AUTH_EXPIRED_EVENT,
  createIdeaLabStageTask,
  createOutlineTask,
  formatUserErrorMessage,
  getAuthToken,
  getCurrentUser,
  listAsyncTasks,
  updateProjectTitle,
  waitForAsyncTask,
} from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import type {
  AsyncTask,
  AuthUser,
  IdeaLabStage,
  IdeaLabStageOption,
  IdeaLabStageRequest,
  IdeaLabStageResponse,
  StoryProject,
} from "@/src/types/models"
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

const IDEA_STAGE_HINTS: Record<IdeaLabStage, string> = {
  concept: "先把故事的基调、题眼与可写性收拢出来。",
  protagonist: "把驱动叙事的人物拉清楚，避免后面大纲空转。",
  conflict: "确认故事真正的阻力和拉扯点，建立推进张力。",
  outline: "把前面所有选择整合成可直接落地的项目方案。",
}

const TASK_STATUS_LABELS = {
  pending: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
} as const

function parseStyleTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatTaskTime(value?: string | null) {
  if (!value) {
    return "刚刚"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function buildTaskSummary(task: AsyncTask<IdeaLabStageResponse>) {
  const payload = task.request_payload as Partial<IdeaLabStageRequest>
  if (typeof payload.seed_input === "string" && payload.seed_input.trim()) {
    return payload.seed_input.trim()
  }
  if (typeof payload.world_view === "string" && payload.world_view.trim()) {
    return payload.world_view.trim()
  }
  return "未命名灵感任务"
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
  const [recentStageTasks, setRecentStageTasks] = useState<Array<AsyncTask<IdeaLabStageResponse>>>([])
  const [currentStageTaskId, setCurrentStageTaskId] = useState<string | null>(null)
  const [currentOutlineTaskId, setCurrentOutlineTaskId] = useState<string | null>(null)

  const stageRequestLockRef = useRef(false)

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

  const hasStarted = IDEA_STAGES.some((stage) => Boolean(stageResults[stage]))
  const canStartIdeaLab = Boolean(seedInput.trim() || worldView.trim())
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
  const completedStageCount = selectedPath.length
  const progressRatio = hasStarted ? (activeStageIndex + 1) / IDEA_STAGES.length : 0.08

  const upsertRecentStageTask = (task: AsyncTask<IdeaLabStageResponse>) => {
    setRecentStageTasks((prev) => [task, ...prev.filter((item) => item.id !== task.id)].slice(0, 8))
  }

  const syncIdeaLabInputsFromTask = (task: AsyncTask<IdeaLabStageResponse>) => {
    const payload = task.request_payload as Partial<IdeaLabStageRequest>
    setSeedInput(typeof payload.seed_input === "string" ? payload.seed_input : "")
    setWorldView(typeof payload.world_view === "string" ? payload.world_view : "")
    setStyleTagsText(Array.isArray(payload.style_tags) ? payload.style_tags.join(", ") : "")
    setBaseProjectId(typeof payload.base_project_id === "string" ? payload.base_project_id : "")
  }

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

  const restoreStageTaskResult = (task: AsyncTask<IdeaLabStageResponse>) => {
    const response = task.result_payload
    if (!response) {
      return
    }
    syncIdeaLabInputsFromTask(task)
    const stageIndex = IDEA_STAGES.indexOf(response.stage)
    clearStagesAfter(stageIndex)
    setStageResults((prev) => ({ ...prev, [response.stage]: response }))
    setSelectedIndices((prev) => {
      const next = { ...prev }
      delete next[response.stage]
      return next
    })
    setActiveStageIndex(stageIndex)
    setStageFeedback("")
    setStageError(null)
  }

  const refreshRecentStageTasks = async () => {
    try {
      const response = await listAsyncTasks<IdeaLabStageResponse>({
        kind: "idea_lab_stage",
        limit: 8,
      })
      setRecentStageTasks(response.tasks)
    } catch (error) {
      console.warn("Failed to load Idea Lab tasks:", error)
    }
  }

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      if (!getAuthToken()) {
        if (!cancelled) {
          setAuthChecking(false)
        }
        router.replace("/")
        return
      }

      try {
        const user = await getCurrentUser()
        if (cancelled) {
          return
        }
        setAuthUser(user)

        const [projectsResult, tasksResult] = await Promise.allSettled([
          loadProjects(),
          listAsyncTasks<IdeaLabStageResponse>({
            kind: "idea_lab_stage",
            limit: 8,
          }),
        ])

        if (cancelled) {
          return
        }

        if (tasksResult.status === "fulfilled") {
          setRecentStageTasks(tasksResult.value.tasks)
        }
        if (projectsResult.status === "rejected") {
          console.warn("Failed to bootstrap Idea Lab projects:", projectsResult.reason)
        }
        if (tasksResult.status === "rejected") {
          console.warn("Failed to bootstrap Idea Lab tasks:", tasksResult.reason)
        }
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
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    }
  }, [loadProjects, router])

  const requestStage = async (stage: IdeaLabStage, selectedOption?: IdeaLabStageOption | null) => {
    if (stageRequestLockRef.current) {
      return
    }

    stageRequestLockRef.current = true
    setIsGeneratingStage(true)
    setStageError(null)

    try {
      const created = await createIdeaLabStageTask({
        stage,
        seed_input: seedInput.trim() || undefined,
        world_view: worldView.trim() || undefined,
        style_tags: parseStyleTags(styleTagsText),
        base_project_id: baseProjectId || undefined,
        feedback: stageFeedback.trim() || undefined,
        selected_option: selectedOption ?? undefined,
      })

      setCurrentStageTaskId(created.task.id)
      syncIdeaLabInputsFromTask(created.task)
      upsertRecentStageTask(created.task)

      const completedTask = await waitForAsyncTask<IdeaLabStageResponse>(created.task.id, {
        onUpdate: (task) => {
          setCurrentStageTaskId(task.id)
          upsertRecentStageTask(task)
        },
      })

      if (completedTask.status === "failed") {
        throw new Error(completedTask.error_message || "生成阶段方案失败，请稍后重试。")
      }

      const response = completedTask.result_payload
      if (!response) {
        throw new Error("阶段任务已完成，但未返回结果。")
      }

      setStageResults((prev) => ({ ...prev, [stage]: response }))
      setSelectedIndices((prev) => {
        const next = { ...prev }
        delete next[stage]
        return next
      })
      setActiveStageIndex(IDEA_STAGES.indexOf(stage))
      setStageFeedback("")
      upsertRecentStageTask(completedTask)
      await refreshRecentStageTasks()
    } catch (error) {
      const message = formatUserErrorMessage(error, "生成阶段方案失败，请稍后重试。")
      setStageError(message)
      toast.error(message)
    } finally {
      stageRequestLockRef.current = false
      setCurrentStageTaskId(null)
      setIsGeneratingStage(false)
    }
  }

  const handleStart = async () => {
    if (stageRequestLockRef.current || isCreatingProject) {
      return
    }
    if (!canStartIdeaLab) {
      setStageError("请先填写一个创意起点或世界观，再开始第一步。")
      return
    }
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
      const created = await createOutlineTask({
        world_view: activeSelectedOption.world_view,
        style_tags: activeSelectedOption.style_tags,
        initial_prompt: activeSelectedOption.initial_prompt,
        base_project_id: baseProjectId || undefined,
      })
      setCurrentOutlineTaskId(created.task.id)
      setOutlineProgressStage(created.task.progress_stage ?? "queued")

      const completedTask = await waitForAsyncTask<StoryProject>(created.task.id, {
        onUpdate: (task) => {
          setCurrentOutlineTaskId(task.id)
          if (task.progress_stage) {
            setOutlineProgressStage(task.progress_stage)
          } else if (task.status === "pending" || task.status === "running") {
            setOutlineProgressStage("queued")
          }
        },
      })

      if (completedTask.status === "failed") {
        throw new Error(completedTask.error_message || "创建项目失败，请稍后重试。")
      }

      let project = completedTask.result_payload
      if (!project) {
        throw new Error("大纲任务已完成，但未返回项目结果。")
      }

      if (activeSelectedOption.project_title.trim()) {
        project = await updateProjectTitle(project.id, {
          title: activeSelectedOption.project_title.trim(),
        })
      }

      setProject(project)
      await loadProjects()
      toast.success("项目已创建")
      router.push("/")
    } catch (error) {
      const message = formatUserErrorMessage(error, "创建项目失败，请稍后重试。")
      setStageError(message)
      toast.error(message)
    } finally {
      setCurrentOutlineTaskId(null)
      setOutlineProgressStage(null)
      setIsCreatingProject(false)
    }
  }

  if (authChecking) {
    return (
      <div className="app-backdrop flex min-h-screen items-center justify-center px-4 text-foreground">
        <div className="panel-shell-strong w-full max-w-md px-6 py-6 text-center">
          <div className="text-base font-semibold">正在准备 Idea Lab</div>
          <div className="mt-2 text-sm text-muted-foreground">正在恢复会话并加载你的灵感工作台。</div>
        </div>
      </div>
    )
  }

  if (!authUser) {
    return null
  }

  return (
    <div className="app-backdrop min-h-screen text-foreground">
      <div className="mx-auto max-w-[1540px] px-3 py-3 sm:px-4 lg:px-5">
        <motion.header
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="panel-shell px-4 py-3 sm:px-5"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild variant="ghost" size="icon-sm" className="rounded-xl">
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
                <span className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="status-pill border-primary/18 bg-primary/6 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    Idea Lab
                  </div>
                  <div className="status-pill">
                    <Lightbulb className="h-3.5 w-3.5 text-primary" />
                    四步收敛
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-[2rem]">
                    灵感工作台
                  </h1>
                  <div className="text-sm text-muted-foreground">
                    像桌面创作软件一样，把模糊想法逐步压缩成可落地项目。
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="status-pill">
                当前账号
                <span className="font-medium text-foreground">{authUser.username}</span>
              </div>
              <Button asChild variant="outline" className="rounded-xl">
                <Link href="/">返回工作台</Link>
              </Button>
            </div>
          </div>
        </motion.header>

        <div className="mt-3 grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
          <motion.aside
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
            className="space-y-3 xl:sticky xl:top-3 xl:self-start"
          >
            <section className="panel-shell-strong overflow-hidden">
              <div className="border-b border-border/60 px-4 py-4 sm:px-5">
                <div className="text-sm font-semibold">创意输入</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  先提供一个起点，Idea Lab 会替你做第一次收拢和分叉。
                </div>
              </div>

              <div className="space-y-4 px-4 py-4 sm:px-5">
                <div>
                  <label className="text-sm font-medium">你现在的模糊想法</label>
                  <Textarea
                    value={seedInput}
                    onChange={(event) => setSeedInput(event.target.value)}
                    rows={6}
                    placeholder="例如：我想写一个现代悬疑故事，主角是女记者，线索来自一封匿名信。"
                    className="mt-2 min-h-[132px] resize-none"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">世界观或背景补充</label>
                  <Textarea
                    value={worldView}
                    onChange={(event) => setWorldView(event.target.value)}
                    rows={5}
                    placeholder="例如：城市被财团和媒体集团操控，很多旧案被系统性压下。"
                    className="mt-2 min-h-[118px] resize-none"
                  />
                </div>

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
                  <label className="text-sm font-medium">继承项目</label>
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

                <Button
                  onClick={handleStart}
                  disabled={isGeneratingStage || isCreatingProject || !canStartIdeaLab}
                  className="h-12 w-full rounded-[12px] text-sm font-semibold shadow-lg shadow-primary/20"
                >
                  {isGeneratingStage && !activeResponse ? "正在启动第一步..." : "开始第一步"}
                </Button>

                {!canStartIdeaLab ? (
                  <div className="rounded-[11px] border border-dashed border-border/70 bg-background/55 px-4 py-3 text-xs leading-6 text-muted-foreground">
                    至少填写一个创意起点或世界观，再开始收敛流程。
                  </div>
                ) : null}
              </div>
            </section>

            <section className="panel-shell px-4 py-4 sm:px-5">
              <div className="text-sm font-semibold">流程轨迹</div>
              <div className="mt-1 text-sm text-muted-foreground">当前阶段、已确认阶段和下一步都在这里。</div>

              <div className="mt-4 space-y-3">
                {IDEA_STAGES.map((stage, index) => {
                  const isActive = index === activeStageIndex
                  const isDone = selectedIndices[stage] !== undefined
                  const isUnlocked = hasStarted ? index <= activeStageIndex + 1 : index === 0
                  return (
                    <button
                      key={stage}
                      type="button"
                      onClick={() => {
                        if (stageResults[stage]) {
                          setActiveStageIndex(index)
                        }
                      }}
                      disabled={!stageResults[stage]}
                      className={cn(
                        "w-full rounded-[12px] border px-4 py-4 text-left transition-[border-color,background-color,box-shadow]",
                        isActive
                          ? "border-primary/25 bg-primary/8 shadow-[0_16px_36px_rgba(77,102,177,0.12)]"
                          : isDone
                            ? "border-emerald-500/25 bg-emerald-500/7"
                            : isUnlocked
                              ? "border-border/60 bg-background/62"
                              : "border-border/40 bg-background/35 opacity-70",
                        stageResults[stage] ? "cursor-pointer" : "cursor-default",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                            isDone
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : isActive
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/70 bg-background text-muted-foreground",
                          )}
                        >
                          {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{IDEA_STAGE_LABELS[stage]}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {IDEA_STAGE_HINTS[stage]}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          </motion.aside>

          <motion.main
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease: "easeOut", delay: 0.08 }}
            className="min-w-0 space-y-3"
          >
            <section className="panel-shell-strong relative overflow-hidden">
              <div className="subtle-grid absolute inset-0 opacity-[0.22]" />
              <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(77,102,177,0.14),transparent_68%)]" />
              <div className="relative border-b border-border/60 px-4 py-4 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="status-pill border-primary/18 bg-primary/6 text-primary">
                      第 {Math.min(activeStageIndex + 1, IDEA_STAGES.length)} / {IDEA_STAGES.length} 步
                    </div>
                    <h2 className="mt-3 font-serif text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.45rem]">
                      {hasStarted
                        ? activeResponse?.stage_title || IDEA_STAGE_LABELS[activeStage]
                        : "从一个念头出发，逐步逼近可写的小说方案"}
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
                      {hasStarted
                        ? activeResponse?.stage_instruction || IDEA_STAGE_HINTS[activeStage]
                        : "中间是当前工作区，左边负责输入和阶段轨迹，右边负责保存决策和回看任务。整个过程不会强迫你一次想清楚，而是让你每一轮只做一个判断。"}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
                    <div className="rounded-[12px] border border-border/60 bg-background/70 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">当前阶段</div>
                      <div className="mt-2 text-sm font-semibold">{IDEA_STAGE_LABELS[activeStage]}</div>
                    </div>
                    <div className="rounded-[12px] border border-border/60 bg-background/70 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">已确认</div>
                      <div className="mt-2 text-sm font-semibold">{completedStageCount} 个阶段</div>
                    </div>
                    <div className="rounded-[12px] border border-border/60 bg-background/70 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">项目状态</div>
                      <div className="mt-2 text-sm font-semibold">
                        {activeStageIndex === IDEA_STAGES.length - 1 && activeSelectedOption ? "可创建项目" : "正在收敛"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-full bg-foreground/6">
                  <motion.div
                    className="h-2 rounded-full bg-primary"
                    initial={false}
                    animate={{ width: `${Math.max(progressRatio * 100, 8)}%` }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  />
                </div>
              </div>

              <div className="px-4 py-4 sm:px-6 sm:py-6">
                {stageError ? (
                  <div className="mb-5 rounded-[12px] border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                    {stageError}
                  </div>
                ) : null}

                {isGeneratingStage || isCreatingProject ? (
                  <div className="mb-5 rounded-[12px] border border-primary/20 bg-primary/6 px-4 py-3 text-sm text-muted-foreground">
                    {[
                      isGeneratingStage && currentStageTaskId
                        ? `阶段任务已提交，正在后台执行。任务 ID：${currentStageTaskId}`
                        : null,
                      isCreatingProject && currentOutlineTaskId
                        ? `大纲任务已提交，正在后台执行。任务 ID：${currentOutlineTaskId}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                ) : null}

                <AnimatePresence mode="wait">
                  {hasStarted && activeResponse ? (
                    <motion.div
                      key={activeStage}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.24, ease: "easeOut" }}
                      className="space-y-5"
                    >
                      <div className="grid gap-4 xl:grid-cols-3">
                        {activeResponse.options.map((option, index) => {
                          const isSelected = activeSelectedIndex === index
                          return (
                            <motion.button
                              key={`${activeStage}-${index}-${option.project_title}`}
                              type="button"
                              onClick={() => handleSelectOption(index)}
                              whileHover={{ y: -3 }}
                              whileTap={{ scale: 0.995 }}
                              className={cn(
                                "group relative flex h-full flex-col overflow-hidden rounded-[15px] border p-5 text-left transition-[border-color,background-color,box-shadow]",
                                isSelected
                                  ? "border-primary/28 bg-[linear-gradient(180deg,rgba(77,102,177,0.10),rgba(255,255,255,0.96))] shadow-[0_22px_48px_rgba(77,102,177,0.13)]"
                                  : "border-border/70 bg-background/80 hover:border-primary/20 hover:bg-background/92 hover:shadow-[0_18px_40px_rgba(0,0,0,0.06)]",
                              )}
                            >
                              <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(77,102,177,0.12),transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                              <div className="relative flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                    方案 {index + 1}
                                  </div>
                                  <div className="mt-3 font-serif text-[1.55rem] font-semibold leading-tight tracking-tight">
                                    {option.project_title}
                                  </div>
                                  <div className="mt-3 text-sm leading-6 text-muted-foreground">
                                    {option.hook}
                                  </div>
                                </div>
                                <div
                                  className={cn(
                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                                    isSelected
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border/70 bg-background text-muted-foreground",
                                  )}
                                >
                                  {isSelected ? <Check className="h-4 w-4" /> : index + 1}
                                </div>
                              </div>

                              <div className="relative mt-5 grid gap-4 border-t border-border/60 pt-4 text-sm">
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">故事前提</div>
                                  <div className="mt-2 leading-6 text-foreground/92">{option.premise}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">主角方案</div>
                                  <div className="mt-2 leading-6 text-foreground/92">{option.protagonist}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">核心冲突</div>
                                  <div className="mt-2 leading-6 text-foreground/92">{option.conflict}</div>
                                </div>
                              </div>

                              <div className="relative mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-4">
                                {option.style_tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full border border-border/60 bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </motion.button>
                          )
                        })}
                      </div>

                      <div className="rounded-[14px] border border-border/70 bg-background/72 p-4">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                          <div>
                            <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                              对下一轮生成的额外要求
                            </label>
                            <Textarea
                              value={stageFeedback}
                              onChange={(event) => setStageFeedback(event.target.value)}
                              rows={3}
                              placeholder="例如：这一步更偏人物关系，少一点世界规则，冲突更私人。"
                              className="mt-2 min-h-[92px] resize-none"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                            <Button
                              variant="outline"
                              className="rounded-xl"
                              onClick={handleRegenerateStage}
                              disabled={isGeneratingStage || isCreatingProject}
                            >
                              {isGeneratingStage ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              换一组
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
                                className="rounded-xl shadow-lg shadow-primary/20"
                                onClick={handleCreateProject}
                                disabled={!activeSelectedOption || isGeneratingStage || isCreatingProject}
                              >
                                {isCreatingProject ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BookOpenText className="h-4 w-4" />}
                                创建项目并生成大纲
                              </Button>
                            ) : (
                              <Button
                                className="rounded-xl shadow-lg shadow-primary/20"
                                onClick={handleNext}
                                disabled={!activeSelectedOption || isGeneratingStage || isCreatingProject}
                              >
                                进入下一步
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                          <div>
                            {activeSelectedOption
                              ? `已选中：${activeSelectedOption.project_title}`
                              : "请先从当前阶段的 3 个方向中选一个。"}
                          </div>
                          {activeSelectedOption ? (
                            <div className="status-pill border-primary/18 bg-primary/6 text-primary">
                              当前决策已锁定，可继续推进
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty-workspace"
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.24, ease: "easeOut" }}
                      className="grid min-h-[560px] gap-4 lg:grid-cols-[1.2fr_0.8fr]"
                    >
                      <div className="relative overflow-hidden rounded-[15px] border border-border/65 bg-background/72 px-6 py-6">
                        <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(77,102,177,0.12),transparent_70%)]" />
                        <div className="relative">
                          <div className="status-pill border-primary/18 bg-primary/6 text-primary">
                            <Sparkles className="h-3.5 w-3.5" />
                            快速开始
                          </div>
                          <h3 className="mt-4 font-serif text-[2rem] font-semibold leading-tight tracking-tight">
                            先给一个方向，剩下的交给流程。
                          </h3>
                          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
                            Idea Lab 不是一次生成完整项目，而是把你的想法拆成四次更容易判断的选择。这样更像在桌面应用里编辑方案，而不是一次把所有决定都压在一个输入框里。
                          </p>

                          <div className="mt-8 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-[12px] border border-border/60 bg-background/78 px-4 py-4">
                              <div className="text-sm font-semibold">第一步：拉出三个方向</div>
                              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                                先把题材、情绪、钩子和可写性做第一次切分。
                              </div>
                            </div>
                            <div className="rounded-[12px] border border-border/60 bg-background/78 px-4 py-4">
                              <div className="text-sm font-semibold">第二步到第四步：逐次锁定</div>
                              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                                每一步只需要判断一个方向是否值得继续，而不是一次想完全部结构。
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between rounded-[15px] border border-border/65 bg-background/70 px-5 py-5">
                        <div>
                          <div className="text-sm font-semibold">工作方式</div>
                          <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                            <div>1. 填写左侧的创意起点，内容可以很模糊。</div>
                            <div>2. 每一轮在三个方向中选一个，系统会继续收敛。</div>
                            <div>3. 最终阶段确认后，直接生成项目和大纲。</div>
                          </div>
                        </div>

                        <div className="mt-6 rounded-[12px] border border-dashed border-border/70 bg-background/52 px-4 py-4 text-sm leading-6 text-muted-foreground">
                          Idea Lab 更适合用来定题、定主角、定冲突，而不是直接写正文。
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>
          </motion.main>

          <motion.aside
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.12 }}
            className="space-y-3 xl:sticky xl:top-3 xl:self-start"
          >
            <section className="panel-shell px-4 py-4 sm:px-5">
              <div className="text-sm font-semibold">已选路径</div>
              <div className="mt-1 text-sm text-muted-foreground">
                每一步的已选结果会累积在这里，方便随时回看整条收敛路径。
              </div>

              <div className="mt-4 space-y-3">
                {selectedPath.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-border/70 bg-background/50 px-4 py-5 text-sm text-muted-foreground">
                    还没有已选方案。先在当前阶段选中一个方向。
                  </div>
                ) : (
                  selectedPath.map((item, index) => (
                    <div
                      key={item.stage}
                      className="rounded-[12px] border border-border/60 bg-background/62 px-4 py-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/20 bg-primary/8 text-[11px] font-semibold text-primary">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{item.label}</div>
                          <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                            {item.option.project_title}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 text-sm leading-6 text-muted-foreground">
                        {item.option.hook}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel-shell-strong px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">最近任务</div>
                  <div className="mt-1 text-sm text-muted-foreground">已完成的阶段结果可以随时载入继续使用。</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => void refreshRecentStageTasks()}
                  disabled={isGeneratingStage}
                >
                  <RefreshCw className={cn("h-4 w-4", isGeneratingStage ? "animate-spin" : "")} />
                  刷新
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                {recentStageTasks.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-border/70 bg-background/50 px-4 py-5 text-sm text-muted-foreground">
                    还没有任务记录。
                  </div>
                ) : (
                  recentStageTasks.map((task) => {
                    const payload = task.request_payload as Partial<IdeaLabStageRequest>
                    const stage = typeof payload.stage === "string" ? payload.stage : null
                    return (
                      <div
                        key={task.id}
                        className="rounded-[12px] border border-border/60 bg-background/62 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">
                              {stage && stage in IDEA_STAGE_LABELS
                                ? IDEA_STAGE_LABELS[stage as IdeaLabStage]
                                : task.title || "Idea Lab 任务"}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {buildTaskSummary(task)}
                            </div>
                          </div>
                          <div className="rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                            {TASK_STATUS_LABELS[task.status]}
                          </div>
                        </div>

                        <div className="mt-3 text-xs text-muted-foreground">
                          {formatTaskTime(task.updated_at)}
                        </div>

                        <div className="mt-3 text-sm leading-6 text-muted-foreground">
                          {task.status === "failed"
                            ? task.error_message || "任务执行失败。"
                            : task.result_payload?.stage_instruction || "任务已提交，等待生成结果。"}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {task.status === "succeeded" && task.result_payload ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-xl"
                              onClick={() => restoreStageTaskResult(task)}
                            >
                              载入结果
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="mt-4 rounded-[12px] border border-border/60 bg-background/55 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <History className="h-4 w-4 text-primary" />
                  当前工作方式
                </div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  先做选择，再继续推进；只在最后一步统一落成项目。这样更稳定，也更适合中长篇前期定题。
                </div>
              </div>
            </section>
          </motion.aside>
        </div>
      </div>
    </div>
  )
}
