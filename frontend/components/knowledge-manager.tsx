"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type { SearchResult, WorldDocument, WorldKnowledgeBase } from "@/src/types/models"
import {
  deleteWorldDocument,
  getProjectStats,
  getWorldKnowledgeBase,
  searchWorldKnowledge,
} from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type KnowledgeManagerProps = {
  onSelectDocument: (doc: WorldDocument | null) => void
  selectedDocumentId: string | null
  refreshSignal: number
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value)
}

function highlightText(text: string, query: string) {
  if (!query.trim()) {
    return text
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "gi"))
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={index} className="rounded bg-primary/10 px-1 text-primary">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

export function KnowledgeManager({
  onSelectDocument,
  selectedDocumentId,
  refreshSignal,
}: KnowledgeManagerProps) {
  const { currentProject } = useProjectStore()
  const [knowledgeBase, setKnowledgeBase] = useState<WorldKnowledgeBase | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({})
  const [stats, setStats] = useState<{
    total_words: number
    total_knowledge_docs: number
    total_chunks: number
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  const loadKnowledge = useCallback(async () => {
    if (!currentProject) {
      setKnowledgeBase(null)
      setSearchResults(null)
      setStats(null)
      return
    }
    setIsLoading(true)
    try {
      const [base, projectStats] = await Promise.all([
        getWorldKnowledgeBase(currentProject.id),
        getProjectStats(currentProject.id),
      ])
      setKnowledgeBase(base)
      setStats({
        total_words: projectStats.total_words,
        total_knowledge_docs: projectStats.total_knowledge_docs,
        total_chunks: base.total_chunks,
      })
    } finally {
      setIsLoading(false)
    }
  }, [currentProject])

  useEffect(() => {
    loadKnowledge()
  }, [loadKnowledge, refreshSignal])

  const handleSearch = useCallback(async () => {
    if (!currentProject) {
      return
    }
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    setIsSearching(true)
    try {
      const results = await searchWorldKnowledge(currentProject.id, {
        query: searchQuery,
      })
      setSearchResults(results)
    } finally {
      setIsSearching(false)
    }
  }, [currentProject, searchQuery])

  const docs = knowledgeBase?.documents ?? []
  const sortedDocs = useMemo(() => {
    return [...docs].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  }, [docs])

  const handleDelete = async (doc: WorldDocument) => {
    if (!currentProject) {
      return
    }
    await deleteWorldDocument(currentProject.id, doc.id)
    if (selectedDocumentId === doc.id) {
      onSelectDocument(null)
    }
    loadKnowledge()
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Stats Summary */}
      <div className="rounded-xl bg-muted/30 p-4 border border-transparent hover:border-border/40 transition-colors">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">知识库概览</div>
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div>
            <div className="text-xl font-bold text-foreground font-mono">
              {stats ? formatNumber(stats.total_words) : "--"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">总字数</div>
          </div>
          <div>
            <div className="text-xl font-bold text-foreground font-mono">
              {stats ? formatNumber(stats.total_knowledge_docs) : "--"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">文档数</div>
          </div>
          <div>
            <div className="text-xl font-bold text-foreground font-mono">
              {stats ? formatNumber(stats.total_chunks) : "--"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">片段数</div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="rounded-xl bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索设定与资料..."
            className="h-9 border-transparent bg-background shadow-none focus-visible:ring-1 focus-visible:ring-primary/20"
          />
          <Button size="sm" variant="secondary" onClick={handleSearch} disabled={isSearching} className="h-9 px-3">
            {isSearching ? "..." : "搜索"}
          </Button>
        </div>
        {searchResults ? (
          <div className="mt-3 space-y-2">
            {searchResults.length === 0 ? (
              <div className="text-xs text-muted-foreground px-1">无结果</div>
            ) : (
              searchResults.map((result) => {
                const docId = (result.metadata as { document_id?: string })
                  ?.document_id
                const doc = sortedDocs.find((item) => item.id === docId) ?? null
                return (
                  <div
                    key={result.id}
                    className="rounded-lg bg-background p-3 text-xs text-muted-foreground shadow-sm ring-1 ring-border/50"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-medium text-foreground">
                        {doc?.title ?? "未知来源"}
                      </div>
                      {doc ? (
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline"
                          onClick={() => onSelectDocument(doc)}
                        >
                          跳转
                        </button>
                      ) : null}
                    </div>
                    <div className="line-clamp-2 leading-relaxed">{highlightText(result.content, searchQuery)}</div>
                  </div>
                )
              })
            )}
          </div>
        ) : null}
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-border/40 bg-card">
        <div className="sticky top-0 z-10 border-b border-border/40 bg-card/95 px-4 py-3 text-xs font-medium text-muted-foreground backdrop-blur-sm">
          文档列表
        </div>
        {isLoading ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">加载中...</div>
        ) : sortedDocs.length === 0 ? (
          <div className="px-4 py-12 text-center text-xs text-muted-foreground">
            暂无文档，请点击上方上传或新建。
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {sortedDocs.map((doc) => {
              const isExpanded = expandedDocs[doc.id]
              const isSelected = doc.id === selectedDocumentId
              return (
                <div key={doc.id} className="group relative">
                  <button
                    type="button"
                    className={`w-full rounded-md px-3 py-2.5 text-left transition-all duration-200 ${
                      isSelected
                        ? "bg-primary/5 text-primary"
                        : "text-foreground hover:bg-muted/60"
                    }`}
                    onClick={() => onSelectDocument(doc)}
                  >
                    <div className={`text-sm font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
                      {doc.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/70">
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                        {doc.category}
                      </span>
                      <span>{formatNumber(doc.content.length)} 字</span>
                    </div>
                  </button>
                  
                  {/* Hover Actions */}
                  <div className={`absolute right-2 top-2 hidden items-center gap-1 group-hover:flex ${isSelected ? "flex" : ""}`}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedDocs((prev) => ({
                          ...prev,
                          [doc.id]: !isExpanded,
                        }))
                      }}
                    >
                      <span className="text-[10px]">{isExpanded ? "▲" : "▼"}</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(doc);
                      }}
                    >
                      <span className="text-xs">×</span>
                    </Button>
                  </div>

                  {isExpanded ? (
                    <div className="mx-2 mb-2 mt-1 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground leading-relaxed border border-border/30">
                      {highlightText(doc.content.slice(0, 150) + (doc.content.length > 150 ? "..." : ""), searchQuery)}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
