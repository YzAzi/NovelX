"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import {
  Sparkles,
  Settings2,
  PenLine,
  Save,
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
import {
  buildApiUrl,
  buildAuthHeaders,
  createChapter,
  deleteChapter,
  formatUserErrorMessage,
  getStyleKnowledgeBase,
  handleUnauthorized,
  previewStyleReferences,
  updateChapter,
  updateProjectSettings,
  updateStyleKnowledgeTitle,
  deleteStyleKnowledgeDocument,
  uploadStyleKnowledgeFile,
} from "@/src/lib/api"
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
import type {
  StyleDocument,
  StyleKnowledgeUploadResponse,
  StyleRetrievalPreviewResponse,
  WriterConfig,
} from "@/src/types/models"
import { ScrollArea } from "@/components/ui/scroll-area"

export function WritingWorkspace() {
  const { currentProject, setError, setProject } = useProjectStore()
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
    polish_instruction: "",
    expand_instruction: "",
    style_strength: "medium",
    style_preset: "default",
  })
  const [styleDocs, setStyleDocs] = useState<StyleDocument[]>([])
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([])
  const [styleError, setStyleError] = useState<string | null>(null)
  const [styleUploadNotice, setStyleUploadNotice] = useState<string | null>(null)
  const [isStyleLoading, setIsStyleLoading] = useState(false)
  const [isStyleUploading, setIsStyleUploading] = useState(false)
  const [styleUploadStage, setStyleUploadStage] = useState("等待上传")
  const [previewDoc, setPreviewDoc] = useState<StyleDocument | null>(null)
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [isPolishing, setIsPolishing] = useState(false)
  const [stylePreview, setStylePreview] = useState<StyleRetrievalPreviewResponse | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const styleFileRef = useRef<HTMLInputElement>(null)
  const skipCommitRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCreatingChapter, setIsCreatingChapter] = useState(false)
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  const STYLE_PRESETS = [
    { key: "default", label: "通用叙事" },
    { key: "warm", label: "温柔细腻" },
    { key: "noir", label: "冷峻硬派" },
    { key: "poetic", label: "诗性抒情" },
    { key: "custom", label: "自定义" },
  ] as const

  const PRESET_INSTRUCTIONS: Record<string, { polish: string; expand: string }> = {
    default: {
      polish: "请润色这段文本，使其描写更生动，沉浸感更强。保持原意不变。",
      expand: "请在保持原意的基础上扩写这段文本，使情节更丰富、描写更细腻。",
    },
    warm: {
      polish: "请用温柔细腻的笔触润色这段文本，强化人物情绪与氛围。",
      expand: "请以温柔细腻的笔触扩写这段文本，补充感受与细节描写。",
    },
    noir: {
      polish: "请用冷峻硬派的风格润色这段文本，节奏干净利落。",
      expand: "请以冷峻硬派的风格扩写这段文本，突出张力与冲突。",
    },
    poetic: {
      polish: "请用诗性抒情的风格润色这段文本，注重意象与节奏。",
      expand: "请以诗性抒情的风格扩写这段文本，丰富意象与内心独白。",
    },
  }

  // Sort nodes
  const sortedChapters = useMemo(() => {
    if (!currentProject) return []
    return [...currentProject.chapters].sort((a, b) => a.order - b.order)
  }, [currentProject])

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
      setConfigForm({
        prompt: currentProject.writer_config.prompt ?? "",
        model: currentProject.writer_config.model ?? "",
        api_key: currentProject.writer_config.api_key ?? "",
        base_url: currentProject.writer_config.base_url ?? "",
        polish_instruction: currentProject.writer_config.polish_instruction ?? "",
        expand_instruction: currentProject.writer_config.expand_instruction ?? "",
        style_strength: currentProject.writer_config.style_strength ?? "medium",
        style_preset: currentProject.writer_config.style_preset ?? "default",
      })
    }
  }, [currentProject])

  useEffect(() => {
    if (!currentProject) {
      setStyleDocs([])
      setSelectedStyleIds([])
      setStylePreview(null)
      return
    }
    const controller = new AbortController()
    setIsStyleLoading(true)
    setStyleError(null)
    getStyleKnowledgeBase(currentProject.id, { signal: controller.signal })
      .then((base) => {
        setStyleDocs(base.documents ?? [])
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "加载文笔知识库失败"
        setStyleError(message)
      })
      .finally(() => setIsStyleLoading(false))
    return () => controller.abort()
  }, [currentProject])

  useEffect(() => {
    setStylePreview(null)
  }, [activeChapterId, selectedStyleIds])

  useEffect(() => {
    if (!isStyleUploading) {
      setStyleUploadStage("等待上传")
      return
    }
    const stages = [
      "读取文件",
      "分批清洗文本",
      "合并清洗结果",
      "构建文笔知识库",
    ]
    let index = 0
    setStyleUploadStage(stages[index])
    const timer = window.setInterval(() => {
      index = Math.min(index + 1, stages.length - 1)
      setStyleUploadStage(stages[index])
    }, 1800)
    return () => window.clearInterval(timer)
  }, [isStyleUploading])

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

  const buildInstruction = (mode: "polish" | "expand") => {
    const strengthLabel =
      configForm.style_strength === "high"
        ? "强烈"
        : configForm.style_strength === "low"
          ? "轻度"
          : "中等"

    const presetLabel =
      STYLE_PRESETS.find((item) => item.key === configForm.style_preset)?.label ??
      "通用叙事"

    const base =
      mode === "polish"
        ? configForm.polish_instruction?.trim()
        : configForm.expand_instruction?.trim()

    const fallback =
      mode === "polish"
        ? PRESET_INSTRUCTIONS[configForm.style_preset || "default"]?.polish
        : PRESET_INSTRUCTIONS[configForm.style_preset || "default"]?.expand

    const instruction = base || fallback || PRESET_INSTRUCTIONS.default[mode]
    const presetText =
      configForm.style_preset && configForm.style_preset !== "custom"
        ? `参考风格：${presetLabel}`
        : ""
    const strengthText = `风格强度：${strengthLabel}`
    return [instruction, presetText, strengthText].filter(Boolean).join("\n")
  }

  const handleAssist = async (
    mode: "polish" | "expand",
    scope: "selection" | "full",
  ) => {
    if (!currentProject || !activeChapterId) return
    
    let textToPolish = content
    const instruction = buildInstruction(mode)
    
    if (scope === "selection" && textareaRef.current) {
      const start = textareaRef.current.selectionStart
      const end = textareaRef.current.selectionEnd
      if (start !== end) {
        textToPolish = content.substring(start, end)
        setSelectionRange({ start, end })
      } else {
        alert("请先选择要处理的文本")
        return
      }
    }

    setIsPolishing(true)
    try {
      if (selectedStyleIds.length > 0) {
        const preview = await previewStyleReferences(currentProject.id, {
          instruction,
          text: textToPolish,
          style_document_ids: selectedStyleIds,
          top_k: 5,
        })
        setStylePreview(preview)
      }

      const response = await fetch(buildApiUrl("/api/writing_assistant"), {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          project_id: currentProject.id,
          text: textToPolish,
          instruction,
          stream: true,
          style_document_ids: selectedStyleIds,
        }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          handleUnauthorized()
        }
        const detail = await response.text()
        throw new Error(detail || "Failed to call AI")
      }
      
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
      
      if (scope === "full") {
         setContent(polishedText)
      } else if (selectionRange) {
         const before = content.substring(0, selectionRange.start)
         const after = content.substring(selectionRange.end)
         setContent(before + polishedText + after)
      }

    } catch (error) {
      console.error("Polish failed", error)
      setError(formatUserErrorMessage(error, "写作助手处理失败，请稍后重试。"))
    } finally {
      setIsPolishing(false)
      setSelectionRange(null)
    }
  }

  const handlePreviewReferences = async (mode: "polish" | "expand") => {
    if (!currentProject) return
    if (selectedStyleIds.length === 0) {
      setStyleError("请先勾选至少一份文笔素材")
      return
    }
    const instruction = buildInstruction(mode)
    let previewText = content
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart
      const end = textareaRef.current.selectionEnd
      if (start !== end) {
        previewText = content.substring(start, end)
      }
    }
    setIsPreviewLoading(true)
    setStyleError(null)
    try {
      const preview = await previewStyleReferences(currentProject.id, {
        instruction,
        text: previewText,
        style_document_ids: selectedStyleIds,
        top_k: 5,
      })
      setStylePreview(preview)
    } catch (error) {
      const message = error instanceof Error ? error.message : "预览参考失败"
      setStyleError(message)
    } finally {
      setIsPreviewLoading(false)
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

  const handlePresetChange = (value: string) => {
    if (!value) {
      return
    }
    if (value === "custom") {
      setConfigForm((prev) => ({ ...prev, style_preset: value }))
      return
    }
    const preset = PRESET_INSTRUCTIONS[value]
    setConfigForm((prev) => ({
      ...prev,
      style_preset: value,
      polish_instruction: preset?.polish ?? prev.polish_instruction,
      expand_instruction: preset?.expand ?? prev.expand_instruction,
    }))
  }

  const handleStyleToggle = (docId: string) => {
    setSelectedStyleIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    )
  }

  const formatCuratedStats = (doc: StyleDocument) => {
    const parts: string[] = []
    if (doc.curated_segments && doc.curated_segments > 0) {
      parts.push(`${doc.curated_segments} 段`)
    }
    if (
      typeof doc.source_characters === "number" &&
      doc.source_characters > 0 &&
      typeof doc.curated_characters === "number" &&
      doc.curated_characters > 0
    ) {
      parts.push(`${doc.source_characters} -> ${doc.curated_characters} 字`)
    } else {
      parts.push(`${doc.content?.length ?? 0} 字`)
    }
    return parts.join(" | ")
  }

  const handleStyleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!currentProject) {
      return
    }
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
      setStyleError("仅支持 .txt / .md 文件")
      return
    }
    setIsStyleUploading(true)
    setStyleError(null)
    setStyleUploadNotice(null)
    try {
      const result: StyleKnowledgeUploadResponse = await uploadStyleKnowledgeFile(
        currentProject.id,
        file,
      )
      const doc = result.document
      setStyleDocs((prev) => [doc, ...prev])
      setSelectedStyleIds((prev) =>
        prev.includes(doc.id) ? prev : [doc.id, ...prev]
      )
      const summary = `已完成 ${result.successful_batches}/${result.total_batches} 个批次，保留 ${doc.curated_segments ?? 0} 个片段。`
      if (result.warnings.length > 0 || result.failed_batches > 0) {
        setStyleUploadNotice(
          `${summary} 存在部分批次失败，但系统已用成功批次完成构建。`
        )
      } else {
        setStyleUploadNotice(summary)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败"
      setStyleError(message)
    } finally {
      setIsStyleUploading(false)
      if (styleFileRef.current) {
        styleFileRef.current.value = ""
      }
    }
  }

  const handleOpenPreview = (doc: StyleDocument) => {
    setPreviewDoc(doc)
  }

  const handleStartRename = (doc: StyleDocument) => {
    setRenamingDocId(doc.id)
    setRenameValue(doc.title || "")
  }

  const handleCancelRename = () => {
    setRenamingDocId(null)
    setRenameValue("")
  }

  const handleConfirmRename = async (doc: StyleDocument) => {
    if (!currentProject) {
      return
    }
    const nextTitle = renameValue.trim()
    if (!nextTitle) {
      setStyleError("标题不能为空")
      return
    }
    try {
      const updated = await updateStyleKnowledgeTitle(currentProject.id, doc.id, {
        title: nextTitle,
      })
      setStyleDocs((prev) =>
        prev.map((item) => (item.id === doc.id ? updated : item))
      )
      handleCancelRename()
    } catch (error) {
      const message = error instanceof Error ? error.message : "重命名失败"
      setStyleError(message)
    }
  }

  const handleDeleteStyleDoc = async (doc: StyleDocument) => {
    if (!currentProject) {
      return
    }
    try {
      await deleteStyleKnowledgeDocument(currentProject.id, doc.id)
      setStyleDocs((prev) => prev.filter((item) => item.id !== doc.id))
      setSelectedStyleIds((prev) => prev.filter((id) => id !== doc.id))
      if (previewDoc?.id === doc.id) {
        setPreviewDoc(null)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败"
      setStyleError(message)
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
                onClick={() => handleAssist("polish", "selection")}
                disabled={isPolishing}
                className="h-8 text-xs bg-background/50 hover:bg-background"
              >
                <PenLine className="h-3 w-3 mr-1.5" /> 选中润色
              </Button>
              <Button 
                size="sm" 
                onClick={() => handleAssist("polish", "full")}
                disabled={isPolishing}
                className="h-8 text-xs"
              >
                <Sparkles className="h-3 w-3 mr-1.5" /> 全文润色
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleAssist("expand", "selection")}
                disabled={isPolishing}
                className="h-8 text-xs bg-background/50 hover:bg-background"
              >
                <PenLine className="h-3 w-3 mr-1.5" /> 选中扩写
              </Button>
              <Button 
                size="sm" 
                onClick={() => handleAssist("expand", "full")}
                disabled={isPolishing}
                className="h-8 text-xs"
              >
                <Sparkles className="h-3 w-3 mr-1.5" /> 全文扩写
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handlePreviewReferences("polish")}
                disabled={isPreviewLoading || selectedStyleIds.length === 0}
                className="h-8 text-xs"
              >
                预览润色参考
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handlePreviewReferences("expand")}
                disabled={isPreviewLoading || selectedStyleIds.length === 0}
                className="h-8 text-xs"
              >
                预览扩写参考
              </Button>
            </div>
            {stylePreview ? (
              <div className="rounded-md border border-border/60 bg-background/70 p-3 space-y-3">
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-foreground">
                    本次优先参考
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {stylePreview.preferred_focuses.length > 0
                      ? stylePreview.preferred_focuses.join(" / ")
                      : "通用型"}
                  </div>
                </div>
                <div className="space-y-2">
                  {stylePreview.references.length > 0 ? (
                    stylePreview.references.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-md border border-border/50 bg-muted/20 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 text-[11px] font-medium text-foreground line-clamp-1">
                            {item.title}
                          </div>
                          <div className="shrink-0 text-[10px] text-muted-foreground">
                            {item.score.toFixed(2)}
                          </div>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {[item.focus, ...(item.techniques || [])]
                            .filter(Boolean)
                            .join(" | ") || "通用型"}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-foreground/85 line-clamp-4">
                          {item.content}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      当前没有召回到合适的参考片段。
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">仿写文笔知识库</h3>
                <p className="text-[11px] text-muted-foreground mt-1">
                  导入小说后会先分批交给 AI 清洗，再用清洗结果构建更适合风格学习的 RAG。
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={isStyleUploading}
                onClick={() => styleFileRef.current?.click()}
              >
                {isStyleUploading ? "处理中..." : "导入小说"}
              </Button>
              <input
                ref={styleFileRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={handleStyleUpload}
              />
            </div>

            {styleError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {styleError}
              </div>
            ) : null}

            {styleUploadNotice ? (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
                {styleUploadNotice}
              </div>
            ) : null}

            {isStyleUploading ? (
              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                正在处理：{styleUploadStage}
              </div>
            ) : null}

            {isStyleLoading ? (
              <div className="text-xs text-muted-foreground">加载中...</div>
            ) : styleDocs.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                暂无文笔素材，先导入一份 TXT/MD 小说文本。
              </div>
            ) : (
              <div className="space-y-2">
                {styleDocs.map((doc) => {
                  const checked = selectedStyleIds.includes(doc.id)
                  const isRenaming = renamingDocId === doc.id
                  return (
                    <div
                      key={doc.id}
                      className={cn(
                        "rounded-md border px-2.5 py-2 text-xs",
                        checked ? "border-primary/40 bg-primary/5" : "border-border/60"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() => handleStyleToggle(doc.id)}
                        />
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <Input
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <div className="font-medium text-foreground line-clamp-1">
                              {doc.title || "未命名风格"}
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground">
                            {formatCuratedStats(doc)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {isRenaming ? (
                          <>
                            <Button size="sm" className="h-7 text-[10px]" onClick={() => handleConfirmRename(doc)}>
                              保存
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={handleCancelRename}>
                              取消
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleOpenPreview(doc)}>
                              预览
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleStartRename(doc)}>
                              重命名
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive hover:text-destructive" onClick={() => handleDeleteStyleDoc(doc)}>
                              删除
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
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
              <label className="text-xs font-medium text-muted-foreground">风格预设</label>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                value={configForm.style_preset || "default"}
                onChange={(event) => handlePresetChange(event.target.value)}
              >
                {STYLE_PRESETS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">风格强度</label>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                value={configForm.style_strength || "medium"}
                onChange={(event) =>
                  setConfigForm((prev) => ({
                    ...prev,
                    style_strength: event.target.value,
                  }))
                }
              >
                <option value="low">轻度</option>
                <option value="medium">中等</option>
                <option value="high">强烈</option>
              </select>
            </div>
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
              <label className="text-xs font-medium text-muted-foreground">润色提示词</label>
              <Textarea 
                value={configForm.polish_instruction || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, polish_instruction: e.target.value }))}
                placeholder="例如：请润色这段文本，使其描写更生动..."
                className="h-20 text-xs"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">扩写提示词</label>
              <Textarea 
                value={configForm.expand_instruction || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, expand_instruction: e.target.value }))}
                placeholder="例如：请在保持原意的基础上扩写..."
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
      <Dialog
        open={Boolean(previewDoc)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewDoc(null)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>文笔素材预览</DialogTitle>
            <DialogDescription>
              {previewDoc ? `${previewDoc.title || "未命名风格"} · ${formatCuratedStats(previewDoc)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed font-serif">
              {(previewDoc?.content ?? "").slice(0, 4000)}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDoc(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
