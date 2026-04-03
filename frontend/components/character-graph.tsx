"use client"

import dynamic from "next/dynamic"
import type { CSSProperties } from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d"
import {
  ArrowUpRight,
  Crosshair,
  Link2,
  Network,
  PencilLine,
  Search,
  Sparkles,
  Tags,
  Trash2,
  Users,
} from "lucide-react"

import {
  createGraphEntity,
  createGraphRelation,
  deleteGraphRelation,
  formatUserErrorMessage,
  getCharacterGraph,
  syncCharacterGraph,
  updateGraphEntity,
  updateGraphRelation,
} from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import type {
  CharacterAppearance,
  CharacterGraphLink,
  CharacterGraphNode,
  CharacterGraphResponse,
} from "@/src/types/character-graph"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as typeof import("react-force-graph-2d").default

const RELATION_TYPES = [
  { value: "family", label: "亲属" },
  { value: "friend", label: "朋友" },
  { value: "lover", label: "恋人" },
  { value: "colleague", label: "同事" },
  { value: "enemy", label: "敌对" },
  { value: "related_to", label: "相关" },
] as const

type Palette = {
  background: string
  surface: string
  surfaceStrong: string
  border: string
  borderSoft: string
  ink: string
  muted: string
  accent: string
  accentSoft: string
  accentGlow: string
  link: string
}

type RelationSummary = {
  id: string
  sourceId: string
  targetId: string
  sourceName: string
  targetName: string
  label: string
  description: string
  focus: boolean
}

type RelationDraft = {
  sourceId: string
  targetId: string
  relationType: string
  relationName: string
  description: string
}

type RelationFilter = "all" | (typeof RELATION_TYPES)[number]["value"]

const defaultPalette: Palette = {
  background: "#f4efe6",
  surface: "#fffdf8",
  surfaceStrong: "#f7efe4",
  border: "#dbcfbf",
  borderSoft: "#ebe3d6",
  ink: "#201912",
  muted: "#6a5a4d",
  accent: "#bc5a2b",
  accentSoft: "#f4dcc9",
  accentGlow: "rgba(188,90,43,0.22)",
  link: "#745f50",
}

const RELATION_TYPE_LABELS = Object.fromEntries(
  RELATION_TYPES.map((item) => [item.value, item.label]),
) as Record<string, string>

