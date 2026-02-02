"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Sparkles,
  Settings2,
  PenLine,
  Save,
  ChevronRight,
  ChevronLeft,
  Plus,
  PencilLine,
  Trash2,
  FileText,
  PanelLeftClose,
  PanelRightClose,
  PanelLeftOpen,
  PanelRightOpen,
} from "lucide-react"

import { useProjectStore } from "@/src/stores/project-store"
import { createChapter, deleteChapter, updateChapter, updateProjectSettings } from "@/src/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { WriterConfig } from "@/src/types/models"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

export function WritingWorkspace() {
  const { currentProject, setProject } = useProjectStore()
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [chapterTitle, setChapterTitle] = useState("")
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true)
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [configForm, setConfigForm] = useState<WriterConfig>({
    prompt: "",
    model: "",
    api_key: "",
    base_url: "",
  })
  const [isPolishing, setIsPolishing] = useState(false)
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const skipCommitRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCreatingChapter, setIsCreatingChapter] = useState(false)
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  // Sort nodes
  const sortedChapters = useMemo(() => {
    if (!currentProject) return []
    return [...currentProject.chapters].sort((a, b) => a.order - b.order)
  }, [currentProject?.chapters])

  // Set initial active chapter
  useEffect(() => {
    if (!activeChapterId && sortedChapters.length > 0) {
      setActiveChapterId(sortedChapters[0].id)
    }
  }, [sortedChapters, activeChapterId])

  // Sync content when active chapter changes
  useEffect(() => {
    if (!activeChapterId || !currentProject) return
    const chapter = currentProject.chapters.find((item) => item.id === activeChapterId)
    if (chapter) {
      setContent(chapter.content || "")
      setChapterTitle(chapter.title || "")
    }
  }, [activeChapterId, currentProject])

  // Load config
  useEffect(() => {
    if (currentProject?.writer_config) {
      setConfigForm(currentProject.writer_config)
    }
  }, [currentProject?.writer_config])

  const handleSaveContent = async () => {
    if (!currentProject || !activeChapterId) return
    const chapter = currentProject.chapters.find((item) => item.id === activeChapterId)
    if (!chapter) return

    setIsSaving(true)
    try {
      const response = await updateChapter(currentProject.id, activeChapterId, {
        title: chapterTitle.trim() || "未命名章节",
        content,
      })
      setProject(response)
    } catch (error) {
      console.error("Failed to save content", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTitleBlur = async () => {
    if (!currentProject || !activeChapterId) return
    const chapter = currentProject.chapters.find((item) => item.id === activeChapterId)
    if (!chapter) return
    const nextTitle = chapterTitle.trim() || "未命名章节"
    if (nextTitle === chapter.title) return
    try {
      const response = await updateChapter(currentProject.id, activeChapterId, {
        title: nextTitle,
      })
      setProject(response)
    } catch (error) {
      console.error("Failed to update chapter title", error)
    }
  }

  const handleSaveConfig = async () => {
    if (!currentProject) return
    try {
      const updated = await updateProjectSettings(currentProject.id, {
        writer_config: configForm,
      })
      setProject(updated)
      setIsConfigOpen(false)
    } catch (error) {
      console.error("Failed to save config", error)
    }
  }

  const handlePolish = async (type: "selection" | "full") => {
    if (!currentProject || !activeChapterId) return
    
    let textToPolish = content
    let instruction = "请润色这段文本，使其描写更生动，沉浸感更强。保持原意不变。"
    
    if (type === "selection" && textareaRef.current) {
      const start = textareaRef.current.selectionStart
      const end = textareaRef.current.selectionEnd
      if (start !== end) {
        textToPolish = content.substring(start, end)
        setSelectionRange({ start, end })
      } else {
        alert("请先选择要润色的文本")
        return
      }
    }

    setIsPolishing(true)
    try {
      const response = await fetch("/api/writing_assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: currentProject.id,
          text: textToPolish,
          instruction,
          stream: true,
        }),
      })

      if (!response.ok) throw new Error("Failed to call AI")
      
      const reader = response.body?.getReader()
      if (!reader) return
      
      const decoder = new TextDecoder()
      let polishedText = ""
      
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") continue
            polishedText += data
          }
        }
      }
      
      if (type === "full") {
         setContent(polishedText)
      } else if (selectionRange) {
         const before = content.substring(0, selectionRange.start)
         const after = content.substring(selectionRange.end)
         setContent(before + polishedText + after)
      }

    } catch (error) {
      console.error("Polish failed", error)
    } finally {
      setIsPolishing(false)
      setSelectionRange(null)
    }
  }

  const handleCreateChapter = async () => {
    if (!currentProject) return
    setIsCreatingChapter(true)
    try {
      const response = await createChapter(currentProject.id, {})
      setProject(response)
      const existingIds = new Set(currentProject.chapters.map((item) => item.id))
      const newChapter = response.chapters.find((item) => !existingIds.has(item.id))
      if (newChapter) {
        setActiveChapterId(newChapter.id)
      }
    } catch (error) {
      console.error("Failed to create chapter", error)
    } finally {
      setIsCreatingChapter(false)
    }
  }

  const handleStartEditTitle = (chapterId: string, title: string) => {
    setEditingChapterId(chapterId)
    setEditingTitle(title)
  }

  const handleCommitTitle = async () => {
    if (!currentProject || !editingChapterId) return
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }
    const nextTitle = editingTitle.trim() || "未命名章节"
    try {
      const response = await updateChapter(currentProject.id, editingChapterId, {
        title: nextTitle,
      })
      setProject(response)
    } catch (error) {
      console.error("Failed to rename chapter", error)
    } finally {
      setEditingChapterId(null)
    }
  }

  const handleDeleteChapter = async (chapterId: string) => {
    if (!currentProject) return
    const confirmed = window.confirm("确定要删除该章节吗？此操作无法撤销。")
    if (!confirmed) return
    try {
      const response = await deleteChapter(currentProject.id, chapterId)
      setProject(response)
      if (activeChapterId === chapterId) {
        const next = response.chapters.sort((a, b) => a.order - b.order)[0]
        setActiveChapterId(next?.id ?? null)
        setChapterTitle(next?.title ?? "")
        setContent(next?.content ?? "")
      }
    } catch (error) {
      console.error("Failed to delete chapter", error)
    }
  }

  if (!currentProject) return null

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <div 
        className={cn(
          "flex flex-col border-r border-border bg-muted/10 transition-all duration-300 ease-in-out",
          isSidebarOpen ? "w-64 opacity-100" : "w-0 opacity-0 overflow-hidden border-none"
        )}
      >
        <div className="flex items-center justify-between p-3 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
             <FileText className="h-4 w-4" />
             <span>章节列表</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCreateChapter}
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              disabled={isCreatingChapter}
              title="新建章节"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(false)}
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="收起侧边栏"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {sortedChapters.map((chapter) => {
              const isActive = activeChapterId === chapter.id
              const isEditing = editingChapterId === chapter.id
              return (
                <div
                  key={chapter.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive 
                      ? "bg-primary/10 text-primary font-medium" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <button
                    onClick={() => setActiveChapterId(chapter.id)}
                    className="flex-1 truncate text-left outline-none"
                  >
                    {isEditing ? (
                      <Input
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={handleCommitTitle}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            handleCommitTitle()
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            skipCommitRef.current = true
                            setEditingChapterId(null)
                          }
                        }}
                        autoFocus
                        className="h-6 px-1 text-sm bg-background border-primary"
                      />
                    ) : (
                      <span className="truncate">{chapter.title}</span>
                    )}
                  </button>
                  {!isEditing && (
                    <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:text-foreground"
                          onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditTitle(chapter.id, chapter.title);
                          }}
                        >
                          <PencilLine className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:text-destructive"
                          onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteChapter(chapter.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Main Editor */}
      <div className="flex-1 flex flex-col relative h-full bg-muted/30 min-w-0">
        
        {/* Editor Toolbar / Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-background/50 backdrop-blur-sm z-10 sticky top-0">
            <div className="flex items-center gap-2">
                {!isSidebarOpen && (
                    <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)} className="text-muted-foreground hover:bg-muted">
                        <PanelLeftOpen className="h-4 w-4" />
                    </Button>
                )}
            </div>
            <div className="flex items-center gap-2">
                 <div className="text-xs text-muted-foreground mr-2 font-mono">
                    {content.length} 字
                 </div>
                 <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleSaveContent}
                    disabled={isSaving}
                    className={cn("text-xs h-8", isSaving ? "text-primary animate-pulse" : "text-muted-foreground hover:text-foreground")}
                 >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {isSaving ? "保存中" : "保存"}
                 </Button>
                 {!isAiPanelOpen && (
                    <Button variant="ghost" size="icon" onClick={() => setIsAiPanelOpen(true)} className="text-muted-foreground hover:bg-muted">
                        <PanelRightOpen className="h-4 w-4" />
                    </Button>
                 )}
            </div>
        </div>

        {/* Scrollable Paper Container */}
        <ScrollArea className="flex-1 w-full">
           <div className="flex flex-col items-center py-8 px-4 min-h-full">
               <div className="w-full max-w-[850px] min-h-[850px] bg-background shadow-paper rounded-sm border border-border/30 p-12 sm:p-16 transition-shadow duration-500 hover:shadow-lg">
                   <input
                     className="w-full bg-transparent text-4xl font-bold mb-8 focus:outline-none text-foreground placeholder:text-muted-foreground/20 font-serif leading-tight tracking-tight"
                     value={chapterTitle}
                     onChange={(event) => setChapterTitle(event.target.value)}
                     onBlur={handleTitleBlur}
                     placeholder="输入章节标题..."
                   />
                   <textarea
                     ref={textareaRef}
                     className="w-full h-full min-h-[600px] resize-none bg-transparent text-lg leading-loose focus:outline-none text-foreground/90 placeholder:text-muted-foreground/20 font-serif selection:bg-primary/15"
                     placeholder="在此开始您的创作..."
                     value={content}
                     onChange={(e) => setContent(e.target.value)}
                     spellCheck={false}
                     style={{ lineHeight: "1.8" }}
                   />
               </div>
               <div className="h-12 shrink-0" /> {/* Bottom spacer */}
           </div>
        </ScrollArea>
      </div>

      {/* AI Panel */}
      <div 
        className={cn(
          "flex flex-col border-l border-border bg-muted/10 transition-all duration-300 ease-in-out",
          isAiPanelOpen ? "w-80 opacity-100" : "w-0 opacity-0 overflow-hidden border-none"
        )}
      >
        <div className="flex items-center justify-between p-3 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>AI 助手</span>
          </div>
          <div className="flex items-center gap-1">
             <Button variant="ghost" size="icon" onClick={() => setIsConfigOpen(true)} className="h-6 w-6 text-muted-foreground hover:text-foreground">
                <Settings2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setIsAiPanelOpen(false)} className="h-6 w-6 text-muted-foreground hover:text-foreground">
                <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <ScrollArea className="flex-1 p-4">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm text-primary">智能润色</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI 可以帮助您优化选中的文本片段，或对全篇内容进行风格润色。请确保已配置 API Key。
            </p>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handlePolish("selection")}
                disabled={isPolishing}
                className="h-8 text-xs bg-background/50 hover:bg-background"
              >
                <PenLine className="h-3 w-3 mr-1.5" /> 选中润色
              </Button>
              <Button 
                size="sm" 
                onClick={() => handlePolish("full")}
                disabled={isPolishing}
                className="h-8 text-xs"
              >
                <Sparkles className="h-3 w-3 mr-1.5" /> 全文润色
              </Button>
            </div>
          </div>
          
          {isPolishing && (
            <div className="mt-4 flex flex-col items-center justify-center py-8 text-muted-foreground animate-pulse space-y-2">
               <Sparkles className="h-5 w-5 animate-spin" />
               <span className="text-xs">AI 正在思考中...</span>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Config Dialog */}
      <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>写作助手配置</DialogTitle>
            <DialogDescription>
                自定义 AI 润色的行为和使用的模型。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">系统指令 (System Prompt)</label>
              <Textarea 
                value={configForm.prompt || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, prompt: e.target.value }))}
                placeholder="例如：你是一个资深小说编辑，请优化这段文字的描写..."
                className="h-20 text-xs"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">模型名称 (Model)</label>
              <Input 
                value={configForm.model || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, model: e.target.value }))}
                placeholder="gpt-4o"
                className="h-8"
              />
            </div>
             <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">API Base URL</label>
              <Input 
                value={configForm.base_url || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, base_url: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className="h-8"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">API Key</label>
              <Input 
                type="password"
                value={configForm.api_key || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, api_key: e.target.value }))}
                placeholder="sk-..."
                className="h-8"
              />
            </div>
           
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfigOpen(false)}>取消</Button>
            <Button onClick={handleSaveConfig}>保存设置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}