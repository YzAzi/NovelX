"use client"

import { useCallback, useState, type DragEvent } from "react"

import { importWorldKnowledge, uploadWorldKnowledgeFile } from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"

type PreviewItem = {
  file: File
  sections: string[]
}

type KnowledgeUploadProps = {
  onUploaded: () => void
}

function parseMarkdownSections(text: string) {
  const lines = text.split("\n")
  const sections: string[] = []
  lines.forEach((line) => {
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim()
      sections.push(title || "未命名标题")
    }
  })
  return sections
}

export function KnowledgeUpload({ onUploaded }: KnowledgeUploadProps) {
  const { currentProject } = useProjectStore()
  const [previews, setPreviews] = useState<PreviewItem[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) {
      return
    }
    const next: PreviewItem[] = []
    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".md") && !file.name.endsWith(".txt")) {
        continue
      }
      if (file.name.endsWith(".md")) {
        const text = await file.text()
        next.push({ file, sections: parseMarkdownSections(text) })
      } else {
        next.push({ file, sections: [] })
      }
    }
    setPreviews(next)
  }, [])

  const handleUpload = async () => {
    if (!currentProject || previews.length === 0) {
      return
    }
    setIsUploading(true)
    try {
      for (const preview of previews) {
        if (preview.file.name.endsWith(".md")) {
          const text = await preview.file.text()
          await importWorldKnowledge(currentProject.id, {
            markdown_content: text,
          })
        } else {
          await uploadWorldKnowledgeFile(currentProject.id, preview.file)
        }
      }
      setPreviews([])
      onUploaded()
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    handleFiles(event.dataTransfer.files)
  }

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold text-foreground">上传文档</div>
      <label
        className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 px-4 py-6 text-xs text-muted-foreground transition-colors hover:border-primary/50"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          type="file"
          accept=".md,.txt"
          multiple
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <span>拖拽文件到此处或点击选择</span>
        <span className="text-[11px]">支持 .md / .txt</span>
      </label>
      {previews.length > 0 ? (
        <div className="mt-4 space-y-3">
          {previews.map((preview) => (
            <div
              key={preview.file.name}
              className="rounded-md border border-dashed border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground"
            >
              <div className="font-semibold text-foreground">{preview.file.name}</div>
              {preview.sections.length > 0 ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  解析到 {preview.sections.length} 个标题：
                  <div className="mt-1 flex flex-wrap gap-1">
                    {preview.sections.slice(0, 6).map((title) => (
                      <span
                        key={title}
                        className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-foreground"
                      >
                        {title}
                      </span>
                    ))}
                    {preview.sections.length > 6 ? (
                      <span className="text-[11px] text-muted-foreground">
                        +{preview.sections.length - 6}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  纯文本文件，将作为单文档导入。
                </div>
              )}
            </div>
          ))}
          <Button size="sm" onClick={handleUpload} disabled={isUploading}>
            {isUploading ? "导入中..." : "开始导入"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
