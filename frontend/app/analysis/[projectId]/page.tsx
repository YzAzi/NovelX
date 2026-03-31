"use client"

import { useParams } from "next/navigation"

import OutlineAnalysisPage from "@/app/analysis/page"
import { ProjectRouteGuard } from "@/components/project-route-guard"

export default function ProjectAnalysisPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = Array.isArray(params?.projectId)
    ? params.projectId[0]
    : params?.projectId ?? ""

  return (
    <ProjectRouteGuard projectId={projectId}>
      <OutlineAnalysisPage />
    </ProjectRouteGuard>
  )
}
