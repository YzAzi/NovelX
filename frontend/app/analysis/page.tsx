"use client"

import { useMemo, useRef, useState } from "react"

import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type ChatMessage = { role: "user" | "assistant"; content: string }

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const QUICK_PROMPT = "请分析当前大纲的一致性问题，并给出修改与扩写建议。"

export default function OutlineAnalysisPage() {
  const { currentProject } = useProjectStore()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)

  const canSend = Boolean(input.trim()) && !isStreaming && currentProject

  const scrollToBottom = () => {
    const target = outputRef.current
    if (!target) {
      return
    }
    target.scrollTo({ top: target.scrollHeight, behavior: "smooth" })
  }

  const sendMessage = async (content: string) => {
    if (!currentProject || isStreaming) {
      return
    }
    const userMessage: ChatMessage = { role: "user", content }
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
      const response = await fetch(`${BASE_URL}/api/outline_analysis_stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: currentProject.id,
          messages: nextMessages,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
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
              dataLines.push(line.replace("data:", ""))
            }
          }
          const data = dataLines.join("\n")
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

  if (!currentProject) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8">
        <div className="surface-card flex flex-1 items-center justify-center text-sm text-muted-foreground">
          请先在大纲视图中选择一个项目。
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-8">
      <div className="surface-card flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">分析大纲</div>
            <div className="text-xs text-slate-500">
              项目：{currentProject.title}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleQuickAnalyze} disabled={isStreaming}>
              分析当前大纲
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMessages([])}
              disabled={isStreaming || messages.length === 0}
            >
              清空对话
            </Button>
          </div>
        </div>
        <div ref={outputRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {orderedMessages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200/70 bg-white/60 px-4 py-6 text-sm text-slate-500">
              请输入你的需求，例如“帮我检查时间线冲突并给出修正建议”。
            </div>
          ) : (
            orderedMessages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[78%] rounded-2xl bg-sky-500/10 px-4 py-3 text-sm text-slate-800 shadow-sm"
                    : "mr-auto max-w-[82%] rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm"
                }
              >
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  {message.role === "user" ? "你" : "分析师"}
                </div>
                <div className="mt-1 whitespace-pre-wrap leading-relaxed">
                  {message.content || (isStreaming && message.role === "assistant" ? "分析中..." : "")}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-white/60 px-6 py-4">
          <div className="flex flex-col gap-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="描述你希望分析的重点或修改意图..."
              rows={3}
            />
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {isStreaming ? "分析中，内容将持续输出..." : "支持多轮对话。"}
              </div>
              <div className="flex items-center gap-2">
                {isStreaming ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => abortRef.current?.abort()}
                  >
                    停止输出
                  </Button>
                ) : null}
                <Button onClick={() => sendMessage(input.trim())} disabled={!canSend}>
                  发送
                </Button>
              </div>
            </div>
            {error ? (
              <div className="rounded-lg border border-red-200/70 bg-red-50/70 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
