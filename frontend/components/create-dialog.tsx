"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import type { VariantProps } from "class-variance-authority"
import { Sparkles } from "lucide-react"

import {
  createEmptyProject,
  createOutline,
  createOutlineChannel,
  formatUserErrorMessage,
  generateStoryDirections,
  getAuthToken,
} from "@/src/lib/api"
import { WebSocketClient } from "@/src/lib/websocket"
import { useProjectStore } from "@/src/stores/project-store"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { StoryDirectionOption } from "@/src/types/models"

type CreateDialogProps = {
  triggerLabel?: string
  triggerClassName?: string
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"]
  triggerSize?: VariantProps<typeof buttonVariants>["size"]
}

const formSchema = z.object({
  createMode: z.enum(["ai", "empty"]),
  title: z.string().trim().optional(),
  worldView: z.string().trim().optional(),
  styleTags: z.string().trim().optional(),
  initialPrompt: z.string().trim().optional(),
  draftingPrompt: z.string().trim().optional(),
  baseProjectId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.createMode === "ai" && !(data.worldView ?? "").trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["worldView"],
      message: "请填写世界观设定",
    })
  }
  if (data.createMode === "empty" && !(data.title ?? "").trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["title"],
      message: "请输入项目名称",
    })
  }
})

type FormValues = z.infer<typeof formSchema>

