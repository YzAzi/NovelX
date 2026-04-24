"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { VariantProps } from "class-variance-authority";
import { Sparkles } from "lucide-react";

import {
  createEmptyProject,
  createOutlineTask,
  createStoryDirectionsTask,
  formatUserErrorMessage,
  waitForAsyncTask,
} from "@/src/lib/api";
import { useProjectStore } from "@/src/stores/project-store";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  StoryDirectionOption,
  StoryDirectionResponse,
  StoryProject,
} from "@/src/types/models";

type CreateDialogProps = {
  triggerLabel?: string;
  triggerClassName?: string;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerSize?: VariantProps<typeof buttonVariants>["size"];
};

const formSchema = z
  .object({
    createMode: z.enum(["ai", "empty"]),
    title: z.string().trim().optional(),
    worldView: z.string().trim().optional(),
    styleTags: z.string().trim().optional(),
    initialPrompt: z.string().trim().optional(),
    draftingPrompt: z.string().trim().optional(),
    baseProjectId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.createMode === "ai" && !(data.worldView ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worldView"],
        message: "请填写世界观设定",
      });
    }
    if (data.createMode === "empty" && !(data.title ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message: "请输入项目名称",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export function CreateDialog({
  triggerLabel = "新建大纲",
  triggerClassName,
  triggerVariant = "default",
  triggerSize = "default",
}: CreateDialogProps = {}) {
  const [open, setOpen] = useState(false);
  const [ideaSeed, setIdeaSeed] = useState("");
  const [directionOptions, setDirectionOptions] = useState<
    StoryDirectionOption[]
  >([]);
  const [selectedDirectionIndex, setSelectedDirectionIndex] = useState<
    number | null
  >(null);
  const [directionError, setDirectionError] = useState<string | null>(null);
  const [isGeneratingDirections, setIsGeneratingDirections] = useState(false);
  const {
    isLoading,
    loadProjects,
    projects,
    setError,
    setOutlineProgressStage,
    setProject,
  } = useProjectStore();
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
  });
  const createMode = watch("createMode");

  useEffect(() => {
    if (open) {
      loadProjects();
    }
  }, [loadProjects, open]);

  useEffect(() => {
    if (createMode !== "ai") {
      setDirectionOptions([]);
      setSelectedDirectionIndex(null);
      setDirectionError(null);
    }
  }, [createMode]);

  const handleGenerateDirections = async () => {
    const values = getValues();
    const styleTags = values.styleTags
      ? values.styleTags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

    if (!ideaSeed.trim() && !(values.worldView ?? "").trim()) {
      setDirectionError("请先输入一个模糊想法，或补充一些世界观信息。");
      return;
    }

    setIsGeneratingDirections(true);
    setDirectionError(null);
    setDirectionOptions([]);
    setSelectedDirectionIndex(null);
    try {
      const created = await createStoryDirectionsTask({
        user_input: ideaSeed.trim() || undefined,
        world_view: values.worldView?.trim() || undefined,
        style_tags: styleTags,
        base_project_id: values.baseProjectId?.trim() || undefined,
      });
      const completedTask = await waitForAsyncTask<StoryDirectionResponse>(
        created.task.id,
      );
      if (completedTask.status === "failed") {
        throw new Error(
          completedTask.error_message || "生成方向失败，请稍后重试。",
        );
      }
      const response = completedTask.result_payload;
      if (!response) {
        throw new Error("方向任务已完成，但未返回结果。");
      }
      setDirectionOptions(response.directions);
    } catch (error) {
      setDirectionError(
        formatUserErrorMessage(error, "生成方向失败，请稍后重试。"),
      );
    } finally {
      setIsGeneratingDirections(false);
    }
  };

  const handleChooseDirection = (
    direction: StoryDirectionOption,
    index: number,
  ) => {
    setSelectedDirectionIndex(index);
    setValue("worldView", direction.world_view);
    setValue("styleTags", direction.style_tags.join(", "));
    setValue("initialPrompt", direction.initial_prompt);
    setDirectionError(null);
  };

  const onSubmit = async (values: FormValues) => {
    const tags = values.styleTags
      ? values.styleTags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

    const worldView = (values.worldView ?? "").trim();

    try {
      let project;
      if (values.createMode === "empty") {
        project = await createEmptyProject({
          title: values.title?.trim() || undefined,
          world_view: worldView || undefined,
          style_tags: tags,
          base_project_id: values.baseProjectId?.trim() || undefined,
        });
      } else {
        const payload = {
          world_view: worldView,
          style_tags: tags,
          initial_prompt: values.initialPrompt?.trim() ?? "",
          drafting_prompt: values.draftingPrompt?.trim() || undefined,
          base_project_id: values.baseProjectId?.trim() || undefined,
        };
        const created = await createOutlineTask(payload);
        setOutlineProgressStage(created.task.progress_stage ?? "queued");
        const completedTask = await waitForAsyncTask<StoryProject>(
          created.task.id,
          {
            onUpdate: (task) => {
              if (task.progress_stage) {
                setOutlineProgressStage(task.progress_stage);
              } else if (
                task.status === "pending" ||
                task.status === "running"
              ) {
                setOutlineProgressStage("queued");
              }
            },
          },
        );
        if (completedTask.status === "failed") {
          throw new Error(
            completedTask.error_message || "生成大纲失败，请稍后重试。",
          );
        }
        project = completedTask.result_payload;
        if (!project) {
          throw new Error("大纲任务已完成，但未返回项目结果。");
        }
      }
      setProject(project);
      await loadProjects();
      setOpen(false);
      reset();
    } catch (error) {
      setError(formatUserErrorMessage(error, "生成大纲失败，请稍后重试。"));
    } finally {
      setOutlineProgressStage(null);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setIdeaSeed("");
      setDirectionOptions([]);
      setSelectedDirectionIndex(null);
      setDirectionError(null);
      reset();
    }
  };

  const submitting = isSubmitting || isLoading;

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
      <DialogContent className="sm:max-w-2xl overflow-hidden p-0 gap-0">
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold tracking-tight">新建大纲</DialogTitle>
            <DialogDescription className="text-base mt-1.5">
              选择创建方式，快速开启新项目，并保持与当前工作台一致的创作结构。
            </DialogDescription>
          </DialogHeader>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col overflow-hidden">
          <ScrollArea className="max-h-[70vh] px-6">
            <div className="space-y-6 pb-6 pt-2">
              <div className="form-panel space-y-3">
                <label className="text-sm font-medium">创建方式</label>
                <Tabs
                  value={createMode}
                  onValueChange={(value) =>
                    setValue("createMode", value as FormValues["createMode"])
                  }
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
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
                    <p className="text-xs text-muted-foreground">
                      建议使用清晰、可辨识的项目名称，方便后续切换。
                    </p>
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
                    <p className="text-sm text-red-600">
                      {errors.worldView.message}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      简明描述时代、规则和冲突来源，AI 会据此搭结构。
                    </p>
                  )}
                </div>
              </div>
              {createMode === "ai" ? (
                <div className="space-y-6">
                  <div className="form-panel rounded-xl border border-primary/10 bg-primary/5 p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-primary/20 p-2.5 text-primary shadow-sm">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-foreground">快速 3 选 1</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          输入一个模糊念头，我会先给你 3
                          个可落地的大纲方向，适合快速开题。
                        </div>
                      </div>
                    </div>
                    <Textarea
                      value={ideaSeed}
                      onChange={(event) => setIdeaSeed(event.target.value)}
                      placeholder="例如：我想写一个悬疑修仙故事，但还没有主线。"
                      rows={3}
                      className="bg-background/50 border-primary/10 focus-visible:ring-primary/20"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-xl shadow-sm hover:shadow transition-all bg-primary/10 hover:bg-primary/20 text-primary"
                        onClick={handleGenerateDirections}
                        disabled={isGeneratingDirections}
                      >
                        {isGeneratingDirections ? "生成中..." : "快速生成 3 个方向"}
                      </Button>
                      <span className="text-xs text-muted-foreground/80">
                        会结合当前世界观、风格标签和继承项目一起判断。
                      </span>
                    </div>
                    {directionError ? (
                      <p className="text-sm text-red-600 font-medium">{directionError}</p>
                    ) : null}
                    {directionOptions.length > 0 ? (
                      <div className="grid gap-3 pt-2">
                        {directionOptions.map((direction, index) => {
                          const isSelected = selectedDirectionIndex === index;
                          return (
                            <button
                              key={`${direction.title}-${index}`}
                              type="button"
                              onClick={() =>
                                handleChooseDirection(direction, index)
                              }
                              className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                                isSelected
                                  ? "border-primary bg-background shadow-md ring-1 ring-primary/20"
                                  : "border-primary/10 bg-background/50 hover:border-primary/40 hover:bg-background hover:shadow-sm"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-bold text-foreground">
                                    {direction.title}
                                  </div>
                                  <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                    {direction.logline}
                                  </div>
                                </div>
                                <div className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary shrink-0">
                                  方向 {index + 1}
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {direction.style_tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              {isSelected && (
                                <div className="mt-4 text-xs font-medium text-primary/80 bg-primary/5 px-3 py-2 rounded-lg inline-block">
                                  ✓ 已自动填入表单，可继续修改或直接生成
                                </div>
                              )}
                            </button>
                          );
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

                  <div className="form-panel rounded-xl border border-border/50 bg-muted/10 p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-sm">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        想一步步完善故事方向？
                      </div>
                      <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
                        去 Idea Lab 按步骤推进。每一步都会给你 3
                        个方向，适合逐步筛选到最终方案。
                      </div>
                    </div>
                    <Button
                      asChild
                      type="button"
                      variant="outline"
                      className="rounded-xl shrink-0 bg-background hover:bg-muted"
                    >
                      <Link href="/idea-lab" onClick={() => setOpen(false)}>
                        前往 Idea Lab
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : null}
              <details className="form-panel rounded-xl border border-border/50 bg-muted/10 p-4 transition-all open:bg-muted/20 group">
                <summary className="cursor-pointer text-sm font-medium hover:text-primary transition-colors select-none">
                  高级选项
                </summary>
                <div className="mt-4 space-y-4 pt-2 border-t border-border/50">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="styleTags">
                      风格标签
                    </label>
                    <Input
                      id="styleTags"
                      placeholder="悬疑, 非线性叙事"
                      {...register("styleTags")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="baseProjectId">
                      继承项目（续作/前作）
                    </label>
                    <select
                      id="baseProjectId"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium"
                        htmlFor="draftingPrompt"
                      >
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
            </div>
          </ScrollArea>
          <div className="px-6 py-4 border-t bg-muted/10">
            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={submitting}
                  className="rounded-xl px-6"
                >
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={submitting} className="rounded-xl px-8 shadow-sm">
                {submitting
                  ? "处理中..."
                  : createMode === "empty"
                    ? "创建空大纲"
                    : "生成大纲"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}