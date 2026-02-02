"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"

import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

import type { WorldDocument } from "@/src/types/models"
import { Button } from "@/components/ui/button"

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false })

type KnowledgeEditorProps = {
  doc: WorldDocument | null
  onSave: (content: string) => Promise<void>
}

export function KnowledgeEditor({ doc, onSave }: KnowledgeEditorProps) {
  const [value, setValue] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [colorMode, setColorMode] = useState<"light" | "dark">("light")

  useEffect(() => {
    setValue(doc?.content ?? "")
  }, [doc?.id])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    const updateMode = () => {
      const isDark = document.documentElement.classList.contains("dark")
      setColorMode(isDark ? "dark" : "light")
    }
    updateMode()

    const observer = new MutationObserver(updateMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener?.("change", updateMode)

    return () => {
      observer.disconnect()
      media.removeEventListener?.("change", updateMode)
    }
  }, [])

  const title = doc?.title ?? "未选择文档"
  const category = doc?.category ?? "--"

  const preview = useMemo(() => {
    return value.trim() ? null : (
      <div className="rounded-md border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
        请输入或编辑世界观内容，右侧将实时预览。
      </div>
    )
  }, [value])

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-background text-sm text-muted-foreground">
        选择左侧文档开始编辑
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">分类：{category}</div>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-border bg-card p-4">
        <div data-color-mode={colorMode} className="h-full">
          <MDEditor
            height={520}
            value={value}
            onChange={(val) => setValue(val ?? "")}
            hideToolbar
            preview="edit"
            visibleDragbar={false}
          />
        </div>
        {preview}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={async () => {
            setIsSaving(true)
            try {
              await onSave(value)
            } finally {
              setIsSaving(false)
            }
          }}
          disabled={isSaving}
        >
          {isSaving ? "保存中..." : "保存并分块"}
        </Button>
      </div>
    </div>
  )
}
