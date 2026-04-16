"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
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
  Check,
  Search,
} from "lucide-react"

import { useProjectStore } from "@/src/stores/project-store"
import {
  buildApiUrl,
  buildAuthHeaders,
  createStyleLibrary,
  createChapter,
  deleteStyleLibrary,
  deleteStyleLibraryDocument,
  deleteChapter,
  formatUserErrorMessage,
  getStyleKnowledgeBase,
  handleUnauthorized,
  importCleanedStyleLibraryFile,
  listStyleLibraries,
  previewStyleReferences,
  updateChapter,
  updateProjectSettings,
  updateStyleLibraryDocumentTitle,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type {
  StyleDocument,
  StyleLibraryBundle,
  StyleKnowledgeImportResponse,
  StyleKnowledgeUploadResponse,
  StyleRetrievalPreviewResponse,
  WriterConfig,
} from "@/src/types/models"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"

const STYLE_PRESETS = [
  { key: "default", label: "通用叙事", summary: "平衡句式、叙事效率和阅读顺滑度。" },
  { key: "warm", label: "温柔细腻", summary: "强调人物感受、停顿和场景温度。" },
  { key: "noir", label: "冷峻硬派", summary: "压缩形容词，让动作和冲突更利落。" },
  { key: "poetic", label: "诗性抒情", summary: "保留呼吸感和意象，但不脱离现场。" },
  { key: "custom", label: "自定义", summary: "完全由你定义输出语感与改写边界。" },
] as const

const PRESET_INSTRUCTIONS: Record<string, { polish: string; expand: string }> = {
  default: {
    polish:
      "请做克制润色：保持剧情事实、人称、时态和语气不变。优先删掉套话，理顺句子，补足必要动作与感官细节，不要刻意拔高文风，不要写成明显的 AI 文学腔。",
    expand:
      "请做自然扩写：只沿当前段落补足必要的动作、环境、心理或对话反应，不新增重大剧情，不提前解释伏笔，不要为了显得有文采而堆砌修辞。",
  },
  warm: {
    polish:
      "请用温柔细腻但克制的方式润色这段文本。重点放在人物感受、动作停顿和场景温度，不要堆叠抒情句，不要写成空泛鸡汤。",
    expand:
      "请用温柔细腻但不过分抒情的方式扩写这段文本，补足人物反应与场景细节，保持自然，不要把情绪说满。",
  },
  noir: {
    polish:
      "请用冷峻硬派的方式润色这段文本。句子要干净，动作要利落，少空话，少形容词，避免煽情和解释。",
    expand:
      "请用冷峻硬派的方式扩写这段文本，补足动作、压迫感和冲突张力，但不要无端变得中二或口号化。",
  },
  poetic: {
    polish:
      "请用节制的诗性语言润色这段文本，允许有意象和节奏变化，但必须服务当前场景，不要连续堆砌比喻，不要写成悬浮散文。",
    expand:
      "请用节制的诗性语言扩写这段文本，补足意象、呼吸感和内心波动，但不要脱离情节现场，不要把句子全部拉长。",
  },
}

const UPLOAD_STAGES = [
  "读取文件",
  "分批清洗文本",
  "合并清洗结果",
  "构建文笔知识库",
] as const

export function WritingWorkspace() {
  const { currentProject, setError, setProject } = useProjectStore()
  const shouldReduceMotion = useReducedMotion()
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [chapterTitle, setChapterTitle] = useState("")
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true)
  const [isZenMode, setIsZenMode] = useState(false)
  const [mobileChapterSheetOpen, setMobileChapterSheetOpen] = useState(false)
  const [mobileAiSheetOpen, setMobileAiSheetOpen] = useState(false)
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
  const [styleLibraries, setStyleLibraries] = useState<StyleLibraryBundle[]>([])
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([])
  const [styleError, setStyleError] = useState<string | null>(null)
  const [styleUploadNotice, setStyleUploadNotice] = useState<string | null>(null)
  const [isStyleLoading, setIsStyleLoading] = useState(false)
  const [isStyleUploading, setIsStyleUploading] = useState(false)
  const [isLibraryUploading, setIsLibraryUploading] = useState(false)
  const [styleUploadStage, setStyleUploadStage] = useState("等待上传")
  const [previewDoc, setPreviewDoc] = useState<StyleDocument | null>(null)
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("")
  const [isCreateLibraryOpen, setIsCreateLibraryOpen] = useState(false)
  const [newLibraryName, setNewLibraryName] = useState("")
  const [newLibraryDescription, setNewLibraryDescription] = useState("")
  const [isCreatingLibrary, setIsCreatingLibrary] = useState(false)
  const [isPolishing, setIsPolishing] = useState(false)
  const [stylePreview, setStylePreview] = useState<StyleRetrievalPreviewResponse | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [selectionDraft, setSelectionDraft] = useState({ start: 0, end: 0 })
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const styleFileRef = useRef<HTMLInputElement>(null)
  const cleanedStyleFileRef = useRef<HTMLInputElement>(null)
  const skipCommitRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isCreatingChapter, setIsCreatingChapter] = useState(false)
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  // Sort nodes
  const sortedChapters = useMemo(() => {
    if (!currentProject) return []
    return [...currentProject.chapters].sort((a, b) => a.order - b.order)
  }, [currentProject])

  const allStyleDocs = useMemo(
    () => [...styleDocs, ...styleLibraries.flatMap((item) => item.documents)],
    [styleDocs, styleLibraries],
  )

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
      setStyleLibraries([])
      setSelectedStyleIds([])
      setStylePreview(null)
      setSelectedLibraryId("")
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
    if (!currentProject) {
      return
    }
    const controller = new AbortController()
    listStyleLibraries({ signal: controller.signal })
      .then((bundles) => {
        setStyleLibraries(bundles)
        setSelectedLibraryId((prev) => {
          if (prev && bundles.some((item) => item.library.id === prev)) {
            return prev
          }
          return bundles[0]?.library.id ?? ""
        })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "加载共享文笔库失败"
        setStyleError(message)
      })
    return () => controller.abort()
  }, [currentProject])

  useEffect(() => {
    setStylePreview(null)
  }, [activeChapterId, selectedStyleIds])

  useEffect(() => {
    const validIds = new Set(allStyleDocs.map((doc) => doc.id))
    setSelectedStyleIds((prev) => prev.filter((id) => validIds.has(id)))
    if (previewDoc && !validIds.has(previewDoc.id)) {
      setPreviewDoc(null)
    }
  }, [allStyleDocs, previewDoc])

  useEffect(() => {
    if (!isStyleUploading) {
      setStyleUploadStage("等待上传")
      return
    }
    let index = 0
    setStyleUploadStage(UPLOAD_STAGES[index])
    const timer = window.setInterval(() => {
      index = Math.min(index + 1, UPLOAD_STAGES.length - 1)
      setStyleUploadStage(UPLOAD_STAGES[index])
    }, 1800)
    return () => window.clearInterval(timer)
  }, [isStyleUploading])

  useEffect(() => {
    setSelectionDraft({ start: 0, end: 0 })
  }, [activeChapterId])

  const syncSelectionDraft = () => {
    if (!textareaRef.current) {
      return
    }
    setSelectionDraft({
      start: textareaRef.current.selectionStart,
      end: textareaRef.current.selectionEnd,
    })
  }

  const handleSaveContent = async () => {
    if (!currentProject || !activeChapterId) return
    const chapter = currentProject.chapters.find((item) => item.id === activeChapterId)
    if (!chapter) return

    setIsSaving(true)
    setSaveSuccess(false)
    try {
      const response = await updateChapter(currentProject.id, activeChapterId, {
        title: chapterTitle.trim() || "未命名章节",
        content,
      })
      setProject(response)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
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
        ? `目标语感：${presetLabel}`
        : ""
    const strengthText =
      configForm.style_strength === "high"
        ? "改写幅度：可以明显调整句式和节奏，但不要改变剧情事实，不要整段换成统一腔调。"
        : configForm.style_strength === "low"
          ? "改写幅度：尽量少改，能不重写就不重写，以局部修顺为主。"
          : "改写幅度：允许调整句序和措辞，但保留原段落的大体质感。"
    const outputRules = [
      "输出要求：只返回正文，不要解释、总结、标题、分点或括号说明。",
      "避免常见 AI 痕迹：不要空泛抒情，不要堆砌比喻，不要频繁使用套板表达。",
    ]
    return [instruction, presetText, strengthText, ...outputRules].filter(Boolean).join("\n")
  }

  const handleAssist = async (
    mode: "polish" | "expand",
    scope: "selection" | "full",
  ) => {
    if (!currentProject || !activeChapterId) return
    
    let textToPolish = content
    const instruction = buildInstruction(mode)
    let replacementRange: { start: number; end: number } | null = null
    
    if (scope === "selection" && textareaRef.current) {
      const start = textareaRef.current.selectionStart
      const end = textareaRef.current.selectionEnd
      if (start !== end) {
        textToPolish = content.substring(start, end)
        replacementRange = { start, end }
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
      } else if (replacementRange) {
         const before = content.substring(0, replacementRange.start)
         const after = content.substring(replacementRange.end)
         setContent(before + polishedText + after)
      }

    } catch (error) {
      console.error("Polish failed", error)
      setError(formatUserErrorMessage(error, "写作助手处理失败，请稍后重试。"))
    } finally {
      setIsPolishing(false)
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

  const handleCreateLibrary = async () => {
    const nextName = newLibraryName.trim()
    if (!nextName) {
      setStyleError("共享文笔库名称不能为空")
      return
    }
    setIsCreatingLibrary(true)
    setStyleError(null)
    try {
      const library = await createStyleLibrary({
        name: nextName,
        description: newLibraryDescription.trim() || null,
      })
      const nextBundle: StyleLibraryBundle = {
        library,
        documents: [],
        total_chunks: 0,
        total_characters: 0,
      }
      setStyleLibraries((prev) => [nextBundle, ...prev])
      setSelectedLibraryId(library.id)
      setIsCreateLibraryOpen(false)
      setNewLibraryName("")
      setNewLibraryDescription("")
      setStyleUploadNotice(`已创建共享文笔库：${library.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建共享文笔库失败"
      setStyleError(message)
    } finally {
      setIsCreatingLibrary(false)
    }
  }

  const handleCleanedLibraryUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!selectedLibraryId) {
      setStyleError("请先创建或选择一个共享文笔库")
      if (cleanedStyleFileRef.current) {
        cleanedStyleFileRef.current.value = ""
      }
      return
    }
    if (!file.name.endsWith(".json") && !file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
      setStyleError("仅支持 .json / .txt / .md 文件")
      if (cleanedStyleFileRef.current) {
        cleanedStyleFileRef.current.value = ""
      }
      return
    }

    setIsLibraryUploading(true)
    setStyleError(null)
    setStyleUploadNotice(null)
    try {
      const result: StyleKnowledgeImportResponse = await importCleanedStyleLibraryFile(
        selectedLibraryId,
        file,
      )
      if (result.documents.length > 0) {
        setStyleLibraries((prev) =>
          prev.map((bundle) => {
            if (bundle.library.id !== selectedLibraryId) {
              return bundle
            }
            return {
              ...bundle,
              documents: [...result.documents, ...bundle.documents],
              total_chunks:
                bundle.total_chunks +
                result.documents.reduce((total, doc) => total + (doc.chunks?.length ?? 0), 0),
              total_characters:
                bundle.total_characters +
                result.documents.reduce((total, doc) => total + (doc.content?.length ?? 0), 0),
            }
          })
        )
        setSelectedStyleIds((prev) => {
          const next = [...prev]
          for (const doc of result.documents) {
            if (!next.includes(doc.id)) {
              next.push(doc.id)
            }
          }
          return next
        })
      }
      setStyleUploadNotice(
        `已向共享文笔库导入 ${result.imported_count} 份已清洗素材。`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入已清洗素材失败"
      setStyleError(message)
    } finally {
      setIsLibraryUploading(false)
      if (cleanedStyleFileRef.current) {
        cleanedStyleFileRef.current.value = ""
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
      if (doc.scope === "library" && doc.library_id) {
        const updated = await updateStyleLibraryDocumentTitle(doc.library_id, doc.id, {
          title: nextTitle,
        })
        setStyleLibraries((prev) =>
          prev.map((bundle) =>
            bundle.library.id !== doc.library_id
              ? bundle
              : {
                  ...bundle,
                  documents: bundle.documents.map((item) =>
                    item.id === doc.id ? updated : item
                  ),
                }
          )
        )
        if (previewDoc?.id === doc.id) {
          setPreviewDoc(updated)
        }
      } else {
        const updated = await updateStyleKnowledgeTitle(currentProject.id, doc.id, {
          title: nextTitle,
        })
        setStyleDocs((prev) =>
          prev.map((item) => (item.id === doc.id ? updated : item))
        )
        if (previewDoc?.id === doc.id) {
          setPreviewDoc(updated)
        }
      }
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
      if (doc.scope === "library" && doc.library_id) {
        await deleteStyleLibraryDocument(doc.library_id, doc.id)
        setStyleLibraries((prev) =>
          prev.map((bundle) =>
            bundle.library.id !== doc.library_id
              ? bundle
              : {
                  ...bundle,
                  documents: bundle.documents.filter((item) => item.id !== doc.id),
                  total_chunks: Math.max(
                    0,
                    bundle.total_chunks - (doc.chunks?.length ?? 0),
                  ),
                  total_characters: Math.max(
                    0,
                    bundle.total_characters - (doc.content?.length ?? 0),
                  ),
                }
          )
        )
      } else {
        await deleteStyleKnowledgeDocument(currentProject.id, doc.id)
        setStyleDocs((prev) => prev.filter((item) => item.id !== doc.id))
      }
      setSelectedStyleIds((prev) => prev.filter((id) => id !== doc.id))
      if (previewDoc?.id === doc.id) {
        setPreviewDoc(null)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败"
      setStyleError(message)
    }
  }

  const handleDeleteLibrary = async (libraryId: string, libraryName: string) => {
    const confirmed = window.confirm(`确定删除共享文笔库「${libraryName}」吗？库内素材会一并删除。`)
    if (!confirmed) {
      return
    }
    try {
      const target = styleLibraries.find((bundle) => bundle.library.id === libraryId)
      await deleteStyleLibrary(libraryId)
      setStyleLibraries((prev) => prev.filter((bundle) => bundle.library.id !== libraryId))
      if (target) {
        const libraryDocIds = new Set(target.documents.map((doc) => doc.id))
        setSelectedStyleIds((prev) => prev.filter((id) => !libraryDocIds.has(id)))
        if (previewDoc && libraryDocIds.has(previewDoc.id)) {
          setPreviewDoc(null)
        }
      }
      setSelectedLibraryId((prev) =>
        prev === libraryId
          ? styleLibraries.find((bundle) => bundle.library.id !== libraryId)?.library.id ?? ""
          : prev
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除共享文笔库失败"
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

  const toggleZenMode = () => {
    setIsZenMode(!isZenMode)
    if (!isZenMode) {
      setIsSidebarOpen(false)
      setIsAiPanelOpen(false)
    } else {
      setIsSidebarOpen(true)
      setIsAiPanelOpen(true)
    }
  }

  const getStyleCardColor = (title: string = "") => {
    const t = title.toLowerCase()
    if (t.includes("暖") || t.includes("温") || t.includes("warm")) return "border-orange-200/50 bg-orange-50/10 dark:bg-orange-950/10"
    if (t.includes("冷") || t.includes("硬") || t.includes("noir")) return "border-blue-200/50 bg-blue-50/10 dark:bg-blue-950/10"
    if (t.includes("诗") || t.includes("美") || t.includes("poetic")) return "border-purple-200/50 bg-purple-50/10 dark:bg-purple-950/10"
    return "border-border/60 bg-background/60"
  }

  if (!currentProject) return null

  const activeChapter = sortedChapters.find((chapter) => chapter.id === activeChapterId)
  const selectedLibraryBundle = styleLibraries.find(
    (item) => item.library.id === selectedLibraryId
  )
  const selectedTextLength = Math.max(0, selectionDraft.end - selectionDraft.start)
  const activePreset =
    STYLE_PRESETS.find((item) => item.key === configForm.style_preset) ?? STYLE_PRESETS[0]
  const uploadProgress =
    (isStyleUploading || isLibraryUploading) && styleUploadStage !== "等待上传"
      ? ((UPLOAD_STAGES.indexOf(styleUploadStage as (typeof UPLOAD_STAGES)[number]) + 1) /
          UPLOAD_STAGES.length) *
        100
      : 0
  const polishInstructionPreview = buildInstruction("polish")
  const expandInstructionPreview = buildInstruction("expand")
  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 280, damping: 28, mass: 0.9 }

  const chapterSidebarContent = (
    <>
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="h-4 w-4 text-primary/80" />
          <span>章节目录</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCreateChapter}
            className="rounded-xl text-muted-foreground hover:text-foreground"
            disabled={isCreatingChapter}
            title="新建章节"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsSidebarOpen(false)}
            className="hidden rounded-xl text-muted-foreground hover:text-foreground xl:inline-flex"
            title="收起侧边栏"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <motion.div layout className="space-y-2 p-3">
          {sortedChapters.length === 0 && isStyleLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-2xl border border-border/40 p-3">
                <Skeleton className="h-4 w-3/4 rounded-full" />
                <Skeleton className="h-3 w-1/2 rounded-full opacity-60" />
              </div>
            ))
          ) : (
            <AnimatePresence initial={false}>
              {sortedChapters.map((chapter, index) => {
                const isActive = activeChapterId === chapter.id
                const isEditing = editingChapterId === chapter.id
                return (
                  <motion.div
                    key={chapter.id}
                    layout
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{
                      ...motionTransition,
                      delay: shouldReduceMotion ? 0 : index * 0.02,
                    }}
                    className={cn(
                      "group relative overflow-hidden rounded-2xl border px-3 py-2.5 transition-all duration-200",
                      isActive
                        ? "border-primary/40 bg-primary/10 shadow-sm"
                        : "border-transparent bg-background/40 hover:bg-background/80"
                    )}
                  >
                    <div className="relative flex items-start gap-2">
                      <button
                        onClick={() => {
                          setActiveChapterId(chapter.id)
                          setMobileChapterSheetOpen(false)
                        }}
                        className="min-w-0 flex-1 text-left outline-none"
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
                            className="h-8 rounded-xl border-primary/30 bg-background"
                          />
                        ) : (
                          <>
                            <div
                              className={cn(
                                "truncate text-sm font-medium",
                                isActive ? "text-primary" : "text-foreground"
                              )}
                            >
                              {chapter.title || "未命名章节"}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/80">
                              <span>第 {chapter.order + 1} 章</span>
                              <span className="h-0.5 w-0.5 rounded-full bg-current/40" />
                              <span>{chapter.content?.length ?? 0} 字</span>
                            </div>
                          </>
                        )}
                      </button>
                      {!isEditing && (
                        <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="rounded-xl hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStartEditTitle(chapter.id, chapter.title)
                            }}
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="rounded-xl hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteChapter(chapter.id)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          )}
        </motion.div>
      </ScrollArea>
    </>
  )

  const aiPanelContent = (
    <>
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>AI 助手</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsConfigOpen(true)}
            className="rounded-xl text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsAiPanelOpen(false)}
            className="hidden rounded-xl text-muted-foreground hover:text-foreground xl:inline-flex"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <motion.div layout className="space-y-4">
          <motion.div
            layout
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTransition}
            className="relative overflow-hidden rounded-[28px] border border-primary/20 bg-[linear-gradient(180deg,rgba(77,102,177,0.1),rgba(255,255,255,0.84))] p-4"
          >
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -left-6 top-0 h-28 w-28 rounded-full bg-primary/15 blur-3xl"
              animate={shouldReduceMotion ? undefined : { x: [0, 10, 0], opacity: [0.35, 0.65, 0.35] }}
              transition={shouldReduceMotion ? undefined : { duration: 6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium text-sm text-primary">智能润色与扩写</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    当前预设为 {activePreset.label}，可针对选区精修，也可整体重整节奏与文风。
                  </p>
                </div>
                <motion.div
                  layout
                  className="rounded-full border border-primary/15 bg-background/78 px-3 py-1 text-xs text-muted-foreground shadow-sm"
                >
                  {selectedTextLength > 0 ? `已选 ${selectedTextLength} 字` : "未选择片段"}
                </motion.div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAssist("polish", "selection")}
                  disabled={isPolishing}
                  className="h-10 rounded-2xl bg-background/60"
                >
                  <PenLine className="h-3.5 w-3.5" /> 选中润色
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleAssist("polish", "full")}
                  disabled={isPolishing}
                  className="h-10 rounded-2xl shadow-[0_14px_32px_rgba(77,102,177,0.22)]"
                >
                  <Sparkles className="h-3.5 w-3.5" /> 全文润色
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAssist("expand", "selection")}
                  disabled={isPolishing}
                  className="h-10 rounded-2xl bg-background/60"
                >
                  <PenLine className="h-3.5 w-3.5" /> 选中扩写
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleAssist("expand", "full")}
                  disabled={isPolishing}
                  className="h-10 rounded-2xl shadow-[0_14px_32px_rgba(77,102,177,0.22)]"
                >
                  <Sparkles className="h-3.5 w-3.5" /> 全文扩写
                </Button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePreviewReferences("polish")}
                  disabled={isPreviewLoading || selectedStyleIds.length === 0}
                  className="h-9 rounded-2xl"
                >
                  预览润色参考
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePreviewReferences("expand")}
                  disabled={isPreviewLoading || selectedStyleIds.length === 0}
                  className="h-9 rounded-2xl"
                >
                  预览扩写参考
                </Button>
              </div>

              <AnimatePresence initial={false}>
                {stylePreview ? (
                  <motion.div
                    key="style-preview"
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                    transition={motionTransition}
                    className="mt-4 space-y-3 rounded-[22px] border border-border/60 bg-background/82 p-3"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-foreground">本次优先参考</div>
                      <div className="text-xs text-muted-foreground">
                        {stylePreview.preferred_focuses.length > 0
                          ? stylePreview.preferred_focuses.join(" / ")
                          : "通用型"}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {stylePreview.references.length > 0 ? (
                        stylePreview.references.map((item, index) => (
                          <motion.div
                            key={item.id}
                            layout
                            initial={shouldReduceMotion ? false : { opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                              ...motionTransition,
                              delay: shouldReduceMotion ? 0 : index * 0.03,
                            }}
                            className="rounded-2xl border border-border/50 bg-muted/20 p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 text-xs font-medium text-foreground line-clamp-1">
                                {item.title}
                              </div>
                              <div className="shrink-0 text-xs text-muted-foreground">
                                {item.score.toFixed(2)}
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {[item.focus, ...(item.techniques || [])].filter(Boolean).join(" | ") || "通用型"}
                            </div>
                            <div className="mt-1 text-xs leading-relaxed text-foreground/85 line-clamp-4">
                              {item.content}
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        <div className="text-xs text-muted-foreground">当前没有召回到合适的参考片段。</div>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>

          <motion.div
            layout
            initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionTransition, delay: shouldReduceMotion ? 0 : 0.05 }}
            className="rounded-[28px] border border-border/60 bg-background/72 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-foreground">仿写文笔知识库</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  项目内素材继续支持原始小说清洗；共享文笔库支持跨项目复用，并可直接导入已清洗 JSON / TXT / MD。
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 rounded-[22px] border border-border/60 bg-background/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 rounded-2xl"
                  disabled={isStyleUploading}
                  onClick={() => styleFileRef.current?.click()}
                >
                  {isStyleUploading ? "处理中..." : "导入原始小说"}
                </Button>
                <input
                  ref={styleFileRef}
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={handleStyleUpload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 rounded-2xl"
                  onClick={() => setIsCreateLibraryOpen(true)}
                >
                  新建共享库
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <Select
                  value={selectedLibraryId || undefined}
                  onValueChange={setSelectedLibraryId}
                >
                  <SelectTrigger className="h-10 rounded-2xl bg-background/70">
                    <SelectValue placeholder="选择共享文笔库" />
                  </SelectTrigger>
                  <SelectContent>
                    {styleLibraries.length > 0 ? (
                      styleLibraries.map((bundle) => (
                        <SelectItem key={bundle.library.id} value={bundle.library.id}>
                          {bundle.library.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__empty__" disabled>
                        暂无共享文笔库
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 rounded-2xl"
                    disabled={!selectedLibraryId || isLibraryUploading}
                    onClick={() => cleanedStyleFileRef.current?.click()}
                  >
                    {isLibraryUploading ? "导入中..." : "导入已清洗"}
                  </Button>
                  <input
                    ref={cleanedStyleFileRef}
                    type="file"
                    accept=".json,.txt,.md"
                    className="hidden"
                    onChange={handleCleanedLibraryUpload}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 rounded-2xl text-destructive hover:text-destructive"
                    disabled={!selectedLibraryBundle}
                    onClick={() =>
                      selectedLibraryBundle
                        ? handleDeleteLibrary(
                            selectedLibraryBundle.library.id,
                            selectedLibraryBundle.library.name,
                          )
                        : undefined
                    }
                  >
                    删除共享库
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedLibraryBundle
                  ? `当前共享库：${selectedLibraryBundle.library.name}，共 ${selectedLibraryBundle.documents.length} 份素材。`
                  : "创建一个共享文笔库后，就能在多个项目之间复用同一套风格素材。"}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {styleError ? (
                <motion.div
                  key="style-error"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={motionTransition}
                  className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive"
                >
                  {styleError}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {styleUploadNotice ? (
                <motion.div
                  key="style-success"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={motionTransition}
                  className="mt-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700"
                >
                  {styleUploadNotice}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {isStyleUploading ? (
                <motion.div
                  key="style-progress"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={motionTransition}
                  className="mt-3 rounded-[22px] border border-primary/20 bg-primary/5 p-3"
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-primary">
                    <span>正在处理：{styleUploadStage}</span>
                    <span>{Math.round(uploadProgress)}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary/10">
                    <motion.div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(77,102,177,0.55),rgba(77,102,177,0.95))]"
                      initial={{ width: "0%" }}
                      animate={{ width: `${uploadProgress}%` }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.45, ease: "easeOut" }}
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="mt-4">
              {isStyleLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full rounded-3xl" />
                  <Skeleton className="h-24 w-full rounded-3xl" />
                </div>
              ) : allStyleDocs.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-border/70 bg-background/50 px-4 py-5 text-xs leading-relaxed text-muted-foreground">
                  暂无文笔素材。你可以导入原始小说到当前项目，也可以把已清洗素材导入共享文笔库后跨项目复用。
                </div>
              ) : (
                <motion.div layout className="space-y-2">
                  {[
                    {
                      key: "project",
                      title: "当前项目素材",
                      description: "仅在当前项目可见",
                      documents: styleDocs,
                    },
                    ...styleLibraries.map((bundle) => ({
                      key: bundle.library.id,
                      title: bundle.library.name,
                      description:
                        bundle.library.description ||
                        `共享文笔库 · ${bundle.documents.length} 份素材`,
                      documents: bundle.documents,
                    })),
                  ].map((group) =>
                    group.documents.length > 0 ? (
                      <div key={group.key} className="space-y-2">
                        <div className="rounded-2xl border border-border/50 bg-muted/20 px-3 py-2">
                          <div className="text-xs font-medium text-foreground">{group.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{group.description}</div>
                        </div>
                        <AnimatePresence initial={false}>
                          {group.documents.map((doc, index) => {
                            const checked = selectedStyleIds.includes(doc.id)
                            const isRenaming = renamingDocId === doc.id
                            return (
                              <motion.div
                                key={doc.id}
                                layout
                                initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                                transition={{
                                  ...motionTransition,
                                  delay: shouldReduceMotion ? 0 : index * 0.025,
                                }}
                                className={cn(
                                  "rounded-[22px] border px-3 py-3 text-xs transition-all",
                                  checked
                                    ? "border-primary/35 bg-primary/10 shadow-lg shadow-primary/5 scale-[1.01]"
                                    : getStyleCardColor(doc.title)
                                )}
                              >
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 rounded border-border text-primary"
                                    checked={checked}
                                    onChange={() => handleStyleToggle(doc.id)}
                                  />
                                  <div className="min-w-0 flex-1">
                                    {isRenaming ? (
                                      <Input
                                        value={renameValue}
                                        onChange={(event) => setRenameValue(event.target.value)}
                                        className="h-9 text-xs"
                                      />
                                    ) : (
                                      <div className="font-medium text-foreground line-clamp-1">
                                        {doc.title || "未命名风格"}
                                      </div>
                                    )}
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {formatCuratedStats(doc)}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {isRenaming ? (
                                    <>
                                      <Button size="sm" className="h-8 rounded-xl text-xs" onClick={() => handleConfirmRename(doc)}>
                                        保存
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={handleCancelRename}>
                                        取消
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => handleOpenPreview(doc)}>
                                        预览
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => handleStartRename(doc)}>
                                        重命名
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs text-destructive hover:text-destructive" onClick={() => handleDeleteStyleDoc(doc)}>
                                        删除
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </motion.div>
                            )
                          })}
                        </AnimatePresence>
                      </div>
                    ) : null
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>

          <AnimatePresence initial={false}>
            {isPolishing ? (
              <motion.div
                key="polishing-indicator"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={motionTransition}
                className="relative flex flex-col items-center justify-center overflow-hidden rounded-[24px] border border-primary/15 bg-primary/5 px-4 py-8 text-muted-foreground"
              >
                <motion.div
                  aria-hidden
                  className="absolute inset-x-12 top-4 h-12 rounded-full bg-primary/12 blur-2xl"
                  animate={shouldReduceMotion ? undefined : { opacity: [0.35, 0.7, 0.35], scale: [0.96, 1.06, 0.96] }}
                  transition={shouldReduceMotion ? undefined : { duration: 2.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                />
                <motion.div
                  animate={shouldReduceMotion ? undefined : { rotate: 360 }}
                  transition={shouldReduceMotion ? undefined : { duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                >
                  <Sparkles className="h-5 w-5 text-primary" />
                </motion.div>
                <span className="mt-2 text-xs">AI 正在思考中...</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </ScrollArea>
    </>
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,var(--bg-main-start),var(--bg-main-end))]">
      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        {/* 左侧章节目录 */}
        <AnimatePresence initial={false}>
          {!isZenMode && isSidebarOpen && (
            <ResizablePanel
              defaultSize={20}
              minSize={15}
              maxSize={30}
              className="hidden xl:block"
            >
              <aside className="flex h-full flex-col border-r border-border/40 bg-background/35 backdrop-blur-xl">
                {chapterSidebarContent}
              </aside>
            </ResizablePanel>
          )}
        </AnimatePresence>

        {!isZenMode && isSidebarOpen && <ResizableHandle withHandle className="hidden xl:flex" />}

        {/* 中间编辑主区 */}
        <ResizablePanel defaultSize={isZenMode ? 100 : 55} minSize={40}>
          <div className="flex h-full flex-col">
            <motion.div
              layout
              className="border-b border-border/50 bg-background/70 px-3 py-3 backdrop-blur-md sm:px-4"
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <motion.div layout className="mb-2 flex flex-wrap gap-2">
                      <motion.div layout className="status-pill">
                        {sortedChapters.length} 个章节
                      </motion.div>
                      <motion.div layout className="status-pill">
                        {content.length} 字
                      </motion.div>
                      <motion.div layout className="status-pill">
                        {selectedStyleIds.length} / {allStyleDocs.length} 份风格素材
                      </motion.div>
                      <AnimatePresence initial={false}>
                        {selectedTextLength > 0 ? (
                          <motion.div
                            key="selection-pill"
                            layout
                            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                            transition={motionTransition}
                            className="status-pill border-primary/20 bg-primary/6 text-primary"
                          >
                            当前选中 {selectedTextLength} 字
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </motion.div>
                    <input
                      className="w-full rounded-2xl bg-transparent px-1 font-serif text-2xl font-semibold leading-tight tracking-tight text-foreground placeholder:text-muted-foreground/30 outline-none transition-[background-color,box-shadow] focus:bg-background/45 sm:text-3xl"
                      value={chapterTitle}
                      onChange={(event) => setChapterTitle(event.target.value)}
                      onBlur={handleTitleBlur}
                      placeholder="输入章节标题..."
                    />
                    <div className="mt-2 text-sm text-muted-foreground">
                      {activeChapter ? `当前编辑：第 ${activeChapter.order + 1} 章` : "创建首个章节后开始写作"}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="hidden xl:flex items-center gap-2 mr-2 px-3 h-9 rounded-xl border border-border/40 bg-background/40 text-muted-foreground transition-all hover:border-primary/30">
                      <Search className="h-3.5 w-3.5" />
                      <span className="text-xs">⌘K 搜索操作...</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl xl:hidden"
                      onClick={() => setMobileChapterSheetOpen(true)}
                    >
                      <FileText className="h-4 w-4" />
                      章节
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl xl:hidden"
                      onClick={() => setMobileAiSheetOpen(true)}
                    >
                      <Sparkles className="h-4 w-4" />
                      AI 助手
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hidden rounded-xl xl:inline-flex"
                      onClick={() => setIsSidebarOpen((prev) => !prev)}
                    >
                      {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hidden rounded-xl xl:inline-flex"
                      onClick={() => setIsAiPanelOpen((prev) => !prev)}
                    >
                      {isAiPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsConfigOpen(true)}
                      className="rounded-xl"
                    >
                      <Settings2 className="h-4 w-4" />
                      配置
                    </Button>
                    <Button
                      variant={isZenMode ? "default" : "outline"}
                      size="sm"
                      onClick={toggleZenMode}
                      className={cn("rounded-xl transition-all", isZenMode && "bg-primary text-primary-foreground shadow-lg shadow-primary/25")}
                      title="禅定模式"
                    >
                      <Sparkles className={cn("h-4 w-4", isZenMode && "animate-pulse")} />
                      {isZenMode ? "沉浸中" : "禅定"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveContent}
                      disabled={isSaving}
                      className={cn(
                        "rounded-xl transition-all duration-300",
                        saveSuccess ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20" : "shadow-[0_14px_28px_rgba(77,102,177,0.18)]"
                      )}
                    >
                      {saveSuccess ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                      {isSaving ? "保存中" : saveSuccess ? "已保存" : "保存"}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>

            <ScrollArea className="flex-1 w-full bg-transparent">
              <div className="flex min-h-full flex-col items-center px-4 py-6 sm:px-6 sm:py-8">
                <motion.div
                  layout
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : {
                          y: isEditorFocused ? -3 : 0,
                          scale: isEditorFocused ? 1.001 : 1,
                        }
                  }
                  transition={motionTransition}
                  className={cn(
                    "relative w-full transition-all duration-500 p-6 sm:p-10",
                    isZenMode ? "max-w-[1100px] border-transparent bg-transparent shadow-none" : "max-w-[980px] rounded-[34px] border surface-card bg-background/95 shadow-xl",
                  )}
                >
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-10 top-0 h-24 rounded-full bg-primary/10 blur-3xl"
                    animate={
                      shouldReduceMotion
                        ? undefined
                        : { opacity: isEditorFocused ? 0.85 : 0.35, scale: isEditorFocused ? 1.08 : 0.92 }
                    }
                    transition={motionTransition}
                  />
                  <div className="relative mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1">
                      {activePreset.label}
                    </span>
                    <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1">
                      {configForm.style_strength === "high"
                        ? "强烈改写"
                        : configForm.style_strength === "low"
                          ? "轻度改写"
                          : "中等改写"}
                    </span>
                    <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1">
                      {selectedTextLength > 0 ? `已选 ${selectedTextLength} 字` : "可先选中局部再精修"}
                    </span>
                  </div>
                  <textarea
                    ref={textareaRef}
                    className={cn(
                      "min-h-[58vh] w-full resize-none bg-transparent font-serif text-foreground/90 placeholder:text-muted-foreground/25 focus:outline-none sm:min-h-[66vh] transition-all duration-500",
                      isZenMode ? "text-xl leading-[2.2]" : "text-base leading-[1.95] sm:text-lg"
                    )}
                    placeholder="在此开始你的创作..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onFocus={() => setIsEditorFocused(true)}
                    onBlur={() => setIsEditorFocused(false)}
                    onSelect={syncSelectionDraft}
                    onKeyUp={syncSelectionDraft}
                    onMouseUp={syncSelectionDraft}
                    spellCheck={false}
                  />
                </motion.div>
                <div className="h-20 shrink-0" />
              </div>
            </ScrollArea>

            <div className="border-t border-border/50 bg-background/88 px-3 py-2 backdrop-blur xl:hidden">
              <div className="grid grid-cols-3 gap-2">
                <Button variant="ghost" className="h-10 rounded-xl" onClick={() => setMobileChapterSheetOpen(true)}>
                  <FileText className="h-4 w-4" />
                  章节
                </Button>
                <Button variant="ghost" className="h-10 rounded-xl" onClick={() => setMobileAiSheetOpen(true)}>
                  <Sparkles className="h-4 w-4" />
                  AI
                </Button>
                <Button className="h-10 rounded-xl" onClick={handleSaveContent} disabled={isSaving}>
                  <Save className="h-4 w-4" />
                  保存
                </Button>
              </div>
            </div>
          </div>
        </ResizablePanel>

        {!isZenMode && isAiPanelOpen && <ResizableHandle withHandle className="hidden xl:flex" />}

        {/* 右侧 AI 助手 */}
        <AnimatePresence initial={false}>
          {!isZenMode && isAiPanelOpen && (
            <ResizablePanel
              defaultSize={25}
              minSize={20}
              maxSize={40}
              className="hidden xl:block"
            >
              <aside className="flex h-full flex-col border-l border-border/40 bg-background/40 backdrop-blur-xl">
                {aiPanelContent}
              </aside>
            </ResizablePanel>
          )}
        </AnimatePresence>
      </ResizablePanelGroup>

      <Sheet open={mobileChapterSheetOpen} onOpenChange={setMobileChapterSheetOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-none p-0 sm:max-w-sm xl:hidden">
          <SheetHeader className="border-b border-border/50">
            <SheetTitle>章节目录</SheetTitle>
            <SheetDescription>切换章节、重命名或新建章节。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{chapterSidebarContent}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={mobileAiSheetOpen} onOpenChange={setMobileAiSheetOpen}>
        <SheetContent side="right" className="w-[92vw] max-w-none p-0 sm:max-w-lg xl:hidden">
          <SheetHeader className="border-b border-border/50">
            <SheetTitle>AI 助手</SheetTitle>
            <SheetDescription>润色、扩写和文风素材都集中在这里。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{aiPanelContent}</div>
        </SheetContent>
      </Sheet>

      <Dialog open={isCreateLibraryOpen} onOpenChange={setIsCreateLibraryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建共享文笔库</DialogTitle>
            <DialogDescription>
              共享库中的素材可以在多个项目里重复勾选使用，适合沉淀长期可复用的文风参考。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-foreground">名称</div>
              <Input
                value={newLibraryName}
                onChange={(event) => setNewLibraryName(event.target.value)}
                placeholder="例如：冷峻对白库"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium text-foreground">说明</div>
              <Textarea
                value={newLibraryDescription}
                onChange={(event) => setNewLibraryDescription(event.target.value)}
                placeholder="可选，用一句话说明这个共享库适合什么风格。"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateLibraryOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateLibrary} disabled={isCreatingLibrary}>
              {isCreatingLibrary ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config Dialog */}
      <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
          <div className="border-b border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,240,232,0.92))] px-6 py-6">
            <DialogHeader className="gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="status-pill border-primary/20 bg-primary/6 text-primary">
                  当前预设: {activePreset.label}
                </div>
                <div className="status-pill">
                  强度: {configForm.style_strength === "high" ? "强烈" : configForm.style_strength === "low" ? "轻度" : "中等"}
                </div>
              </div>
              <DialogTitle>写作助手配置</DialogTitle>
              <DialogDescription>
                调整润色与扩写的语感边界、连接参数和实时预览，让写作台更贴近你的个人工作流。
              </DialogDescription>
            </DialogHeader>
          </div>

          <ScrollArea className="max-h-[calc(90vh-10rem)]">
            <div className="grid gap-4 p-6 lg:grid-cols-[1.15fr_0.85fr]">
              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={motionTransition}
                className="space-y-4"
              >
                <div className="rounded-[28px] border border-border/70 bg-background/72 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">风格预设</div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        先定输出语感，再微调润色和扩写指令，整体会稳定很多。
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {STYLE_PRESETS.map((item, index) => {
                      const isSelected = configForm.style_preset === item.key
                      return (
                        <motion.button
                          key={item.key}
                          type="button"
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            ...motionTransition,
                            delay: shouldReduceMotion ? 0 : index * 0.03,
                          }}
                          whileHover={shouldReduceMotion ? undefined : { y: -2, scale: 1.01 }}
                          whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
                          onClick={() => handlePresetChange(item.key)}
                          className={cn(
                            "rounded-[22px] border px-4 py-3 text-left transition-[border-color,background-color,box-shadow]",
                            isSelected
                              ? "border-primary/30 bg-[linear-gradient(180deg,rgba(77,102,177,0.12),rgba(255,255,255,0.96))] shadow-[0_18px_38px_rgba(77,102,177,0.12)]"
                              : "border-border/70 bg-background/78 hover:border-primary/18 hover:bg-background"
                          )}
                        >
                          <div className="text-sm font-medium text-foreground">{item.label}</div>
                          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {item.summary}
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-background/72 p-4">
                  <div className="text-sm font-medium text-foreground">改写强度</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    控制模型对句式和节奏的介入程度。
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      { key: "low", label: "轻度", summary: "以修顺和去套话为主。" },
                      { key: "medium", label: "中等", summary: "调整句序，但保留原质感。" },
                      { key: "high", label: "强烈", summary: "明显重塑节奏与句式。" },
                    ].map((item) => {
                      const isSelected = configForm.style_strength === item.key
                      return (
                        <motion.button
                          key={item.key}
                          type="button"
                          whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                          whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
                          onClick={() =>
                            setConfigForm((prev) => ({
                              ...prev,
                              style_strength: item.key,
                            }))
                          }
                          className={cn(
                            "rounded-[20px] border px-3 py-3 text-left transition-[border-color,background-color,box-shadow]",
                            isSelected
                              ? "border-primary/30 bg-primary/8 shadow-[0_12px_26px_rgba(77,102,177,0.12)]"
                              : "border-border/70 bg-background/70 hover:border-primary/18"
                          )}
                        >
                          <div className="text-sm font-medium text-foreground">{item.label}</div>
                          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {item.summary}
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-background/72 p-4">
                  <div className="text-sm font-medium text-foreground">指令细化</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    把系统定位和具体润色策略拆开写，效果通常比一段大杂烩 prompt 更稳定。
                  </p>
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">系统指令</label>
                      <Textarea
                        value={configForm.prompt || ""}
                        onChange={(e) => setConfigForm((prev) => ({ ...prev, prompt: e.target.value }))}
                        placeholder="例如：你是中文长篇小说编辑。保持人称、时态、语气与情节事实不变，只输出处理后的正文，避免套板 AI 腔。"
                        className="min-h-28 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">润色提示词</label>
                      <Textarea
                        value={configForm.polish_instruction || ""}
                        onChange={(e) => setConfigForm((prev) => ({ ...prev, polish_instruction: e.target.value }))}
                        placeholder="例如：做克制润色，删套话、顺句子、补必要动作与感官细节，不要拔高文风。"
                        className="min-h-32 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">扩写提示词</label>
                      <Textarea
                        value={configForm.expand_instruction || ""}
                        onChange={(e) => setConfigForm((prev) => ({ ...prev, expand_instruction: e.target.value }))}
                        placeholder="例如：只沿当前段落自然扩写，补足动作、环境、心理或对话反应，不新增重大剧情。"
                        className="min-h-32 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...motionTransition, delay: shouldReduceMotion ? 0 : 0.05 }}
                className="space-y-4"
              >
                <div className="rounded-[28px] border border-border/70 bg-background/72 p-4">
                  <div className="text-sm font-medium text-foreground">连接设置</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这里可以调整当前写作助手使用的模型与服务连接。
                  </p>
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">模型名称</label>
                      <Input
                        value={configForm.model || ""}
                        onChange={(e) => setConfigForm((prev) => ({ ...prev, model: e.target.value }))}
                        placeholder="gpt-4o"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">服务地址</label>
                      <Input
                        value={configForm.base_url || ""}
                        onChange={(e) => setConfigForm((prev) => ({ ...prev, base_url: e.target.value }))}
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">访问密钥</label>
                      <Input
                        type="password"
                        value={configForm.api_key || ""}
                        onChange={(e) => setConfigForm((prev) => ({ ...prev, api_key: e.target.value }))}
                        placeholder="sk-..."
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-primary/18 bg-[linear-gradient(180deg,rgba(77,102,177,0.08),rgba(255,255,255,0.86))] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-foreground">实时组合预览</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        这里展示写作台最终会拼出来的核心指令语气。
                      </p>
                    </div>
                    <div className="rounded-full border border-primary/15 bg-background/75 px-3 py-1 text-xs text-primary">
                      {activePreset.label}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="rounded-[22px] border border-border/60 bg-background/84 p-3">
                      <div className="text-xs font-medium text-foreground">润色预览</div>
                      <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {polishInstructionPreview}
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-border/60 bg-background/84 p-3">
                      <div className="text-xs font-medium text-foreground">扩写预览</div>
                      <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {expandInstructionPreview}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 pb-6">
            <Button variant="outline" onClick={() => setIsConfigOpen(false)}>
              取消
            </Button>
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
