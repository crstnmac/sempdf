# Production Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved refined-calm shadcn sidebar with accessible navigation, desktop icon collapse, and mobile sheet behavior.

**Architecture:** Keep `SidebarProvider` as the state owner and enhance the existing shadcn sidebar primitives rather than adding a component library. `AppSidebar` composes the branded header, semantic navigation, collapse rail, and account footer; route links close only the mobile sheet. Focused Vitest/Testing Library tests exercise state and accessible semantics before visual changes are added.

**Tech Stack:** React 19, TypeScript, TanStack Router, shadcn/Base UI, Tailwind CSS 4, Vitest, Testing Library

---

## File Structure

- `license-server/apps/web/src/components/ui/sidebar.tsx`: accessible sidebar state controls, mobile sheet labeling, reduced-motion transitions, and production target sizing.
- `license-server/apps/web/src/components/app-sidebar.tsx`: branded sidebar composition, semantic navigation landmark, active route semantics, mobile route dismissal, and collapse rail.
- `license-server/apps/web/src/components/nav-user.tsx`: accessible account trigger and refined footer presentation.
- `license-server/apps/web/src/components/site-header.tsx`: state-aware sidebar trigger presentation.
- `license-server/apps/web/src/styles.css`: refined-calm sidebar design tokens.
- `license-server/apps/web/src/components/sidebar.test.tsx`: component-level accessibility and interaction regression tests.
- `license-server/apps/web/vite.config.ts`: Vitest jsdom configuration.

### Task 1: Establish Sidebar Accessibility Tests

**Files:**
- Create: `license-server/apps/web/src/components/sidebar.test.tsx`
- Modify: `license-server/apps/web/vite.config.ts`

- [ ] **Step 1: Configure Vitest for React component tests**

Add the following `test` configuration to `defineConfig`:

```ts
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
},
```

Create `license-server/apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
})
```

Install the missing test-only matcher package:

```bash
cd license-server && npm install --workspace @sempdf/license-dashboard --save-dev @testing-library/jest-dom
```

- [ ] **Step 2: Write failing state-aware trigger tests**

Create `sidebar.test.tsx` with a harness:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from '#/components/ui/sidebar.tsx'

function SidebarHarness() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <span>Navigation</span>
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>
  )
}

