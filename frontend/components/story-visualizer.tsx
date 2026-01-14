"use client"

import "@xyflow/react/dist/style.css"

import { useMemo, useCallback, useEffect, useRef } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import dagre from "dagre"

import type { StoryNode } from "@/src/types/models"
import { useProjectStore } from "@/src/stores/project-store"
import { cn } from "@/lib/utils"

const NODE_WIDTH = 220
const NODE_HEIGHT = 120
const LANE_HEIGHT = 180
const TAG_COLORS = [
  "bg-amber-100/80 text-amber-900",
  "bg-sky-100/80 text-sky-900",
  "bg-emerald-100/80 text-emerald-900",
  "bg-rose-100/80 text-rose-900",
  "bg-lime-100/80 text-lime-900",
  "bg-orange-100/80 text-orange-900",
  "bg-teal-100/80 text-teal-900",
  "bg-fuchsia-100/80 text-fuchsia-900",
]

const defaultEdgeOptions = { type: "smoothstep", animated: false }

type StoryNodeData = {
  title: string
  locationTag: string
  colorClass: string
  highlight: boolean
}

type StoryFlowNode = Node<StoryNodeData, "storyNode">

function StoryNodeCard({ data, selected }: NodeProps<StoryFlowNode>) {
  return (
    <div
      className={cn(
        "w-[220px] rounded-xl border border-white/70 bg-white/80 p-3 shadow-sm backdrop-blur transition",
        selected
          ? "ring-2 ring-primary/60"
          : data.highlight
            ? "ring-2 ring-amber-300"
            : "hover:border-slate-300/70"
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="mb-2 text-sm font-semibold text-slate-900">{data.title}</div>
      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", data.colorClass)}>
        {data.locationTag}
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function getLocationTag(node: StoryNode) {
  const tag = node.location_tag?.trim()
  return tag && tag.length > 0 ? tag : "未标记"
}

function getTagColor(tag: string, lanes: string[]) {
  const index = lanes.indexOf(tag)
  return TAG_COLORS[index % TAG_COLORS.length]
}

function buildEdges(nodes: StoryNode[]): Edge[] {
  const sorted = [...nodes].sort((a, b) => a.narrative_order - b.narrative_order)
  const edges: Edge[] = []
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const source = sorted[i]
    const target = sorted[i + 1]
    edges.push({
      id: `edge-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      type: "smoothstep",
    })
  }
  return edges
}

function buildLayoutEdges(nodes: StoryNode[]) {
  const sorted = [...nodes].sort((a, b) => a.timeline_order - b.timeline_order)
  const edges: Array<{ source: string; target: string }> = []
  for (let i = 0; i < sorted.length - 1; i += 1) {
    edges.push({ source: sorted[i].id, target: sorted[i + 1].id })
  }
  return edges
}

function buildLayout(
  storyNodes: StoryNode[],
  lanes: string[]
): { nodes: StoryFlowNode[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 140,
  })

  storyNodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })

  const layoutEdges = buildLayoutEdges(storyNodes)
  layoutEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const laneMap = new Map<string, number>()
  lanes.forEach((tag, index) => laneMap.set(tag, index))

  const nodes: StoryFlowNode[] = storyNodes.map((node) => {
    const tag = getLocationTag(node)
    const laneIndex = laneMap.get(tag) ?? 0
    const dagreNode = dagreGraph.node(node.id)
    const x = dagreNode ? dagreNode.x - NODE_WIDTH / 2 : 0
    const y = laneIndex * LANE_HEIGHT + (LANE_HEIGHT - NODE_HEIGHT) / 2

    return {
      id: node.id,
      type: "storyNode",
      data: {
        title: node.title || "未命名节点",
        locationTag: tag,
        colorClass: getTagColor(tag, lanes),
        highlight: false,
      },
      position: { x, y },
    }
  })

  return { nodes, edges: buildEdges(storyNodes) }
}

export function StoryVisualizer() {
  const {
    currentProject,
    selectedNodeId,
    highlightedNodeIds,
    selectNode,
    setNodeEditorOpen,
  } = useProjectStore()
  const storyNodes = currentProject?.nodes ?? []
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null)
  const lanes = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    storyNodes.forEach((node) => {
      const tag = getLocationTag(node)
      if (!seen.has(tag)) {
        seen.add(tag)
        result.push(tag)
      }
    })
    return result.length > 0 ? result : ["未标记"]
  }, [storyNodes])

  const { nodes, edges } = useMemo(() => buildLayout(storyNodes, lanes), [storyNodes, lanes])

  const flowNodes = useMemo(() => {
    const highlighted = new Set(highlightedNodeIds)
    return nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        highlight: highlighted.has(node.id),
      },
    }))
  }, [nodes, highlightedNodeIds, selectedNodeId])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id)
      setNodeEditorOpen(true)
    },
    [selectNode, setNodeEditorOpen]
  )

  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id)
      document.getElementById("node-editor")?.focus()
    },
    [selectNode]
  )

  const nodeTypes = useMemo(() => ({ storyNode: StoryNodeCard }), [])

  useEffect(() => {
    const instance = flowInstanceRef.current
    if (!instance || flowNodes.length === 0) {
      return
    }
    const id = window.requestAnimationFrame(() => {
      instance.fitView({ padding: 0.2, duration: 0 })
    })
    return () => window.cancelAnimationFrame(id)
  }, [flowNodes.length])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) {
      return
    }

    const observer = new ResizeObserver(() => {
      const instance = flowInstanceRef.current
      if (!instance || flowNodes.length === 0) {
        return
      }
      window.requestAnimationFrame(() => {
        instance.fitView({ padding: 0.2, duration: 0 })
      })
    })

    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [flowNodes.length])

  if (!currentProject) {
    return (
      <div className="surface-card flex h-full items-center justify-center border-dashed text-sm text-muted-foreground">
        先创建大纲以查看节点布局。
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="surface-card flex h-full overflow-hidden">
      <div className="flex w-[140px] shrink-0 flex-col border-r border-white/60 bg-white/60">
        <div className="px-3 py-3 text-xs font-semibold text-slate-500">场景泳道</div>
        <div className="flex flex-1 flex-col">
          {lanes.map((lane, index) => (
            <div
              key={`${lane}-${index}`}
              className="flex items-center px-3 text-xs font-medium text-slate-600"
              style={{ height: LANE_HEIGHT }}
            >
              {lane}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          className="h-full w-full"
          defaultEdgeOptions={defaultEdgeOptions}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onInit={(instance) => {
            flowInstanceRef.current = instance
          }}
          panOnScroll
          zoomOnScroll
          fitView
          minZoom={0.4}
          maxZoom={1.4}
          nodesDraggable={false}
        >
          <Background gap={24} size={1} />
          <Controls position="bottom-right" />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  )
}
