"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { IndexSnapshot, SnapshotType, VersionDiff as VersionDiffModel } from "@/src/types/models"
import {
  compareVersions,
  createVersion,
  deleteVersion,
  getVersionSnapshot,
  listVersions,
  restoreVersion,
} from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"
import { VersionDiff } from "@/components/version-diff"

type VersionHistoryProps = {
  open: boolean
  onClose: () => void
}

const TYPE_STYLES: Record<SnapshotType, string> = {
  auto: "bg-muted text-muted-foreground",
  manual: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  milestone: "bg-muted text-muted-foreground",
  pre_sync: "bg-muted text-muted-foreground",
}

const TYPE_LABELS: Record<SnapshotType, string> = {
  auto: "历史快照",
  manual: "手动快照",
  milestone: "历史快照",
  pre_sync: "历史快照",
}

export function VersionHistory({ open, onClose }: VersionHistoryProps) {
  const { currentProject, setError, replaceProject } = useProjectStore()
  const [versions, setVersions] = useState<Array<{
    version: number
    snapshot_type: SnapshotType
    name: string | null
    description: string | null
    node_count: number
    words_added?: number
    words_removed?: number
    created_at: string
  }>>([])
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [selectedVersions, setSelectedVersions] = useState<Set<number>>(new Set())
  const selectAllRef = useRef<HTMLInputElement | null>(null)
  const [snapshotCache, setSnapshotCache] = useState<Record<number, IndexSnapshot>>({})
  const [diff, setDiff] = useState<VersionDiffModel | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadVersions = useCallback(async () => {
    if (!currentProject) {
      return
    }
    setIsLoading(true)
    try {
      const list = await listVersions(currentProject.id)
      setVersions(
        list.map((item) => ({
          version: item.version,
          snapshot_type: item.snapshot_type as SnapshotType,
          name: item.name,
          description: item.description ?? null,
          node_count: item.node_count,
          created_at: item.created_at,
        }))
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载版本失败"
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [currentProject, setError])

  useEffect(() => {
    if (open) {
      loadVersions()
    }
  }, [loadVersions, open])

  useEffect(() => {
    if (!open) {
      setDiff(null)
      setSelectedVersion(null)
      setBaseVersion(null)
      setSelectedVersions(new Set())
    }
  }, [open])

  const handleSelect = useCallback(
    async (version: number) => {
      if (!currentProject) {
        return
      }
      try {
        setSelectedVersion(version)
        const list = versions
          .map((item) => item.version)
          .sort((a, b) => a - b)
        const base = list.find((item) => item < version) ?? list[0] ?? version
        setBaseVersion(base)

        const snapshot = snapshotCache[version]
        const baseSnapshot = snapshotCache[base]
        if (!snapshot) {
          const loaded = await getVersionSnapshot(currentProject.id, version)
          setSnapshotCache((prev) => ({ ...prev, [version]: loaded }))
        }
        if (!baseSnapshot) {
          const loaded = await getVersionSnapshot(currentProject.id, base)
          setSnapshotCache((prev) => ({ ...prev, [base]: loaded }))
        }
        const computed = await compareVersions(currentProject.id, base, version)
        setDiff(computed)
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载版本差异失败"
        setError(message)
      }
    },
    [currentProject, setError, snapshotCache, versions]
  )

  const selectedSnapshot = selectedVersion ? snapshotCache[selectedVersion] ?? null : null
  const baseSnapshot = baseVersion ? snapshotCache[baseVersion] ?? null : null

  const visibleVersions = useMemo(() => versions.map((item) => item.version), [versions])
  const allSelected = visibleVersions.length > 0 && visibleVersions.every((v) => selectedVersions.has(v))
  const someSelected = visibleVersions.some((v) => selectedVersions.has(v)) && !allSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected
    }
  }, [someSelected])

  const handleCreateSnapshot = async () => {
    if (!currentProject) {
      return
    }
    const name = window.prompt("快照名称", "手动快照")
    if (name === null) {
      return
    }
    try {
      await createVersion(currentProject.id, { name })
      loadVersions()
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建快照失败"
      setError(message)
    }
  }

  const handleRestore = async () => {
    if (!currentProject || selectedVersion === null) {
      return
    }
    const confirmed = window.confirm(`确认恢复到版本 v${selectedVersion} 吗？`)
    if (!confirmed) {
      return
    }
    try {
      const restored = await restoreVersion(currentProject.id, selectedVersion)
      replaceProject(restored)
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复版本失败"
      setError(message)
    }
  }

  const handleDelete = async () => {
    if (!currentProject || selectedVersion === null) {
      return
    }
    const confirmed = window.confirm(`确认删除版本 v${selectedVersion} 吗？`)
    if (!confirmed) {
      return
    }
    try {
      await deleteVersion(currentProject.id, selectedVersion)
      setSelectedVersion(null)
      setDiff(null)
      loadVersions()
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除版本失败"
      setError(message)
    }
  }

  const toggleBatchSelection = (version: number) => {
    setSelectedVersions((prev) => {
      const next = new Set(prev)
      if (next.has(version)) {
        next.delete(version)
      } else {
        next.add(version)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedVersions((prev) => {
      if (allSelected) {
        return new Set()
      }
      return new Set(visibleVersions)
    })
  }

  const handleBulkDelete = async () => {
    if (!currentProject || selectedVersions.size === 0) {
      return
    }
    const confirmed = window.confirm(`确认删除选中的 ${selectedVersions.size} 个版本吗？`)
    if (!confirmed) {
      return
    }
    try {
      await Promise.all(
        Array.from(selectedVersions).map((version) => deleteVersion(currentProject.id, version))
      )
      if (selectedVersion && selectedVersions.has(selectedVersion)) {
        setSelectedVersion(null)
        setBaseVersion(null)
        setDiff(null)
      }
      setSelectedVersions(new Set())
      loadVersions()
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除版本失败"
      setError(message)
    }
  }

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-[880px] max-w-[95vw] bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">版本历史</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleCreateSnapshot}>
              创建快照
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
        <div className="grid h-[calc(100%-56px)] gap-4 p-4 lg:grid-cols-[300px_1fr]">
          <div className="flex flex-col overflow-hidden rounded-xl border bg-background">
            <div className="flex items-center justify-between border-b px-4 py-3 text-xs font-semibold text-muted-foreground">
              <div className="flex items-center gap-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="accent-foreground"
                  checked={allSelected}
                  onChange={handleSelectAll}
                />
                版本列表
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleBulkDelete}
                disabled={selectedVersions.size === 0}
              >
                批量删除
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="px-4 py-6 text-xs text-muted-foreground">
                  加载中...
                </div>
              ) : versions.length === 0 ? (
                <div className="px-4 py-6 text-xs text-muted-foreground">
                  暂无版本快照
                </div>
              ) : (
                <div className="divide-y">
                  {versions.map((item) => (
                    <button
                      key={item.version}
                      type="button"
                      className={`w-full px-4 py-3 text-left ${
                        selectedVersion === item.version ? "bg-accent/50" : ""
                      }`}
                      onClick={() => handleSelect(item.version)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="accent-foreground"
                            checked={selectedVersions.has(item.version)}
                            onChange={() => toggleBatchSelection(item.version)}
                            onClick={(event) => event.stopPropagation()}
                          />
                          <div className="text-sm font-semibold">
                            v{item.version} {item.name ?? ""}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${TYPE_STYLES[item.snapshot_type]}`}>
                          {TYPE_LABELS[item.snapshot_type]}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        节点：{item.node_count}｜字数变化：
                        {item.words_added != null || item.words_removed != null
                          ? `+${item.words_added ?? 0} / -${item.words_removed ?? 0}`
                          : "--"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-xs">
              <div>
                {selectedVersion ? (
                  <>
                    <span className="font-semibold">选中版本：</span>
                    v{selectedVersion}
                  </>
                ) : (
                  <span className="text-muted-foreground">请选择一个版本</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleRestore} disabled={!selectedVersion}>
                  恢复到此版本
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDelete} disabled={!selectedVersion}>
                  删除
                </Button>
              </div>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 text-xs text-muted-foreground">
              当前版本系统只保留手动快照。旧项目中的自动、预同步和里程碑快照都会作为历史快照兼容显示。
            </div>
            <div className="flex-1 overflow-y-auto">
              <VersionDiff base={baseSnapshot} target={selectedSnapshot} diff={diff} />
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
