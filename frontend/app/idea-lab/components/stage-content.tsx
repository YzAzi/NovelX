"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { IDEA_STAGES, IDEA_STAGE_LABELS, IDEA_STAGE_HINTS } from "../constants";
import type {
  IdeaLabStage,
  IdeaLabStageOption,
  IdeaLabStageResponse,
} from "@/src/types/models";

interface StageContentProps {
  activeStageIndex: number;
  hasStarted: boolean;
  activeResponse: IdeaLabStageResponse | null;
  activeStage: IdeaLabStage;
  completedStageCount: number;
  activeSelectedOption: IdeaLabStageOption | null;
  progressRatio: number;
  stageError: string | null;
  isGeneratingStage: boolean;
  isCreatingProject: boolean;
  currentStageTaskId: string | null;
  currentOutlineTaskId: string | null;
  activeSelectedIndex?: number;
  handleSelectOption: (index: number) => void;
  stageFeedback: string;
  setStageFeedback: (val: string) => void;
  handleRegenerateStage: () => void;
  handleBack: () => void;
  handleCreateProject: () => void;
  handleNext: () => void;
}

export function StageContent({
  activeStageIndex,
  hasStarted,
  activeResponse,
  activeStage,
  completedStageCount,
  activeSelectedOption,
  progressRatio,
  stageError,
  isGeneratingStage,
  isCreatingProject,
  currentStageTaskId,
  currentOutlineTaskId,
  activeSelectedIndex,
  handleSelectOption,
  stageFeedback,
  setStageFeedback,
  handleRegenerateStage,
  handleBack,
  handleCreateProject,
  handleNext,
}: StageContentProps) {
  return (
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
                第 {Math.min(activeStageIndex + 1, IDEA_STAGES.length)} /{" "}
                {IDEA_STAGES.length} 步
              </div>
              <h2 className="mt-3 font-serif text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.45rem]">
                {hasStarted
                  ? activeResponse?.stage_title ||
                    IDEA_STAGE_LABELS[activeStage]
                  : "从一个念头出发，逐步逼近可写的小说方案"}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
                {hasStarted
                  ? activeResponse?.stage_instruction ||
                    IDEA_STAGE_HINTS[activeStage]
                  : "中间是当前工作区，左边负责输入和阶段轨迹，右边负责保存决策和回看任务。整个过程不会强迫你一次想清楚，而是让你每一轮只做一个判断。"}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
              <div className="rounded-[12px] border border-border/60 bg-background/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  当前阶段
                </div>
                <div className="mt-2 text-sm font-semibold">
                  {IDEA_STAGE_LABELS[activeStage]}
                </div>
              </div>
              <div className="rounded-[12px] border border-border/60 bg-background/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  已确认
                </div>
                <div className="mt-2 text-sm font-semibold">
                  {completedStageCount} 个阶段
                </div>
              </div>
              <div className="rounded-[12px] border border-border/60 bg-background/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  项目状态
                </div>
                <div className="mt-2 text-sm font-semibold">
                  {activeStageIndex === IDEA_STAGES.length - 1 &&
                  activeSelectedOption
                    ? "可创建项目"
                    : "正在收敛"}
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
                    const isSelected = activeSelectedIndex === index;
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
                            ? "border-primary/28 bg-gradient-to-b from-primary/10 to-background/95 shadow-[0_22px_48px_rgba(77,102,177,0.13)]"
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
                            {isSelected ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              index + 1
                            )}
                          </div>
                        </div>

                        <div className="relative mt-5 grid gap-4 border-t border-border/60 pt-4 text-sm">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              故事前提
                            </div>
                            <div className="mt-2 leading-6 text-foreground/92">
                              {option.premise}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              主角方案
                            </div>
                            <div className="mt-2 leading-6 text-foreground/92">
                              {option.protagonist}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              核心冲突
                            </div>
                            <div className="mt-2 leading-6 text-foreground/92">
                              {option.conflict}
                            </div>
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
                    );
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
                        onChange={(event) =>
                          setStageFeedback(event.target.value)
                        }
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
                        {isGeneratingStage ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        换一组
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={handleBack}
                        disabled={
                          activeStageIndex === 0 ||
                          isGeneratingStage ||
                          isCreatingProject
                        }
                      >
                        <ArrowLeft className="h-4 w-4" />
                        上一步
                      </Button>
                      {activeResponse.is_final_stage ? (
                        <Button
                          className="rounded-xl shadow-lg shadow-primary/20"
                          onClick={handleCreateProject}
                          disabled={
                            !activeSelectedOption ||
                            isGeneratingStage ||
                            isCreatingProject
                          }
                        >
                          {isCreatingProject ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <BookOpenText className="h-4 w-4" />
                          )}
                          创建项目并生成大纲
                        </Button>
                      ) : (
                        <Button
                          className="rounded-xl shadow-lg shadow-primary/20"
                          onClick={handleNext}
                          disabled={
                            !activeSelectedOption ||
                            isGeneratingStage ||
                            isCreatingProject
                          }
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
                      Idea Lab
                      不是一次生成完整项目，而是把你的想法拆成四次更容易判断的选择。这样更像在桌面应用里编辑方案，而不是一次把所有决定都压在一个输入框里。
                    </p>

                    <div className="mt-8 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[12px] border border-border/60 bg-background/78 px-4 py-4">
                        <div className="text-sm font-semibold">
                          第一步：拉出三个方向
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted-foreground">
                          先把题材、情绪、钩子和可写性做第一次切分。
                        </div>
                      </div>
                      <div className="rounded-[12px] border border-border/60 bg-background/78 px-4 py-4">
                        <div className="text-sm font-semibold">
                          第二步到第四步：逐次锁定
                        </div>
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
  );
}
