"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Layout,
  PenTool,
  Network,
  Book,
  Settings,
  History,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react"

import { CreateDialog } from "@/components/create-dialog"
import { CharacterGraph } from "@/components/character-graph"
import { ConflictAlert } from "@/components/conflict-alert"
import { KnowledgeWorkspace } from "@/components/knowledge-workspace"
import { ProjectList } from "@/components/project-list"
import { NodeEditor } from "@/components/node-editor"
import { StoryVisualizer } from "@/components/story-visualizer"
import { SyncIndicator } from "@/components/sync-indicator"
import { VersionHistory } from "@/components/version-history"
import { ChatSidebar } from "@/components/chat-sidebar"
import { WritingWorkspace } from "@/components/writing-workspace"
import {
  createVersion,
  getModelConfig,
  updateModelConfig,
  updateProjectSettings,
  updateProjectTitle,
} from "@/src/lib/api"
import { useWebsocket } from "@/src/hooks/use-websocket"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useProjectStore } from "@/src/stores/project-store"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

const DEFAULT_TITLE = "未命名项目"
const OUTLINE_STEPS = [
  { key: "retrieval", title: "解析需求", detail: "整理世界观与写作风格" },
  { key: "drafting", title: "构建框架", detail: "搭建主线结构与冲突" },
  { key: "validation", title: "填充节点", detail: "生成章节与情节推进" },
  { key: "graph_update", title: "润色检查", detail: "统一节奏与逻辑" },
]

