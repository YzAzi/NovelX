"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Sparkles, Settings2, PenLine, Save, ChevronRight, ChevronLeft } from "lucide-react"

import { useProjectStore } from "@/src/stores/project-store"
import { syncNode, updateProjectSettings } from "@/src/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { WriterConfig, StoryNode } from "@/src/types/models"

export function WritingWorkspace() {
  const { currentProject, setProject } = useProjectStore()
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [content, setContent] = useState("")
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
  const [isSaving, setIsSaving] = useState(false)

  // Sort nodes
  const sortedNodes = useMemo(() => {
    if (!currentProject) return []
    return [...currentProject.nodes].sort((a, b) => a.narrative_order - b.narrative_order)
  }, [currentProject?.nodes])

  // Set initial active node
  useEffect(() => {
    if (!activeNodeId && sortedNodes.length > 0) {
      setActiveNodeId(sortedNodes[0].id)
    }
  }, [sortedNodes, activeNodeId])

  // Sync content when active node changes
  useEffect(() => {
    if (!activeNodeId || !currentProject) return
    const node = currentProject.nodes.find((n) => n.id === activeNodeId)
    if (node) {
      setContent(node.content || "")
    }
  }, [activeNodeId, currentProject])

  // Load config
  useEffect(() => {
    if (currentProject?.writer_config) {
      setConfigForm(currentProject.writer_config)
    }
  }, [currentProject?.writer_config])

  const handleSaveContent = async () => {
    if (!currentProject || !activeNodeId) return
    const node = currentProject.nodes.find((n) => n.id === activeNodeId)
    if (!node) return

    setIsSaving(true)
    try {
      const updatedNode = { ...node, content }
      const response = await syncNode(currentProject.id, updatedNode)
      setProject(response.project)
    } catch (error) {
      console.error("Failed to save content", error)
    } finally {
      setIsSaving(false)
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
    if (!currentProject || !activeNodeId) return
    
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

      // If full text polish, maybe replace content? Or show diff?
      // For now, let's just append or show in alert/modal.
      // Better: Replace content if selection, or show in a "Suggestion" box.
      // To keep it simple for this iteration: Just replace selection or content directly?
      // No, that's dangerous. Let's just log it or put it in clipboard?
      // Let's replace selection for "selection" mode, and replace all for "full" mode?
      // User requested "Click polish -> polish entire article".
      
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

  if (!currentProject) return null

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-50/50 dark:bg-zinc-950/50">
      {/* Sidebar */}
      <div className={cn(
        "flex flex-col border-r bg-white/60 backdrop-blur-xl transition-all duration-300 dark:bg-zinc-900/60",
        isSidebarOpen ? "w-64" : "w-0 overflow-hidden"
      )}>
        <div className="flex items-center justify-between p-4">
          <span className="font-semibold text-sm">章节列表</span>
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)} className="h-6 w-6">
            <ChevronLeft size={14} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-1 p-2">
            {sortedNodes.map(node => (
              <button
                key={node.id}
                onClick={() => setActiveNodeId(node.id)}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  activeNodeId === node.id ? "bg-zinc-200 font-medium dark:bg-zinc-800" : ""
                )}
              >
                <div className="truncate">{node.title}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Toggle Sidebar Button (when closed) */}
      {!isSidebarOpen && (
        <div className="absolute left-4 top-4 z-10">
          <Button variant="outline" size="icon" onClick={() => setIsSidebarOpen(true)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      {/* Main Editor */}
      <div className="flex-1 flex flex-col relative h-full">
        <div className="absolute top-4 right-4 z-10 flex gap-2">
           <Button 
             variant={isSaving ? "secondary" : "default"} 
             size="sm" 
             onClick={handleSaveContent}
             disabled={isSaving}
           >
             <Save size={14} className="mr-1" />
             {isSaving ? "保存中..." : "保存"}
           </Button>
           <Button
             variant="outline"
             size="icon"
             onClick={() => setIsAiPanelOpen(!isAiPanelOpen)}
           >
             <Sparkles size={16} />
           </Button>
        </div>
        
        <div className="mx-auto w-full max-w-3xl flex-1 py-12 px-8 flex flex-col h-full">
           <input
             className="bg-transparent text-3xl font-bold mb-6 focus:outline-none"
             value={currentProject.nodes.find(n => n.id === activeNodeId)?.title || ""}
             readOnly // Editing title in sidebar or dedicated edit mode
           />
           <textarea
             ref={textareaRef}
             className="flex-1 w-full resize-none bg-transparent text-lg leading-relaxed focus:outline-none"
             placeholder="开始写作..."
             value={content}
             onChange={(e) => setContent(e.target.value)}
           />
        </div>
      </div>

      {/* AI Panel */}
      <div className={cn(
        "flex flex-col border-l bg-white/60 backdrop-blur-xl transition-all duration-300 dark:bg-zinc-900/60",
        isAiPanelOpen ? "w-80" : "w-0 overflow-hidden"
      )}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-500" />
            <span className="font-semibold text-sm">AI 助手</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsConfigOpen(true)}>
            <Settings2 size={16} />
          </Button>
        </div>
        <div className="p-4 space-y-4">
          <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800">
            <h3 className="font-medium text-sm mb-2 text-purple-900 dark:text-purple-100">智能润色</h3>
            <p className="text-xs text-purple-700 dark:text-purple-300 mb-4">
              选中一段文本进行局部润色，或点击下方按钮全文润色。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handlePolish("selection")}
                disabled={isPolishing}
              >
                <PenLine size={14} className="mr-1" /> 选中润色
              </Button>
              <Button 
                variant="default" 
                size="sm" 
                onClick={() => handlePolish("full")}
                disabled={isPolishing}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Sparkles size={14} className="mr-1" /> 全文润色
              </Button>
            </div>
          </div>
          
          {/* Status */}
          {isPolishing && (
            <div className="text-xs text-center text-muted-foreground animate-pulse">
              AI 正在思考中...
            </div>
          )}
        </div>
      </div>

      {/* Config Dialog */}
      <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>写作助手设置</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Prompt (润色指令)</label>
              <Textarea 
                value={configForm.prompt || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, prompt: e.target.value }))}
                placeholder="例如：你是一个资深小说编辑..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Model Name</label>
              <Input 
                value={configForm.model || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, model: e.target.value }))}
                placeholder="gpt-4o"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <Input 
                type="password"
                value={configForm.api_key || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, api_key: e.target.value }))}
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Base URL</label>
              <Input 
                value={configForm.base_url || ""} 
                onChange={e => setConfigForm(prev => ({ ...prev, base_url: e.target.value }))}
                placeholder="https://api.openai.com/v1"
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

import { useMemo } from "react" // Added missing import
