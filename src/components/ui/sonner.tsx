import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
      visibleToasts={3}
      expand
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast pointer-events-auto group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-2 group-[.toaster]:border-border group-[.toaster]:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] group-[.toaster]:rounded-lg group-[.toaster]:font-semibold",
          title: "group-[.toast]:font-bold group-[.toast]:text-base",
          description: "group-[.toast]:text-white/90 dark:group-[.toast]:text-white/90",
          success:
            "group-[.toaster]:!bg-emerald-500 group-[.toaster]:!text-white group-[.toaster]:!border-emerald-700 group-[.toaster]:!border-l-8",
          error:
            "group-[.toaster]:!bg-red-500 group-[.toaster]:!text-white group-[.toaster]:!border-red-700 group-[.toaster]:!border-l-8",
          warning:
            "group-[.toaster]:!bg-amber-500 group-[.toaster]:!text-white group-[.toaster]:!border-amber-700 group-[.toaster]:!border-l-8",
          info:
            "group-[.toaster]:!bg-sky-500 group-[.toaster]:!text-white group-[.toaster]:!border-sky-700 group-[.toaster]:!border-l-8",
          actionButton:
            "group-[.toast]:bg-white group-[.toast]:text-emerald-700 group-[.toast]:hover:bg-white/90",
          cancelButton:
            "group-[.toast]:bg-white/20 group-[.toast]:text-white group-[.toast]:hover:bg-white/30",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
