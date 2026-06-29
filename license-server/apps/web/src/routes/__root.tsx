import { Outlet, createRootRoute } from '@tanstack/react-router'

import '../styles.css'
import { ConfirmProvider } from '#/components/confirm.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Toaster } from '#/components/ui/sonner.tsx'
import { TooltipProvider } from '#/components/ui/tooltip'

export const Route = createRootRoute({
    component: RootComponent,
    errorComponent: RootErrorComponent,
})

/** Catches render/loader errors anywhere in the tree instead of a blank screen. */
function RootErrorComponent({ error }: { error: Error }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
                <h1 className="font-heading text-lg font-semibold text-foreground">
                    Something went wrong
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    An unexpected error interrupted this page. Reloading usually fixes it.
                </p>
                {error?.message ? (
                    <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted-surface p-3 text-left text-xs text-muted-foreground">
                        {error.message}
                    </pre>
                ) : null}
                <Button className="mt-4" onClick={() => window.location.reload()}>
                    Reload page
                </Button>
            </div>
        </div>
    )
}

function RootComponent() {
    return (
        <TooltipProvider>
            <ConfirmProvider>
                <Outlet />
            </ConfirmProvider>
            <Toaster richColors position="top-right" />
        </TooltipProvider>
    )
}
