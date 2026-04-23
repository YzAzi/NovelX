"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import {
  ChevronLeft,
  History,
  Network,
  PanelLeftOpen,
  PenTool,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  MessageSquare,
  Bot,
  User,
  Zap,
} from "lucide-react"
import "@uiw/react-markdown-preview/markdown.css"

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const MarkdownPreview = dynamic(
  () => import("@uiw/react-markdown-preview").then((mod) => mod.default),
  { ssr: false }
)

const QUICK_PROMPT = "请分析当前大纲的一致性问题，并给出修改与扩写建议。"
const QUICK_ACTIONS = [
  "帮我检查主线冲突是否清晰，并指出节奏薄弱处。",
  "请检查设定冲突、人物动机断裂和时间线问题。",
  "如果要增强悬念和推进感，优先建议修改哪些节点？",
]

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
  const [historySidebarOpen, setHistorySidebarOpen] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messageItemRefs = useRef(new Map<number, HTMLDivElement>())

  const canSend = Boolean(input.trim()) && !isStreaming && currentProject
  const selectedProfile = currentProject?.analysis_profile ?? "auto"
  const currentProjectId = currentProject?.id ?? null

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
    if (!scrollRef.current) {
      return
    }
    const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]")
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" })
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
  const historyItems = useMemo(
    () =>
      orderedMessages
        .map((message, index) => ({ ...message, index }))
        .filter((message) => message.role === "user"),
    [orderedMessages]
  )

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
    if (!currentProjectId) {
      setMessages([])
      return
    }
    const controller = new AbortController()
    getAnalysisHistory(currentProjectId, { signal: controller.signal })
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
        console.warn("Analysis history load failed", err)
      })
    return () => controller.abort()
  }, [currentProjectId])

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom()
    }
  }, [messages])

  const scrollToMessage = (index: number) => {
    const target = messageItemRefs.current.get(index)
    if (!target) {
      return
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" })
    setMobileHistoryOpen(false)
  }

  if (!currentProject) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Search className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">请先选择一个项目</h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            选择项目后，这里会展示历史分析记录、快捷提问入口以及适合当前篇幅的分析配置。
          </p>
          <Button asChild className="mt-8 rounded-full px-8">
            <Link href="/">返回主页</Link>
          </Button>
        </div>
      </div>
    )
  }

  const historySidebarContent = (
    <div className="flex h-full flex-col bg-muted/10">
      <div className="flex flex-col gap-4 p-5 border-b border-border/40 shrink-0">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-fit">
          <ChevronLeft size={16} />
          返回主页
        </Link>
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-lg truncate tracking-tight text-foreground" title={currentProject.title}>
            {currentProject.title || "未命名项目"}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <Button asChild variant="secondary" size="sm" className="h-8 flex-1 justify-center rounded-lg text-xs bg-background hover:bg-muted shadow-sm border border-border/40">
              <Link href={`/projects/${currentProject.id}/writing`}>
                <PenTool className="h-3.5 w-3.5 mr-2" />
                写作
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className="h-8 flex-1 justify-center rounded-lg text-xs bg-background hover:bg-muted shadow-sm border border-border/40">
              <Link href={`/projects/${currentProject.id}/relations`}>
                <Network className="h-3.5 w-3.5 mr-2" />
                关系图
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 py-5">
        <div className="space-y-8">
          <div>
            <div className="px-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Zap size={13} className="text-amber-500/80" /> 快捷提问
            </div>
            <div className="space-y-1">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  onClick={() => {
                    sendMessage(action)
                    setMobileHistoryOpen(false)
                  }}
                  disabled={isStreaming}
                  className="w-full text-left p-2.5 rounded-xl text-[13px] text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group border border-transparent hover:border-border/50"
                >
                  <div className="line-clamp-2 leading-relaxed group-hover:line-clamp-none transition-all">{action}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="px-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <History size={13} className="text-blue-500/80" /> 历史记录
            </div>
            {historyItems.length === 0 ? (
              <div className="px-2 py-6 text-[13px] text-muted-foreground/50 text-center">
                暂无历史对话
              </div>
            ) : (
              <div className="space-y-1">
                {historyItems.map((item, itemIndex) => (
                  <button
                    key={item.index}
                    onClick={() => scrollToMessage(item.index)}
                    className="w-full text-left p-2.5 rounded-xl text-[13px] text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-all group flex flex-col gap-1.5 border border-transparent hover:border-border/50"
                  >
                    <div className="font-medium text-foreground/70 flex justify-between text-[11px] uppercase tracking-wider">
                      <span>问题 {itemIndex + 1}</span>
                    </div>
                    <div className="line-clamp-2 leading-relaxed">{item.content}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
        {/* Sidebar - Desktop */}
        <aside className={cn(
          "hidden lg:flex flex-col border-r border-border/40 transition-all duration-300 ease-in-out shrink-0 bg-muted/10 relative z-20",
          historySidebarOpen ? "w-[280px] xl:w-[320px]" : "w-0 opacity-0 overflow-hidden border-r-0"
        )}>
          {historySidebarContent}
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 bg-background relative z-10">
          {/* Header */}
          <header className="h-14 flex items-center justify-between px-3 sm:px-5 border-b border-border/40 bg-background/95 backdrop-blur absolute top-0 left-0 right-0 z-10 shrink-0">
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setMobileHistoryOpen(true)}
              >
                <PanelLeftOpen size={16} />
              </Button>
              {!historySidebarOpen && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hidden lg:flex h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                  onClick={() => setHistorySidebarOpen(true)}
                >
                  <PanelLeftOpen size={16} />
                </Button>
              )}
              <div className="flex items-center gap-2 px-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm tracking-wide">大纲分析</span>
                {isStreaming && (
                  <span className="relative flex h-2 w-2 ml-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-3">
              <div className="hidden sm:flex items-center gap-2 pr-2 border-r border-border/40">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">模式</div>
                <select
                  className="h-7 rounded-md border border-border/50 bg-muted/30 px-2 py-0 text-xs outline-none focus:ring-1 focus:ring-primary/30 transition-all hover:bg-muted/50 disabled:opacity-50 cursor-pointer"
                  value={selectedProfile}
                  onChange={(event) =>
                    handleProfileChange(
                      event.target.value as "auto" | "short" | "medium" | "long"
                    )
                  }
                  disabled={isStreaming}
                >
                  <option value="auto">自动配置</option>
                  <option value="short">全量分析</option>
                  <option value="medium">检索分析</option>
                  <option value="long">深度检索分析</option>
                </select>
              </div>
              
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={handleQuickAnalyze}
                      disabled={isStreaming}
                      className="h-8 w-8 rounded-lg text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                    >
                      <Zap size={15} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>一键分析</TooltipContent>
                </Tooltip>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setMessages([])}
                      disabled={isStreaming || messages.length === 0}
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>清空对话</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </header>

          {/* Chat Area */}
          <div className="flex-1 overflow-hidden pt-14">
            <ScrollArea ref={scrollRef} className="h-full w-full">
              <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12 min-h-full flex flex-col">
                {orderedMessages.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center text-center px-4 animate-in fade-in duration-700 pb-20">
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-sm ring-1 ring-primary/20">
                      <Sparkles size={28} />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground tracking-tight">AI 剧情分析助手</h3>
                    <p className="mt-3 max-w-md text-[15px] text-muted-foreground leading-relaxed">
                      我可以帮你检查剧情逻辑、寻找设定冲突、评估节奏断点，或者给出更具体的扩写与调整建议。
                    </p>
                    <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
                      {QUICK_ACTIONS.slice(0, 2).map((action) => (
                        <button
                          key={action}
                          onClick={() => sendMessage(action)}
                          className="p-4 text-left rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm hover:bg-primary/5 hover:border-primary/30 transition-all text-sm text-muted-foreground hover:text-foreground shadow-sm group"
                        >
                          <MessageSquare className="h-4 w-4 mb-2.5 text-primary/60 group-hover:text-primary transition-colors" />
                          <span className="leading-relaxed">{action}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8 pb-4">
                    {orderedMessages.map((message, index) => (
                      <div
                        key={index}
                        ref={(node) => {
                          if (node) {
                            messageItemRefs.current.set(index, node)
                          } else {
                            messageItemRefs.current.delete(index)
                          }
                        }}
                        className={cn(
                          "flex w-full gap-4 sm:gap-5 animate-in slide-in-from-bottom-2 fade-in duration-300",
                          message.role === "user" ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        <div className="flex-shrink-0 mt-1">
                          {message.role === "user" ? (
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary ring-1 ring-primary/20 shadow-sm">
                              <User size={15} />
                            </div>
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 ring-1 ring-blue-500/20 shadow-sm">
                              <Bot size={15} />
                            </div>
                          )}
                        </div>
                        
                        <div
                          className={cn(
                            "flex flex-col gap-1.5 min-w-0 max-w-[85%] sm:max-w-[75%]",
                            message.role === "user" ? "items-end" : "items-start"
                          )}
                        >
                          <div className="text-[11px] font-medium text-muted-foreground px-1 uppercase tracking-wider">
                            {message.role === "user" ? "你" : "分析助手"}
                          </div>
                          <div
                            className={cn(
                              "rounded-2xl px-5 py-4 text-[15px] leading-relaxed shadow-sm",
                              message.role === "user"
                                ? "bg-primary text-primary-foreground rounded-tr-sm"
                                : "bg-card border border-border/50 text-card-foreground rounded-tl-sm"
                            )}
                          >
                            {message.role === "assistant" ? (
                              <div className="markdown-preview-reset">
                                <MarkdownPreview
                                  source={normalizeMarkdown(
                                    stripFencedCodeBlocks(
                                      message.content || (isStreaming ? "正在思考..." : "")
                                    )
                                  )}
                                  style={{
                                    backgroundColor: "transparent",
                                    color: "inherit",
                                    fontSize: "inherit",
                                  }}
                                  wrapperElement={{ "data-color-mode": colorMode }}
                                />
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap">{message.content}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Input Area */}
          <div className="p-3 sm:p-5 bg-background/95 backdrop-blur border-t border-border/40 shrink-0 relative z-20">
            <div className="mx-auto w-full max-w-3xl relative">
              {error ? (
                <div className="absolute -top-12 left-0 right-0 flex justify-center animate-in slide-in-from-bottom-2 fade-in">
                  <div className="rounded-full border border-destructive/20 bg-destructive/10 px-4 py-1.5 text-[13px] text-destructive shadow-sm backdrop-blur">
                    {error}
                  </div>
                </div>
              ) : null}
              
              <div className="relative rounded-2xl border border-border/60 bg-muted/20 shadow-sm transition-all focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 focus-within:bg-background">
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault()
                      if (canSend) sendMessage(input.trim())
                    }
                  }}
                  placeholder="输入关于剧情的问题，例如：这段剧情的反派动机是否合理？ (Shift + Enter 换行)"
                  rows={1}
                  className="min-h-[64px] max-h-[240px] w-full resize-none border-0 bg-transparent px-4 py-4 pr-16 text-[15px] focus-visible:ring-0 placeholder:text-muted-foreground/50 leading-relaxed"
                  style={{ height: "auto", overflow: "hidden" }}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                  {isStreaming ? (
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      className="h-8 w-8 rounded-xl shadow-sm"
                      onClick={() => abortRef.current?.abort()}
                    >
                      <Square size={14} fill="currentColor" />
                    </Button>
                  ) : (
                    <Button
                      size="icon-sm"
                      className="h-8 w-8 rounded-xl shadow-sm transition-all"
                      disabled={!canSend}
                      onClick={() => sendMessage(input.trim())}
                    >
                      <Send size={14} className={cn("transition-transform", canSend && "translate-x-0.5 -translate-y-0.5")} />
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-3 text-center text-[11px] text-muted-foreground/50 flex items-center justify-center gap-1.5">
                <Sparkles size={11} className="text-muted-foreground/40" /> AI 生成内容仅供参考，请结合实际创作调整
              </div>
            </div>
          </div>
        </main>

        {/* Mobile Drawer */}
        <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
          <SheetContent side="left" className="w-[85vw] max-w-sm p-0 flex flex-col border-r-border/40">
            <div className="p-4 border-b border-border/40 shrink-0">
              <SheetTitle className="text-lg">历史侧栏</SheetTitle>
              <SheetDescription className="mt-1 text-xs">查看过往提问，并一键跳回对应位置继续分析。</SheetDescription>
            </div>
            <div className="flex-1 overflow-hidden">{historySidebarContent}</div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  )
}