export function CreateDialog({
  triggerLabel = "新建大纲",
  triggerClassName,
  triggerVariant = "default",
  triggerSize = "default",
}: CreateDialogProps = {}) {
  const [open, setOpen] = useState(false)
  const [ideaSeed, setIdeaSeed] = useState("")
  const [directionOptions, setDirectionOptions] = useState<StoryDirectionOption[]>([])
  const [selectedDirectionIndex, setSelectedDirectionIndex] = useState<number | null>(null)
  const [directionError, setDirectionError] = useState<string | null>(null)
  const [isGeneratingDirections, setIsGeneratingDirections] = useState(false)
  const {
    isLoading,
    loadProjects,
    projects,
    setOutlineProgressStage,
    setProject,
  } = useProjectStore()
  const wsRef = useRef<WebSocketClient | null>(null)
  const outlineProgressUnsubRef = useRef<(() => void) | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch,
    getValues,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      createMode: "ai",
      title: "",
      worldView: "",
      styleTags: "",
      initialPrompt: "",
      draftingPrompt: "",
      baseProjectId: "",
    },
  })
  const createMode = watch("createMode")

  useEffect(() => {
    if (open) {
      loadProjects()
    }
  }, [loadProjects, open])

  useEffect(() => {
    if (createMode !== "ai") {
      setDirectionOptions([])
      setSelectedDirectionIndex(null)
      setDirectionError(null)
    }
  }, [createMode])

  const handleGenerateDirections = async () => {
    const values = getValues()
    const styleTags = values.styleTags
      ? values.styleTags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []

    if (!ideaSeed.trim() && !(values.worldView ?? "").trim()) {
      setDirectionError("请先输入一个模糊想法，或补充一些世界观信息。")
      return
    }

    setIsGeneratingDirections(true)
    setDirectionError(null)
    setDirectionOptions([])
    setSelectedDirectionIndex(null)
    try {
      const response = await generateStoryDirections({
        user_input: ideaSeed.trim() || undefined,
        world_view: values.worldView?.trim() || undefined,
        style_tags: styleTags,
        base_project_id: values.baseProjectId?.trim() || undefined,
      })
      setDirectionOptions(response.directions)
    } catch (error) {
      setDirectionError(formatUserErrorMessage(error, "生成方向失败，请稍后重试。"))
    } finally {
      setIsGeneratingDirections(false)
    }
  }

  const handleChooseDirection = (direction: StoryDirectionOption, index: number) => {
    setSelectedDirectionIndex(index)
    setValue("worldView", direction.world_view)
    setValue("styleTags", direction.style_tags.join(", "))
    setValue("initialPrompt", direction.initial_prompt)
    setDirectionError(null)
  }

  const onSubmit = async (values: FormValues) => {
    const tags = values.styleTags
      ? values.styleTags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []

    const worldView = (values.worldView ?? "").trim()

    try {
      let project
      if (values.createMode === "empty") {
        project = await createEmptyProject({
          title: values.title?.trim() || undefined,
          world_view: worldView || undefined,
          style_tags: tags,
          base_project_id: values.baseProjectId?.trim() || undefined,
        })
      } else {
        const outlineChannel = await createOutlineChannel()
        const payload = {
          world_view: worldView,
          style_tags: tags,
          initial_prompt: values.initialPrompt?.trim() ?? "",
          drafting_prompt: values.draftingPrompt?.trim() || undefined,
          base_project_id: values.baseProjectId?.trim() || undefined,
          request_id: outlineChannel.request_id,
        }

        const wsClient = new WebSocketClient()
        wsRef.current = wsClient
        outlineProgressUnsubRef.current = wsClient.on(
          "outline_progress",
          (progress) => {
            if (!progress || typeof progress !== "object") {
              return
            }
            const stage = (progress as { stage?: string }).stage
            if (stage) {
              setOutlineProgressStage(stage)
            }
          }
        )
        wsClient.connect(outlineChannel.request_id, getAuthToken(), {
          route: "outline",
          queryParams: { channel_token: outlineChannel.channel_token },
        })
        project = await createOutline(payload)
      }
      setProject(project)
      await loadProjects()
      setOpen(false)
      reset()
    } catch {
      // Error state is handled in the store and surfaced by the page shell.
    } finally {
      outlineProgressUnsubRef.current?.()
      outlineProgressUnsubRef.current = null
      wsRef.current?.disconnect()
      wsRef.current = null
      setOutlineProgressStage(null)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setIdeaSeed("")
      setDirectionOptions([])
      setSelectedDirectionIndex(null)
      setDirectionError(null)
      reset()
    }
  }

  const submitting = isSubmitting || isLoading

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建大纲</DialogTitle>
          <DialogDescription>选择创建方式，快速开启新项目，并保持与当前工作台一致的创作结构。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <input type="hidden" {...register("createMode")} />
          <div className="form-panel space-y-3">
            <label className="text-sm font-medium">创建方式</label>
            <Tabs
              value={createMode}
              onValueChange={(value) =>
                setValue("createMode", value as FormValues["createMode"])
              }
            >
              <TabsList>
                <TabsTrigger value="ai">AI 生成</TabsTrigger>
                <TabsTrigger value="empty">空白大纲</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {createMode === "ai"
                ? "根据设定自动生成完整大纲。"
                : "直接创建空项目，稍后手动补充内容。"}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="form-panel space-y-2">
              <label className="text-sm font-medium" htmlFor="title">
                项目名称
              </label>
              <Input
                id="title"
                placeholder="例如：雾城谜案"
                {...register("title")}
              />
              {errors.title ? (
                <p className="text-sm text-red-600">{errors.title.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">建议使用清晰、可辨识的项目名称，方便后续切换。</p>
              )}
            </div>
            <div className="form-panel space-y-2">
              <label className="text-sm font-medium" htmlFor="worldView">
                世界观
              </label>
              <Textarea
                id="worldView"
                placeholder="例：人类在漂浮群岛上生活，能源来自失落的星核。"
                rows={4}
                {...register("worldView")}
              />
              {errors.worldView ? (
                <p className="text-sm text-red-600">{errors.worldView.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">简明描述时代、规则和冲突来源，AI 会据此搭结构。</p>
              )}
            </div>
          </div>
          {createMode === "ai" ? (
            <div className="space-y-4">
              <div className="form-panel space-y-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">快速 3 选 1</div>
                    <div className="text-xs text-muted-foreground">
                      输入一个模糊念头，我会先给你 3 个可落地的大纲方向，适合快速开题。
                    </div>
                  </div>
                </div>
                <Textarea
                  value={ideaSeed}
                  onChange={(event) => setIdeaSeed(event.target.value)}
                  placeholder="例如：我想写一个悬疑修仙故事，但还没有主线。"
                  rows={4}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={handleGenerateDirections}
                    disabled={isGeneratingDirections}
                  >
                    {isGeneratingDirections ? "生成中..." : "快速生成 3 个方向"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    会结合当前世界观、风格标签和继承项目一起判断。
                  </span>
                </div>
                {directionError ? (
                  <p className="text-sm text-red-600">{directionError}</p>
                ) : null}
                {directionOptions.length > 0 ? (
                  <div className="grid gap-3">
                    {directionOptions.map((direction, index) => {
                      const isSelected = selectedDirectionIndex === index
                      return (
                        <button
                          key={`${direction.title}-${index}`}
                          type="button"
                          onClick={() => handleChooseDirection(direction, index)}
                          className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                            isSelected
                              ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                              : "border-border/70 bg-background/70 hover:border-primary/40 hover:bg-background"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground">{direction.title}</div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                {direction.logline}
                              </div>
                            </div>
                            <div className="rounded-full border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
                              方向 {index + 1}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {direction.style_tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="mt-3 text-xs text-muted-foreground">
                            选中后会自动填入下方表单，可直接生成大纲。
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>

              <div className="form-panel space-y-2">
                <label className="text-sm font-medium" htmlFor="initialPrompt">
                  大纲生成输入
                </label>
                <Textarea
                  id="initialPrompt"
                  placeholder="例如：女主在旧报纸里发现父亲失踪的线索。"
                  rows={4}
                  {...register("initialPrompt")}
                />
                <p className="text-xs text-muted-foreground">
                  你也可以跳过上面的灵感孵化，直接在这里输入核心事件或人物处境。
                </p>
              </div>

              <div className="form-panel flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">想一步步完善故事方向</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    去 Idea Lab 按步骤推进。每一步都会给你 3 个方向，适合逐步筛选到最终方案。
                  </div>
                </div>
                <Button asChild type="button" variant="outline" className="rounded-xl">
                  <Link href="/idea-lab" onClick={() => setOpen(false)}>
                    前往 Idea Lab
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
          <details className="form-panel">
            <summary className="cursor-pointer text-sm font-medium">
              高级选项
            </summary>
            <div className="mt-3 space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="styleTags">
                  风格标签
                </label>
                <Input
                  id="styleTags"
                  placeholder="悬疑, 非线性叙事"
                  {...register("styleTags")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="baseProjectId">
                  继承项目（续作/前作）
                </label>
                <select
                  id="baseProjectId"
                  className="form-select"
                  {...register("baseProjectId")}
                >
                  <option value="">不继承</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  仅在续作/前作时选择，用于继承世界观与关系线索。
                </p>
              </div>
              {createMode === "ai" ? (
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="draftingPrompt">
                    自定义生成指令（可选）
                  </label>
                  <Textarea
                    id="draftingPrompt"
                    placeholder={
                      "可使用变量：{world_view} {style_tags} {user_input} {retrieved_context}\n留空则使用默认模板"
                    }
                    rows={5}
                    {...register("draftingPrompt")}
                  />
                  <p className="text-xs text-muted-foreground">
                    仅在需要更细致地控制大纲结构和语气时再展开修改。
                  </p>
                </div>
              ) : null}
            </div>
          </details>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting} className="rounded-xl">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting} className="rounded-xl">
              {submitting
                ? "处理中..."
                : createMode === "empty"
                  ? "创建空大纲"
                  : "生成大纲"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
