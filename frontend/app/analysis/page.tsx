"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, Sparkles, Send, Square, Trash2 } from "lucide-react"
import dynamic from "next/dynamic"
import "@uiw/react-markdown-preview/markdown.css";

import type { AnalysisMessage } from "@/src/types/models"
import {
  buildApiUrl,
  buildAuthHeaders,
  getAnalysisHistory,
  handleUnauthorized,
  saveAnalysisHistory,
  updateProjectSettings,
} from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import { normalizeMarkdown } from "@/src/lib/markdown"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const MarkdownPreview = dynamic(
  () => import("@uiw/react-markdown-preview").then((mod) => mod.default),
  { ssr: false }
);

const QUICK_PROMPT = "请分析当前大纲的一致性问题，并给出修改与扩写建议。"
const stripFencedCodeBlocks = (input: string) =>
  input.replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, code: string) =>
    code.replace(/^\s{0,4}/gm, "")
  )

export default function OutlineAnalysisPage() {
  const { currentProject, setProject } = useProjectStore()
  const [messages, setMessages] = useState<AnalysisMessage[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<"light" | "dark">("light")
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const canSend = Boolean(input.trim()) && !isStreaming && currentProject
  const selectedProfile = currentProject?.analysis_profile ?? "auto"

  useEffect(() => {
    if (typeof window === "undefined") return
    const updateMode = () => {
      const isDark = document.documentElement.classList.contains("dark")
      setColorMode(isDark ? "dark" : "light")
    }
    updateMode()
    const observer = new MutationObserver(updateMode)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  const scrollToBottom = () => {
    if (scrollRef.current) {
        const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollContainer) {
            scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
        }
    }
  }

  const sendMessage = async (content: string) => {
    if (!currentProject || isStreaming) {
      return
    }
    const userMessage: AnalysisMessage = { role: "user", content }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput("")
    setIsStreaming(true)
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller
    let assistantBuffer = ""
    setMessages((prev) => [...prev, { role: "assistant", content: "" }])

    try {
      const response = await fetch(buildApiUrl("/api/outline_analysis_stream"), {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          project_id: currentProject.id,
          messages: nextMessages,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        if (response.status === 401) {
          handleUnauthorized()
        }
        const detail = await response.text()
        throw new Error(detail || "请求失败")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder("utf-8")
      let buffer = ""
      let done = false

      while (!done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""

        for (const part of parts) {
          const lines = part.split("\n")
          let event = "message"
          const dataLines: string[] = []
          for (const line of lines) {
            if (line.startsWith("event:")) {
              event = line.replace("event:", "").trim()
            } else if (line.startsWith("data:")) {
              dataLines.push(line.replace(/^data:\s?/, ""))
            }
          }
          const data = dataLines.join("\n")
          if (event === "start") {
             continue
          }
          if (event === "done") {
            done = true
            break
          }
          if (event === "error") {
            throw new Error(data || "分析失败")
          }
          if (data) {
            assistantBuffer += data
            setMessages((prev) => {
              const updated = [...prev]
              const lastIndex = updated.length - 1
              if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                updated[lastIndex] = { role: "assistant", content: assistantBuffer }
              }
              return updated
            })
            scrollToBottom()
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return
      }
      const message = err instanceof Error ? err.message : "分析失败"
      setError(message)
      setMessages((prev) => prev.filter((_, index) => index !== prev.length - 1))
    } finally {
      if (assistantBuffer.trim()) {
        try {
          await saveAnalysisHistory({
            project_id: currentProject.id,
            messages: [
              { role: "user", content },
              { role: "assistant", content: assistantBuffer },
            ],
          })
        } catch {
          // ignore persistence errors
        }
      }
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  const handleQuickAnalyze = () => {
    if (!currentProject || isStreaming) {
      return
    }
    sendMessage(QUICK_PROMPT)
  }

  const orderedMessages = useMemo(() => messages, [messages])

  const handleProfileChange = async (value: "auto" | "short" | "medium" | "long") => {
    if (!currentProject) {
      return
    }
    try {
      const updated = await updateProjectSettings(currentProject.id, { analysis_profile: value })
      setProject(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存设置失败"
      setError(message)
    }
  }

  useEffect(() => {
    if (!currentProject) {
      setMessages([])
      return
    }
    const controller = new AbortController()
    getAnalysisHistory(currentProject.id, { signal: controller.signal })
      .then((response) => {
        const nextMessages = response.messages.map((item) => ({
          role: item.role,
          content: item.content,
        }))
        setMessages(nextMessages)
        setError(null)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return
        }
        // Suppress initial load errors if backend is down
        console.warn("Analysis history load failed", err)
      })
    return () => controller.abort()
  }, [currentProject?.id])

  // Scroll to bottom on load
  useEffect(() => {
      if (messages.length > 0) {
          scrollToBottom();
      }
  }, [messages.length]);


  if (!currentProject) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-sm text-muted-foreground">
        <div className="text-center space-y-4">
            <p>请先在主界面选择一个项目。</p>
            <Button asChild variant="outline">
                <Link href="/">返回主页</Link>
            </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Link href="/" title="返回主页">
              <ChevronLeft size={20} />
            </Link>
          </Button>
          <div className="flex flex-col">
             <span className="text-sm font-semibold">{currentProject.title}</span>
             <span className="text-[10px] text-muted-foreground">大纲深度分析</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm focus:border-primary focus:outline-none"
              value={selectedProfile}
              onChange={(event) =>
                handleProfileChange(
                  event.target.value as "auto" | "short" | "medium" | "long"
                )
              }
              disabled={isStreaming}
            >
              <option value="auto">自动配置</option>
              <option value="short">短篇 (全量)</option>
              <option value="medium">中篇 (RAG)</option>
              <option value="long">长篇 (RAG)</option>
            </select>
            <Button 
                variant="secondary" 
                size="sm" 
                onClick={handleQuickAnalyze} 
                disabled={isStreaming}
                className="h-8 text-xs"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              一键分析
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMessages([])}
              disabled={isStreaming || messages.length === 0}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="清空对话"
            >
              <Trash2 size={16} />
            </Button>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden relative bg-muted/20">
         <ScrollArea ref={scrollRef} className="h-full w-full">
            <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
                {orderedMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
                            <Sparkles size={24} />
                        </div>
                        <h3 className="text-sm font-medium text-foreground mb-1">AI 大纲分析助手</h3>
                        <p className="text-xs text-muted-foreground max-w-xs">
                            我可以帮你检查剧情逻辑、寻找设定冲突，或者提供扩写建议。
                        </p>
                    </div>
                ) : (
                    orderedMessages.map((message, index) => (
                        <div
                            key={index}
                            className={cn(
                                "flex w-full",
                                message.role === "user" ? "justify-end" : "justify-start"
                            )}
                        >
                            <div
                                className={cn(
                                    "max-w-[85%] rounded-2xl px-5 py-3.5 text-sm shadow-sm leading-relaxed whitespace-pre-wrap",
                                    message.role === "user"
                                        ? "bg-primary text-primary-foreground rounded-br-sm"
                                        : "bg-card text-card-foreground border border-border rounded-bl-sm"
                                )}
                            >
                                {message.role === "assistant" ? (
                                    <div className="markdown-preview-reset text-sm">
                                        <MarkdownPreview 
                                            source={normalizeMarkdown(
                                              stripFencedCodeBlocks(
                                                message.content || (isStreaming ? "Thinking..." : "")
                                              )
                                            )} 
                                            style={{ backgroundColor: 'transparent', color: 'inherit', fontSize: 'inherit' }}
                                            wrapperElement={{ "data-color-mode": colorMode }}
                                        />
                                    </div>
                                ) : (
                                    <div className="whitespace-pre-wrap">{message.content}</div>
                                )}
                            </div>
                        </div>
                    ))
                )}
                <div className="h-4" />
            </div>
         </ScrollArea>
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-border bg-background px-4 py-4">
         <div className="mx-auto max-w-3xl relative">
            <div className="relative rounded-xl border border-border bg-muted/30 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all shadow-sm">
                <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (canSend) sendMessage(input.trim());
                        }
                    }}
                    placeholder="输入你的问题，Shift + Enter 换行..."
                    rows={1}
                    className="min-h-[50px] max-h-[200px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0 placeholder:text-muted-foreground/50"
                    style={{ height: 'auto', overflow: 'hidden' }} 
                    // Simple auto-grow hack if needed, or rely on Textarea autosize props if available
                />
                <div className="absolute right-2 bottom-2 flex items-center gap-2">
                    {isStreaming ? (
                        <Button
                            size="icon"
                            variant="destructive"
                            className="h-8 w-8 rounded-lg"
                            onClick={() => abortRef.current?.abort()}
                        >
                            <Square size={14} fill="currentColor" />
                        </Button>
                    ) : (
                        <Button
                            size="icon"
                            className="h-8 w-8 rounded-lg"
                            disabled={!canSend}
                            onClick={() => sendMessage(input.trim())}
                        >
                            <Send size={16} />
                        </Button>
                    )}
                </div>
            </div>
            {error && (
                <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                    <span className="font-medium">Error:</span> {error}
                </div>
            )}
            <div className="mt-2 text-[10px] text-center text-muted-foreground/60">
                AI 内容仅供参考，请核对重要信息。
            </div>
         </div>
      </div>
    </div>
  )
}
