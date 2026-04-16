"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"
import { AUTH_EXPIRED_EVENT, getAuthToken } from "@/src/lib/api"

type ProjectRouteGuardProps = {
  projectId: string
  children: ReactNode
}

export function ProjectRouteGuard({
  projectId,
  children,
}: ProjectRouteGuardProps) {
  const { currentProject, error, loadProject, resetWorkspace } = useProjectStore()
  const [isBootstrapping, setIsBootstrapping] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handleAuthExpired = () => {
      resetWorkspace()
      router.replace("/")
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    if (!getAuthToken()) {
      handleAuthExpired()
      return () => {
        window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
      }
    }
    
    // Defer state update to avoid synchronous cascading renders
    Promise.resolve().then(() => setSessionChecked(true))

    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    }
  }, [resetWorkspace, router])

  useEffect(() => {
    if (!sessionChecked || !projectId || currentProject?.id === projectId) {
      return
    }
    let cancelled = false
    
    // Defer state update to avoid synchronous cascading renders
    Promise.resolve().then(() => setIsBootstrapping(true))
    
    void loadProject(projectId).finally(() => {
      if (!cancelled) {
        setIsBootstrapping(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [currentProject?.id, loadProject, projectId, sessionChecked])

  if (!projectId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">无效的项目地址。</p>
          <Button asChild variant="outline">
            <Link href="/">返回主页</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (!sessionChecked || isBootstrapping || currentProject?.id !== projectId) {
    if (!isBootstrapping && error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button asChild variant="outline">
              <Link href="/">返回主页</Link>
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">正在恢复项目…</p>
          <p className="text-xs text-muted-foreground">
            正在根据链接加载项目内容。
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
