"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  BookPlus,
  Calendar,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Loader2,
  MoreVertical,
  Trash2,
  Upload,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import { exportProject, importProject } from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type ProjectListProps = {
  variant?: "grid" | "rail"
  showHeader?: boolean
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function ProjectList({
  variant = "grid",
  showHeader = true,
}: ProjectListProps = {}) {
  const {
    currentProject,
    loadProject,
    loadProjects,
    projects,
    removeProject,
    setError,
    setProject,
  } = useProjectStore()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isRail = variant === "rail"

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const sortedProjects = useMemo(() => {
    return [...projects].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  }, [projects])

  const handleLoad = async (projectId: string) => {
    setLoadingId(projectId)
    await loadProject(projectId)
    setLoadingId(null)
  }

  const handleDelete = async (projectId: string) => {
    await removeProject(projectId)
    setConfirmingId(null)
  }

  const handleExport = async (projectId: string, title: string) => {
    setExportingId(projectId)
    try {
      const data = await exportProject(projectId)
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${title || "项目"}-${projectId}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出失败"
      setError(message)
    } finally {
      setExportingId(null)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImport = async (file: File) => {
    setIsImporting(true)
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const project = await importProject(payload)
      setProject(project)
      await loadProjects()
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败"
      setError(message)
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: isRail ? 0.06 : 0.1,
      },
    },
  }

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  }

  return (
    <div className={cn("w-full", isRail ? "space-y-4" : "mx-auto max-w-7xl space-y-8 py-8")}>
      {showHeader && (
        <div className={cn("flex gap-4", isRail ? "flex-col px-0" : "flex-col px-2 md:flex-row md:items-end md:justify-between")}>
          <div className="space-y-2">
            <h2 className="flex items-center gap-3 text-2xl font-serif font-bold tracking-tight text-foreground/90">
              <div className="rounded-xl bg-primary/10 p-2">
                <BookPlus className="h-6 w-6 text-primary" />
              </div>
              项目空间
            </h2>
            <p className="ml-1 text-sm text-muted-foreground">
              {isRail
                ? `最近更新的 ${sortedProjects.length} 个项目会优先显示在这里`
                : `按最近更新时间排序，共 ${sortedProjects.length} 个项目`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  handleImport(file)
                }
              }}
            />
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4 text-sm font-medium border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all"
              onClick={handleImportClick}
              disabled={isImporting}
            >
              {isImporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              导入备份
            </Button>
          </div>
        </div>
      )}

      {!showHeader && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              handleImport(file)
            }
          }}
        />
      )}

      {sortedProjects.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "flex flex-col items-center justify-center text-center backdrop-blur-sm",
            isRail
              ? "rounded-[28px] border border-dashed border-border/50 bg-background/45 px-5 py-14"
              : "rounded-[32px] border-2 border-dashed border-border/40 bg-card/30 py-24"
          )}
        >
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/5 text-primary/40">
            <FileText size={40} strokeWidth={1} />
          </div>
          <h3 className="text-xl font-semibold text-foreground/80">还没有项目</h3>
          <p className="mt-3 max-w-[24rem] text-sm leading-relaxed text-muted-foreground">
            点击“新建大纲”创建项目，或导入已有备份继续创作。
          </p>
          {!showHeader && (
            <Button
              variant="outline"
              className="mt-6 rounded-xl"
              onClick={handleImportClick}
              disabled={isImporting}
            >
              {isImporting ? "导入中..." : "导入项目"}
            </Button>
          )}
        </motion.div>
      ) : (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className={cn(
            isRail ? "space-y-3" : "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          )}
        >
          <AnimatePresence mode="popLayout">
            {sortedProjects.map((project, index) => {
              const isActive = project.id === currentProject?.id
              const isConfirming = confirmingId === project.id
              const isLoading = loadingId === project.id
              const isExporting = exportingId === project.id
              const isFeatured = !isRail && (isActive || index === 0)

              return (
                <motion.div
                  key={project.id}
                  variants={item}
                  layout
                  className={cn(
                    "group relative cursor-pointer overflow-hidden border border-border/60 backdrop-blur-md transition-all duration-300",
                    isRail
                      ? "rounded-[24px] bg-background/66 px-4 py-4 hover:border-primary/40 hover:bg-background/78"
                      : "flex min-h-[360px] flex-col rounded-[30px] bg-background/74 p-7 shadow-[0_18px_55px_rgba(0,0,0,0.05)] hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_28px_75px_rgba(0,0,0,0.08)]",
                    isFeatured && !isRail && "bg-gradient-to-br from-primary/[0.18] via-primary/[0.12] to-secondary/[0.18] text-primary-foreground shadow-[0_24px_80px_rgba(77,102,177,0.16)]",
                    isActive && "border-primary/50 ring-2 ring-primary/5"
                  )}
                  onClick={() => !isLoading && handleLoad(project.id)}
                >
                  <div className={cn("flex", isRail ? "items-start gap-3" : "flex-col")}>
                    {!isRail && (
                      <div className="mb-4 flex items-start justify-between">
                        <div
                          className={cn(
                            "flex h-12 w-12 items-center justify-center rounded-2xl transition-colors",
                            isFeatured
                              ? "bg-background/85 text-foreground"
                              : isActive
                              ? "bg-primary/10 text-primary"
                              : "bg-muted/50 text-muted-foreground group-hover:bg-primary/5 group-hover:text-primary/70"
                          )}
                        >
                          <BookOpen size={24} strokeWidth={1.5} />
                        </div>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {isActive && (
                            <div className="mr-2 flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                              <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                              当前项目
                            </div>
                          )}
                          <ProjectActions
                            isConfirming={isConfirming}
                            isExporting={isExporting}
                            onCancel={() => setConfirmingId(null)}
                            onConfirmDelete={() => {
                              void handleDelete(project.id)
                            }}
                            onDelete={() => setConfirmingId(project.id)}
                            onExport={() => {
                              void handleExport(project.id, project.title)
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {isRail && (
                      <>
                        <div
                          className={cn(
                            "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors",
                            isActive
                              ? "bg-primary/12 text-primary"
                              : "bg-muted/60 text-muted-foreground group-hover:bg-primary/6 group-hover:text-primary/70"
                          )}
                        >
                          <BookOpen size={20} strokeWidth={1.6} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="truncate text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                                  {project.title || "未命名项目"}
                                </h3>
                                {isActive && (
                                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                    当前项目
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                  <Calendar className="h-3.5 w-3.5" />
                                  {formatDate(project.updated_at)}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <Clock3 className="h-3.5 w-3.5" />
                                  最近编辑
                                </span>
                              </div>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                              <ProjectActions
                                isConfirming={isConfirming}
                                isExporting={isExporting}
                                onCancel={() => setConfirmingId(null)}
                                onConfirmDelete={() => {
                                  void handleDelete(project.id)
                                }}
                                onDelete={() => setConfirmingId(project.id)}
                                onExport={() => {
                                  void handleExport(project.id, project.title)
                                }}
                              />
                            </div>
                          </div>

                          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/40 pt-3">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {isActive
                                ? "已就绪，可直接回到大纲、写作或分析模块。"
                                : "载入后可从首页快速继续上次的工作进度。"}
                            </p>
                            <div
                              className={cn(
                                "flex shrink-0 items-center gap-1.5 text-xs font-semibold transition-all",
                                isActive
                                  ? "text-primary"
                                  : "text-muted-foreground group-hover:translate-x-1 group-hover:text-primary"
                              )}
                            >
                              {isLoading ? "正在载入..." : isActive ? "继续创作" : "载入项目"}
                              {!isLoading && <ChevronRight className="h-3.5 w-3.5" />}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {!isRail && (
                      <>
                        <div className="flex-1 space-y-2">
                          <h3 className={cn(
                            "line-clamp-2 text-[2rem] font-semibold leading-tight tracking-tight transition-colors sm:text-[2.2rem]",
                            isFeatured ? "text-foreground" : "text-foreground group-hover:text-primary"
                          )}>
                            {project.title || "未命名项目"}
                          </h3>
                          <p className={cn(
                            "max-w-md pt-2 text-base leading-8",
                            isFeatured ? "text-foreground/82" : "text-muted-foreground"
                          )}>
                            {isFeatured
                              ? "继续推进故事结构、章节写作与人物关系。"
                              : "打开项目后，可直接回到上次停留的位置。"}
                          </p>
                          <div className={cn(
                            "flex items-center gap-4 pt-3 text-xs font-medium",
                            isFeatured ? "text-foreground/75" : "text-muted-foreground/80"
                          )}>
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(project.updated_at)}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock3 className="h-3.5 w-3.5" />
                              最近编辑
                            </div>
                          </div>
                        </div>

                        <div className={cn(
                          "mt-8 flex items-center justify-between border-t pt-5",
                          isFeatured ? "border-foreground/10" : "border-border/40"
                        )}>
                          <div className={cn(
                            "text-xs",
                            isFeatured ? "text-foreground/72" : "text-muted-foreground"
                          )}>
                            {isActive ? "当前已连接" : "点击打开项目"}
                          </div>

                          <div
                            className={cn(
                              "flex items-center gap-1.5 text-sm font-semibold transition-all",
                              isActive
                                ? "text-primary"
                                : isFeatured
                                ? "text-foreground group-hover:translate-x-1"
                                : "text-muted-foreground group-hover:translate-x-1 group-hover:text-primary"
                            )}
                          >
                            {isLoading ? "正在载入..." : isActive ? "继续创作" : "打开项目"}
                            {!isLoading && <ChevronRight className="h-3.5 w-3.5" />}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {isLoading && (
                    <div
                      className={cn(
                        "absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[2px]",
                        isRail ? "rounded-[24px]" : "rounded-[24px]"
                      )}
                    >
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}

function ProjectActions({
  isConfirming,
  isExporting,
  onExport,
  onDelete,
  onConfirmDelete,
  onCancel,
}: {
  isConfirming: boolean
  isExporting: boolean
  onExport: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancel: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full opacity-60 hover:bg-background/80 hover:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 rounded-xl">
        <DropdownMenuItem
          className="rounded-lg"
          onClick={onExport}
          disabled={isExporting}
        >
          <Download className="mr-2 h-4 w-4" />
          导出项目
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isConfirming ? (
          <>
            <DropdownMenuItem
              className="rounded-lg font-medium text-destructive focus:text-destructive"
              onClick={onConfirmDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              确认彻底删除
            </DropdownMenuItem>
            <DropdownMenuItem className="rounded-lg" onClick={onCancel}>
              取消
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem
            className="rounded-lg text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            删除项目
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
