"use client"

import { useEffect, useRef, useState } from "react"
import { Send, Sparkles, X, MessageSquareText, Eraser } from "lucide-react"
import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

export function ChatSidebar() {
  const { currentProject } = useProjectStore()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 当切换项目时，清空聊天记录（可选，也可以做持久化）
  useEffect(() => {
    setMessages([])
  }, [currentProject?.id])

  const handleSend = async () => {
    if (!input.trim() || !currentProject) return
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    }
    
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    // 准备发送给后端的上下文消息列表
    // 过滤掉 id，只保留 role 和 content
    const historyPayload = messages.concat(userMessage).map(m => ({
      role: m.role,
      content: m.content
    }))

    // 创建一个新的 AI 消息占位
    const assistantMessageId = (Date.now() + 1).toString()
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, role: "assistant", content: "" },
    ])

    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch("/api/outline_analysis_stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: currentProject.id,
          messages: historyPayload,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error("Failed to fetch response")
      }

      if (!response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let currentResponse = ""

      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        const chunkValue = decoder.decode(value, { stream: true })
        
        // 处理 SSE 格式数据
        // 格式通常是: "data: ...\n\n"
        const lines = chunkValue.split("\n")
        
        for (const line of lines) {
            if (line.startsWith("data: ")) {
                const data = line.slice(6)
                if (data === "[DONE]") {
                    continue
                }
                currentResponse += data
                
                // 更新最后一条消息的内容
                setMessages((prev) => 
                    prev.map((msg) => 
                        msg.id === assistantMessageId 
                            ? { ...msg, content: currentResponse } 
                            : msg
                    )
                )
            }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('Stream aborted')
      } else {
        console.error("Chat error:", error)
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: "assistant", content: "抱歉，遇到了一些错误，请稍后重试。" },
        ])
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleClear = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort()
    }
    setMessages([])
    setIsLoading(false)
  }

  if (!currentProject) return null

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-105 active:scale-95",
          isOpen 
            ? "bg-slate-100 text-slate-600 rotate-90" 
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        {isOpen ? <X size={24} /> : <MessageSquareText size={24} />}
      </button>

      {/* 聊天窗口 */}
      <div
        className={cn(
          "fixed bottom-24 right-6 z-40 flex flex-col overflow-hidden rounded-2xl border bg-white/95 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-in-out dark:bg-slate-900/95",
          isOpen
            ? "h-[600px] w-[400px] opacity-100 translate-y-0"
            : "pointer-events-none h-[60px] w-[60px] opacity-0 translate-y-10 scale-90"
        )}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b px-4 py-3 bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">灵感助手</span>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-slate-400 hover:text-slate-600"
            onClick={handleClear}
            title="清空对话"
          >
            <Eraser size={16} />
          </Button>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30 dark:bg-slate-900/30">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400 space-y-2">
              <Sparkles className="h-8 w-8 opacity-50" />
              <p className="text-sm">有什么关于这个故事的想法吗？<br/>我可以帮你检索设定、分析剧情。</p>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex w-max max-w-[85%] flex-col gap-1 rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                msg.role === "user"
                  ? "self-end bg-primary text-primary-foreground ml-auto rounded-tr-sm"
                  : "self-start bg-white border border-slate-100 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 rounded-tl-sm"
              )}
            >
              <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
             <div className="self-start bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                <div className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }}/>
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }}/>
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }}/>
                </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div className="p-4 border-t bg-white dark:bg-slate-900">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="问问关于设定的事..."
              className="flex-1 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
              disabled={isLoading}
            />
            <Button 
                type="submit" 
                size="icon" 
                disabled={isLoading || !input.trim()}
                className={cn("transition-transform active:scale-95", isLoading && "opacity-50")}
            >
              <Send size={18} />
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}
