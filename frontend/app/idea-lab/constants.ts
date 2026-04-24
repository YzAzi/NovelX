import type {
  IdeaLabStage,
  AsyncTask,
  IdeaLabStageResponse,
  IdeaLabStageRequest,
} from "@/src/types/models";

export const IDEA_STAGES: IdeaLabStage[] = [
  "concept",
  "protagonist",
  "conflict",
  "outline",
];

export const IDEA_STAGE_LABELS: Record<IdeaLabStage, string> = {
  concept: "故事方向",
  protagonist: "主角方案",
  conflict: "核心冲突",
  outline: "成稿方向",
};

export const IDEA_STAGE_HINTS: Record<IdeaLabStage, string> = {
  concept: "先把故事的基调、题眼与可写性收拢出来。",
  protagonist: "把驱动叙事的人物拉清楚，避免后面大纲空转。",
  conflict: "确认故事真正的阻力和拉扯点，建立推进张力。",
  outline: "把前面所有选择整合成可直接落地的项目方案。",
};

export const TASK_STATUS_LABELS = {
  pending: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
} as const;

export function parseStyleTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatTaskTime(value?: string | null) {
  if (!value) {
    return "刚刚";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildTaskSummary(task: AsyncTask<IdeaLabStageResponse>) {
  const payload = task.request_payload as Partial<IdeaLabStageRequest>;
  if (typeof payload.seed_input === "string" && payload.seed_input.trim()) {
    return payload.seed_input.trim();
  }
  if (typeof payload.world_view === "string" && payload.world_view.trim()) {
    return payload.world_view.trim();
  }
  return "未命名灵感任务";
}
