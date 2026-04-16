"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import {
  ChevronLeft,
  History,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
      <div className="app-backdrop flex h-screen w-full items-center justify-center px-4">
        <div className="panel-shell-strong w-full max-w-lg p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[22px] bg-primary/10 text-primary">
            <Search className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">请先选择一个项目</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            选择项目后，这里会展示历史分析记录、快捷提问入口以及适合当前篇幅的分析配置。
          </p>
          <Button asChild variant="outline" className="mt-5 rounded-xl">
            <Link href="/">返回主页</Link>
          </Button>
        </div>
      </div>
    )
  }

  const historySidebarContent = (
    <>
      <div className="border-b border-border/60 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">会话历史</div>
            <div className="mt-1 text-sm text-muted-foreground">
              快速跳到此前的提问位置，继续追问同一问题。
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden rounded-xl lg:inline-flex"
            onClick={() => setHistorySidebarOpen(false)}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border-b border-border/60 p-4">
        <div className="space-y-3">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action}
              onClick={() => {
                sendMessage(action)
                setMobileHistoryOpen(false)
              }}
              disabled={isStreaming}
              className="w-full rounded-[22px] border border-border/70 bg-background/70 px-4 py-4 text-left transition hover:border-primary/30 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{action}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    直接发给分析助手，生成针对当前项目的结构建议。
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-4 py-4">
        {historyItems.length === 0 ? (
          <div className="empty-state-panel px-4 py-6">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <History className="h-4 w-4" />
            </div>
            <div className="text-sm font-medium text-foreground">还没有历史问题</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              发送第一条分析请求后，这里会按顺序记录你的提问。
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {historyItems.map((item, itemIndex) => (
              <button
                key={item.index}
                onClick={() => scrollToMessage(item.index)}
                className="w-full rounded-2xl border border-border/70 bg-background/75 px-3 py-3 text-left transition hover:border-primary/30 hover:bg-primary/5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    问题 {itemIndex + 1}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    第 {item.index + 1} 条
                  </div>
                </div>
                <div className="mt-2 line-clamp-3 text-sm leading-6 text-foreground">
                  {item.content}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-border/60 px-4 py-4">
        <div className="rounded-[22px] border border-border/70 bg-[linear-gradient(135deg,rgba(77,102,177,0.08),rgba(223,191,144,0.12))] p-4">
          <div className="text-sm font-semibold text-foreground">使用建议</div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            先做一次全局一致性检查，再点历史问题回跳，继续追问局部修改方案。
          </div>
        </div>
      </div>
    </>
  )

  return (
    <div className="app-backdrop flex h-screen w-full flex-col overflow-hidden text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        <header className="panel-shell px-4 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button asChild variant="ghost" size="icon-sm" className="rounded-xl">
                    <Link href="/" title="返回主页">
                      <ChevronLeft size={16} />
                    </Link>
                  </Button>
                  <div className="status-pill">
                    <Sparkles className="h-3.5 w-3.5 text-primary/80" />
                    大纲深度分析
                  </div>
                </div>
                <div>
                  <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
                    {currentProject.title || "未命名项目"}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    用对话式分析快速检查剧情逻辑、设定冲突、人物动机与扩写方向，并根据篇幅切换更合适的分析模式。
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl lg:hidden"
                  onClick={() => setMobileHistoryOpen(true)}
                >
                  <History className="h-4 w-4" />
                  历史
                </Button>
                <Button asChild variant="outline" size="sm" className="rounded-xl">
                  <Link href={`/projects/${currentProject.id}/writing`}>
                    <PenTool className="h-4 w-4" />
                    写作
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="rounded-xl">
                  <Link href={`/projects/${currentProject.id}/relations`}>
                    <Network className="h-4 w-4" />
                    关系图
                  </Link>
                </Button>
                <select
                  className="form-select h-9"
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
                  size="sm"
                  onClick={handleQuickAnalyze}
                  disabled={isStreaming}
                  className="rounded-xl"
                >
                  <Sparkles className="h-4 w-4" />
                  一键分析
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setMessages([])}
                  disabled={isStreaming || messages.length === 0}
                  className="rounded-xl text-muted-foreground hover:text-destructive"
                  title="清空对话"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[24px] border border-border/70 bg-background/70 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  分析模式
                </div>
                <div className="mt-2 text-xl font-semibold text-foreground">
                  {selectedProfile === "auto"
                    ? "自动"
                    : selectedProfile === "short"
                      ? "短篇"
                      : selectedProfile === "medium"
                        ? "中篇"
                        : "长篇"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  自动匹配全量分析或 RAG 模式
                </div>
              </div>
              <div className="rounded-[24px] border border-border/70 bg-background/70 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  历史记录
                </div>
                <div className="mt-2 text-xl font-semibold text-foreground">{messages.length}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  已保存的对话轮次会在这里继续衔接
                </div>
              </div>
              <div className="rounded-[24px] border border-border/70 bg-background/70 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  当前状态
                </div>
                <div className="mt-2 text-xl font-semibold text-foreground">
                  {isStreaming ? "分析中" : "待命"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {isStreaming ? "正在持续生成建议，请稍候" : "可以继续追问细节或索要改写方案"}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 gap-3">
          {historySidebarOpen ? (
            <aside className="panel-shell hidden min-h-0 w-[340px] shrink-0 flex-col overflow-hidden lg:flex">
              {historySidebarContent}
            </aside>
          ) : (
            <aside className="panel-shell hidden min-h-0 w-[92px] shrink-0 items-center justify-center lg:flex">
              <Button
                variant="ghost"
                size="icon-lg"
                className="rounded-2xl"
                onClick={() => setHistorySidebarOpen(true)}
              >
                <PanelLeftOpen className="h-5 w-5" />
              </Button>
            </aside>
          )}

          <section className="panel-shell-strong flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-border/60 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">分析对话区</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    支持连续追问，适合逐步拆解剧情漏洞、角色动机和扩写策略。
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hidden rounded-xl lg:inline-flex"
                  onClick={() => setHistorySidebarOpen((prev) => !prev)}
                >
                  {historySidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.5),rgba(248,243,235,0.7))]">
              <ScrollArea ref={scrollRef} className="h-full w-full">
                <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-6 sm:py-8">
                  {orderedMessages.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[22px] bg-primary/10 text-primary">
                        <Sparkles size={24} />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">AI 大纲分析助手</h3>
                      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                        我可以帮你检查剧情逻辑、寻找设定冲突、评估节奏断点，或者给出更具体的扩写与调整建议。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
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
                            "flex w-full",
                            message.role === "user" ? "justify-end" : "justify-start"
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[92%] rounded-[24px] px-5 py-4 text-sm leading-7 shadow-sm sm:max-w-[80%]",
                              message.role === "user"
                                ? "rounded-br-md bg-primary text-primary-foreground"
                                : "rounded-bl-md border border-border/70 bg-background/85 text-card-foreground"
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
                      ))}
                    </div>
                  )}
                  <div className="h-4" />
                </div>
              </ScrollArea>
            </div>

            <div className="border-t border-border/60 bg-background/88 px-4 py-4 backdrop-blur">
              <div className="mx-auto w-full max-w-4xl">
                <div className="relative rounded-[28px] border border-border bg-background/80 p-3 shadow-sm transition-all focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        if (canSend) sendMessage(input.trim())
                      }
                    }}
                    placeholder="输入你的问题，Shift + Enter 换行..."
                    rows={1}
                    className="min-h-[88px] max-h-[220px] w-full resize-none border-0 bg-transparent px-2 py-2 pr-14 text-sm focus-visible:ring-0 placeholder:text-muted-foreground/50"
                    style={{ height: "auto", overflow: "hidden" }}
                  />
                  <div className="absolute bottom-3 right-3 flex items-center gap-2">
                    {isStreaming ? (
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        className="rounded-xl"
                        onClick={() => abortRef.current?.abort()}
                      >
                        <Square size={14} fill="currentColor" />
                      </Button>
                    ) : (
                      <Button
                        size="icon-sm"
                        className="rounded-xl"
                        disabled={!canSend}
                        onClick={() => sendMessage(input.trim())}
                      >
                        <Send size={16} />
                      </Button>
                    )}
                  </div>
                </div>
                {error ? (
                  <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                    {error}
                  </div>
                ) : null}
                <div className="mt-2 text-center text-[11px] text-muted-foreground/70">
                  AI 内容仅供参考，请核对重要信息。
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-none p-0 sm:max-w-md lg:hidden">
          <SheetHeader className="border-b border-border/60">
            <SheetTitle>历史侧栏</SheetTitle>
            <SheetDescription>查看过往提问，并一键跳回对应位置继续分析。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{historySidebarContent}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
