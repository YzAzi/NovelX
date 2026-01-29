"use client"

import { useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { createOutline } from "@/src/lib/api"
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
import { Textarea } from "@/components/ui/textarea"

const formSchema = z.object({
  worldView: z.string().trim().min(1, "请填写世界观设定"),
  styleTags: z.string().trim().optional(),
  initialPrompt: z.string().trim().optional(),
  draftingPrompt: z.string().trim().optional(),
  baseProjectId: z.string().optional(),
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
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
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
    const requestId = `outline-${crypto.randomUUID()}`
    const tags = values.styleTags
      ? values.styleTags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []

    const payload = {
      world_view: values.worldView.trim(),
      style_tags: tags,
      initial_prompt: values.initialPrompt?.trim() ?? "",
      drafting_prompt: values.draftingPrompt?.trim() || undefined,
      base_project_id: values.baseProjectId?.trim() || undefined,
      request_id: requestId,
    }

    try {
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

      const project = await createOutline(payload)
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>新建大纲</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建大纲</DialogTitle>
          <DialogDescription>填写关键信息，让系统生成故事大纲。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
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
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "生成中..." : "生成大纲"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
