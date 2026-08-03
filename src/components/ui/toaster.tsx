import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle2, AlertCircle, Info } from "lucide-react"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const Icon =
          variant === "destructive" ? AlertCircle : variant === "success" ? CheckCircle2 : Info
        return (
          <Toast
            key={id}
            variant={variant}
            {...props}
            className="transition-all duration-300 ease-out"
          >
            <div className="flex gap-3 items-start w-full">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
                <Icon className="h-5 w-5 text-white" strokeWidth={2.25} />
              </div>
              <div className="grid gap-0.5 flex-1 min-w-0 pt-0.5">
                {title && (
                  <ToastTitle data-toast-title className="text-[15px] font-semibold leading-tight">
                    {title}
                  </ToastTitle>
                )}
                {description && (
                  <ToastDescription data-toast-desc className="text-[13px] leading-snug opacity-100">
                    {description}
                  </ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
