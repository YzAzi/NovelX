"use client"

import dynamic from "next/dynamic"
import type { CSSProperties } from "react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d"

import {
  createGraphEntity,
  createGraphRelation,
  getCharacterGraph,
  syncCharacterGraph,
  updateGraphEntity,
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
import { Textarea } from "@/components/ui/textarea"

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
]

type Palette = {
  background: string
  surface: string
  border: string
  ink: string
  muted: string
  accent: string
  accentSoft: string
  link: string
}

const defaultPalette: Palette = {
  background: "#f7f7f2",
  surface: "#ffffff",
  border: "#e2e2dc",
  ink: "#111111",
  muted: "#5c5c58",
  accent: "#e04f2f",
  accentSoft: "#f6d8cf",
  link: "#2d2d2d",
}

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

function nodeLabel(node: CharacterGraphNode) {
  return node.name
}

export function CharacterGraph() {
  const { currentProject, graphUpdateVersion } = useProjectStore()
  const [graphData, setGraphData] = useState<CharacterGraphResponse>({
    nodes: [],
    links: [],
  })
  const [selectedChapterId, setSelectedChapterId] = useState<string | "all">(
    "all",
  )
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    null,
  )
  const [hoveredCharacterId, setHoveredCharacterId] = useState<string | null>(
    null,
  )
  const [graphSize, setGraphSize] = useState({ width: 0, height: 0 })
  const [graphKey, setGraphKey] = useState(0)
  const [palette, setPalette] = useState<Palette>(defaultPalette)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [editMode, setEditMode] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const [showAddCharacter, setShowAddCharacter] = useState(false)
  const [showAddRelation, setShowAddRelation] = useState(false)
  const [showCharacterDetail, setShowCharacterDetail] = useState(false)

  const [characterDraft, setCharacterDraft] = useState({
    name: "",
    description: "",
    aliases: "",
    appearances: [] as string[],
  })

  const [relationDraft, setRelationDraft] = useState({
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
    return [...currentProject.nodes].sort(
      (a, b) => a.narrative_order - b.narrative_order,
    )
  }, [currentProject])

  const selectedCharacter = selectedCharacterId
    ? nodesById.get(selectedCharacterId) ?? null
    : null

  const filteredGraph = useMemo(() => {
    const activeIds = new Set<string>()
    const nodes = graphData.nodes
    if (selectedChapterId === "all") {
      nodes.forEach((node) => activeIds.add(node.id))
    } else {
      nodes.forEach((node) => {
        const appearances = node.appearances ?? []
        if (appearances.some((item) => item.node_id === selectedChapterId)) {
          activeIds.add(node.id)
        }
      })
    }
    const filteredNodes = nodes.filter((node) => activeIds.has(node.id))
    const filteredLinks = graphData.links.filter((link) => {
      const source = typeof link.source === "string" ? link.source : link.source.id
      const target = typeof link.target === "string" ? link.target : link.target.id
      return activeIds.has(source) && activeIds.has(target)
    })
    return { nodes: filteredNodes, links: filteredLinks }
  }, [graphData.links, graphData.nodes, selectedChapterId])

  const visibleCharacters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return filteredGraph.nodes
    }
    return filteredGraph.nodes.filter((node) =>
      node.name.toLowerCase().includes(query),
    )
  }, [filteredGraph.nodes, searchQuery])

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
      border: read("--cg-border") || defaultPalette.border,
      ink: read("--cg-ink") || defaultPalette.ink,
      muted: read("--cg-muted") || defaultPalette.muted,
      accent: read("--cg-accent") || defaultPalette.accent,
      accentSoft: read("--cg-accent-soft") || defaultPalette.accentSoft,
      link: read("--cg-link") || defaultPalette.link,
    })
  }, [])

  useEffect(() => {
    if (
      !graphRef.current ||
      filteredGraph.nodes.length === 0 ||
      graphSize.width === 0 ||
      graphSize.height === 0
    ) {
      return
    }
    // Small delay to ensure internal canvas resize is complete
    const timer = setTimeout(() => {
      graphRef.current?.zoomToFit(500, 48)
    }, 100)
    return () => clearTimeout(timer)
  }, [filteredGraph.nodes.length, graphKey, graphSize.width, graphSize.height])

  useEffect(() => {
    setGraphKey((value) => value + 1)
  }, [selectedChapterId])

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
    await loadGraph()
    setEditMode(false)
  }, [
    characterDraft,
    currentProject?.id,
    loadGraph,
    selectedCharacter,
  ])

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
    await loadGraph()
    setShowAddCharacter(false)
  }, [characterDraft, currentProject?.id, loadGraph])

  const handleCreateRelation = useCallback(async () => {
    if (!currentProject?.id) {
      return
    }
    await createGraphRelation(currentProject.id, {
      source_id: relationDraft.sourceId,
      target_id: relationDraft.targetId,
      relation_type: relationDraft.relationType,
      relation_name: relationDraft.relationName,
      description: relationDraft.description,
    })
    await loadGraph()
    setShowAddRelation(false)
  }, [currentProject?.id, loadGraph, relationDraft])

  const handleSync = useCallback(
    async (mode: "full" | "node") => {
      if (!currentProject?.id) {
        return
      }
      setSyncing(true)
      try {
        await syncCharacterGraph(currentProject.id, {
          mode,
          node_id:
            mode === "node" && selectedChapterId !== "all"
              ? selectedChapterId
              : undefined,
        })
        await loadGraph()
      } finally {
        setSyncing(false)
      }
    },
    [currentProject?.id, loadGraph, selectedChapterId],
  )

  const selectChapterOptions = chapters.map((node) => ({
    value: node.id,
    label: `${node.narrative_order}. ${node.title}`,
  }))

  const cssVars = {
    "--cg-bg": "#f7f7f2",
    "--cg-surface": "#ffffff",
    "--cg-border": "#dedbd3",
    "--cg-ink": "#121212",
    "--cg-muted": "#5a5852",
    "--cg-accent": "#e04f2f",
    "--cg-accent-soft": "#f6d8cf",
    "--cg-link": "#2b2b2b",
  } as CSSProperties

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-black/5 bg-[var(--cg-bg)] text-[var(--cg-ink)] shadow-[0_20px_80px_rgba(0,0,0,0.08)]"
      style={cssVars}
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(224,79,47,0.18),_transparent_50%)]" />
        <div className="absolute inset-x-0 top-0 -z-10 h-24 bg-gradient-to-b from-white/70 to-transparent" />
      </div>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--cg-border)] px-6 py-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--cg-muted)]">
            Character Atlas
          </p>
          <h2 className="font-serif text-2xl text-[var(--cg-ink)] md:text-3xl">
            角色关系图
          </h2>
          <p className="max-w-xl text-sm text-[var(--cg-muted)]">
            只呈现角色之间的关系。切换大纲章节即可查看该章节登场角色。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-surface)] text-sm"
            onClick={() => handleSync("full")}
            disabled={syncing}
          >
            {syncing ? "同步中…" : "全量同步"}
          </Button>
          <Button
            className="rounded-full bg-[var(--cg-accent)] text-[var(--cg-bg)] hover:bg-[var(--cg-accent)]/90"
            onClick={() => handleSync("node")}
            disabled={syncing || selectedChapterId === "all"}
          >
            同步当前章节
          </Button>
        </div>
      </header>

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <div className="space-y-3 rounded-2xl border border-[var(--cg-border)] bg-[var(--cg-surface)] p-4 shadow-[0_12px_40px_rgba(17,17,17,0.06)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cg-muted)]">
                章节筛选
              </p>
              <span className="rounded-full bg-[var(--cg-accent-soft)] px-2 py-0.5 text-xs text-[var(--cg-accent)]">
                {filteredGraph.nodes.length} 角色
              </span>
            </div>
            <select
              className="w-full rounded-xl border border-[var(--cg-border)] bg-[var(--cg-bg)] px-3 py-2 text-sm text-[var(--cg-ink)]"
              value={selectedChapterId}
              onChange={(event) =>
                setSelectedChapterId(event.target.value as string | "all")
              }
            >
              <option value="all">全部章节</option>
              {selectChapterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="space-y-2">
              <p className="text-xs text-[var(--cg-muted)]">搜索角色</p>
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="输入角色名"
                className="rounded-xl border-[var(--cg-border)] bg-white/70"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--cg-border)] bg-[var(--cg-surface)] p-4 shadow-[0_12px_40px_rgba(17,17,17,0.06)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cg-muted)]">
                角色列表
              </p>
              <Button
                size="sm"
                className="rounded-full bg-[var(--cg-accent)] text-[var(--cg-bg)]"
                onClick={() => {
                  setCharacterDraft({
                    name: "",
                    description: "",
                    aliases: "",
                    appearances:
                      selectedChapterId === "all" ? [] : [selectedChapterId],
                  })
                  setShowAddCharacter(true)
                }}
              >
                添加角色
              </Button>
            </div>
            <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
              {visibleCharacters.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--cg-border)] px-3 py-6 text-center text-sm text-[var(--cg-muted)]">
                  当前章节暂无角色
                </p>
              ) : (
                visibleCharacters.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      setSelectedCharacterId(node.id)
                      setShowCharacterDetail(true)
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                      node.id === selectedCharacterId
                        ? "border-[var(--cg-accent)] bg-[var(--cg-accent-soft)] text-[var(--cg-ink)]"
                        : "border-[var(--cg-border)] bg-white/70 hover:border-[var(--cg-accent)]/40"
                    }`}
                  >
                    <span>{node.name}</span>
                    <span className="text-xs text-[var(--cg-muted)]">
                      {(node.appearances ?? []).length}
                    </span>
                  </button>
                ))
              )}
            </div>
            <Button
              variant="secondary"
              className="w-full rounded-full border border-[var(--cg-border)] bg-transparent"
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

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-serif text-xl text-[var(--cg-ink)]">
                关系网络
              </h3>
              <p className="text-sm text-[var(--cg-muted)]">
                只展示角色之间有关系的连线
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--cg-muted)]">
              <span>{filteredGraph.links.length} 条关系</span>
              <span className="h-4 w-px bg-[var(--cg-border)]" />
              <span>{filteredGraph.nodes.length} 个角色</span>
            </div>
          </div>

          <div
            ref={containerRef}
            className="relative min-h-[520px] overflow-hidden rounded-3xl border border-[var(--cg-border)] bg-[var(--cg-surface)]"
          >
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--cg-muted)]">
                加载角色关系图…
              </div>
            ) : filteredGraph.nodes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--cg-muted)]">
                <p>当前没有角色关系可展示</p>
                <p>可新增角色或进行手动同步</p>
              </div>
            ) : (
              <ForceGraph2D
                key={graphKey}
                ref={graphRef}
                graphData={filteredGraph}
                width={graphSize.width}
                height={graphSize.height}
                backgroundColor={palette.surface}
                nodeLabel={(node) => nodeLabel(node as CharacterGraphNode)}
                onNodeClick={(node) => handleNodeClick(node as CharacterGraphNode)}
                onNodeHover={(node) =>
                  setHoveredCharacterId((node as CharacterGraphNode | null)?.id ?? null)
                }
                linkColor={() => palette.link}
                linkWidth={(link) =>
                  hoveredCharacterId &&
                  [
                    (link as CharacterGraphLink).source,
                    (link as CharacterGraphLink).target,
                  ].some((item) =>
                    (typeof item === "string" ? item : item.id) ===
                    hoveredCharacterId,
                  )
                    ? 2.2
                    : 1
                }
                nodeCanvasObject={(node, ctx, globalScale) => {
                  const graphNode = node as CharacterGraphNode & {
                    x?: number
                    y?: number
                  }
                  if (graphNode.x == null || graphNode.y == null) {
                    return
                  }
                  const isSelected = graphNode.id === selectedCharacterId
                  const isHovered = graphNode.id === hoveredCharacterId
                  const fontSize = 12 / globalScale
                  const label = graphNode.name
                  ctx.font = `${fontSize}px var(--font-sans)`
                  const textWidth = ctx.measureText(label).width
                  const padding = 8 / globalScale
                  const radius = 10 / globalScale
                  const width = textWidth + padding * 2
                  const height = fontSize + padding

                  ctx.fillStyle = isSelected
                    ? palette.accent
                    : isHovered
                      ? palette.accentSoft
                      : palette.background
                  ctx.strokeStyle = isSelected
                    ? palette.accent
                    : palette.border
                  ctx.lineWidth = 1 / globalScale

                  ctx.beginPath()
                  const roundRect = (
                    ctx as CanvasRenderingContext2D & {
                      roundRect?: (
                        x: number,
                        y: number,
                        w: number,
                        h: number,
                        r: number,
                      ) => void
                    }
                  ).roundRect
                  if (roundRect) {
                    roundRect.call(
                      ctx,
                      graphNode.x - width / 2,
                      graphNode.y - height / 2,
                      width,
                      height,
                      radius,
                    )
                  } else {
                    const x = graphNode.x - width / 2
                    const y = graphNode.y - height / 2
                    ctx.moveTo(x + radius, y)
                    ctx.lineTo(x + width - radius, y)
                    ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
                    ctx.lineTo(x + width, y + height - radius)
                    ctx.quadraticCurveTo(
                      x + width,
                      y + height,
                      x + width - radius,
                      y + height,
                    )
                    ctx.lineTo(x + radius, y + height)
                    ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
                    ctx.lineTo(x, y + radius)
                    ctx.quadraticCurveTo(x, y, x + radius, y)
                  }
                  ctx.fill()
                  ctx.stroke()

                  ctx.fillStyle = isSelected
                    ? palette.background
                    : palette.ink
                  ctx.textAlign = "center"
                  ctx.textBaseline = "middle"
                  ctx.fillText(label, graphNode.x, graphNode.y)
                }}
              />
            )}
          </div>
        </section>
      </div>

      {/* Character Details Dialog */}
      <Dialog
        open={showCharacterDetail}
        onOpenChange={(open) => {
          setShowCharacterDetail(open)
          if (!open) setEditMode(false)
        }}
      >
        <DialogContent
          className="flex h-[80vh] w-[80vw] max-w-5xl flex-col gap-6 rounded-3xl"
          style={cssVars}
        >
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {selectedCharacter?.name || "角色档案"}
            </DialogTitle>
          </DialogHeader>

          {!selectedCharacter ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--cg-muted)]">
              请选择一个角色
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pr-2 space-y-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
              <div>
                <p className="text-sm font-medium text-[var(--cg-muted)]">
                  角色名
                </p>
                {editMode ? (
                  <Input
                    value={characterDraft.name}
                    onChange={(event) =>
                      setCharacterDraft((draft) => ({
                        ...draft,
                        name: event.target.value,
                      }))
                    }
                    className="mt-2 rounded-xl border-[var(--cg-border)]"
                  />
                ) : (
                  <p className="mt-2 font-serif text-3xl font-bold text-[var(--cg-ink)]">
                    {selectedCharacter.name}
                  </p>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-[var(--cg-muted)]">
                  描述
                </p>
                {editMode ? (
                  <Textarea
                    value={characterDraft.description}
                    onChange={(event) =>
                      setCharacterDraft((draft) => ({
                        ...draft,
                        description: event.target.value,
                      }))
                    }
                    className="mt-2 min-h-[200px] rounded-xl border-[var(--cg-border)] text-base leading-relaxed"
                  />
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-lg leading-relaxed text-[var(--cg-ink)]">
                    {selectedCharacter.description || "暂无描述"}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-[var(--cg-muted)]">
                    别名
                  </p>
                  {editMode ? (
                    <Input
                      value={characterDraft.aliases}
                      onChange={(event) =>
                        setCharacterDraft((draft) => ({
                          ...draft,
                          aliases: event.target.value,
                        }))
                      }
                      className="mt-2 rounded-xl border-[var(--cg-border)]"
                      placeholder="使用逗号分隔"
                    />
                  ) : (
                    <p className="mt-2 text-base text-[var(--cg-ink)]">
                      {(selectedCharacter.aliases ?? []).join("、") || "无"}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-[var(--cg-muted)]">
                  登场章节
                </p>
                {editMode ? (
                  <div className="mt-2 max-h-[300px] space-y-2 overflow-auto rounded-xl border border-[var(--cg-border)] bg-[var(--cg-bg)] p-4">
                    {chapters.map((node) => (
                      <label
                        key={node.id}
                        className="flex items-center gap-3 text-base"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-[var(--cg-accent)] focus:ring-[var(--cg-accent)]"
                          checked={characterDraft.appearances.includes(
                            node.id,
                          )}
                          onChange={(event) => {
                            setCharacterDraft((draft) => {
                              const next = new Set(draft.appearances)
                              if (event.target.checked) {
                                next.add(node.id)
                              } else {
                                next.delete(node.id)
                              }
                              return {
                                ...draft,
                                appearances: Array.from(next),
                              }
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
                          className="rounded-full border border-[var(--cg-border)] bg-[var(--cg-bg)] px-4 py-1.5 text-sm font-medium transition hover:border-[var(--cg-accent)]"
                        >
                          {item.narrative_order}. {item.node_title}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="mt-0 gap-3 sm:justify-between border-t border-[var(--cg-border)] pt-4">
            <div className="flex-1" />
            {selectedCharacter &&
              (editMode ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setEditMode(false)}
                    className="rounded-full px-6"
                  >
                    取消
                  </Button>
                  <Button
                    className="rounded-full bg-[var(--cg-accent)] px-6 text-[var(--cg-bg)] hover:bg-[var(--cg-accent)]/90"
                    onClick={handleSaveCharacter}
                  >
                    保存档案
                  </Button>
                </>
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
        <DialogContent className="max-w-lg rounded-3xl" style={cssVars}>
          <DialogHeader>
            <DialogTitle>新增角色</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">角色名</p>
              <Input
                value={characterDraft.name}
                onChange={(event) =>
                  setCharacterDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">描述</p>
              <Textarea
                value={characterDraft.description}
                onChange={(event) =>
                  setCharacterDraft((draft) => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
                className="min-h-[120px]"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">别名</p>
              <Input
                value={characterDraft.aliases}
                onChange={(event) =>
                  setCharacterDraft((draft) => ({
                    ...draft,
                    aliases: event.target.value,
                  }))
                }
                placeholder="使用逗号分隔"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">登场章节</p>
              <div className="mt-2 max-h-[200px] space-y-2 overflow-auto rounded-xl border border-border bg-muted/30 p-3">
                {chapters.map((node) => (
                  <label key={node.id} className="flex items-center gap-2 text-sm">
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
            <Button variant="secondary" onClick={() => setShowAddCharacter(false)}>
              取消
            </Button>
            <Button
              className="bg-[var(--cg-accent)] text-[var(--cg-bg)]"
              onClick={handleCreateCharacter}
              disabled={!characterDraft.name.trim()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRelation} onOpenChange={setShowAddRelation}>
        <DialogContent className="max-w-lg rounded-3xl" style={cssVars}>
          <DialogHeader>
            <DialogTitle>新增角色关系</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">角色 A</p>
              <select
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                value={relationDraft.sourceId}
                onChange={(event) =>
                  setRelationDraft((draft) => ({
                    ...draft,
                    sourceId: event.target.value,
                  }))
                }
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
              <p className="text-xs text-muted-foreground">角色 B</p>
              <select
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                value={relationDraft.targetId}
                onChange={(event) =>
                  setRelationDraft((draft) => ({
                    ...draft,
                    targetId: event.target.value,
                  }))
                }
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
              <p className="text-xs text-muted-foreground">关系类型</p>
              <select
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                value={relationDraft.relationType}
                onChange={(event) =>
                  setRelationDraft((draft) => ({
                    ...draft,
                    relationType: event.target.value,
                  }))
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
              <p className="text-xs text-muted-foreground">关系名称</p>
              <Input
                value={relationDraft.relationName}
                onChange={(event) =>
                  setRelationDraft((draft) => ({
                    ...draft,
                    relationName: event.target.value,
                  }))
                }
                placeholder="如：师徒、宿敌"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">说明</p>
              <Textarea
                value={relationDraft.description}
                onChange={(event) =>
                  setRelationDraft((draft) => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setShowAddRelation(false)}>
              取消
            </Button>
            <Button
              className="bg-[var(--cg-accent)] text-[var(--cg-bg)]"
              onClick={handleCreateRelation}
              disabled={!relationDraft.sourceId || !relationDraft.targetId}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}