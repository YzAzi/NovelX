"use client"

import { useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { createEmptyProject, createOutline } from "@/src/lib/api"
import { WebSocketClient } from "@/src/lib/websocket"
import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"
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

export function CreateDialog() {
  const [open, setOpen] = useState(false)
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

  useEffect(() => {
    if (open) {
      loadProjects()
    }
  }, [loadProjects, open])

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
        const requestId = `outline-${crypto.randomUUID()}`
        const payload = {
          world_view: worldView,
          style_tags: tags,
          initial_prompt: values.initialPrompt?.trim() ?? "",
          drafting_prompt: values.draftingPrompt?.trim() || undefined,
          base_project_id: values.baseProjectId?.trim() || undefined,
          request_id: requestId,
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
        wsClient.connect(requestId)
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
      reset()
    }
  }

  const submitting = isSubmitting || isLoading
  const createMode = watch("createMode")

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>新建大纲</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建大纲</DialogTitle>
          <DialogDescription>选择创建方式，快速开启新项目。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <input type="hidden" {...register("createMode")} />
          <div className="space-y-2">
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
          <div className="space-y-1">
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
            ) : null}
          </div>
          <div className="space-y-1">
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
            ) : null}
          </div>
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="initialPrompt">
                  初始想法
                </label>
                <Textarea
                  id="initialPrompt"
                  placeholder="例如：女主在旧报纸里发现父亲失踪的线索。"
                  rows={3}
                  {...register("initialPrompt")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="draftingPrompt">
                  自定义大纲 Prompt（可选）
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
                  用于控制大纲生成风格与结构，支持上述变量占位符。
                </p>
              </div>
            </>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
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
