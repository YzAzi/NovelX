import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground/70 selection:bg-primary selection:text-primary-foreground border-input/75 h-11 w-full min-w-0 rounded-2xl border bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(247,242,235,0.92))] px-3.5 py-2 text-base shadow-[0_10px_28px_rgba(55,44,28,0.05)] transition-[color,box-shadow,background-color,border-color,transform] outline-none backdrop-blur file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:border-primary/20 hover:bg-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:bg-background focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:shadow-[0_18px_40px_rgba(77,102,177,0.12)]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
