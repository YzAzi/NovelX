export type EntityType = "character"

export interface CharacterAppearance {
  node_id: string
  node_title: string
  narrative_order: number
  timeline_order?: number | null
}

export interface CharacterGraphNode {
  id: string
  name: string
  type?: EntityType
  description?: string
  aliases?: string[]
  properties?: Record<string, unknown>
  source_refs?: string[]
  appearances?: CharacterAppearance[]
  x?: number
  y?: number
}

export interface CharacterGraphLink {
  id?: string
  source: string | CharacterGraphNode
  target: string | CharacterGraphNode
  relation_type?: string
  relation_name?: string
  description?: string
}

export interface CharacterGraphResponse {
  nodes: CharacterGraphNode[]
  links: CharacterGraphLink[]
}
