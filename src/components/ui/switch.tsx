import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

const switchRootSizeClasses = {
  default: "h-[18px] w-8 p-px",
  sm: "h-[14px] w-6 p-px",
} as const

const switchThumbSizeClasses = {
  default: "size-4 data-[checked]:translate-x-[14px]",
  sm: "size-3 data-[checked]:translate-x-[10px]",
} as const

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer relative inline-flex shrink-0 items-center rounded-full border border-border/70 transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-[checked]:border-primary/40 data-[checked]:bg-primary data-[unchecked]:bg-input data-[unchecked]:hover:bg-input/80 dark:data-[unchecked]:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        switchRootSizeClasses[size],
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full shadow-sm ring-0 transition-transform data-[unchecked]:translate-x-0 data-[checked]:bg-primary-foreground data-[unchecked]:bg-foreground",
          switchThumbSizeClasses[size]
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
