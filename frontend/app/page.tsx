"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Layout,
  PenTool,
  Network,
  Settings,
  History,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  LogOut,
  ArrowUpRight,
} from "lucide-react";

import { CreateDialog } from "@/components/create-dialog";
import { ConflictAlert } from "@/components/conflict-alert";
import { ProjectList } from "@/components/project-list";
import { NodeEditor } from "@/components/node-editor";
import { VersionHistory } from "@/components/version-history";
import {
  AUTH_EXPIRED_EVENT,
  changePassword,
  clearAuthToken,
  createVersion,
  getCurrentUser,
  getModelConfig,
  loginUser,
  logoutAllSessions,
  registerUser,
  setAuthToken,
  updateCurrentUser,
  updateModelConfig,
  updateProjectSettings,
} from "@/src/lib/api";
import { useWebsocket } from "@/src/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStore } from "@/src/stores/project-store";
import { cn } from "@/lib/utils";
import type { AuthUser, ModelConfigResponse } from "@/src/types/models";

const OUTLINE_STEPS = [
  { key: "retrieval", title: "解析需求", detail: "整理世界观与写作风格" },
  { key: "drafting", title: "构建框架", detail: "搭建主线结构与冲突" },
  { key: "validation", title: "填充节点", detail: "生成章节与情节推进" },
  { key: "graph_update", title: "润色检查", detail: "统一节奏与逻辑" },
];

