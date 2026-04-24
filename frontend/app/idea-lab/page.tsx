"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Lightbulb, Sparkles } from "lucide-react";
import { toast } from "sonner";

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
} from "@/src/lib/api";
import { useProjectStore } from "@/src/stores/project-store";
import type {
  AsyncTask,
  AuthUser,
  IdeaLabStage,
  IdeaLabStageOption,
  IdeaLabStageRequest,
  IdeaLabStageResponse,
  StoryProject,
} from "@/src/types/models";
import { Button } from "@/components/ui/button";
import { IDEA_STAGES, IDEA_STAGE_LABELS, parseStyleTags } from "./constants";
import { InputSidebar } from "./components/input-sidebar";
import { StageContent } from "./components/stage-content";
import { HistorySidebar } from "./components/history-sidebar";

export default function IdeaLabPage() {
  const router = useRouter();
  const { projects, loadProjects, setOutlineProgressStage, setProject } =
    useProjectStore();

  const [authChecking, setAuthChecking] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [seedInput, setSeedInput] = useState("");
  const [worldView, setWorldView] = useState("");
  const [styleTagsText, setStyleTagsText] = useState("");
  const [baseProjectId, setBaseProjectId] = useState("");
  const [stageFeedback, setStageFeedback] = useState("");
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [stageResults, setStageResults] = useState<
    Partial<Record<IdeaLabStage, IdeaLabStageResponse>>
  >({});
  const [selectedIndices, setSelectedIndices] = useState<
    Partial<Record<IdeaLabStage, number>>
  >({});
  const [stageError, setStageError] = useState<string | null>(null);
  const [isGeneratingStage, setIsGeneratingStage] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [recentStageTasks, setRecentStageTasks] = useState<
    Array<AsyncTask<IdeaLabStageResponse>>
  >([]);
  const [currentStageTaskId, setCurrentStageTaskId] = useState<string | null>(
    null,
  );
  const [currentOutlineTaskId, setCurrentOutlineTaskId] = useState<
    string | null
  >(null);

  const stageRequestLockRef = useRef(false);

  const activeStage = IDEA_STAGES[activeStageIndex];
  const activeResponse = stageResults[activeStage] ?? null;
  const activeSelectedIndex = selectedIndices[activeStage];
  const activeSelectedOption =
    activeResponse && activeSelectedIndex !== undefined
      ? (activeResponse.options[activeSelectedIndex] ?? null)
      : null;
  const previousStage =
    activeStageIndex > 0 ? IDEA_STAGES[activeStageIndex - 1] : null;
  const previousSelectedOption =
    previousStage !== null
      ? (() => {
          const response = stageResults[previousStage];
          const index = selectedIndices[previousStage];
          if (!response || index === undefined) {
            return null;
          }
          return response.options[index] ?? null;
        })()
      : null;

  const hasStarted = IDEA_STAGES.some((stage) => Boolean(stageResults[stage]));
  const canStartIdeaLab = Boolean(seedInput.trim() || worldView.trim());
  const selectedPath = useMemo(
    () =>
      IDEA_STAGES.map((stage) => {
        const response = stageResults[stage];
        const index = selectedIndices[stage];
        if (!response || index === undefined) {
          return null;
        }
        return {
          stage,
          label: IDEA_STAGE_LABELS[stage],
          option: response.options[index] ?? null,
        };
      }).filter(
        (
          item,
        ): item is {
          stage: IdeaLabStage;
          label: string;
          option: IdeaLabStageOption;
        } => Boolean(item?.option),
      ),
    [selectedIndices, stageResults],
  );
  const completedStageCount = selectedPath.length;
  const progressRatio = hasStarted
    ? (activeStageIndex + 1) / IDEA_STAGES.length
    : 0.08;

  const upsertRecentStageTask = (task: AsyncTask<IdeaLabStageResponse>) => {
    setRecentStageTasks((prev) =>
      [task, ...prev.filter((item) => item.id !== task.id)].slice(0, 8),
    );
  };

  const syncIdeaLabInputsFromTask = (task: AsyncTask<IdeaLabStageResponse>) => {
    const payload = task.request_payload as Partial<IdeaLabStageRequest>;
    setSeedInput(
      typeof payload.seed_input === "string" ? payload.seed_input : "",
    );
    setWorldView(
      typeof payload.world_view === "string" ? payload.world_view : "",
    );
    setStyleTagsText(
      Array.isArray(payload.style_tags) ? payload.style_tags.join(", ") : "",
    );
    setBaseProjectId(
      typeof payload.base_project_id === "string"
        ? payload.base_project_id
        : "",
    );
  };

  const clearStagesAfter = (stageIndex: number) => {
    setStageResults((prev) => {
      const next = { ...prev };
      IDEA_STAGES.slice(stageIndex + 1).forEach((stage) => {
        delete next[stage];
      });
      return next;
    });
    setSelectedIndices((prev) => {
      const next = { ...prev };
      IDEA_STAGES.slice(stageIndex + 1).forEach((stage) => {
        delete next[stage];
      });
      return next;
    });
  };

  const restoreStageTaskResult = (task: AsyncTask<IdeaLabStageResponse>) => {
    const response = task.result_payload;
    if (!response) {
      return;
    }
    syncIdeaLabInputsFromTask(task);
    const stageIndex = IDEA_STAGES.indexOf(response.stage);
    clearStagesAfter(stageIndex);
    setStageResults((prev) => ({ ...prev, [response.stage]: response }));
    setSelectedIndices((prev) => {
      const next = { ...prev };
      delete next[response.stage];
      return next;
    });
    setActiveStageIndex(stageIndex);
    setStageFeedback("");
    setStageError(null);
  };

  const refreshRecentStageTasks = async () => {
    try {
      const response = await listAsyncTasks<IdeaLabStageResponse>({
        kind: "idea_lab_stage",
        limit: 8,
      });
      setRecentStageTasks(response.tasks);
    } catch (error) {
      console.warn("Failed to load Idea Lab tasks:", error);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (!getAuthToken()) {
        if (!cancelled) {
          setAuthChecking(false);
        }
        router.replace("/");
        return;
      }

      try {
        const user = await getCurrentUser();
        if (cancelled) {
          return;
        }
        setAuthUser(user);

        const [projectsResult, tasksResult] = await Promise.allSettled([
          loadProjects(),
          listAsyncTasks<IdeaLabStageResponse>({
            kind: "idea_lab_stage",
            limit: 8,
          }),
        ]);

        if (cancelled) {
          return;
        }

        if (tasksResult.status === "fulfilled") {
          setRecentStageTasks(tasksResult.value.tasks);
        }
        if (projectsResult.status === "rejected") {
          console.warn(
            "Failed to bootstrap Idea Lab projects:",
            projectsResult.reason,
          );
        }
        if (tasksResult.status === "rejected") {
          console.warn(
            "Failed to bootstrap Idea Lab tasks:",
            tasksResult.reason,
          );
        }
      } catch {
        if (!cancelled) {
          router.replace("/");
        }
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    };

    const handleAuthExpired = () => {
      router.replace("/");
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    void bootstrap();

    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [loadProjects, router]);

  const requestStage = async (
    stage: IdeaLabStage,
    selectedOption?: IdeaLabStageOption | null,
  ) => {
    if (stageRequestLockRef.current) {
      return;
    }

    stageRequestLockRef.current = true;
    setIsGeneratingStage(true);
    setStageError(null);

    try {
      const created = await createIdeaLabStageTask({
        stage,
        seed_input: seedInput.trim() || undefined,
        world_view: worldView.trim() || undefined,
        style_tags: parseStyleTags(styleTagsText),
        base_project_id: baseProjectId || undefined,
        feedback: stageFeedback.trim() || undefined,
        selected_option: selectedOption ?? undefined,
      });

      setCurrentStageTaskId(created.task.id);
      syncIdeaLabInputsFromTask(created.task);
      upsertRecentStageTask(created.task);

      const completedTask = await waitForAsyncTask<IdeaLabStageResponse>(
        created.task.id,
        {
          onUpdate: (task) => {
            setCurrentStageTaskId(task.id);
            upsertRecentStageTask(task);
          },
        },
      );

      if (completedTask.status === "failed") {
        throw new Error(
          completedTask.error_message || "生成阶段方案失败，请稍后重试。",
        );
      }

      const response = completedTask.result_payload;
      if (!response) {
        throw new Error("阶段任务已完成，但未返回结果。");
      }

      setStageResults((prev) => ({ ...prev, [stage]: response }));
      setSelectedIndices((prev) => {
        const next = { ...prev };
        delete next[stage];
        return next;
      });
      setActiveStageIndex(IDEA_STAGES.indexOf(stage));
      setStageFeedback("");
      upsertRecentStageTask(completedTask);
      await refreshRecentStageTasks();
    } catch (error) {
      const message = formatUserErrorMessage(
        error,
        "生成阶段方案失败，请稍后重试。",
      );
      setStageError(message);
      toast.error(message);
    } finally {
      stageRequestLockRef.current = false;
      setCurrentStageTaskId(null);
      setIsGeneratingStage(false);
    }
  };

  const handleStart = async () => {
    if (stageRequestLockRef.current || isCreatingProject) {
      return;
    }
    if (!canStartIdeaLab) {
      setStageError("请先填写一个创意起点或世界观，再开始第一步。");
      return;
    }
    setActiveStageIndex(0);
    setStageError(null);
    setStageFeedback("");
    clearStagesAfter(-1);
    await requestStage("concept", null);
  };

  const handleSelectOption = (index: number) => {
    setSelectedIndices((prev) => ({ ...prev, [activeStage]: index }));
    clearStagesAfter(activeStageIndex);
    setStageError(null);
  };

  const handleNext = async () => {
    if (!activeSelectedOption) {
      setStageError("请先从当前阶段的 3 个方向中选一个。");
      return;
    }

    const nextStage = IDEA_STAGES[activeStageIndex + 1];
    if (!nextStage) {
      return;
    }
    await requestStage(nextStage, activeSelectedOption);
  };

  const handleBack = () => {
    setStageError(null);
    setStageFeedback("");
    setActiveStageIndex((current) => Math.max(current - 1, 0));
  };

  const handleRegenerateStage = async () => {
    if (activeStage !== "concept" && !previousSelectedOption) {
      setStageError("请先完成上一步选择，再重新生成当前阶段。");
      return;
    }
    await requestStage(activeStage, previousSelectedOption);
  };

  const handleCreateProject = async () => {
    if (!activeSelectedOption) {
      setStageError("请先选择最终成稿方向。");
      return;
    }

    setIsCreatingProject(true);
    setStageError(null);
    try {
      const created = await createOutlineTask({
        world_view: activeSelectedOption.world_view,
        style_tags: activeSelectedOption.style_tags,
        initial_prompt: activeSelectedOption.initial_prompt,
        base_project_id: baseProjectId || undefined,
      });
      setCurrentOutlineTaskId(created.task.id);
      setOutlineProgressStage(created.task.progress_stage ?? "queued");

      const completedTask = await waitForAsyncTask<StoryProject>(
        created.task.id,
        {
          onUpdate: (task) => {
            setCurrentOutlineTaskId(task.id);
            if (task.progress_stage) {
              setOutlineProgressStage(task.progress_stage);
            } else if (task.status === "pending" || task.status === "running") {
              setOutlineProgressStage("queued");
            }
          },
        },
      );

      if (completedTask.status === "failed") {
        throw new Error(
          completedTask.error_message || "创建项目失败，请稍后重试。",
        );
      }

      let project = completedTask.result_payload;
      if (!project) {
        throw new Error("大纲任务已完成，但未返回项目结果。");
      }

      if (activeSelectedOption.project_title.trim()) {
        project = await updateProjectTitle(project.id, {
          title: activeSelectedOption.project_title.trim(),
        });
      }

      setProject(project);
      await loadProjects();
      toast.success("项目已创建");
      router.push("/");
    } catch (error) {
      const message = formatUserErrorMessage(
        error,
        "创建项目失败，请稍后重试。",
      );
      setStageError(message);
      toast.error(message);
    } finally {
      setCurrentOutlineTaskId(null);
      setOutlineProgressStage(null);
      setIsCreatingProject(false);
    }
  };

  if (authChecking) {
    return (
      <div className="app-backdrop flex min-h-screen items-center justify-center px-4 text-foreground">
        <div className="panel-shell-strong w-full max-w-md px-6 py-6 text-center">
          <div className="text-base font-semibold">正在准备 Idea Lab</div>
          <div className="mt-2 text-sm text-muted-foreground">
            正在恢复会话并加载你的灵感工作台。
          </div>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return null;
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
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                className="rounded-xl"
              >
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
                <span className="font-medium text-foreground">
                  {authUser.username}
                </span>
              </div>
              <Button asChild variant="outline" className="rounded-xl">
                <Link href="/">返回工作台</Link>
              </Button>
            </div>
          </div>
        </motion.header>

        <div className="mt-3 grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
          <InputSidebar
            seedInput={seedInput}
            setSeedInput={setSeedInput}
            worldView={worldView}
            setWorldView={setWorldView}
            styleTagsText={styleTagsText}
            setStyleTagsText={setStyleTagsText}
            baseProjectId={baseProjectId}
            setBaseProjectId={setBaseProjectId}
            projects={projects}
            handleStart={handleStart}
            isGeneratingStage={isGeneratingStage}
            isCreatingProject={isCreatingProject}
            canStartIdeaLab={canStartIdeaLab}
            activeStageIndex={activeStageIndex}
            setActiveStageIndex={setActiveStageIndex}
            selectedIndices={selectedIndices}
            stageResults={stageResults}
            hasStarted={hasStarted}
          />
          <StageContent
            activeStageIndex={activeStageIndex}
            hasStarted={hasStarted}
            activeResponse={activeResponse}
            activeStage={activeStage}
            completedStageCount={completedStageCount}
            activeSelectedOption={activeSelectedOption}
            progressRatio={progressRatio}
            stageError={stageError}
            isGeneratingStage={isGeneratingStage}
            isCreatingProject={isCreatingProject}
            currentStageTaskId={currentStageTaskId}
            currentOutlineTaskId={currentOutlineTaskId}
            activeSelectedIndex={activeSelectedIndex}
            handleSelectOption={handleSelectOption}
            stageFeedback={stageFeedback}
            setStageFeedback={setStageFeedback}
            handleRegenerateStage={handleRegenerateStage}
            handleBack={handleBack}
            handleCreateProject={handleCreateProject}
            handleNext={handleNext}
          />
          <HistorySidebar
            selectedPath={selectedPath}
            recentStageTasks={recentStageTasks}
            refreshRecentStageTasks={refreshRecentStageTasks}
            isGeneratingStage={isGeneratingStage}
            restoreStageTaskResult={restoreStageTaskResult}
          />
        </div>
      </div>
    </div>
  );
}
