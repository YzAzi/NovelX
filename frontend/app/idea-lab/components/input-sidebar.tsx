"use client";

import { motion } from "framer-motion";
import { Check, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { IDEA_STAGES, IDEA_STAGE_LABELS, IDEA_STAGE_HINTS } from "../constants";
import type {
  IdeaLabStage,
  IdeaLabStageResponse,
  ProjectSummary,
} from "@/src/types/models";
import { useState } from "react";

interface InputSidebarProps {
  seedInput: string;
  setSeedInput: (val: string) => void;
  worldView: string;
  setWorldView: (val: string) => void;
  styleTagsText: string;
  setStyleTagsText: (val: string) => void;
  baseProjectId: string;
  setBaseProjectId: (val: string) => void;
  projects: ProjectSummary[];
  handleStart: () => void;
  isGeneratingStage: boolean;
  isCreatingProject: boolean;
  canStartIdeaLab: boolean;
  activeStageIndex: number;
  setActiveStageIndex: (index: number) => void;
  selectedIndices: Partial<Record<IdeaLabStage, number>>;
  stageResults: Partial<Record<IdeaLabStage, IdeaLabStageResponse>>;
  hasStarted: boolean;
}

export function InputSidebar({
  seedInput,
  setSeedInput,
  worldView,
  setWorldView,
  styleTagsText,
  setStyleTagsText,
  baseProjectId,
  setBaseProjectId,
  projects,
  handleStart,
  isGeneratingStage,
  isCreatingProject,
  canStartIdeaLab,
  activeStageIndex,
  setActiveStageIndex,
  selectedIndices,
  stageResults,
  hasStarted,
}: InputSidebarProps) {
  const activeStage = IDEA_STAGES[activeStageIndex];
  const activeResponse = stageResults[activeStage] ?? null;
  const [isOpen, setIsOpen] = useState(false);

  const renderSidebarContent = (isDrawer: boolean) => (
    <div
      className={cn(
        "flex flex-col",
        isDrawer ? "h-full overflow-y-auto" : "space-y-3",
      )}
    >
      <section
        className={cn(
          "panel-shell-strong shrink-0",
          isDrawer ? "border-b-0" : "overflow-hidden",
        )}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-4 sm:px-5">
          <div>
            <div className="text-sm font-semibold">创意输入</div>
            <div
              className={cn(
                "mt-1 text-sm leading-6 text-muted-foreground",
                isDrawer ? "hidden xl:block" : "",
              )}
            >
              先提供一个起点，Idea Lab 会替你做第一次收拢和分叉。
            </div>
          </div>
          {isDrawer && (
            <Button
              variant="ghost"
              size="icon"
              className="xl:hidden h-8 w-8 rounded-full shrink-0 -mr-2"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
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
            <Select
              value={baseProjectId || "none"}
              onValueChange={(val) =>
                setBaseProjectId(val === "none" ? "" : val)
              }
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="不继承" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不继承</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => {
              handleStart();
              if (isDrawer) setIsOpen(false);
            }}
            disabled={
              isGeneratingStage || isCreatingProject || !canStartIdeaLab
            }
            className="h-12 w-full rounded-[12px] text-sm font-semibold shadow-lg shadow-primary/20"
          >
            {isGeneratingStage && !activeResponse
              ? "正在启动第一步..."
              : "开始第一步"}
          </Button>

          {!canStartIdeaLab ? (
            <div className="rounded-[11px] border border-dashed border-border/70 bg-background/55 px-4 py-3 text-xs leading-6 text-muted-foreground">
              至少填写一个创意起点或世界观，再开始收敛流程。
            </div>
          ) : null}
        </div>
      </section>

      <section
        className={cn(
          "panel-shell px-4 py-4 sm:px-5 shrink-0",
          isDrawer
            ? "border-t border-border/60 xl:border-none xl:mt-3 mt-0"
            : "",
        )}
      >
        <div className="text-sm font-semibold">流程轨迹</div>
        <div className="mt-1 text-sm text-muted-foreground">
          当前阶段、已确认阶段和下一步都在这里。
        </div>

        <div className={cn("mt-4 space-y-3", isDrawer ? "pb-8 xl:pb-0" : "")}>
          {IDEA_STAGES.map((stage, index) => {
            const isActive = index === activeStageIndex;
            const isDone = selectedIndices[stage] !== undefined;
            const isUnlocked = hasStarted
              ? index <= activeStageIndex + 1
              : index === 0;
            return (
              <button
                key={stage}
                type="button"
                onClick={() => {
                  if (stageResults[stage]) {
                    setActiveStageIndex(index);
                    if (isDrawer) setIsOpen(false);
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
                    <div className="text-sm font-semibold">
                      {IDEA_STAGE_LABELS[stage]}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {IDEA_STAGE_HINTS[stage]}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );

  return (
    <>
      {/* 隐藏的 Sheet，被 top card 或 FAB 控制 */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="left"
          className="w-[85vw] max-w-[400px] p-0 border-r-0 bg-background/95 backdrop-blur-xl"
          showCloseButton={false}
        >
          {renderSidebarContent(true)}
        </SheetContent>
      </Sheet>

      {/* 移动端/平板 (小于 xl) 的内联显示逻辑 */}
      <div className="xl:hidden mb-3">
        {hasStarted ? (
          <div
            className="panel-shell px-4 py-3 sm:px-5 flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => setIsOpen(true)}
          >
            <div className="min-w-0 pr-4">
              <div className="text-xs font-semibold text-muted-foreground">
                创意输入 & 轨迹
              </div>
              <div className="mt-1 text-sm truncate">
                {seedInput || worldView || "已启动收敛..."}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 pointer-events-none rounded-full bg-primary/10 text-primary"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          renderSidebarContent(false)
        )}
      </div>

      {/* 移动端/平板的悬浮按钮 (仅在 hasStarted 为 true 时显示，防止挤占原本未开始的屏幕) */}
      {hasStarted && (
        <div className="xl:hidden fixed bottom-8 left-6 z-40">
          <Button
            size="icon"
            onClick={() => setIsOpen(true)}
            className="h-14 w-14 rounded-full shadow-[0_8px_30px_rgba(77,102,177,0.25)] bg-primary text-primary-foreground hover:bg-primary/90 transition-transform active:scale-95"
          >
            <Settings2 className="h-6 w-6" />
          </Button>
        </div>
      )}

      {/* 桌面端正常侧边栏 */}
      <motion.aside
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
        className="hidden xl:block space-y-3 xl:sticky xl:top-3 xl:self-start"
      >
        {renderSidebarContent(false)}
      </motion.aside>
    </>
  );
}
