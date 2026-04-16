import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-2xl border border-input/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(247,242,235,0.9))] px-3.5 py-3 text-base shadow-[0_10px_28px_rgba(55,44,28,0.05)] transition-[color,box-shadow,background-color,border-color] outline-none placeholder:text-muted-foreground/70 hover:border-primary/20 hover:bg-background focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:shadow-[0_18px_40px_rgba(77,102,177,0.12)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
