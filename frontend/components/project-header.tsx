"use client"

import { useCallback } from "react"
import Link from "next/link"
import {
  BookOpenText,
  Layout,
  Network,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { CreateDialog } from "@/components/create-dialog"
import { SyncIndicator } from "@/components/sync-indicator"
import { History } from "lucide-react"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/src/stores/project-store"

const MODULE_NAV = [
  { key: "outline", label: "大纲", icon: Layout, routeFn: (id: string) => `/projects/${id}/outline` },
  { key: "writing", label: "写作", icon: PenTool, routeFn: (id: string) => `/projects/${id}/writing` },
  { key: "relations", label: "关系", icon: Network, routeFn: (id: string) => `/projects/${id}/relations` },
  { key: "analysis", label: "分析", icon: Sparkles, routeFn: (id: string) => `/analysis/${id}` },
]

const MODULE_ICONS: Record<string, typeof Layout> = {
  outline: Layout,
  writing: PenTool,
  relations: Network,
  analysis: Sparkles,
}

const MODULE_SUBTITLES: Record<string, string> = {
  outline: "管理叙事节点、时间线与场景位置",
  writing: "章节正文、文风知识库与 AI 辅助",
  relations: "角色网络、章节筛选与关系状态",
  analysis: "一致性检查与扩写建议",
}

export function ProjectHeader({
  projectId,
  activeModule,
  children,
  setProjectSidebarOpen,
  setVersionOpen,
  projectSidebarOpen,
}: {
  projectId: string
  activeModule: string
  children?: React.ReactNode
  setProjectSidebarOpen?: (open: boolean) => void
  setVersionOpen?: (open: boolean) => void
  projectSidebarOpen?: boolean
}) {
  const { currentProject, saveStatus } = useProjectStore()
  const resolveRoute = useCallback(
    (mod: (typeof MODULE_NAV)[number]) => {
      if (mod.routeFn) return mod.routeFn(projectId)
      return "/"
    },
    [projectId],
  )

  const activeKey = activeModule

  return (
    <header className="panel-shell px-4 py-3 sm:px-5">
      {/* Row 1: title + status + actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href="/"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm transition-transform hover:scale-105"
          >
            <Sparkles size={16} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="h-9 flex items-center">
              <span className="font-serif text-lg font-semibold text-foreground line-clamp-1 sm:text-xl">
                {currentProject?.title || "未命名项目"}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <SyncIndicator />
                {saveStatus === "saving" ? "同步中" : saveStatus === "saved" ? "已保存" : "在线"}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <BookOpenText size={11} className="text-primary/70" />
                已连接
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CreateDialog />
          {setVersionOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setVersionOpen(true)}
              className="rounded-xl"
              title="版本历史"
            >
              <History size={16} />
            </Button>
          )}
          {setProjectSidebarOpen && projectSidebarOpen !== undefined && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setProjectSidebarOpen(!projectSidebarOpen)}
              className="hidden rounded-xl xl:inline-flex"
              title="切换项目侧栏"
            >
              {projectSidebarOpen ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: module tabs */}
      <nav className="mt-3 flex items-center gap-1 overflow-x-auto border-t border-border/40 pt-3 sm:gap-1.5">
        {MODULE_NAV.map((mod) => {
          const Icon = mod.icon
          const isActive = activeKey === mod.key
          return (
            <Link
              key={mod.key}
              href={resolveRoute(mod)}
              className={cn(
                "group flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
              )}
            >
              <Icon size={15} className={cn("transition-transform duration-200", isActive ? "text-primary-foreground" : "group-hover:scale-110")} />
              {mod.label}
            </Link>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <CreateDialog />
          {setVersionOpen && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-xl text-xs"
              onClick={() => setVersionOpen(true)}
            >
              <History size={13} />
              版本历史
            </Button>
          )}
        </div>
      </nav>

      {/* Optional children (e.g., module-specific toolbar) */}
      {children}
    </header>
  )
}

export function ProjectWorkspaceHeader({
  moduleKey,
  title,
  subtitle,
}: {
  moduleKey: string
  title?: string
  subtitle?: string
}) {
  const Icon = MODULE_ICONS[moduleKey] ?? Layout
  const displayTitle = title || {
    outline: "故事结构工作区",
    writing: "写作空间",
    relations: "关系图谱",
    analysis: "分析建议",
  }[moduleKey] || "工作区"

  const displaySubtitle = subtitle || MODULE_SUBTITLES[moduleKey] || ""

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon size={14} />
          </span>
          <div className="text-sm font-semibold text-foreground">{displayTitle}</div>
        </div>
        {displaySubtitle && (
          <div className="mt-0.5 text-xs text-muted-foreground">{displaySubtitle}</div>
        )}
      </div>
    </div>
  )
}

export { MODULE_NAV, MODULE_ICONS, MODULE_SUBTITLES }