function formatHomeDate(value?: string | null) {
  if (!value) {
    return "刚刚";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
}

export default function Home() {
  const {
    currentProject,
    isLoading,
    error,
    loadProjects,
    projects,
    setError,
    outlineProgressStage,
    setProject,
    selectNode,
    setNodeEditorOpen,
    resetWorkspace,
  } = useProjectStore();
  const [versionOpen, setVersionOpen] = useState(false);

  const [modelConfig, setModelConfig] = useState<{
    draftingBaseUrl: string;
    writing: string;
    drafting: string;
    sync: string;
    extraction: string;
    draftingReasoningEffort: string;
    writingReasoningEffort: string;
    syncReasoningEffort: string;
    extractionReasoningEffort: string;
    baseUrl: string;
    writingBaseUrl: string;
    hasDefaultKey: boolean;
    hasDraftingKey: boolean;
    hasWritingKey: boolean;
    hasSyncKey: boolean;
    hasExtractionKey: boolean;
  } | null>(null);
  const [isSavingModels, setIsSavingModels] = useState(false);
  const [outlineStepIndex, setOutlineStepIndex] = useState(0);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [isSavingPrompts, setIsSavingPrompts] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState({
    baseUrl: "",
    defaultKey: "",
    draftingBaseUrl: "",
    draftingReasoningEffort: "high",
    writingBaseUrl: "",
    writing: "",
    writingReasoningEffort: "high",
    writingKey: "",
    drafting: "",
    draftingKey: "",
    sync: "",
    syncReasoningEffort: "high",
    syncKey: "",
    extraction: "",
    extractionReasoningEffort: "high",
    extractionKey: "",
  });
  const [promptForm, setPromptForm] = useState({
    drafting: "",
    sync: "",
    extraction: "",
    analysis: "",
    outline_import: "",
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authForm, setAuthForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [accountForm, setAccountForm] = useState({
    username: "",
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  });
  useWebsocket(authUser ? (currentProject?.id ?? null) : null);

  const applyModelConfig = useCallback((config: ModelConfigResponse) => {
    const nextConfig = {
      baseUrl: config.base_url ?? "",
      draftingBaseUrl: config.drafting_base_url ?? "",
      writingBaseUrl: config.writing_base_url ?? "",
      writing: config.writing_model,
      drafting: config.drafting_model,
      sync: config.sync_model,
      extraction: config.extraction_model,
      draftingReasoningEffort: config.drafting_reasoning_effort ?? "high",
      writingReasoningEffort: config.writing_reasoning_effort ?? "high",
      syncReasoningEffort: config.sync_reasoning_effort ?? "high",
      extractionReasoningEffort: config.extraction_reasoning_effort ?? "high",
      hasDefaultKey: Boolean(config.has_default_key),
      hasDraftingKey: Boolean(config.has_drafting_key),
      hasWritingKey: Boolean(config.has_writing_key),
      hasSyncKey: Boolean(config.has_sync_key),
      hasExtractionKey: Boolean(config.has_extraction_key),
    };
    setModelConfig(nextConfig);
    setModelForm((prev) => ({
      ...prev,
      baseUrl: nextConfig.baseUrl,
      draftingBaseUrl: nextConfig.draftingBaseUrl,
      writingBaseUrl: nextConfig.writingBaseUrl,
      writing: nextConfig.writing,
      drafting: nextConfig.drafting,
      sync: nextConfig.sync,
      extraction: nextConfig.extraction,
      draftingReasoningEffort: nextConfig.draftingReasoningEffort,
      writingReasoningEffort: nextConfig.writingReasoningEffort,
      syncReasoningEffort: nextConfig.syncReasoningEffort,
      extractionReasoningEffort: nextConfig.extractionReasoningEffort,
    }));
  }, []);

  useEffect(() => {
    setAccountForm((prev) => ({
      ...prev,
      username: authUser?.username ?? "",
    }));
  }, [authUser?.username]);

  useEffect(() => {
    if (!currentProject) {
      setPromptForm({
        drafting: "",
        sync: "",
        extraction: "",
        analysis: "",
        outline_import: "",
      });
      return;
    }
    const overrides = currentProject.prompt_overrides ?? {};
    setPromptForm({
      drafting: overrides.drafting ?? "",
      sync: overrides.sync ?? "",
      extraction: overrides.extraction ?? "",
      analysis: overrides.analysis ?? "",
      outline_import: overrides.outline_import ?? "",
    });
  }, [currentProject]);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "h"
      ) {
        event.preventDefault();
        setVersionOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!currentProject) {
          return;
        }
        const name = `手动快照 ${new Date().toLocaleString()}`;
        try {
          await createVersion(currentProject.id, { name });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "创建快照失败";
          setError(message);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentProject, setError]);

  useEffect(() => {
    const controller = new AbortController();
    const handleAuthExpired = () => {
      clearAuthToken();
      resetWorkspace();
      setAuthUser(null);
      setModelConfig(null);
      setAuthError("登录已过期，请重新登录。");
      setAuthChecking(false);
    };

    const bootstrapSession = async () => {
      try {
        const user = await getCurrentUser({ signal: controller.signal });
        setAuthUser(user);
        setAuthError(null);
        await loadProjects();
        const config = await getModelConfig({ signal: controller.signal });
        applyModelConfig(config);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        clearAuthToken();
        resetWorkspace();
        setAuthUser(null);
        setModelConfig(null);
      } finally {
        setAuthChecking(false);
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    void bootstrapSession();

    return () => {
      controller.abort();
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [applyModelConfig, loadProjects, resetWorkspace]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => window.cancelAnimationFrame(id);
  }, [currentProject?.id]);

  useEffect(() => {
    selectNode(null);
    setNodeEditorOpen(false);
  }, [selectNode, setNodeEditorOpen]);

  useEffect(() => {
    if (!isLoading) {
      setOutlineStepIndex(0);
      return;
    }
    if (outlineProgressStage) {
      const nextIndex = OUTLINE_STEPS.findIndex(
        (step) => step.key === outlineProgressStage,
      );
      if (nextIndex >= 0) {
        setOutlineStepIndex(nextIndex);
      } else if (outlineProgressStage === "queued") {
        setOutlineStepIndex(0);
      } else if (outlineProgressStage === "completed") {
        setOutlineStepIndex(OUTLINE_STEPS.length - 1);
      }
      return;
    }
    setOutlineStepIndex(0);
    const interval = window.setInterval(() => {
      setOutlineStepIndex((prev) =>
        prev < OUTLINE_STEPS.length - 1 ? prev + 1 : prev,
      );
    }, 1800);
    return () => window.clearInterval(interval);
  }, [isLoading, outlineProgressStage]);

  const handleModelFieldChange = (
    key:
      | "baseUrl"
      | "defaultKey"
      | "draftingBaseUrl"
      | "draftingReasoningEffort"
      | "writingBaseUrl"
      | "writing"
      | "writingReasoningEffort"
      | "writingKey"
      | "drafting"
      | "draftingKey"
      | "sync"
      | "syncReasoningEffort"
      | "syncKey"
      | "extraction"
      | "extractionReasoningEffort"
      | "extractionKey",
    value: string,
  ) => {
    setModelForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePromptFieldChange = (
    key: "drafting" | "sync" | "extraction" | "analysis" | "outline_import",
    value: string,
  ) => {
    setPromptForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAuthFieldChange = (
    key: "username" | "password" | "confirmPassword",
    value: string,
  ) => {
    setAuthForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAccountFieldChange = (
    key: "username" | "currentPassword" | "newPassword" | "confirmNewPassword",
    value: string,
  ) => {
    setAccountNotice(null);
    setAccountForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = authForm.username.trim();
    const password = authForm.password;

    if (username.length < 3) {
      setAuthError("用户名至少需要 3 个字符");
      return;
    }
    if (password.length < 6) {
      setAuthError("密码至少需要 6 个字符");
      return;
    }
    if (authMode === "register" && password !== authForm.confirmPassword) {
      setAuthError("两次输入的密码不一致");
      return;
    }

    setAuthSubmitting(true);
    try {
      const response =
        authMode === "login"
          ? await loginUser({ username, password })
          : await registerUser({ username, password });
      setAuthToken(response.access_token);
      setAuthUser(response.user);
      setAuthError(null);
      resetWorkspace();
      await loadProjects();
      const config = await getModelConfig();
      applyModelConfig(config);
      setAuthForm({ username, password: "", confirmPassword: "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      setAuthError(message);
      setAuthUser(null);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    resetWorkspace();
    setAuthUser(null);
    setModelConfig(null);
    setAuthError(null);
    setAccountNotice(null);
  };

  const handleSaveAccountProfile = async () => {
    const username = accountForm.username.trim();
    if (username.length < 3) {
      setAccountNotice("用户名至少需要 3 个字符");
      return;
    }
    setIsSavingAccount(true);
    try {
      const updated = await updateCurrentUser({ username });
      setAuthUser(updated);
      setAccountNotice("账号信息已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新账号失败";
      setAccountNotice(message);
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleChangePassword = async () => {
    if (accountForm.currentPassword.length < 6) {
      setAccountNotice("当前密码至少需要 6 个字符");
      return;
    }
    if (accountForm.newPassword.length < 6) {
      setAccountNotice("新密码至少需要 6 个字符");
      return;
    }
    if (accountForm.newPassword !== accountForm.confirmNewPassword) {
      setAccountNotice("两次输入的新密码不一致");
      return;
    }
    setIsChangingPassword(true);
    try {
      const response = await changePassword({
        current_password: accountForm.currentPassword,
        new_password: accountForm.newPassword,
      });
      setAuthToken(response.access_token);
      setAuthUser(response.user);
      setAccountForm((prev) => ({
        ...prev,
        currentPassword: "",
        newPassword: "",
        confirmNewPassword: "",
      }));
      setAccountNotice("密码已更新，其他旧会话已失效");
    } catch (error) {
      const message = error instanceof Error ? error.message : "修改密码失败";
      setAccountNotice(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLogoutAllSessions = async () => {
    setIsLoggingOutAll(true);
    try {
      await logoutAllSessions();
      clearAuthToken();
      resetWorkspace();
      setAuthUser(null);
      setModelConfig(null);
      setPromptDialogOpen(false);
      setAuthError("已退出全部会话，请重新登录。");
      setAccountNotice(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "退出全部会话失败";
      setAccountNotice(message);
    } finally {
      setIsLoggingOutAll(false);
    }
  };

  const handleSaveModels = async () => {
    setIsSavingModels(true);
    try {
      const updated = await updateModelConfig({
        base_url: modelForm.baseUrl.trim() || null,
        default_api_key: modelForm.defaultKey.trim() || null,
        drafting_base_url: modelForm.draftingBaseUrl.trim() || null,
        writing_base_url: modelForm.writingBaseUrl.trim() || null,
        writing_api_key: modelForm.writingKey.trim() || null,
        writing_model: modelForm.writing.trim() || null,
        drafting_api_key: modelForm.draftingKey.trim() || null,
        sync_api_key: modelForm.syncKey.trim() || null,
        extraction_api_key: modelForm.extractionKey.trim() || null,
        drafting_model: modelForm.drafting.trim() || null,
        sync_model: modelForm.sync.trim() || null,
        extraction_model: modelForm.extraction.trim() || null,
        drafting_reasoning_effort:
          modelForm.draftingReasoningEffort.trim() || null,
        writing_reasoning_effort:
          modelForm.writingReasoningEffort.trim() || null,
        sync_reasoning_effort: modelForm.syncReasoningEffort.trim() || null,
        extraction_reasoning_effort:
          modelForm.extractionReasoningEffort.trim() || null,
      });
      const nextConfig = {
        baseUrl: updated.base_url ?? "",
        draftingBaseUrl: updated.drafting_base_url ?? "",
        writingBaseUrl: updated.writing_base_url ?? "",
        writing: updated.writing_model,
        drafting: updated.drafting_model,
        sync: updated.sync_model,
        extraction: updated.extraction_model,
        draftingReasoningEffort:
          updated.drafting_reasoning_effort ?? "high",
        writingReasoningEffort: updated.writing_reasoning_effort ?? "high",
        syncReasoningEffort: updated.sync_reasoning_effort ?? "high",
        extractionReasoningEffort:
          updated.extraction_reasoning_effort ?? "high",
        hasDefaultKey: Boolean(updated.has_default_key),
        hasDraftingKey: Boolean(updated.has_drafting_key),
        hasWritingKey: Boolean(updated.has_writing_key),
        hasSyncKey: Boolean(updated.has_sync_key),
        hasExtractionKey: Boolean(updated.has_extraction_key),
      };
      setModelConfig(nextConfig);
      setModelForm((prev) => ({
        ...prev,
        baseUrl: nextConfig.baseUrl,
        draftingBaseUrl: nextConfig.draftingBaseUrl,
        defaultKey: "",
        writingBaseUrl: nextConfig.writingBaseUrl,
        writing: nextConfig.writing,
        writingKey: "",
        drafting: nextConfig.drafting,
        draftingKey: "",
        sync: nextConfig.sync,
        syncKey: "",
        extraction: nextConfig.extraction,
        extractionKey: "",
        draftingReasoningEffort: nextConfig.draftingReasoningEffort,
        writingReasoningEffort: nextConfig.writingReasoningEffort,
        syncReasoningEffort: nextConfig.syncReasoningEffort,
        extractionReasoningEffort: nextConfig.extractionReasoningEffort,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新模型失败";
      setError(message);
    } finally {
      setIsSavingModels(false);
    }
  };

  const handleSavePrompts = async () => {
    if (!currentProject) {
      return;
    }
    setIsSavingPrompts(true);
    try {
      const updated = await updateProjectSettings(currentProject.id, {
        prompt_overrides: {
          drafting: promptForm.drafting.trim() || null,
          sync: promptForm.sync.trim() || null,
          extraction: promptForm.extraction.trim() || null,
          analysis: promptForm.analysis.trim() || null,
          outline_import: promptForm.outline_import.trim() || null,
        },
      });
      setProject(updated);
      setPromptDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "保存创作指令失败";
      setError(message);
    } finally {
      setIsSavingPrompts(false);
    }
  };

  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [projects],
  );
  const featuredProject = currentProject ?? sortedProjects[0] ?? null;
  const featuredProjectId = featuredProject?.id ?? null;
  const featuredProjectTitle =
    featuredProject?.title?.trim() || "开始你的下一部作品";
  const featuredProjectDate = formatHomeDate(featuredProject?.updated_at);
  const homeNavItems = [
    { label: "快速开始", href: "#quick-start" },
    { label: "项目空间", href: "#projects" },
    { label: "Idea Lab", href: "/idea-lab" },
  ];

  if (authChecking) {
    return (
      <div className="app-backdrop flex min-h-screen items-center justify-center px-4 text-foreground">
        <div className="panel-shell-strong w-full max-w-md px-6 py-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="text-base font-semibold">正在连接创作空间</div>
              <div className="text-sm text-muted-foreground">
                验证登录状态并同步你的项目数据
              </div>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="app-backdrop relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12 text-foreground sm:px-6">
        {/* 背景装饰光晕 - 动态且柔和 */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -left-[10%] -top-[10%] h-[60%] w-[60%] rounded-full bg-primary/10 blur-[120px]"
          />
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.2, 0.4, 0.2],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 1,
            }}
            className="absolute -right-[5%] bottom-[10%] h-[50%] w-[50%] rounded-full bg-secondary/20 blur-[100px]"
          />
        </div>

        <div className="absolute inset-0 subtle-grid opacity-[0.15] [mask-image:radial-gradient(ellipse_at_center,black,transparent)]" />

        <div className="relative mx-auto flex w-full max-w-[1100px] flex-col gap-8 lg:flex-row lg:items-stretch lg:gap-0">
          {/* 左侧：品牌展示 - 更有艺术感的排版 */}
          <section className="hidden flex-1 flex-col justify-between rounded-l-[16px] border-y border-l border-border/60 bg-background/30 p-10 backdrop-blur-md lg:flex">
            <div className="space-y-8">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                  <Sparkles size={24} />
                </div>
                <span className="text-xl font-bold tracking-tight">
                  NovelX Workspace
                </span>
              </div>

              <div className="max-w-md space-y-6">
                <h1 className="font-serif text-5xl font-medium leading-[1.15] text-foreground xl:text-6xl">
                  为创作而生
                  <br />
                  <span className="text-primary/90">不止于写作</span>
                </h1>
                <p className="text-lg leading-relaxed text-muted-foreground/90">
                  我们重新思考了长篇小说的工作流。从逻辑严密的节点大纲，到沉浸式的写作空间，一切都为了让你的灵感能走得更远。
                </p>
              </div>

              <ul className="space-y-5">
                {[
                  {
                    icon: Layout,
                    text: "结构化创作：大纲、节点与场景的一体化管理",
                  },
                  {
                    icon: PenTool,
                    text: "AI 文笔助手：精准润色，保留你独特的文字风格",
                  },
                  {
                    icon: Network,
                    text: "关系图谱：自动提取角色网络，确保逻辑滴水不漏",
                  },
                ].map((item, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    className="flex items-center gap-4 text-sm font-medium text-foreground/80"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <item.icon size={16} />
                    </div>
                    {item.text}
                  </motion.li>
                ))}
              </ul>
            </div>

            <div className="mt-8 flex items-center gap-4 border-t border-border/40 pt-8">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-8 w-8 rounded-full border-2 border-background bg-muted shadow-sm"
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                加入数百位创作者，开启更高效的叙事旅程。
              </p>
            </div>
          </section>

          {/* 右侧：登录表单 - 极简且富有质感 */}
          <section className="panel-shell-strong relative z-10 w-full overflow-hidden p-6 sm:p-10 lg:w-[460px] lg:rounded-l-none">
            <div className="mb-10 text-center lg:text-left">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary lg:hidden">
                <Sparkles size={24} />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {authMode === "login" ? "欢迎回来" : "开始创作"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {authMode === "login"
                  ? "请输入你的凭据进入工作区"
                  : "创建一个账号，开启你的小说项目"}
              </p>
            </div>

            <div className="mb-8 flex rounded-2xl bg-muted/50 p-1.5 backdrop-blur-sm">
              <button
                type="button"
                className={cn(
                  "relative flex-1 rounded-xl py-2.5 text-sm font-medium transition-all duration-300",
                  authMode === "login"
                    ? "bg-background text-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setAuthMode("login");
                  setAuthError(null);
                }}
              >
                登录
              </button>
              <button
                type="button"
                className={cn(
                  "relative flex-1 rounded-xl py-2.5 text-sm font-medium transition-all duration-300",
                  authMode === "register"
                    ? "bg-background text-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setAuthMode("register");
                  setAuthError(null);
                }}
              >
                注册
              </button>
            </div>

            <form className="space-y-5" onSubmit={handleAuthSubmit}>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  用户名
                </label>
                <Input
                  value={authForm.username}
                  onChange={(event) =>
                    handleAuthFieldChange("username", event.target.value)
                  }
                  placeholder="请输入用户名"
                  className="h-12 border-border/60 bg-background/50 focus:bg-background"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  密码
                </label>
                <Input
                  type="password"
                  value={authForm.password}
                  onChange={(event) =>
                    handleAuthFieldChange("password", event.target.value)
                  }
                  placeholder="••••••••"
                  className="h-12 border-border/60 bg-background/50 focus:bg-background"
                />
              </div>
              {authMode === "register" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    确认密码
                  </label>
                  <Input
                    type="password"
                    value={authForm.confirmPassword}
                    onChange={(event) =>
                      handleAuthFieldChange(
                        "confirmPassword",
                        event.target.value,
                      )
                    }
                    placeholder="••••••••"
                    className="h-12 border-border/60 bg-background/50 focus:bg-background"
                  />
                </div>
              )}

              {authError && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                >
                  {authError}
                </motion.div>
              )}

              <Button
                className="h-12 w-full rounded-2xl bg-primary text-sm font-semibold shadow-lg shadow-primary/25 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70"
                type="submit"
                disabled={authSubmitting}
              >
                {authSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>处理中...</span>
                  </div>
                ) : authMode === "login" ? (
                  "立即登录"
                ) : (
                  "创建账号"
                )}
              </Button>
            </form>

            <div className="mt-8 text-center text-xs text-muted-foreground/60">
              登录即表示你同意我们的服务条款与隐私政策。
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-backdrop relative min-h-screen overflow-hidden text-foreground">
      <div className="absolute inset-0 subtle-grid opacity-35 [mask-image:linear-gradient(180deg,rgba(0,0,0,0.95),rgba(0,0,0,0.25),transparent)]" />
      <div className="absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[150px]" />
      <div className="absolute right-[8%] top-[26rem] h-[22rem] w-[22rem] rounded-full bg-secondary/16 blur-[130px]" />
      <div className="relative min-h-screen px-3 pb-20 sm:px-4">
        <header className="mx-auto w-full max-w-[1560px] pt-4 sm:pt-5">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[15px] border border-border/60 bg-background/72 px-3 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.06)] backdrop-blur-xl sm:px-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20">
                  <Sparkles size={18} />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-serif text-xl font-semibold tracking-tight">
                    NovelX Workspace
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    长篇小说创作工作台
                  </div>
                </div>
              </div>

              <nav className="hidden flex-1 items-center justify-center gap-2 lg:flex">
                {homeNavItems.map((item) => (
                  <Button
                    key={item.label}
                    asChild
                    variant="ghost"
                    className="rounded-full px-4 text-sm text-foreground/75 hover:bg-background/80 hover:text-foreground"
                  >
                    <Link href={item.href}>{item.label}</Link>
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  className="rounded-full px-4 text-sm text-foreground/75 hover:bg-background/80 hover:text-foreground"
                  onClick={() => setVersionOpen(true)}
                >
                  版本记录
                </Button>
              </nav>

              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden text-right xl:block">
                  <div className="text-sm font-medium">{authUser.username}</div>
                  <div className="text-xs text-muted-foreground">
                    {currentProject ? "已连接当前项目" : "准备创建新项目"}
                  </div>
                </div>
                <Dialog
                  open={promptDialogOpen}
                  onOpenChange={setPromptDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-xl"
                      title="偏好设置"
                    >
                      <Settings size={16} />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[85vh] w-[95vw] overflow-y-auto rounded-[14px] sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>偏好设置</DialogTitle>
                      <DialogDescription>
                        账号、AI
                        服务和进阶创作选项都收在这里，日常创作时无需频繁调整。
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 py-4">
                      <div className="space-y-3 rounded-2xl border border-border/60 p-4">
                        <div className="space-y-1">
                          <h3 className="text-sm font-medium text-foreground">
                            账号管理
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            可修改当前用户名、更新密码，或让全部旧登录会话失效。
                          </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              当前用户名
                            </label>
                            <Input
                              value={accountForm.username}
                              onChange={(e) =>
                                handleAccountFieldChange(
                                  "username",
                                  e.target.value,
                                )
                              }
                              placeholder="请输入用户名"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              账号创建时间
                            </label>
                            <Input
                              value={
                                authUser?.created_at
                                  ? new Date(
                                      authUser.created_at,
                                    ).toLocaleString()
                                  : "未知"
                              }
                              disabled
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              当前密码
                            </label>
                            <Input
                              type="password"
                              value={accountForm.currentPassword}
                              onChange={(e) =>
                                handleAccountFieldChange(
                                  "currentPassword",
                                  e.target.value,
                                )
                              }
                              placeholder="当前密码"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              新密码
                            </label>
                            <Input
                              type="password"
                              value={accountForm.newPassword}
                              onChange={(e) =>
                                handleAccountFieldChange(
                                  "newPassword",
                                  e.target.value,
                                )
                              }
                              placeholder="至少 6 位"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              确认新密码
                            </label>
                            <Input
                              type="password"
                              value={accountForm.confirmNewPassword}
                              onChange={(e) =>
                                handleAccountFieldChange(
                                  "confirmNewPassword",
                                  e.target.value,
                                )
                              }
                              placeholder="再次输入新密码"
                            />
                          </div>
                        </div>
                        {accountNotice ? (
                          <div className="rounded-2xl border border-border/60 bg-muted/40 px-3 py-2 text-xs text-foreground">
                            {accountNotice}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={handleSaveAccountProfile}
                            disabled={isSavingAccount}
                          >
                            {isSavingAccount ? "保存中..." : "保存账号"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={handleChangePassword}
                            disabled={isChangingPassword}
                          >
                            {isChangingPassword ? "更新中..." : "修改密码"}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={handleLogoutAllSessions}
                            disabled={isLoggingOutAll}
                          >
                            {isLoggingOutAll ? "处理中..." : "退出全部会话"}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-border/60 p-4">
                        <div className="space-y-1">
                          <h3 className="text-sm font-medium text-foreground">
                            AI 服务
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            仅在需要切换服务、补充密钥或调整模型时修改。
                          </p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            服务地址
                          </label>
                          <Input
                            value={modelForm.baseUrl}
                            onChange={(e) =>
                              handleModelFieldChange("baseUrl", e.target.value)
                            }
                            placeholder="https://api.openai.com/v1"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            访问密钥
                          </label>
                          <Input
                            type="password"
                            value={modelForm.defaultKey}
                            onChange={(e) =>
                              handleModelFieldChange(
                                "defaultKey",
                                e.target.value,
                              )
                            }
                            placeholder={
                              modelConfig?.hasDefaultKey
                                ? "已配置 (隐藏)"
                                : "sk-..."
                            }
                          />
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                          <div className="space-y-1">
                            <h4 className="text-sm font-medium text-foreground">
                              大纲配置
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              大纲生成和相关结构化起草共用这组模型、服务地址和访问密钥。
                            </p>
                          </div>
                          <div className="mt-4 grid gap-4 md:grid-cols-3">
                            <div className="space-y-2 md:col-span-3">
                              <label className="text-xs font-medium text-muted-foreground">
                                大纲服务地址
                              </label>
                              <Input
                                value={modelForm.draftingBaseUrl}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "draftingBaseUrl",
                                    e.target.value,
                                  )
                                }
                                placeholder="https://api.openai.com/v1"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                大纲生成模型
                              </label>
                              <Input
                                value={modelForm.drafting}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "drafting",
                                    e.target.value,
                                  )
                                }
                                placeholder="gpt-4o"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                推理强度
                              </label>
                              <Input
                                value={modelForm.draftingReasoningEffort}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "draftingReasoningEffort",
                                    e.target.value,
                                  )
                                }
                                placeholder="high"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                大纲密钥
                              </label>
                              <Input
                                type="password"
                                value={modelForm.draftingKey}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "draftingKey",
                                    e.target.value,
                                  )
                                }
                                placeholder={
                                  modelConfig?.hasDraftingKey
                                    ? "已配置 (隐藏)"
                                    : "sk-..."
                                }
                              />
                            </div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                          <div className="space-y-1">
                            <h4 className="text-sm font-medium text-foreground">
                              写作助手配置
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              润色和续写共用这组模型、服务地址和访问密钥。
                            </p>
                          </div>
                          <div className="mt-4 grid gap-4 md:grid-cols-3">
                            <div className="space-y-2 md:col-span-3">
                              <label className="text-xs font-medium text-muted-foreground">
                                写作服务地址
                              </label>
                              <Input
                                value={modelForm.writingBaseUrl}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "writingBaseUrl",
                                    e.target.value,
                                  )
                                }
                                placeholder="https://api.openai.com/v1"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                写作模型
                              </label>
                              <Input
                                value={modelForm.writing}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "writing",
                                    e.target.value,
                                  )
                                }
                                placeholder="gpt-4o"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                推理强度
                              </label>
                              <Input
                                value={modelForm.writingReasoningEffort}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "writingReasoningEffort",
                                    e.target.value,
                                  )
                                }
                                placeholder="high"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                写作密钥
                              </label>
                              <Input
                                type="password"
                                value={modelForm.writingKey}
                                onChange={(e) =>
                                  handleModelFieldChange(
                                    "writingKey",
                                    e.target.value,
                                  )
                                }
                                placeholder={
                                  modelConfig?.hasWritingKey
                                    ? "已配置 (隐藏)"
                                    : "sk-..."
                                }
                              />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              同步分析模型
                            </label>
                            <Input
                              value={modelForm.sync}
                              onChange={(e) =>
                                handleModelFieldChange("sync", e.target.value)
                              }
                              placeholder="gpt-4o-mini"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              同步推理强度
                            </label>
                            <Input
                              value={modelForm.syncReasoningEffort}
                              onChange={(e) =>
                                handleModelFieldChange(
                                  "syncReasoningEffort",
                                  e.target.value,
                                )
                              }
                              placeholder="high"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              实体抽取模型
                            </label>
                            <Input
                              value={modelForm.extraction}
                              onChange={(e) =>
                                handleModelFieldChange(
                                  "extraction",
                                  e.target.value,
                                )
                              }
                              placeholder="gpt-4o-mini"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              抽取推理强度
                            </label>
                            <Input
                              value={modelForm.extractionReasoningEffort}
                              onChange={(e) =>
                                handleModelFieldChange(
                                  "extractionReasoningEffort",
                                  e.target.value,
                                )
                              }
                              placeholder="high"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="space-y-1">
                          <h3 className="text-sm font-medium text-foreground">
                            创作指令微调
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            仅对当前项目生效。只有在你想精细调整生成风格时才需要修改。
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-baseline">
                          <label className="text-xs font-medium text-foreground">
                            大纲生成指令
                          </label>
                          <span className="text-[10px] text-muted-foreground">
                            可用变量: {"{world_view} {style_tags} {user_input}"}
                          </span>
                        </div>
                        <Textarea
                          value={promptForm.drafting}
                          onChange={(e) =>
                            handlePromptFieldChange("drafting", e.target.value)
                          }
                          rows={5}
                          className="font-mono text-xs leading-relaxed"
                          placeholder={`留空则使用系统默认的大纲生成逻辑。
你也可以补充叙事风格、结构约束或输出格式。`}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-baseline">
                          <label className="text-xs font-medium text-foreground">
                            同步分析指令
                          </label>
                          <span className="text-[10px] text-muted-foreground">
                            可用变量: {"{modified_node} {retrieved_context}"}
                          </span>
                        </div>
                        <Textarea
                          value={promptForm.sync}
                          onChange={(e) =>
                            handlePromptFieldChange("sync", e.target.value)
                          }
                          rows={5}
                          className="font-mono text-xs leading-relaxed"
                          placeholder={`留空则使用系统默认的同步分析逻辑。
可在这里强调角色状态、地点变化或关系追踪重点。`}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-baseline">
                          <label className="text-xs font-medium text-foreground">
                            实体抽取指令
                          </label>
                          <span className="text-[10px] text-muted-foreground">
                            可用变量: {"{text} {existing_entities}"}
                          </span>
                        </div>
                        <Textarea
                          value={promptForm.extraction}
                          onChange={(e) =>
                            handlePromptFieldChange(
                              "extraction",
                              e.target.value,
                            )
                          }
                          rows={4}
                          className="font-mono text-xs leading-relaxed"
                          placeholder={`留空则使用系统默认的实体抽取逻辑。
可指定关注的实体类型，或补充命名与去重规则。`}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setPromptDialogOpen(false)}
                      >
                        取消
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleSaveModels}
                        disabled={isSavingModels}
                      >
                        保存模型
                      </Button>
                      <Button
                        onClick={handleSavePrompts}
                        disabled={isSavingPrompts || !currentProject}
                      >
                        保存创作指令
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setVersionOpen(true)}
                  className="rounded-xl lg:hidden"
                  title="版本历史（快捷键 Ctrl/Cmd + Shift + H）"
                >
                  <History size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleLogout}
                  className="rounded-xl text-muted-foreground hover:text-destructive"
                  title="退出登录"
                >
                  <LogOut size={16} />
                </Button>
                <CreateDialog
                  triggerLabel="新建大纲"
                  triggerClassName="rounded-full px-5 shadow-lg shadow-primary/20"
                />
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.45,
              delay: 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden"
          >
            {homeNavItems.map((item) => (
              <Button
                key={item.label}
                asChild
                variant="ghost"
                className="shrink-0 rounded-full border border-border/55 bg-background/68 px-4 text-sm hover:bg-background"
              >
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
            <Button
              variant="ghost"
              className="shrink-0 rounded-full border border-border/55 bg-background/68 px-4 text-sm hover:bg-background"
              onClick={() => setVersionOpen(true)}
            >
              版本记录
            </Button>
          </motion.div>
        </header>

        <main className="mx-auto w-full max-w-[1560px]">
          <section
            id="quick-start"
            className="relative flex min-h-[calc(100svh-9rem)] flex-col items-center justify-center px-4 pb-16 pt-10 text-center sm:px-6"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.55,
                delay: 0.06,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/72 px-4 py-2 text-[11px] font-medium tracking-[0.24em] text-muted-foreground shadow-sm backdrop-blur-md">
                <span>快速开始</span>
                <span className="h-1 w-1 rounded-full bg-primary/50" />
                <span className="tracking-[0.16em] normal-case text-foreground/70">
                  {featuredProjectId
                    ? `最近更新 · ${featuredProjectDate}`
                    : "准备创建第一部作品"}
                </span>
              </div>
              <h1 className="mt-7 font-serif text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
                从这里继续你的故事
              </h1>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.12,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative mt-10 w-full max-w-[1080px]"
            >
              <div className="overflow-hidden rounded-[19px] border border-border/60 bg-background/78 p-4 shadow-[0_24px_90px_rgba(0,0,0,0.07)] backdrop-blur-xl sm:p-5">
                {featuredProjectId ? (
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <Link
                      href={`/projects/${featuredProjectId}/outline`}
                      className="flex min-w-0 items-center gap-4 rounded-[14px] border border-border/50 bg-primary/[0.08] px-4 py-4 text-left transition-transform duration-300 hover:-translate-y-0.5 lg:w-[40%] lg:flex-none"
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[11px] bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                        <ArrowUpRight size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                          继续最近项目
                        </span>
                        <span className="mt-2 block truncate text-lg font-semibold text-foreground sm:text-xl">
                          {featuredProjectTitle}
                        </span>
                        <span className="mt-2 block text-sm text-muted-foreground">
                          最近更新于 {featuredProjectDate}
                        </span>
                      </span>
                    </Link>

                    <div className="grid flex-1 gap-3 sm:grid-cols-3">
                      <Button
                        asChild
                        className="h-16 rounded-[12px] text-sm font-semibold shadow-lg shadow-primary/20"
                      >
                        <Link href={`/projects/${featuredProjectId}/outline`}>
                          <Layout size={15} />
                          继续大纲
                        </Link>
                      </Button>
                      <Button
                        asChild
                        variant="ghost"
                        className="h-16 rounded-[12px] border border-border/55 bg-background/72 text-sm font-semibold hover:bg-background"
                      >
                        <Link href={`/projects/${featuredProjectId}/writing`}>
                          <PenTool size={15} />
                          进入写作
                        </Link>
                      </Button>
                      <Button
                        asChild
                        variant="ghost"
                        className="h-16 rounded-[12px] border border-border/55 bg-background/72 text-sm font-semibold hover:bg-background"
                      >
                        <Link href={`/analysis/${featuredProjectId}`}>
                          <Sparkles size={15} />
                          查看分析
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 items-center gap-4 rounded-[14px] border border-border/50 bg-primary/[0.08] px-4 py-4 text-left lg:flex-1">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[11px] bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                        <Sparkles size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                          开始创作
                        </span>
                        <span className="mt-2 block text-lg font-semibold text-foreground sm:text-xl">
                          创建你的第一个项目
                        </span>
                        <span className="mt-2 block text-sm text-muted-foreground">
                          建立世界观、章节骨架与写作空间。
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col gap-3 sm:flex-row">
                      <CreateDialog
                        triggerLabel="新建大纲"
                        triggerClassName="h-16 w-full rounded-[12px] px-8 text-sm font-semibold shadow-lg shadow-primary/20"
                      />
                      <Button
                        asChild
                        variant="ghost"
                        className="h-16 rounded-[12px] border border-border/55 bg-background/72 text-sm font-semibold hover:bg-background"
                      >
                        <Link href="/idea-lab">
                          <Sparkles size={15} />
                          打开 Idea Lab
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.22,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="mt-6 flex flex-wrap items-center justify-center gap-3"
            >
              <div className="rounded-full border border-border/55 bg-background/68 px-4 py-2 text-sm text-muted-foreground backdrop-blur-md">
                当前账号{" "}
                <span className="font-medium text-foreground">
                  {authUser.username}
                </span>
              </div>
              <div className="rounded-full border border-border/55 bg-background/68 px-4 py-2 text-sm text-muted-foreground backdrop-blur-md">
                {sortedProjects.length > 0
                  ? `共 ${sortedProjects.length} 个项目`
                  : "还没有项目"}
              </div>
              <Button
                variant="ghost"
                className="rounded-full border border-border/55 bg-background/68 px-5 hover:bg-background"
                onClick={() => setVersionOpen(true)}
              >
                <History size={14} />
                查看版本记录
              </Button>
            </motion.div>
          </section>

          <section id="projects" className="px-4 pb-8 sm:px-6">
            <div className="mx-auto max-w-7xl border-t border-border/50 pt-6">
              <ProjectList />
            </div>
          </section>
        </main>
      </div>

      <NodeEditor />
      <ConflictAlert />
      <VersionHistory
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
      />

      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="panel-shell-strong w-[min(92vw,420px)] p-6">
            <div className="mb-6 flex items-center gap-4">
              <div className="relative h-11 w-11 shrink-0">
                <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
              </div>
              <div>
                <h3 className="font-medium">正在生成内容</h3>
                <p className="text-xs text-muted-foreground">
                  AI 正在根据你的设定构建大纲...
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-out"
                  style={{
                    width: `${((outlineStepIndex + 1) / OUTLINE_STEPS.length) * 100}%`,
                  }}
                />
              </div>
              <div className="space-y-2">
                {OUTLINE_STEPS.map((step, index) => {
                  const isDone = index < outlineStepIndex;
                  const isActive = index === outlineStepIndex;
                  return (
                    <div
                      key={step.key}
                      className="flex items-center gap-3 text-xs"
                    >
                      <div
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                          isDone
                            ? "border-primary bg-primary text-primary-foreground"
                            : isActive
                              ? "border-primary text-primary"
                              : "border-muted-foreground/30 text-muted-foreground/30",
                        )}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <div
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              isActive
                                ? "bg-primary animate-pulse"
                                : "bg-muted-foreground/30",
                            )}
                          />
                        )}
                      </div>
                      <div
                        className={cn(
                          "flex-1",
                          isActive
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {step.title}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed right-4 top-4 z-50 flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg animate-in slide-in-from-top-2">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError(null)}
            className="h-auto p-0 text-destructive hover:bg-transparent hover:text-destructive/80"
          >
            关闭
          </Button>
        </div>
      )}
    </div>
  );
}
