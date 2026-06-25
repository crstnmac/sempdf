import { Outlet, createRootRoute } from '@tanstack/react-router'

import '../styles.css'
import { Toaster } from '#/components/ui/sonner.tsx'
import { TooltipProvider } from '#/components/ui/tooltip'

export const Route = createRootRoute({
    component: RootComponent,
})

function RootComponent() {
    return (
        <TooltipProvider>
            <Outlet />
            <Toaster richColors position="top-right" />
        </TooltipProvider>
    )
}