function parseAliases(value: string) {
  return value
    .split("，")
    .join(",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function appearancesToIds(appearances?: CharacterAppearance[]) {
  if (!appearances || appearances.length === 0) {
    return []
  }
  return appearances.map((item) => item.node_id)
}

function getNodeId(node: string | CharacterGraphNode) {
  return typeof node === "string" ? node : node.id
}

function getRelationLabel(link: CharacterGraphLink) {
  if (link.relation_name?.trim()) {
    return link.relation_name.trim()
  }
  if (link.relation_type) {
    return RELATION_TYPE_LABELS[link.relation_type] ?? link.relation_type
  }
  return "相关"
}

function getRelationId(link: CharacterGraphLink) {
  const sourceId = getNodeId(link.source)
  const targetId = getNodeId(link.target)
  return link.id ?? `${sourceId}-${targetId}-${getRelationLabel(link)}`
}

function matchCharacter(node: CharacterGraphNode, query: string) {
  if (!query) {
    return true
  }
  const haystack = [
    node.name,
    node.description ?? "",
    ...(node.aliases ?? []),
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query)
}

function buildMetricLabel(count: number, singular: string, plural = singular) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function CharacterGraph() {
  const { currentProject, graphUpdateVersion, loadProject, setError } = useProjectStore()
  const [graphData, setGraphData] = useState<CharacterGraphResponse>({
    nodes: [],
    links: [],
  })
  const [selectedChapterId, setSelectedChapterId] = useState<string | "all">("all")
  const [relationFilter, setRelationFilter] = useState<RelationFilter>("all")
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [hoveredCharacterId, setHoveredCharacterId] = useState<string | null>(null)
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null)
  const [pointerPosition, setPointerPosition] = useState({ x: 24, y: 24 })
  const [graphSize, setGraphSize] = useState({ width: 0, height: 0 })
  const [graphKey, setGraphKey] = useState(0)
  const [palette, setPalette] = useState<Palette>(defaultPalette)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [editMode, setEditMode] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [showAddCharacter, setShowAddCharacter] = useState(false)
  const [showAddRelation, setShowAddRelation] = useState(false)
  const [showEditRelation, setShowEditRelation] = useState(false)
  const [showCharacterDetail, setShowCharacterDetail] = useState(false)
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null)
  const [editingRelationPair, setEditingRelationPair] = useState<{
    sourceName: string
    targetName: string
  } | null>(null)
  const [characterDraft, setCharacterDraft] = useState({
    name: "",
    description: "",
    aliases: "",
    appearances: [] as string[],
  })
  const [relationDraft, setRelationDraft] = useState<RelationDraft>({
    sourceId: "",
    targetId: "",
    relationType: RELATION_TYPES[0].value,
    relationName: "",
    description: "",
  })

  const graphRef = useRef<
    ForceGraphMethods<
      NodeObject<CharacterGraphNode>,
      LinkObject<CharacterGraphNode, CharacterGraphLink>
    > | undefined
  >(undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  const nodesById = useMemo(() => {
    const map = new Map<string, CharacterGraphNode>()
    graphData.nodes.forEach((node) => map.set(node.id, node))
    return map
  }, [graphData.nodes])

  const chapters = useMemo(() => {
    if (!currentProject) {
      return []
    }
    return [...currentProject.nodes].sort((a, b) => a.narrative_order - b.narrative_order)
  }, [currentProject])

  const selectedCharacter = selectedCharacterId ? nodesById.get(selectedCharacterId) ?? null : null
  const focusCharacterId = hoveredCharacterId ?? selectedCharacterId

  const chapterLabel = useMemo(() => {
    if (selectedChapterId === "all") {
      return "全部章节"
    }
    const chapter = chapters.find((node) => node.id === selectedChapterId)
    return chapter ? `${chapter.narrative_order}. ${chapter.title}` : "当前章节"
  }, [chapters, selectedChapterId])

  const chapterFilteredGraph = useMemo(() => {
    const activeIds = new Set<string>()
    if (selectedChapterId === "all") {
      graphData.nodes.forEach((node) => activeIds.add(node.id))
    } else {
      graphData.nodes.forEach((node) => {
        const appearances = node.appearances ?? []
        if (appearances.some((item) => item.node_id === selectedChapterId)) {
          activeIds.add(node.id)
        }
      })
    }
    return {
      nodes: graphData.nodes.filter((node) => activeIds.has(node.id)),
      links: graphData.links.filter((link) => {
        const source = getNodeId(link.source)
        const target = getNodeId(link.target)
        return activeIds.has(source) && activeIds.has(target)
      }),
    }
  }, [graphData.links, graphData.nodes, selectedChapterId])

  const relationFilteredGraph = useMemo(() => {
    if (relationFilter === "all") {
      return chapterFilteredGraph
    }

    const filteredLinks = chapterFilteredGraph.links.filter(
      (link) => (link.relation_type ?? "related_to") === relationFilter,
    )
    const activeIds = new Set<string>()
    filteredLinks.forEach((link) => {
      activeIds.add(getNodeId(link.source))
      activeIds.add(getNodeId(link.target))
    })

    return {
      nodes: chapterFilteredGraph.nodes.filter((node) => activeIds.has(node.id)),
      links: filteredLinks,
    }
  }, [chapterFilteredGraph, relationFilter])

  const visibleCharacters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return [...relationFilteredGraph.nodes]
      .filter((node) => matchCharacter(node, query))
      .sort((left, right) => {
        const diff = (right.appearances?.length ?? 0) - (left.appearances?.length ?? 0)
        return diff !== 0 ? diff : left.name.localeCompare(right.name, "zh-CN")
      })
  }, [relationFilteredGraph.nodes, searchQuery])

  const displayGraph = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return relationFilteredGraph
    }
    const matchedIds = new Set(visibleCharacters.map((node) => node.id))
    if (matchedIds.size === 0) {
      return { nodes: [], links: [] as CharacterGraphLink[] }
    }

    const contextualIds = new Set(matchedIds)
    relationFilteredGraph.links.forEach((link) => {
      const source = getNodeId(link.source)
      const target = getNodeId(link.target)
      if (matchedIds.has(source) || matchedIds.has(target)) {
        contextualIds.add(source)
        contextualIds.add(target)
      }
    })

    return {
      nodes: relationFilteredGraph.nodes.filter((node) => contextualIds.has(node.id)),
      links: relationFilteredGraph.links.filter((link) => {
        const source = getNodeId(link.source)
        const target = getNodeId(link.target)
        return contextualIds.has(source) && contextualIds.has(target)
      }),
    }
  }, [relationFilteredGraph, searchQuery, visibleCharacters])

  const relationSummaries = useMemo(() => {
    const items: RelationSummary[] = displayGraph.links.map((link) => {
      const sourceId = getNodeId(link.source)
      const targetId = getNodeId(link.target)
      const sourceNode = nodesById.get(sourceId)
      const targetNode = nodesById.get(targetId)
      return {
        id: getRelationId(link),
        sourceId,
        targetId,
        sourceName: sourceNode?.name ?? sourceId,
        targetName: targetNode?.name ?? targetId,
        label: getRelationLabel(link),
        description: link.description?.trim() ?? "",
        focus: !!focusCharacterId && (sourceId === focusCharacterId || targetId === focusCharacterId),
      }
    })
    return items.sort((left, right) => {
      if (left.focus !== right.focus) {
        return left.focus ? -1 : 1
      }
      return left.label.localeCompare(right.label, "zh-CN")
    })
  }, [displayGraph.links, focusCharacterId, nodesById])

  const hoveredRelation = useMemo(
    () => relationSummaries.find((item) => item.id === hoveredRelationId) ?? null,
    [hoveredRelationId, relationSummaries],
  )

  const degreeByNodeId = useMemo(() => {
    const degree = new Map<string, number>()
    displayGraph.links.forEach((link) => {
      const source = getNodeId(link.source)
      const target = getNodeId(link.target)
      degree.set(source, (degree.get(source) ?? 0) + 1)
      degree.set(target, (degree.get(target) ?? 0) + 1)
    })
    return degree
  }, [displayGraph.links])

  const focusedRelations = relationSummaries.filter((item) => item.focus)
  const activeCharacterCount = displayGraph.nodes.length
  const totalAppearanceCount = displayGraph.nodes.reduce(
    (sum, node) => sum + (node.appearances?.length ?? 0),
    0,
  )

  const loadGraph = useCallback(async () => {
    if (!currentProject?.id) {
      return
    }
    setLoading(true)
    try {
      const response = await getCharacterGraph(currentProject.id)
      setGraphData(response)
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    loadGraph()
  }, [loadGraph, graphUpdateVersion, currentProject?.updated_at])

  useLayoutEffect(() => {
    if (!containerRef.current) {
      return
    }
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setGraphSize({ width, height })
      }
    })
    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const styles = getComputedStyle(containerRef.current)
    const read = (name: string) => styles.getPropertyValue(name).trim()
    setPalette({
      background: read("--cg-bg") || defaultPalette.background,
      surface: read("--cg-surface") || defaultPalette.surface,
      surfaceStrong: read("--cg-surface-strong") || defaultPalette.surfaceStrong,
      border: read("--cg-border") || defaultPalette.border,
      borderSoft: read("--cg-border-soft") || defaultPalette.borderSoft,
      ink: read("--cg-ink") || defaultPalette.ink,
      muted: read("--cg-muted") || defaultPalette.muted,
      accent: read("--cg-accent") || defaultPalette.accent,
      accentSoft: read("--cg-accent-soft") || defaultPalette.accentSoft,
      accentGlow: read("--cg-accent-glow") || defaultPalette.accentGlow,
      link: read("--cg-link") || defaultPalette.link,
    })
  }, [])

  useEffect(() => {
    if (!graphRef.current || displayGraph.nodes.length === 0 || graphSize.width === 0 || graphSize.height === 0) {
      return
    }
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(500, 72)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [displayGraph.nodes.length, graphKey, graphSize.width, graphSize.height])

  useEffect(() => {
    setGraphKey((value) => value + 1)
  }, [selectedChapterId, searchQuery])

  useEffect(() => {
    if (!selectedCharacterId || !graphRef.current) {
      return
    }
    const target = displayGraph.nodes.find((node) => node.id === selectedCharacterId)
    if (!target || target.x == null || target.y == null) {
      return
    }
    const timer = window.setTimeout(() => {
      graphRef.current?.centerAt(target.x ?? 0, target.y ?? 0, 500)
      graphRef.current?.zoom(2.1, 500)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [displayGraph.nodes, selectedCharacterId])

  useEffect(() => {
    if (!selectedCharacter) {
      setEditMode(false)
      return
    }
    setCharacterDraft({
      name: selectedCharacter.name,
      description: selectedCharacter.description ?? "",
      aliases: (selectedCharacter.aliases ?? []).join("，"),
      appearances: appearancesToIds(selectedCharacter.appearances),
    })
  }, [selectedCharacter])

  const handleNodeClick = useCallback((node: CharacterGraphNode) => {
    setSelectedCharacterId(node.id)
    setShowCharacterDetail(true)
  }, [])

  const handleSaveCharacter = useCallback(async () => {
    if (!currentProject?.id || !selectedCharacter) {
      return
    }
    const payload = {
      name: characterDraft.name.trim(),
      description: characterDraft.description.trim(),
      aliases: parseAliases(characterDraft.aliases),
      properties: {
        ...(selectedCharacter.properties ?? {}),
        appearances: characterDraft.appearances,
      },
    }
    await updateGraphEntity(currentProject.id, selectedCharacter.id, payload)
    await loadProject(currentProject.id)
    await loadGraph()
    setEditMode(false)
  }, [characterDraft, currentProject?.id, loadGraph, loadProject, selectedCharacter])

  const handleCreateCharacter = useCallback(async () => {
    if (!currentProject?.id) {
      return
    }
    const payload = {
      name: characterDraft.name.trim(),
      description: characterDraft.description.trim(),
      aliases: parseAliases(characterDraft.aliases),
      type: "character" as const,
      properties: {
        appearances: characterDraft.appearances,
      },
    }
    await createGraphEntity(currentProject.id, payload)
    await loadProject(currentProject.id)
    await loadGraph()
    setShowAddCharacter(false)
  }, [characterDraft, currentProject?.id, loadGraph, loadProject])

  const handleCreateRelation = useCallback(async () => {
    if (!currentProject?.id) {
      return
    }
    try {
      await createGraphRelation(currentProject.id, {
        source_id: relationDraft.sourceId,
        target_id: relationDraft.targetId,
        relation_type: relationDraft.relationType,
        relation_name: relationDraft.relationName,
        description: relationDraft.description,
      })
      await loadProject(currentProject.id)
      await loadGraph()
      setShowAddRelation(false)
    } catch (error) {
      setError(formatUserErrorMessage(error, "创建关系失败，请稍后重试。"))
    }
  }, [currentProject?.id, loadGraph, loadProject, relationDraft, setError])

  const handleOpenRelationEditor = useCallback((item: RelationSummary) => {
    const link = displayGraph.links.find((entry) => {
      return getRelationId(entry) === item.id
    })
    if (!link || !link.id) {
      setError("当前关系缺少稳定 ID，暂时无法编辑。")
      return
    }
    setEditingRelationId(link.id)
    setEditingRelationPair({
      sourceName: item.sourceName,
      targetName: item.targetName,
    })
    setRelationDraft({
      sourceId: item.sourceId,
      targetId: item.targetId,
      relationType: link.relation_type ?? "related_to",
      relationName: link.relation_name ?? "",
      description: link.description ?? "",
    })
    setShowEditRelation(true)
  }, [displayGraph.links, setError])

  const handleOpenRelationEditorFromLink = useCallback((link: CharacterGraphLink) => {
    const sourceId = getNodeId(link.source)
    const targetId = getNodeId(link.target)
    const sourceName = nodesById.get(sourceId)?.name ?? sourceId
    const targetName = nodesById.get(targetId)?.name ?? targetId
    const item: RelationSummary = {
      id: link.id ?? `${sourceId}-${targetId}-${getRelationLabel(link)}`,
      sourceId,
      targetId,
      sourceName,
      targetName,
      label: getRelationLabel(link),
      description: link.description?.trim() ?? "",
      focus: !!focusCharacterId && (sourceId === focusCharacterId || targetId === focusCharacterId),
    }
    handleOpenRelationEditor(item)
  }, [focusCharacterId, handleOpenRelationEditor, nodesById])

  const handleUpdateRelation = useCallback(async () => {
    if (!currentProject?.id || !editingRelationId) {
      return
    }
    try {
      await updateGraphRelation(currentProject.id, editingRelationId, {
        relation_type: relationDraft.relationType,
        relation_name: relationDraft.relationName.trim(),
        description: relationDraft.description.trim(),
      })
      await loadProject(currentProject.id)
      await loadGraph()
      setShowEditRelation(false)
      setEditingRelationId(null)
      setEditingRelationPair(null)
    } catch (error) {
      setError(formatUserErrorMessage(error, "更新关系失败，请稍后重试。"))
    }
  }, [currentProject?.id, editingRelationId, loadGraph, loadProject, relationDraft, setError])

  const handleDeleteRelation = useCallback(async () => {
    if (!currentProject?.id || !editingRelationId) {
      return
    }
    const confirmed = window.confirm("确认删除这条角色关系吗？")
    if (!confirmed) {
      return
    }
    try {
      await deleteGraphRelation(currentProject.id, editingRelationId)
      await loadProject(currentProject.id)
      await loadGraph()
      setShowEditRelation(false)
      setEditingRelationId(null)
      setEditingRelationPair(null)
    } catch (error) {
      setError(formatUserErrorMessage(error, "删除关系失败，请稍后重试。"))
    }
  }, [currentProject?.id, editingRelationId, loadGraph, loadProject, setError])

  const handleSync = useCallback(
    async (mode: "full" | "node") => {
      if (!currentProject?.id) {
        return
      }
      setSyncing(true)
      try {
        await syncCharacterGraph(currentProject.id, {
          mode,
          node_id: mode === "node" && selectedChapterId !== "all" ? selectedChapterId : undefined,
        })
        await loadProject(currentProject.id)
        await loadGraph()
      } finally {
        setSyncing(false)
      }
    },
    [currentProject?.id, loadGraph, loadProject, selectedChapterId],
  )

  const handleZoomToFit = useCallback(() => {
    graphRef.current?.zoomToFit(500, 72)
  }, [])

  const resetFilters = useCallback(() => {
    setSearchQuery("")
    setSelectedChapterId("all")
    setRelationFilter("all")
    setHoveredCharacterId(null)
    setHoveredRelationId(null)
  }, [])

  const selectChapterOptions = chapters.map((node) => ({
    value: node.id,
    label: `${node.narrative_order}. ${node.title}`,
  }))

  const cssVars = {
    "--cg-bg": "#f4efe6",
    "--cg-surface": "#fffdf8",
    "--cg-surface-strong": "#f7efe4",
    "--cg-border": "#d8c9b7",
    "--cg-border-soft": "#ebe1d5",
    "--cg-ink": "#201912",
    "--cg-muted": "#6c5a4d",
    "--cg-accent": "#bc5a2b",
    "--cg-accent-soft": "#f4dcc9",
    "--cg-accent-glow": "rgba(188, 90, 43, 0.2)",
    "--cg-link": "#725b4b",
  } as CSSProperties

  return (
    <section
      className="relative overflow-hidden rounded-[32px] border border-black/5 bg-[var(--cg-bg)] text-[var(--cg-ink)] shadow-[0_32px_120px_rgba(38,24,14,0.12)]"
      style={cssVars}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(188,90,43,0.2),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(120,90,60,0.12),_transparent_35%)]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/65 to-transparent" />
      </div>

      <header className="relative border-b border-[var(--cg-border)] px-6 py-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--cg-border)] bg-white/70 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-[var(--cg-muted)]">
              <Sparkles className="h-3.5 w-3.5" />
              Character Atlas
            </div>
            <div>
              <h2 className="font-serif text-3xl tracking-tight text-[var(--cg-ink)] md:text-[2.35rem]">
                角色关系图
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--cg-muted)]">
                以角色为中心查看出场脉络、关系连线和当前章节的社交张力。筛选、搜索和选中状态会同步作用到主图，不再只是旁边的静态名单。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface)] px-4 text-sm text-[var(--cg-ink)]"
              onClick={handleZoomToFit}
            >
              <Crosshair className="mr-1.5 h-4 w-4" />
              适配视图
            </Button>
            <Button
              variant="secondary"
              className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface)] px-4 text-sm text-[var(--cg-ink)]"
              onClick={() => handleSync("full")}
              disabled={syncing}
            >
              <Network className="mr-1.5 h-4 w-4" />
              {syncing ? "同步中…" : "全量同步"}
            </Button>
            <Button
              className="rounded-full bg-[var(--cg-accent)] px-4 text-[var(--cg-bg)] hover:bg-[var(--cg-accent)]/90"
              onClick={() => handleSync("node")}
              disabled={syncing || selectedChapterId === "all"}
            >
              <ArrowUpRight className="mr-1.5 h-4 w-4" />
              同步当前章节
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "当前视图角色",
              value: String(activeCharacterCount),
              detail: buildMetricLabel(totalAppearanceCount, "次登场"),
              icon: Users,
            },
            {
              label: "关系连线",
              value: String(displayGraph.links.length),
              detail: chapterLabel,
              icon: Link2,
            },
            {
              label: "焦点关系",
              value: String(focusedRelations.length),
              detail: focusCharacterId ? "已联动到选中角色" : "选中角色后会高亮",
              icon: Sparkles,
            },
            {
              label: "搜索状态",
              value: searchQuery.trim() ? "过滤中" : "全量",
              detail: searchQuery.trim() ? `关键词：${searchQuery.trim()}` : "未使用关键词",
              icon: Search,
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-[var(--cg-border)] bg-white/70 px-4 py-4 shadow-[0_16px_40px_rgba(32,25,18,0.05)] backdrop-blur-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--cg-muted)]">
                    {item.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--cg-ink)]">
                    {item.value}
                  </p>
                </div>
                <div className="rounded-2xl bg-[var(--cg-accent-soft)] p-2.5 text-[var(--cg-accent)]">
                  <item.icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3 text-sm text-[var(--cg-muted)]">{item.detail}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="relative grid gap-6 px-6 py-6 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="space-y-5">
          <div className="rounded-[28px] border border-[var(--cg-border)] bg-[var(--cg-surface)] p-4 shadow-[0_20px_48px_rgba(32,25,18,0.08)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--cg-muted)]">
                  View Controls
                </p>
                <h3 className="mt-1 font-serif text-xl text-[var(--cg-ink)]">筛选与导航</h3>
              </div>
              <span className="rounded-full bg-[var(--cg-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--cg-accent)]">
                {chapterLabel}
              </span>
            </div>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--cg-muted)]">按章节聚焦</label>
                <select
                  className="w-full rounded-2xl border border-[var(--cg-border)] bg-[var(--cg-bg)] px-3 py-2.5 text-sm text-[var(--cg-ink)]"
                  value={selectedChapterId}
                  onChange={(event) => setSelectedChapterId(event.target.value as string | "all")}
                >
                  <option value="all">全部章节</option>
                  {selectChapterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--cg-muted)]">搜索角色或别名</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cg-muted)]" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="例如：陆沉、阿沉、宿敌"
                    className="h-11 rounded-2xl border-[var(--cg-border)] bg-white pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--cg-muted)]">按关系类型筛选</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRelationFilter("all")}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition",
                      relationFilter === "all"
                        ? "border-[var(--cg-accent)] bg-[var(--cg-accent-soft)] text-[var(--cg-accent)]"
                        : "border-[var(--cg-border)] bg-white text-[var(--cg-muted)] hover:border-[var(--cg-accent)]/40",
                    )}
                  >
                    全部关系
                  </button>
                  {RELATION_TYPES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setRelationFilter(item.value)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition",
                        relationFilter === item.value
                          ? "border-[var(--cg-accent)] bg-[var(--cg-accent-soft)] text-[var(--cg-accent)]"
                          : "border-[var(--cg-border)] bg-white text-[var(--cg-muted)] hover:border-[var(--cg-accent)]/40",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="rounded-full border border-[var(--cg-border)] bg-transparent"
                  onClick={resetFilters}
                >
                  清空筛选
                </Button>
                <Button
                  variant="secondary"
                  className="rounded-full border border-[var(--cg-border)] bg-transparent"
                  onClick={() => {
                    setCharacterDraft({
                      name: "",
                      description: "",
                      aliases: "",
                      appearances: selectedChapterId === "all" ? [] : [selectedChapterId],
                    })
                    setShowAddCharacter(true)
                  }}
                >
                  添加角色
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-[var(--cg-border)] bg-[var(--cg-surface)] p-4 shadow-[0_20px_48px_rgba(32,25,18,0.08)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--cg-muted)]">
                  Cast Roster
                </p>
                <h3 className="mt-1 font-serif text-xl text-[var(--cg-ink)]">角色列表</h3>
              </div>
              <span className="text-xs text-[var(--cg-muted)]">
                {visibleCharacters.length}/{chapterFilteredGraph.nodes.length}
              </span>
            </div>

            <ScrollArea className="mt-4 h-[420px] pr-3">
              <div className="space-y-2.5">
                {visibleCharacters.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-4 py-8 text-center text-sm text-[var(--cg-muted)]">
                    当前筛选下没有可展示角色
                  </div>
                ) : (
                  visibleCharacters.map((node) => {
                    const isActive = node.id === selectedCharacterId
                    const isHovered = node.id === hoveredCharacterId
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => {
                          setSelectedCharacterId(node.id)
                          setShowCharacterDetail(true)
                        }}
                        onMouseEnter={() => setHoveredCharacterId(node.id)}
                        onMouseLeave={() => setHoveredCharacterId((current) => (current === node.id ? null : current))}
                        className={cn(
                          "w-full rounded-2xl border px-3 py-3 text-left transition-all",
                          isActive
                            ? "border-[var(--cg-accent)] bg-[var(--cg-accent-soft)] shadow-[0_12px_28px_var(--cg-accent-glow)]"
                            : isHovered
                              ? "border-[var(--cg-accent)]/50 bg-white"
                              : "border-[var(--cg-border)] bg-white/70 hover:border-[var(--cg-accent)]/35 hover:bg-white",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--cg-ink)]">{node.name}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--cg-muted)]">
                              {node.description || "暂无角色描述"}
                            </p>
                          </div>
                          <div className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface)] px-2 py-1 text-xs text-[var(--cg-muted)]">
                            {(node.appearances ?? []).length}
                          </div>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </ScrollArea>

            <Button
              variant="secondary"
              className="mt-4 w-full rounded-full border border-[var(--cg-border)] bg-transparent"
              onClick={() => {
                setRelationDraft({
                  sourceId: selectedCharacterId ?? "",
                  targetId: "",
                  relationType: RELATION_TYPES[0].value,
                  relationName: "",
                  description: "",
                })
                setShowAddRelation(true)
              }}
              disabled={graphData.nodes.length < 2}
            >
              添加关系连线
            </Button>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="rounded-[30px] border border-[var(--cg-border)] bg-[var(--cg-surface)] p-4 shadow-[0_20px_56px_rgba(32,25,18,0.09)]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--cg-muted)]">Graph Stage</p>
                <h3 className="mt-1 font-serif text-2xl text-[var(--cg-ink)]">关系网络</h3>
                <p className="mt-1 text-sm text-[var(--cg-muted)]">
                  节点大小会参考出场次数和连接度，搜索会保留命中角色及其直接关系。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--cg-muted)]">
                <span className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-3 py-1">
                  {activeCharacterCount} 个角色
                </span>
                <span className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-3 py-1">
                  {displayGraph.links.length} 条关系
                </span>
                {relationFilter !== "all" ? (
                  <span className="rounded-full bg-[var(--cg-accent-soft)] px-3 py-1 text-[var(--cg-accent)]">
                    关系类型：{RELATION_TYPE_LABELS[relationFilter]}
                  </span>
                ) : null}
                {searchQuery.trim() ? (
                  <span className="rounded-full bg-[var(--cg-accent-soft)] px-3 py-1 text-[var(--cg-accent)]">
                    命中关键词：{searchQuery.trim()}
                  </span>
                ) : null}
              </div>
            </div>

            <div
              ref={containerRef}
              className="relative min-h-[620px] overflow-hidden rounded-[28px] border border-[var(--cg-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,239,228,0.92))]"
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setPointerPosition({
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                })
              }}
              onMouseLeave={() => {
                setHoveredRelationId(null)
              }}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(188,90,43,0.08),transparent_40%)]" />

                <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
                {[
                  { label: "当前焦点", tone: "bg-[var(--cg-accent)] text-[var(--cg-bg)]" },
                  { label: "关联角色", tone: "bg-[var(--cg-accent-soft)] text-[var(--cg-accent)]" },
                  { label: "普通角色", tone: "bg-white text-[var(--cg-muted)] border border-[var(--cg-border)]" },
                ].map((item) => (
                  <span
                    key={item.label}
                    className={cn("rounded-full px-3 py-1 text-[11px] shadow-sm", item.tone)}
                  >
                    {item.label}
                  </span>
                ))}
                </div>

              <div className="absolute bottom-4 right-4 z-10 rounded-full border border-[var(--cg-border)] bg-white/85 px-3 py-1.5 text-[11px] text-[var(--cg-muted)] shadow-sm backdrop-blur-sm">
                可直接点击连线编辑关系
              </div>

              {hoveredRelation ? (
                <div
                  className="pointer-events-none absolute z-20 max-w-[260px] rounded-2xl border border-[var(--cg-border)] bg-white/95 px-3 py-3 shadow-[0_18px_40px_rgba(32,25,18,0.16)] backdrop-blur-sm"
                  style={{
                    left: Math.min(pointerPosition.x + 16, Math.max(graphSize.width - 280, 16)),
                    top: Math.min(pointerPosition.y + 16, Math.max(graphSize.height - 140, 16)),
                  }}
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--cg-muted)]">
                    Relation Hover
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[var(--cg-ink)]">
                    {hoveredRelation.label}
                  </p>
                  <p className="mt-1 text-sm text-[var(--cg-muted)]">
                    {hoveredRelation.sourceName} · {hoveredRelation.targetName}
                  </p>
                  {hoveredRelation.description ? (
                    <p className="mt-2 text-xs leading-5 text-[var(--cg-muted)]">
                      {hoveredRelation.description}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-[var(--cg-muted)]">
                      点击这条连线可直接编辑关系。
                    </p>
                  )}
                </div>
              ) : null}

              {loading ? (
                <div className="flex h-full min-h-[620px] items-center justify-center text-sm text-[var(--cg-muted)]">
                  加载角色关系图…
                </div>
              ) : displayGraph.nodes.length === 0 ? (
                <div className="flex h-full min-h-[620px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[var(--cg-muted)]">
                  <p className="text-base text-[var(--cg-ink)]">当前没有可展示的角色关系</p>
                  <p>可切换章节、清空关键词，或新增角色后再尝试同步。</p>
                </div>
              ) : (
                <ForceGraph2D
                  key={graphKey}
                  ref={graphRef}
                  graphData={displayGraph}
                  width={graphSize.width}
                  height={graphSize.height}
                  backgroundColor="rgba(255,255,255,0)"
                  cooldownTicks={90}
                  d3AlphaDecay={0.03}
                  linkColor={(link) => {
                    const graphLink = link as CharacterGraphLink
                    const source = getNodeId(graphLink.source)
                    const target = getNodeId(graphLink.target)
                    if (hoveredRelationId && getRelationId(graphLink) === hoveredRelationId) {
                      return palette.accent
                    }
                    if (focusCharacterId && (source === focusCharacterId || target === focusCharacterId)) {
                      return palette.accent
                    }
                    return palette.link
                  }}
                  linkWidth={(link) => {
                    const graphLink = link as CharacterGraphLink
                    const source = getNodeId(graphLink.source)
                    const target = getNodeId(graphLink.target)
                    if (hoveredRelationId && getRelationId(graphLink) === hoveredRelationId) {
                      return 3.6
                    }
                    if (focusCharacterId && (source === focusCharacterId || target === focusCharacterId)) {
                      return 2.8
                    }
                    return 1.25
                  }}
                  linkCurvature={0.16}
                  nodeLabel={(node) => (node as CharacterGraphNode).name}
                  onNodeClick={(node) => handleNodeClick(node as CharacterGraphNode)}
                  onLinkClick={(link) => handleOpenRelationEditorFromLink(link as CharacterGraphLink)}
                  onLinkHover={(link) =>
                    setHoveredRelationId(link ? getRelationId(link as CharacterGraphLink) : null)
                  }
                  onNodeHover={(node) => setHoveredCharacterId((node as CharacterGraphNode | null)?.id ?? null)}
                  nodeCanvasObject={(node, ctx, globalScale) => {
                    const graphNode = node as CharacterGraphNode & { x?: number; y?: number }
                    if (graphNode.x == null || graphNode.y == null) {
                      return
                    }

                    const isSelected = graphNode.id === selectedCharacterId
                    const isHovered = graphNode.id === hoveredCharacterId
                    const isNeighbor =
                      !!focusCharacterId &&
                      relationSummaries.some(
                        (item) =>
                          item.focus &&
                          (item.sourceId === graphNode.id || item.targetId === graphNode.id),
                      )
                    const degree = degreeByNodeId.get(graphNode.id) ?? 0
                    const appearanceCount = graphNode.appearances?.length ?? 0
                    const radius = (11 + Math.min(appearanceCount, 6) * 1.7 + Math.min(degree, 5) * 1.4) / globalScale
                    const label = graphNode.name
                    const fontSize = 12 / globalScale
                    const textWidth = ctx.measureText(label).width
                    const badge = String(appearanceCount)
                    const badgeWidth = ctx.measureText(badge).width + 10 / globalScale
                    const boxWidth = Math.max(radius * 2.4, textWidth + 22 / globalScale)
                    const boxHeight = 24 / globalScale

                    if (isSelected || isHovered) {
                      ctx.beginPath()
                      ctx.fillStyle = palette.accentGlow
                      ctx.arc(graphNode.x, graphNode.y, radius * 1.9, 0, 2 * Math.PI)
                      ctx.fill()
                    }

                    ctx.beginPath()
                    ctx.fillStyle = isSelected
                      ? palette.accent
                      : isHovered || isNeighbor
                        ? palette.accentSoft
                        : palette.surface
                    ctx.strokeStyle = isSelected ? palette.accent : palette.border
                    ctx.lineWidth = 1.2 / globalScale
                    ctx.roundRect?.(
                      graphNode.x - boxWidth / 2,
                      graphNode.y - boxHeight / 2,
                      boxWidth,
                      boxHeight,
                      999,
                    )
                    if (!ctx.roundRect) {
                      ctx.rect(graphNode.x - boxWidth / 2, graphNode.y - boxHeight / 2, boxWidth, boxHeight)
                    }
                    ctx.fill()
                    ctx.stroke()

                    ctx.font = `600 ${fontSize}px sans-serif`
                    ctx.fillStyle = isSelected ? palette.background : palette.ink
                    ctx.textAlign = "center"
                    ctx.textBaseline = "middle"
                    ctx.fillText(label, graphNode.x, graphNode.y)

                    ctx.beginPath()
                    ctx.fillStyle = isSelected ? palette.background : palette.surfaceStrong
                    ctx.strokeStyle = isSelected ? palette.background : palette.borderSoft
                    ctx.lineWidth = 1 / globalScale
                    ctx.roundRect?.(
                      graphNode.x + boxWidth / 2 - badgeWidth + 2 / globalScale,
                      graphNode.y - boxHeight / 2 - 7 / globalScale,
                      badgeWidth,
                      14 / globalScale,
                      999,
                    )
                    if (!ctx.roundRect) {
                      ctx.rect(
                        graphNode.x + boxWidth / 2 - badgeWidth + 2 / globalScale,
                        graphNode.y - boxHeight / 2 - 7 / globalScale,
                        badgeWidth,
                        14 / globalScale,
                      )
                    }
                    ctx.fill()
                    ctx.stroke()
                    ctx.font = `700 ${9 / globalScale}px sans-serif`
                    ctx.fillStyle = isSelected ? palette.accent : palette.muted
                    ctx.fillText(
                      badge,
                      graphNode.x + boxWidth / 2 - badgeWidth / 2 + 2 / globalScale,
                      graphNode.y - boxHeight / 2,
                    )
                  }}
                  linkCanvasObjectMode={() => "after"}
                  linkCanvasObject={(link, ctx, globalScale) => {
                    const graphLink = link as CharacterGraphLink & {
                      source: CharacterGraphNode & { x?: number; y?: number }
                      target: CharacterGraphNode & { x?: number; y?: number }
                    }
                    if (
                      graphLink.source.x == null ||
                      graphLink.source.y == null ||
                      graphLink.target.x == null ||
                      graphLink.target.y == null
                    ) {
                      return
                    }

                    const sourceId = getNodeId(graphLink.source)
                    const targetId = getNodeId(graphLink.target)
                    const focused = !!focusCharacterId && (sourceId === focusCharacterId || targetId === focusCharacterId)
                    const hovered = getRelationId(graphLink) === hoveredRelationId
                    const showLabel = hovered || focused || displayGraph.links.length <= 10
                    if (!showLabel) {
                      return
                    }

                    const label = getRelationLabel(graphLink)
                    const x = (graphLink.source.x + graphLink.target.x) / 2
                    const y = (graphLink.source.y + graphLink.target.y) / 2
                    const fontSize = (hovered ? 10.5 : focused ? 10 : 8.5) / globalScale

                    ctx.font = `600 ${fontSize}px sans-serif`
                    const paddingX = 6 / globalScale
                    const paddingY = 3 / globalScale
                    const width = ctx.measureText(label).width + paddingX * 2
                    const height = fontSize + paddingY * 2

                    ctx.fillStyle = hovered || focused ? palette.accentSoft : "rgba(255,253,248,0.94)"
                    ctx.strokeStyle = hovered || focused ? palette.accent : palette.borderSoft
                    ctx.lineWidth = 1 / globalScale
                    ctx.beginPath()
                    ctx.roundRect?.(x - width / 2, y - height / 2, width, height, 999)
                    if (!ctx.roundRect) {
                      ctx.rect(x - width / 2, y - height / 2, width, height)
                    }
                    ctx.fill()
                    ctx.stroke()

                    ctx.fillStyle = hovered || focused ? palette.accent : palette.muted
                    ctx.textAlign = "center"
                    ctx.textBaseline = "middle"
                    ctx.fillText(label, x, y)
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-[28px] border border-[var(--cg-border)] bg-[var(--cg-surface)] p-4 shadow-[0_20px_48px_rgba(32,25,18,0.08)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--cg-muted)]">
                  Focus Panel
                </p>
                <h3 className="mt-1 font-serif text-xl text-[var(--cg-ink)]">当前焦点</h3>
              </div>
              <div className="rounded-2xl bg-[var(--cg-accent-soft)] p-2 text-[var(--cg-accent)]">
                <Users className="h-4 w-4" />
              </div>
            </div>

            {!selectedCharacter ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-4 py-8 text-sm leading-6 text-[var(--cg-muted)]">
                选中左侧角色或图中节点后，这里会展示角色摘要、出场次数和关联关系。
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-3xl border border-[var(--cg-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(244,220,201,0.45))] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-serif text-2xl text-[var(--cg-ink)]">
                        {selectedCharacter.name}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--cg-muted)]">
                        {selectedCharacter.description || "暂无角色描述"}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="rounded-full border border-[var(--cg-border)] bg-white/80"
                      onClick={() => setShowCharacterDetail(true)}
                    >
                      查看档案
                    </Button>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      {
                        label: "登场",
                        value: String(selectedCharacter.appearances?.length ?? 0),
                      },
                      {
                        label: "关系",
                        value: String(focusedRelations.length),
                      },
                      {
                        label: "别名",
                        value: String(selectedCharacter.aliases?.length ?? 0),
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-[var(--cg-border)] bg-white/80 px-3 py-3 text-center">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--cg-muted)]">
                          {item.label}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-[var(--cg-ink)]">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] p-4">
                  <p className="text-xs font-medium text-[var(--cg-muted)]">别名</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--cg-ink)]">
                    {(selectedCharacter.aliases ?? []).join("、") || "无"}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-[var(--cg-border)] bg-[var(--cg-surface)] p-4 shadow-[0_20px_48px_rgba(32,25,18,0.08)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--cg-muted)]">
                  Relation Ledger
                </p>
                <h3 className="mt-1 font-serif text-xl text-[var(--cg-ink)]">关系清单</h3>
                <p className="mt-1 text-xs text-[var(--cg-muted)]">
                  可从这里编辑，也可直接点击图上的连线
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--cg-muted)]">
                {relationFilter !== "all" ? (
                  <span className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-2 py-1">
                    <Tags className="mr-1 inline h-3 w-3" />
                    {RELATION_TYPE_LABELS[relationFilter]}
                  </span>
                ) : null}
                <span>{relationSummaries.length} 条</span>
              </div>
            </div>

            <ScrollArea className="mt-4 h-[420px] pr-3">
              <div className="space-y-2.5">
                {relationSummaries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-4 py-8 text-center text-sm text-[var(--cg-muted)]">
                    当前视图暂无关系连线
                  </div>
                ) : (
                  relationSummaries.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-2xl border px-3 py-3 transition",
                        item.focus
                          ? "border-[var(--cg-accent)] bg-[var(--cg-accent-soft)] shadow-[0_10px_26px_var(--cg-accent-glow)]"
                          : "border-[var(--cg-border)] bg-white/75 hover:border-[var(--cg-accent)]/35",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCharacterId(item.sourceId)
                            setShowCharacterDetail(true)
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-[var(--cg-ink)]">{item.label}</p>
                            {item.focus ? (
                              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-[var(--cg-accent)]">
                                当前焦点
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-[var(--cg-muted)]">
                            {item.sourceName} · {item.targetName}
                          </p>
                          {item.description ? (
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--cg-muted)]">
                              {item.description}
                            </p>
                          ) : null}
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full text-[var(--cg-muted)] hover:bg-white/80 hover:text-[var(--cg-ink)]"
                            onClick={() => handleOpenRelationEditor(item)}
                          >
                            <PencilLine className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </aside>
      </div>

      <Dialog
        open={showCharacterDetail}
        onOpenChange={(open) => {
          setShowCharacterDetail(open)
          if (!open) {
            setEditMode(false)
          }
        }}
      >
        <DialogContent className="flex h-[84vh] w-[92vw] max-w-5xl flex-col gap-6 rounded-[32px] border border-[var(--cg-border)] bg-[var(--cg-surface)] p-0" style={cssVars}>
          <DialogHeader className="border-b border-[var(--cg-border)] px-6 py-5">
            <DialogTitle className="font-serif text-[2rem] text-[var(--cg-ink)]">
              {selectedCharacter?.name || "角色档案"}
            </DialogTitle>
          </DialogHeader>

          {!selectedCharacter ? (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-[var(--cg-muted)]">
              请选择一个角色
            </div>
          ) : (
            <div className="grid flex-1 gap-6 overflow-hidden px-6 pb-6 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="space-y-4">
                <div className="rounded-[28px] border border-[var(--cg-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,220,201,0.4))] p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--cg-muted)]">Character Card</p>
                  <p className="mt-3 font-serif text-3xl text-[var(--cg-ink)]">{selectedCharacter.name}</p>
                  <p className="mt-3 text-sm leading-6 text-[var(--cg-muted)]">
                    {selectedCharacter.description || "暂无角色描述"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "别名", value: String(selectedCharacter.aliases?.length ?? 0) },
                    { label: "登场", value: String(selectedCharacter.appearances?.length ?? 0) },
                    { label: "焦点关系", value: String(focusedRelations.length) },
                    { label: "章节筛选", value: selectedChapterId === "all" ? "全部" : "已选" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--cg-muted)]">{item.label}</p>
                      <p className="mt-1 text-xl font-semibold text-[var(--cg-ink)]">{item.value}</p>
                    </div>
                  ))}
                </div>
              </aside>

              <ScrollArea className="h-full pr-2">
                <div className="space-y-6 pb-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--cg-muted)]">角色名</p>
                    {editMode ? (
                      <Input
                        value={characterDraft.name}
                        onChange={(event) => setCharacterDraft((draft) => ({ ...draft, name: event.target.value }))}
                        className="mt-2 rounded-2xl border-[var(--cg-border)]"
                      />
                    ) : (
                      <p className="mt-2 font-serif text-4xl text-[var(--cg-ink)]">{selectedCharacter.name}</p>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[var(--cg-muted)]">角色描述</p>
                    {editMode ? (
                      <Textarea
                        value={characterDraft.description}
                        onChange={(event) =>
                          setCharacterDraft((draft) => ({ ...draft, description: event.target.value }))
                        }
                        className="mt-2 min-h-[200px] rounded-3xl border-[var(--cg-border)] bg-white text-base leading-7"
                      />
                    ) : (
                      <div className="mt-2 rounded-[28px] border border-[var(--cg-border)] bg-white px-5 py-4 text-base leading-8 text-[var(--cg-ink)]">
                        {selectedCharacter.description || "暂无描述"}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[var(--cg-muted)]">别名</p>
                    {editMode ? (
                      <Input
                        value={characterDraft.aliases}
                        onChange={(event) => setCharacterDraft((draft) => ({ ...draft, aliases: event.target.value }))}
                        className="mt-2 rounded-2xl border-[var(--cg-border)]"
                        placeholder="使用逗号分隔"
                      />
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(selectedCharacter.aliases ?? []).length === 0 ? (
                          <span className="rounded-full border border-dashed border-[var(--cg-border)] px-4 py-1.5 text-sm text-[var(--cg-muted)]">
                            无
                          </span>
                        ) : (
                          (selectedCharacter.aliases ?? []).map((alias) => (
                            <span
                              key={alias}
                              className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-4 py-1.5 text-sm text-[var(--cg-ink)]"
                            >
                              {alias}
                            </span>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[var(--cg-muted)]">登场章节</p>
                    {editMode ? (
                      <div className="mt-3 max-h-[320px] space-y-2 overflow-auto rounded-[28px] border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] p-4">
                        {chapters.map((node) => (
                          <label key={node.id} className="flex items-center gap-3 rounded-2xl bg-white/70 px-3 py-2 text-sm text-[var(--cg-ink)]">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-[var(--cg-accent)] focus:ring-[var(--cg-accent)]"
                              checked={characterDraft.appearances.includes(node.id)}
                              onChange={(event) => {
                                setCharacterDraft((draft) => {
                                  const next = new Set(draft.appearances)
                                  if (event.target.checked) {
                                    next.add(node.id)
                                  } else {
                                    next.delete(node.id)
                                  }
                                  return { ...draft, appearances: Array.from(next) }
                                })
                              }}
                            />
                            <span>
                              {node.narrative_order}. {node.title}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(selectedCharacter.appearances ?? []).length === 0 ? (
                          <span className="rounded-full border border-dashed border-[var(--cg-border)] px-4 py-1.5 text-sm text-[var(--cg-muted)]">
                            暂无记录
                          </span>
                        ) : (
                          (selectedCharacter.appearances ?? []).map((item) => (
                            <span
                              key={item.node_id}
                              className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-4 py-1.5 text-sm font-medium text-[var(--cg-ink)]"
                            >
                              {item.narrative_order}. {item.node_title}
                            </span>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter className="border-t border-[var(--cg-border)] px-6 py-4 sm:justify-between">
            <div />
            {selectedCharacter &&
              (editMode ? (
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setEditMode(false)}
                    className="rounded-full border border-[var(--cg-border)] bg-transparent px-6"
                  >
                    取消
                  </Button>
                  <Button
                    className="rounded-full bg-[var(--cg-accent)] px-6 text-[var(--cg-bg)] hover:bg-[var(--cg-accent)]/90"
                    onClick={handleSaveCharacter}
                  >
                    保存档案
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setEditMode(true)}
                  className="rounded-full border-[var(--cg-border)] px-6"
                >
                  编辑档案
                </Button>
              ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddCharacter} onOpenChange={setShowAddCharacter}>
        <DialogContent className="max-w-xl rounded-[30px] border border-[var(--cg-border)] bg-[var(--cg-surface)]" style={cssVars}>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-[var(--cg-ink)]">新增角色</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-[var(--cg-muted)]">角色名</p>
              <Input
                value={characterDraft.name}
                onChange={(event) => setCharacterDraft((draft) => ({ ...draft, name: event.target.value }))}
                className="mt-2 rounded-2xl border-[var(--cg-border)]"
              />
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">描述</p>
              <Textarea
                value={characterDraft.description}
                onChange={(event) =>
                  setCharacterDraft((draft) => ({ ...draft, description: event.target.value }))
                }
                className="mt-2 min-h-[140px] rounded-3xl border-[var(--cg-border)]"
              />
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">别名</p>
              <Input
                value={characterDraft.aliases}
                onChange={(event) => setCharacterDraft((draft) => ({ ...draft, aliases: event.target.value }))}
                className="mt-2 rounded-2xl border-[var(--cg-border)]"
                placeholder="使用逗号分隔"
              />
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">登场章节</p>
              <div className="mt-2 max-h-[220px] space-y-2 overflow-auto rounded-[28px] border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] p-3">
                {chapters.map((node) => (
                  <label key={node.id} className="flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-sm text-[var(--cg-ink)]">
                    <input
                      type="checkbox"
                      checked={characterDraft.appearances.includes(node.id)}
                      onChange={(event) => {
                        setCharacterDraft((draft) => {
                          const next = new Set(draft.appearances)
                          if (event.target.checked) {
                            next.add(node.id)
                          } else {
                            next.delete(node.id)
                          }
                          return { ...draft, appearances: Array.from(next) }
                        })
                      }}
                    />
                    <span>
                      {node.narrative_order}. {node.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setShowAddCharacter(false)} className="rounded-full">
              取消
            </Button>
            <Button
              className="rounded-full bg-[var(--cg-accent)] text-[var(--cg-bg)]"
              onClick={handleCreateCharacter}
              disabled={!characterDraft.name.trim()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRelation} onOpenChange={setShowAddRelation}>
        <DialogContent className="max-w-xl rounded-[30px] border border-[var(--cg-border)] bg-[var(--cg-surface)]" style={cssVars}>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-[var(--cg-ink)]">新增角色关系</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-[var(--cg-muted)]">角色 A</p>
              <select
                className="mt-2 w-full rounded-2xl border border-[var(--cg-border)] bg-white px-3 py-2.5 text-sm"
                value={relationDraft.sourceId}
                onChange={(event) => setRelationDraft((draft) => ({ ...draft, sourceId: event.target.value }))}
              >
                <option value="">选择角色</option>
                {graphData.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">角色 B</p>
              <select
                className="mt-2 w-full rounded-2xl border border-[var(--cg-border)] bg-white px-3 py-2.5 text-sm"
                value={relationDraft.targetId}
                onChange={(event) => setRelationDraft((draft) => ({ ...draft, targetId: event.target.value }))}
              >
                <option value="">选择角色</option>
                {graphData.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">关系类型</p>
              <select
                className="mt-2 w-full rounded-2xl border border-[var(--cg-border)] bg-white px-3 py-2.5 text-sm"
                value={relationDraft.relationType}
                onChange={(event) => setRelationDraft((draft) => ({ ...draft, relationType: event.target.value }))}
              >
                {RELATION_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">关系名称</p>
              <Input
                value={relationDraft.relationName}
                onChange={(event) =>
                  setRelationDraft((draft) => ({ ...draft, relationName: event.target.value }))
                }
                className="mt-2 rounded-2xl border-[var(--cg-border)]"
                placeholder="如：师徒、宿敌、互相利用"
              />
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">说明</p>
              <Textarea
                value={relationDraft.description}
                onChange={(event) =>
                  setRelationDraft((draft) => ({ ...draft, description: event.target.value }))
                }
                className="mt-2 min-h-[120px] rounded-3xl border-[var(--cg-border)]"
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setShowAddRelation(false)} className="rounded-full">
              取消
            </Button>
            <Button
              className="rounded-full bg-[var(--cg-accent)] text-[var(--cg-bg)]"
              onClick={handleCreateRelation}
              disabled={!relationDraft.sourceId || !relationDraft.targetId}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showEditRelation}
        onOpenChange={(open) => {
          setShowEditRelation(open)
          if (!open) {
            setEditingRelationId(null)
            setEditingRelationPair(null)
          }
        }}
      >
        <DialogContent className="max-w-xl rounded-[30px] border border-[var(--cg-border)] bg-[var(--cg-surface)]" style={cssVars}>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-[var(--cg-ink)]">编辑角色关系</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-[24px] border border-[var(--cg-border)] bg-[var(--cg-surface-strong)] px-4 py-3">
              <p className="text-xs text-[var(--cg-muted)]">关系双方</p>
              <p className="mt-1 text-sm font-medium text-[var(--cg-ink)]">
                {editingRelationPair
                  ? `${editingRelationPair.sourceName} · ${editingRelationPair.targetName}`
                  : "未选择关系"}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">关系类型</p>
              <select
                className="mt-2 w-full rounded-2xl border border-[var(--cg-border)] bg-white px-3 py-2.5 text-sm"
                value={relationDraft.relationType}
                onChange={(event) =>
                  setRelationDraft((draft) => ({ ...draft, relationType: event.target.value }))
                }
              >
                {RELATION_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">关系名称</p>
              <Input
                value={relationDraft.relationName}
                onChange={(event) =>
                  setRelationDraft((draft) => ({ ...draft, relationName: event.target.value }))
                }
                className="mt-2 rounded-2xl border-[var(--cg-border)]"
                placeholder="如：盟友、师徒、互相利用"
              />
            </div>
            <div>
              <p className="text-xs text-[var(--cg-muted)]">说明</p>
              <Textarea
                value={relationDraft.description}
                onChange={(event) =>
                  setRelationDraft((draft) => ({ ...draft, description: event.target.value }))
                }
                className="mt-2 min-h-[120px] rounded-3xl border-[var(--cg-border)]"
              />
            </div>
          </div>
          <DialogFooter className="mt-4 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={handleDeleteRelation}
              className="rounded-full text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
              删除关系
            </Button>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setShowEditRelation(false)} className="rounded-full">
                取消
              </Button>
              <Button
                className="rounded-full bg-[var(--cg-accent)] text-[var(--cg-bg)]"
                onClick={handleUpdateRelation}
                disabled={!editingRelationId}
              >
                保存修改
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