export default function Home() {
  const {
    currentProject,
    isLoading,
    error,
    loadProjects,
    saveStatus,
    setError,
    outlineProgressStage,
    setProject,
    setProjectTitle,
    selectNode,
    setNodeEditorOpen,
  } = useProjectStore()
  const [activeTab, setActiveTab] = useState("outline")
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [projectSidebarOpen, setProjectSidebarOpen] = useState(true)
  const [versionOpen, setVersionOpen] = useState(false)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
  const [modelConfig, setModelConfig] = useState<{
    drafting: string
    sync: string
    extraction: string
    baseUrl: string
    hasDefaultKey: boolean
    hasDraftingKey: boolean
    hasSyncKey: boolean
    hasExtractionKey: boolean
  } | null>(null)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [isSavingModels, setIsSavingModels] = useState(false)
  const [outlineStepIndex, setOutlineStepIndex] = useState(0)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [isSavingPrompts, setIsSavingPrompts] = useState(false)
  const [modelForm, setModelForm] = useState({
    baseUrl: "",
    defaultKey: "",
    drafting: "",
    draftingKey: "",
    sync: "",
    syncKey: "",
    extraction: "",
    extractionKey: "",
  })
  const [promptForm, setPromptForm] = useState({
    drafting: "",
    sync: "",
    extraction: "",
    analysis: "",
    outline_import: "",
  })

  useWebsocket(currentProject?.id ?? null)

  useEffect(() => {
    setTitle(currentProject?.title ?? DEFAULT_TITLE)
  }, [currentProject])

  useEffect(() => {
    if (!currentProject) {
      setPromptForm({
        drafting: "",
        sync: "",
        extraction: "",
        analysis: "",
        outline_import: "",
      })
      return
    }
    const overrides = currentProject.prompt_overrides ?? {}
    setPromptForm({
      drafting: overrides.drafting ?? "",
      sync: overrides.sync ?? "",
      extraction: overrides.extraction ?? "",
      analysis: overrides.analysis ?? "",
      outline_import: overrides.outline_import ?? "",
    })
  }, [currentProject?.id])

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        setVersionOpen(true)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (!currentProject) {
          return
        }
        const name = `手动快照 ${new Date().toLocaleString()}`
        try {
          await createVersion(currentProject.id, { name, type: "manual" })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "创建快照失败"
          setError(message)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [currentProject, setError])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    const controller = new AbortController()
    getModelConfig({ signal: controller.signal })
      .then((config) => {
        const nextConfig = {
          baseUrl: config.base_url ?? "",
          drafting: config.drafting_model,
          sync: config.sync_model,
          extraction: config.extraction_model,
          hasDefaultKey: Boolean(config.has_default_key),
          hasDraftingKey: Boolean(config.has_drafting_key),
          hasSyncKey: Boolean(config.has_sync_key),
          hasExtractionKey: Boolean(config.has_extraction_key),
        }
        setModelConfig(nextConfig)
        setModelForm((prev) => ({
          ...prev,
          baseUrl: nextConfig.baseUrl,
          drafting: nextConfig.drafting,
          sync: nextConfig.sync,
          extraction: nextConfig.extraction,
        }))
      })
      .catch(() => null)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"))
    })
    return () => window.cancelAnimationFrame(id)
  }, [activeTab, currentProject?.id])

  useEffect(() => {
    if (activeTab !== "outline") {
      selectNode(null)
      setNodeEditorOpen(false)
    }
  }, [activeTab, selectNode, setNodeEditorOpen])

  useEffect(() => {
    if (!isLoading) {
      setOutlineStepIndex(0)
      return
    }
    if (outlineProgressStage) {
      const nextIndex = OUTLINE_STEPS.findIndex(
        (step) => step.key === outlineProgressStage
      )
      if (nextIndex >= 0) {
        setOutlineStepIndex(nextIndex)
      } else if (outlineProgressStage === "queued") {
        setOutlineStepIndex(0)
      } else if (outlineProgressStage === "completed") {
        setOutlineStepIndex(OUTLINE_STEPS.length - 1)
      }
      return
    }
    setOutlineStepIndex(0)
    const interval = window.setInterval(() => {
      setOutlineStepIndex((prev) =>
        prev < OUTLINE_STEPS.length - 1 ? prev + 1 : prev
      )
    }, 1800)
    return () => window.clearInterval(interval)
  }, [isLoading, outlineProgressStage])


  const handleTitleChange = (value: string) => {
    setTitle(value)
  }

  const handleSaveTitle = async () => {
    if (!currentProject) {
      return
    }
    const nextTitle = title.trim()
    if (!nextTitle) {
      setError("项目标题不能为空")
      return
    }
    setIsSavingTitle(true)
    try {
      const updated = await updateProjectTitle(currentProject.id, { title: nextTitle })
      setProject(updated)
      setTitle(updated.title)
      setProjectTitle(updated.id, updated.title, updated.updated_at)
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存项目标题失败"
      setError(message)
    } finally {
      setIsSavingTitle(false)
    }
  }

  const handleModelFieldChange = (
    key:
      | "baseUrl"
      | "defaultKey"
      | "drafting"
      | "draftingKey"
      | "sync"
      | "syncKey"
      | "extraction"
      | "extractionKey",
    value: string
  ) => {
    setModelForm((prev) => ({ ...prev, [key]: value }))
  }

  const handlePromptFieldChange = (
    key: "drafting" | "sync" | "extraction" | "analysis" | "outline_import",
    value: string
  ) => {
    setPromptForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSaveModels = async () => {
    setIsSavingModels(true)
    try {
      const updated = await updateModelConfig({
        base_url: modelForm.baseUrl.trim() || null,
        default_api_key: modelForm.defaultKey.trim() || null,
        drafting_api_key: modelForm.draftingKey.trim() || null,
        sync_api_key: modelForm.syncKey.trim() || null,
        extraction_api_key: modelForm.extractionKey.trim() || null,
        drafting_model: modelForm.drafting.trim() || null,
        sync_model: modelForm.sync.trim() || null,
        extraction_model: modelForm.extraction.trim() || null,
      })
      const nextConfig = {
        baseUrl: updated.base_url ?? "",
        drafting: updated.drafting_model,
        sync: updated.sync_model,
        extraction: updated.extraction_model,
        hasDefaultKey: Boolean(updated.has_default_key),
        hasDraftingKey: Boolean(updated.has_drafting_key),
        hasSyncKey: Boolean(updated.has_sync_key),
        hasExtractionKey: Boolean(updated.has_extraction_key),
      }
      setModelConfig(nextConfig)
      setModelForm((prev) => ({
        ...prev,
        baseUrl: nextConfig.baseUrl,
        defaultKey: "",
        drafting: nextConfig.drafting,
        draftingKey: "",
        sync: nextConfig.sync,
        syncKey: "",
        extraction: nextConfig.extraction,
        extractionKey: "",
      }))
      setModelDialogOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新模型失败"
      setError(message)
    } finally {
      setIsSavingModels(false)
    }
  }

  const handleSavePrompts = async () => {
    if (!currentProject) {
      return
    }
    setIsSavingPrompts(true)
    try {
      const updated = await updateProjectSettings(currentProject.id, {
        prompt_overrides: {
          drafting: promptForm.drafting.trim() || null,
          sync: promptForm.sync.trim() || null,
          extraction: promptForm.extraction.trim() || null,
          analysis: promptForm.analysis.trim() || null,
          outline_import: promptForm.outline_import.trim() || null,
        },
      })
      setProject(updated)
      setPromptDialogOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 Prompt 失败"
      setError(message)
    } finally {
      setIsSavingPrompts(false)
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* 1. Left Navigation Sidebar */}
      <aside className="flex w-16 flex-col items-center border-r border-border bg-muted/20 py-4 z-20">
        <div className="mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles size={20} />
          </div>
        </div>
        
        <nav className="flex flex-1 flex-col items-center gap-4 w-full px-2">
          <NavButton 
            active={activeTab === "outline"} 
            onClick={() => setActiveTab("outline")} 
            icon={<Layout size={20} />} 
            label="大纲" 
          />
          <NavButton 
            active={activeTab === "writing"} 
            onClick={() => setActiveTab("writing")} 
            icon={<PenTool size={20} />} 
            label="写作" 
          />
          <NavButton 
            active={activeTab === "relations"} 
            onClick={() => setActiveTab("relations")} 
            icon={<Network size={20} />} 
            label="关系" 
          />
          <NavButton 
            active={activeTab === "knowledge"} 
            onClick={() => setActiveTab("knowledge")} 
            icon={<Book size={20} />} 
            label="设定" 
          />
          
          <Separator className="my-2 bg-border/50 w-8" />
          
          <Button asChild variant="ghost" size="icon" title="分析大纲" className="text-muted-foreground hover:text-primary">
            <Link href="/analysis">
              <Sparkles size={20} />
            </Link>
          </Button>

          <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" title="模型设置" className="text-muted-foreground hover:text-primary">
                <Settings size={20} />
              </Button>
            </DialogTrigger>
            {/* ... Model Dialog Content ... */}
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>模型配置</DialogTitle>
                  <DialogDescription>
                    配置项目使用的 LLM 模型及 API Key。
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">API Base URL</label>
                    <Input
                      value={modelForm.baseUrl}
                      onChange={(e) => handleModelFieldChange("baseUrl", e.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                   <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Default API Key</label>
                    <Input
                      type="password"
                      value={modelForm.defaultKey}
                      onChange={(e) => handleModelFieldChange("defaultKey", e.target.value)}
                      placeholder={modelConfig?.hasDefaultKey ? "已配置 (隐藏)" : "sk-..."}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Drafting Model</label>
                        <Input
                          value={modelForm.drafting}
                          onChange={(e) => handleModelFieldChange("drafting", e.target.value)}
                          placeholder="gpt-4o"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Sync Model</label>
                        <Input
                          value={modelForm.sync}
                          onChange={(e) => handleModelFieldChange("sync", e.target.value)}
                          placeholder="gpt-4o-mini"
                        />
                     </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setModelDialogOpen(false)}>取消</Button>
                  <Button onClick={handleSaveModels} disabled={isSavingModels}>保存配置</Button>
                </DialogFooter>
              </DialogContent>
          </Dialog>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setVersionOpen(true)}
            title="版本历史"
            className="text-muted-foreground hover:text-primary"
          >
            <History size={20} />
          </Button>
        </nav>

        <div className="mt-auto flex flex-col gap-4">
           {/* Prompt Button reused logic */}
           <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" disabled={!currentProject} title="Prompt 设置" className="text-muted-foreground hover:text-primary">
                  <div className="font-serif text-lg font-bold">P</div>
                </Button>
              </DialogTrigger>
              {/* ... Prompt Dialog Content ... */}
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                 <DialogHeader>
                  <DialogTitle>Prompt 微调</DialogTitle>
                  <DialogDescription>
                     针对当前项目覆盖默认提示词。留空则使用系统默认设定。
                  </DialogDescription>
                </DialogHeader>
                 <div className="grid gap-6 py-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                        <label className="text-xs font-medium text-foreground">大纲生成 (Drafting)</label>
                        <span className="text-[10px] text-muted-foreground">可用变量: {"{world_view} {style_tags} {user_input}"}</span>
                    </div>
                    <Textarea
                      value={promptForm.drafting}
                      onChange={(e) => handlePromptFieldChange("drafting", e.target.value)}
                      rows={5}
                      className="font-mono text-xs leading-relaxed"
                      placeholder={`示例：
你是一个擅长悬疑风格的小说家。请根据用户提供的核心创意 "{user_input}"，结合世界观 "{world_view}"，创作一份扣人心弦的大纲。
风格要求：{style_tags}。
请包含：
1. 主要冲突
2. 三幕式结构
3. 核心角色动机`}
                    />
                  </div>
                   <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                        <label className="text-xs font-medium text-foreground">同步分析 (Sync)</label>
                        <span className="text-[10px] text-muted-foreground">可用变量: {"{modified_node} {retrieved_context}"}</span>
                    </div>
                    <Textarea
                      value={promptForm.sync}
                      onChange={(e) => handlePromptFieldChange("sync", e.target.value)}
                      rows={5}
                      className="font-mono text-xs leading-relaxed"
                      placeholder={`示例：
你是一个严谨的连载小说编辑。用户刚刚更新了章节 "{modified_node}"。
请分析这段新内容，并更新知识库中相关的角色状态和地点信息。
参考上下文：
{retrieved_context}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                        <label className="text-xs font-medium text-foreground">实体抽取 (Extraction)</label>
                        <span className="text-[10px] text-muted-foreground">可用变量: {"{text} {existing_entities}"}</span>
                    </div>
                    <Textarea
                      value={promptForm.extraction}
                      onChange={(e) => handlePromptFieldChange("extraction", e.target.value)}
                      rows={4}
                      className="font-mono text-xs leading-relaxed"
                      placeholder={`示例：
阅读以下文本：
"{text}"
请从中提取所有新登场的角色、地点和关键道具。
已知实体列表：{existing_entities}（请避免重复提取）`}
                    />
                  </div>
                </div>
                 <DialogFooter>
                   <Button variant="outline" onClick={() => setPromptDialogOpen(false)}>取消</Button>
                   <Button onClick={handleSavePrompts} disabled={isSavingPrompts}>保存 Prompt</Button>
                 </DialogFooter>
              </DialogContent>
           </Dialog>
        </div>
      </aside>

      {/* 2. Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Minimal Header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
           <div className="flex items-center gap-2 flex-1 min-w-0">
              <Input
                value={title}
                onChange={(event) => handleTitleChange(event.target.value)}
                className="h-8 max-w-[300px] border-transparent bg-transparent px-2 text-sm font-semibold shadow-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-0 truncate"
              />
              <SyncIndicator />
              {saveStatus !== "idle" && (
                <span className="text-[10px] text-muted-foreground animate-fade-in">
                  {saveStatus === "saving" ? "保存中..." : "已保存"}
                </span>
              )}
           </div>
           
           <div className="flex items-center gap-2">
              <CreateDialog />
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setProjectSidebarOpen(!projectSidebarOpen)}
                className={cn("text-muted-foreground transition-transform", projectSidebarOpen ? "bg-muted" : "")}
              >
                 {projectSidebarOpen ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
              </Button>
           </div>
        </header>

        {/* Workspace Content */}
        <main className="flex-1 overflow-hidden relative">
           {activeTab === "outline" ? (
              <StoryVisualizer />
            ) : activeTab === "writing" ? (
              <WritingWorkspace />
            ) : activeTab === "relations" ? (
              <CharacterGraph />
            ) : (
              <KnowledgeWorkspace />
            )}
        </main>
      </div>

      {/* 3. Right Project Sidebar */}
      <aside 
        className={cn(
          "flex flex-col border-l border-border bg-muted/10 transition-all duration-300 ease-in-out z-10",
          projectSidebarOpen ? "w-64" : "w-0 overflow-hidden border-none"
        )}
      >
         <div className="flex h-12 items-center justify-between border-b border-border px-4 bg-muted/20">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
               <FolderOpen size={14} />
               项目列表
            </span>
         </div>
         <div className="flex-1 overflow-y-auto p-2">
            <ProjectList />
         </div>
      </aside>

      {/* Overlays */}
      <NodeEditor />
      <ChatSidebar />
      <ConflictAlert />
      <VersionHistory open={versionOpen} onClose={() => setVersionOpen(false)} />

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-[380px] rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="relative h-10 w-10 shrink-0">
                 <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                 <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
              </div>
              <div>
                <h3 className="font-medium">正在生成内容</h3>
                <p className="text-xs text-muted-foreground">AI 正在根据您的设定构建大纲...</p>
              </div>
            </div>
            {/* Progress Bar */}
            <div className="space-y-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div 
                   className="h-full bg-primary transition-all duration-500 ease-out" 
                   style={{ width: `${((outlineStepIndex + 1) / OUTLINE_STEPS.length) * 100}%` }}
                />
              </div>
              <div className="space-y-2">
                {OUTLINE_STEPS.map((step, index) => {
                  const isDone = index < outlineStepIndex
                  const isActive = index === outlineStepIndex
                  return (
                    <div key={step.key} className="flex items-center gap-3 text-xs">
                      <div className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                        isDone ? "border-primary bg-primary text-primary-foreground" :
                        isActive ? "border-primary text-primary" : "border-muted-foreground/30 text-muted-foreground/30"
                      )}>
                        {isDone ? <CheckCircle2 className="h-3 w-3" /> : <div className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-primary animate-pulse" : "bg-muted-foreground/30")} />}
                      </div>
                      <div className={cn("flex-1", isActive ? "text-foreground font-medium" : "text-muted-foreground")}>
                        {step.title}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg animate-in slide-in-from-top-2">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setError(null)}
            className="h-auto p-0 text-destructive hover:text-destructive/80 hover:bg-transparent"
          >
            关闭
          </Button>
        </div>
      )}
    </div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col items-center justify-center gap-1 rounded-lg p-2 transition-all duration-200",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm"
      )}
    >
      <div className={cn("transition-transform duration-200 group-hover:scale-110", active && "scale-110")}>{icon}</div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}
