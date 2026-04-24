"use client";

import { motion } from "framer-motion";
import { History, RefreshCw, History as HistoryIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  IDEA_STAGE_LABELS,
  TASK_STATUS_LABELS,
  buildTaskSummary,
  formatTaskTime,
} from "../constants";
import type {
  IdeaLabStage,
  IdeaLabStageOption,
  IdeaLabStageResponse,
  IdeaLabStageRequest,
  AsyncTask,
} from "@/src/types/models";
import { useState } from "react";

interface HistorySidebarProps {
  selectedPath: {
    stage: IdeaLabStage;
    label: string;
    option: IdeaLabStageOption;
  }[];
  recentStageTasks: Array<AsyncTask<IdeaLabStageResponse>>;
  refreshRecentStageTasks: () => Promise<void>;
  isGeneratingStage: boolean;
  restoreStageTaskResult: (task: AsyncTask<IdeaLabStageResponse>) => void;
}

export function HistorySidebar({
  selectedPath,
  recentStageTasks,
  refreshRecentStageTasks,
  isGeneratingStage,
  restoreStageTaskResult,
}: HistorySidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const content = (
    <div className="flex h-full flex-col overflow-y-auto">
      <section className="panel-shell px-4 py-4 sm:px-5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">已选路径</div>
            <div className="mt-1 text-sm text-muted-foreground xl:block hidden">
              每一步的已选结果会累积在这里，方便随时回看整条收敛路径。
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden h-8 w-8 rounded-full"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
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

      <section className="panel-shell-strong px-4 py-4 sm:px-5 shrink-0 xl:mt-3 mt-0 xl:border-none border-t border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">最近任务</div>
            <div className="mt-1 text-sm text-muted-foreground xl:block hidden">
              已完成的阶段结果可以随时载入继续使用。
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl shrink-0"
            onClick={() => void refreshRecentStageTasks()}
            disabled={isGeneratingStage}
          >
            <RefreshCw
              className={cn("h-4 w-4", isGeneratingStage ? "animate-spin" : "")}
            />
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
              const payload =
                task.request_payload as Partial<IdeaLabStageRequest>;
              const stage =
                typeof payload.stage === "string" ? payload.stage : null;
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
                    <div className="rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground whitespace-nowrap">
                      {TASK_STATUS_LABELS[task.status]}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-muted-foreground">
                    {formatTaskTime(task.updated_at)}
                  </div>

                  <div className="mt-3 text-sm leading-6 text-muted-foreground">
                    {task.status === "failed"
                      ? task.error_message || "任务执行失败。"
                      : task.result_payload?.stage_instruction ||
                        "任务已提交，等待生成结果。"}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {task.status === "succeeded" && task.result_payload ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => {
                          restoreStageTaskResult(task);
                          setIsOpen(false);
                        }}
                      >
                        载入结果
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-4 rounded-[12px] border border-border/60 bg-background/55 px-4 py-4 mb-8 xl:mb-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-primary" />
            当前工作方式
          </div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            先做选择，再继续推进；只在最后一步统一落成项目。这样更稳定，也更适合中长篇前期定题。
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <>
      {/* 移动端/平板的悬浮按钮和抽屉 */}
      <div className="xl:hidden fixed bottom-6 right-6 z-40">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full shadow-[0_8px_30px_rgba(77,102,177,0.25)] bg-background border border-border/80 text-foreground hover:bg-background/90 transition-transform active:scale-95"
            >
              <HistoryIcon className="h-6 w-6 text-primary" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[85vw] max-w-[400px] p-0 border-l-0 bg-background/95 backdrop-blur-xl"
            showCloseButton={false}
          >
            {content}
          </SheetContent>
        </Sheet>
      </div>

      {/* 桌面端正常侧边栏 */}
      <motion.aside
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.12 }}
        className="hidden xl:block space-y-3 xl:sticky xl:top-3 xl:self-start"
      >
        {content}
      </motion.aside>
    </>
  );
}