describe('SidebarTrigger', () => {
  it('announces and exposes the expanded sidebar state', () => {
    render(<SidebarHarness />)
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('updates its name after collapsing the sidebar', () => {
    render(<SidebarHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
```

- [ ] **Step 3: Run the tests and verify the expected failure**

Run:

```bash
cd license-server && npm test --workspace @sempdf/license-dashboard -- sidebar.test.tsx
```

Expected: both tests fail because the trigger is named “Toggle Sidebar” and does not expose `aria-expanded`.

- [ ] **Step 4: Do not implement yet**

Task 2 supplies the minimal production change that makes these tests pass.

### Task 2: Make the shadcn Sidebar Primitive Production-Ready

**Files:**
- Modify: `license-server/apps/web/src/components/ui/sidebar.tsx`
- Test: `license-server/apps/web/src/components/sidebar.test.tsx`

- [ ] **Step 1: Implement state-aware trigger semantics**

Update `SidebarTrigger` to consume `state`, `isMobile`, and `openMobile`, derive the visible state, and merge a caller-provided label safely:

```tsx
const { state, isMobile, openMobile, toggleSidebar } = useSidebar()
const expanded = isMobile ? openMobile : state === 'expanded'
const label = expanded ? 'Collapse sidebar' : 'Expand sidebar'

return (
  <Button
    type="button"
    aria-label={label}
    aria-expanded={expanded}
    title={`${label} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+B)`}
    data-sidebar="trigger"
    data-slot="sidebar-trigger"
    variant="ghost"
    size="icon"
    className={cn('size-11 rounded-xl focus-visible:ring-2', className)}
    onClick={(event) => {
      onClick?.(event)
      if (!event.defaultPrevented) toggleSidebar()
    }}
    {...props}
  >
    <PanelLeftIcon aria-hidden="true" />
  </Button>
)
```

Avoid using `navigator.platform` if it complicates SSR; a static “Ctrl/Command+B” title is acceptable while the accessible name remains state-aware.

- [ ] **Step 2: Improve mobile sheet semantics and controls**

Give the sheet an accurate hidden heading and description, stop hiding the built-in close button, and use mobile-safe width:

```tsx
<SheetContent
  aria-label="Application navigation"
  className="w-[min(20rem,calc(100vw-1rem))] bg-sidebar p-0 text-sidebar-foreground"
  side={side}
>
  <SheetHeader className="sr-only">
    <SheetTitle>Application navigation</SheetTitle>
    <SheetDescription>Navigate your workspace and manage your account.</SheetDescription>
  </SheetHeader>
  <div className="flex h-full w-full flex-col">{children}</div>
</SheetContent>
```

- [ ] **Step 3: Refine base transitions and target sizes**

Use `motion-reduce:transition-none` on gap/container/group-label transitions. Increase the icon rail width to `3.5rem`, make default menu buttons `min-h-11`, and keep collapsed buttons `size-11`.

```ts
const SIDEBAR_WIDTH_ICON = '3.5rem'
```

Update `sidebarMenuButtonVariants` so default rows use:

```txt
min-h-11 rounded-xl px-3 py-2.5 focus-visible:ring-2 focus-visible:ring-inset
group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:p-3!
```

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
cd license-server && npm test --workspace @sempdf/license-dashboard -- sidebar.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit the primitive and its tests**

```bash
git add license-server/apps/web/vite.config.ts \
  license-server/apps/web/src/test/setup.ts \
  license-server/apps/web/src/components/sidebar.test.tsx \
  license-server/apps/web/src/components/ui/sidebar.tsx \
  license-server/package.json license-server/package-lock.json
git commit -m "feat: harden sidebar accessibility controls"
```

### Task 3: Compose the Refined-Calm Application Sidebar

**Files:**
- Modify: `license-server/apps/web/src/components/app-sidebar.tsx`
- Modify: `license-server/apps/web/src/components/nav-user.tsx`
- Modify: `license-server/apps/web/src/components/site-header.tsx`
- Modify: `license-server/apps/web/src/styles.css`
- Test: `license-server/apps/web/src/components/sidebar.test.tsx`

- [ ] **Step 1: Write a failing navigation semantics test**

Extend `sidebar.test.tsx` with a minimal TanStack memory router and render `AppSidebar` at `/licenses`. Assert:

```tsx
expect(screen.getByRole('navigation', { name: 'License Ops navigation' })).toBeVisible()
expect(screen.getByRole('link', { name: 'Licenses' })).toHaveAttribute(
  'aria-current',
  'page',
)
expect(screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'))).toHaveLength(1)
expect(screen.getByRole('button', { name: /account menu for/i })).toBeVisible()
```

Use a `createRootRoute`, child routes for `/` and `/licenses`, `createMemoryHistory({ initialEntries: ['/licenses'] })`, and `createRouter`.

- [ ] **Step 2: Run the navigation test and verify red**

Run:

```bash
cd license-server && npm test --workspace @sempdf/license-dashboard -- sidebar.test.tsx
```

Expected: failure because there is no labeled navigation landmark, route link lacks `aria-current`, and the account trigger lacks an explicit name.

- [ ] **Step 3: Implement the application composition**

Update `AppSidebar` to:

```tsx
const { isMobile, setOpenMobile } = useSidebar()
const navigationLabel = `${config.label} navigation`

function handleNavigate() {
  if (isMobile) setOpenMobile(false)
}

return (
  <Sidebar
    aria-label={navigationLabel}
    collapsible="icon"
    className="border-r-0 p-2"
    variant="floating"
    {...props}
  >
    <SidebarHeader className="gap-3 p-2 pb-3">
      {/* branded home link with full logo, product label, and collapsed mark */}
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup className="px-2 py-1">
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label={navigationLabel}>
            <SidebarMenu className="gap-1.5">
              {/* configured links */}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter className="border-t border-sidebar-border/70 p-2">
      <NavUser user={user} onSignOut={onSignOut} />
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
)
```

For each `Link`, use `activeProps={{ 'data-active': 'true', 'aria-current': 'page' }}`, `onClick={handleNavigate}`, and a menu-button class with a `before:` edge indicator on active state. Mark every Lucide icon `aria-hidden="true"`.

- [ ] **Step 4: Refine the account trigger**

Set `aria-label={`Account menu for ${name}`}` and `aria-haspopup="menu"` on the dropdown trigger. Give the avatar image `alt=""`, mark the ellipsis icon hidden, add a visible role label (“Super admin” for `role === 'superadmin'`, otherwise the email), and use 44px target sizing.

- [ ] **Step 5: Add refined-calm design tokens**

Adjust only sidebar tokens in `styles.css`:

```css
:root {
  --sidebar: oklch(0.992 0.003 286);
  --sidebar-foreground: oklch(0.24 0.018 286);
  --sidebar-primary: oklch(0.491 0.27 292.581);
  --sidebar-primary-foreground: oklch(0.969 0.016 293.756);
  --sidebar-accent: oklch(0.955 0.025 293);
  --sidebar-accent-foreground: oklch(0.34 0.16 292);
  --sidebar-border: oklch(0.91 0.012 286);
  --sidebar-ring: oklch(0.491 0.27 292.581);
}
```

Preserve the existing dark sidebar variables while increasing `--sidebar-ring` contrast if browser inspection shows it is weak.

- [ ] **Step 6: Run focused tests and verify green**

Run:

```bash
cd license-server && npm test --workspace @sempdf/license-dashboard -- sidebar.test.tsx
```

Expected: all sidebar tests pass.

- [ ] **Step 7: Commit the application composition**

```bash
git add license-server/apps/web/src/components/app-sidebar.tsx \
  license-server/apps/web/src/components/nav-user.tsx \
  license-server/apps/web/src/components/site-header.tsx \
  license-server/apps/web/src/styles.css \
  license-server/apps/web/src/components/sidebar.test.tsx
git commit -m "feat: polish responsive application sidebar"
```

### Task 4: Verify Behavior and Accessibility

**Files:**
- Modify if needed: sidebar files listed above

- [ ] **Step 1: Run the full web test suite**

Run:

```bash
cd license-server && npm test --workspace @sempdf/license-dashboard
```

Expected: all tests pass with no unhandled errors.

- [ ] **Step 2: Run the production build**

Run:

```bash
cd license-server && npm run build --workspace @sempdf/license-dashboard
```

Expected: Vite exits 0 with no TypeScript errors.

- [ ] **Step 3: Inspect the running app**

Start the web app and API using the repository's existing development commands. Inspect admin and portal layouts at:

- 1440px expanded
- 1440px collapsed
- 390px mobile sheet open

Verify active styling, 44px targets, tooltip focus behavior, account menu, mobile dismissal, Escape, focus restoration, and text truncation.

- [ ] **Step 4: Run an accessibility scan**

Use the in-app browser accessibility scanner against the rendered admin and portal sidebar states. Resolve any critical or serious violations attributable to the sidebar.

- [ ] **Step 5: Verify reduced motion and keyboard-only use**

Emulate `prefers-reduced-motion: reduce`, confirm transitions are suppressed, then tab through brand, navigation, trigger, and account menu. Confirm the active page is exposed as current and no control loses visible focus.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff -- license-server/apps/web/src/components license-server/apps/web/src/styles.css license-server/apps/web/vite.config.ts
```

Expected: no whitespace errors; only intended sidebar/test changes plus pre-existing unrelated user changes.

- [ ] **Step 7: Commit any verification fixes**

If browser or accessibility verification required changes:

```bash
git add license-server/apps/web/src/components \
  license-server/apps/web/src/styles.css \
  license-server/apps/web/vite.config.ts
git commit -m "fix: resolve sidebar accessibility findings"
```
