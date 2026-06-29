# Production Sidebar Design

## Objective

Upgrade the license dashboard sidebar into a polished, production-level application shell with strong accessibility, responsive mobile behavior, and a collapsible desktop icon rail.

The implementation must use only the project's existing shadcn components, Base UI behavior, semantic HTML, and Tailwind styling. It must not introduce React Aria or another component library.

## Scope

This design applies to both sidebar audiences already supported by `AppSidebar`:

- Admin: Dashboard, Customers, Licenses, and Usage & telemetry
- Organization portal: Overview, Activity, Members, Notifications, Settings, and Account

The sidebar will continue to use the existing route configuration and account menu. The work is limited to the shared application shell and related tests; page content and information architecture are unchanged.

## Visual Direction

Use the approved “Refined calm” direction:

- Warm white sidebar surface separated from page content by a quiet border and subtle depth
- Existing A11yPDF purple as a focused accent rather than a large color field
- Clear hierarchy between brand, workspace navigation, optional contextual header content, and account controls
- Navigation rows with at least a 44px interactive target
- Active route shown by a pale purple surface, stronger foreground contrast, and a slim purple edge indicator
- Restrained hover, pressed, and focus states that remain legible in light and dark themes
- Existing typography and logo assets, avoiding a separate visual system

Animations will be short and functional. They will be removed or reduced when `prefers-reduced-motion` is enabled.

## Component Structure

### Application sidebar

`AppSidebar` remains the shared composition layer. It will:

- Render the existing shadcn `Sidebar` primitive with desktop icon collapse enabled
- Provide a branded home link whose visible label adapts to expanded and collapsed states
- Render navigation inside a labeled `<nav>` landmark
- Preserve the admin and portal navigation configurations
- Place the account menu in a visually separated footer
- Accept the existing `headerSlot` without changing its public contract

### Navigation

Each navigation item remains a TanStack Router `Link` rendered through `SidebarMenuButton`.

The current route will receive:

- `aria-current="page"`
- The existing `data-active` state used by shadcn styling
- A visible background, text treatment, and edge indicator so state is not communicated by color alone

Collapsed items will expose shadcn tooltips on pointer hover and keyboard focus. Visible item labels will remain the accessible names in expanded mode.

### Collapse controls

Desktop users can switch between the full sidebar and an icon rail. The control will:

- Be a semantic button
- Use the accessible name “Collapse sidebar” when expanded
- Use the accessible name “Expand sidebar” when collapsed
- Expose expanded state with `aria-expanded`
- Preserve the existing keyboard shortcut
- Have a visible keyboard focus indicator

The brand will use its full lockup when expanded and a mark-only treatment when collapsed.

### Mobile behavior

At the existing mobile breakpoint, navigation opens in the shadcn sheet used by the sidebar primitive. The sheet will:

- Have an accurate accessible title and description
- Display an obvious close control
- Contain focus while open
- close with Escape
- Restore focus to its trigger after closing
- Close after the user follows a navigation link
- Use comfortable touch targets and safe spacing around the account menu

These behaviors will be provided through existing shadcn/Base UI primitives wherever available rather than duplicated.

### Account menu

`NavUser` remains a shadcn dropdown menu. It will:

- Present the user's name and role or email with clear visual hierarchy
- Give its trigger an explicit accessible name
- Avoid redundant image announcements when visible text already identifies the user
- Preserve keyboard opening, arrow-key navigation, Escape dismissal, and focus restoration
- Keep logout as an explicit menu action

## Accessibility Requirements

The completed sidebar must provide:

- A labeled navigation landmark
- Exactly one current-page link identified by `aria-current="page"`
- Logical tab order through brand, navigation, optional header controls, collapse control, and account menu
- Visible focus styles meeting contrast expectations against every sidebar surface
- Interactive targets of at least 44 by 44 CSS pixels for primary navigation and mobile controls
- Text and meaningful icon contrast consistent with WCAG 2.2 AA
- Tooltips that appear on both hover and keyboard focus in collapsed mode
- State communicated through text, shape, or position in addition to color
- Reduced-motion behavior for sidebar transitions
- No redundant accessible names from decorative icons or avatars
- Accurate accessible labels and state for mobile and desktop sidebar controls

## State and Data Flow

`SidebarProvider` remains the single owner of expanded, collapsed, and mobile-open state. `AppSidebar`, the header trigger, collapse control, and mobile sheet consume that existing context.

Route state continues to come from TanStack Router. A navigation action on mobile also requests that the sheet close; desktop navigation does not alter collapse state. The persisted sidebar preference behavior already present in the provider remains intact.

No API, server, or database changes are required.

## Error Handling and Edge Cases

- Long navigation labels and user identity text truncate without covering controls.
- Missing user images fall back to initials.
- Missing user names fall back to email.
- Tooltips provide labels when sidebar text is visually hidden.
- Sidebar controls remain operable when motion is disabled.
- Mobile navigation remains usable at narrow widths and with zoomed text.
- The optional `headerSlot` must not break the navigation order or collapsed layout.

## Verification

### Automated checks

- Add focused component tests for active navigation state and `aria-current`
- Test accessible names and expanded state for collapse controls
- Test keyboard activation and mobile close-after-navigation behavior
- Run the existing web test suite
- Run the production Vite build and TypeScript checks included in that build
- Run an automated accessibility scan against representative sidebar states

### Browser checks

Inspect:

- Desktop expanded
- Desktop collapsed icon rail
- Mobile sheet open and closed
- Admin and portal navigation variants
- Light and dark themes if both remain supported by the application

Manually verify:

- Keyboard-only traversal and activation
- Visible focus throughout
- Tooltip behavior in collapsed mode
- Escape dismissal and focus restoration
- Current-page identification
- Reduced-motion behavior
- Touch target sizing and text truncation at narrow widths

## Acceptance Criteria

The design is complete when:

1. Both admin and portal sidebars use the approved refined-calm visual treatment.
2. Desktop users can collapse and expand the sidebar as an icon rail.
3. Mobile users receive an accessible off-canvas sheet that closes after navigation.
4. Navigation, collapse, and account controls have correct semantics, accessible names, keyboard behavior, and focus treatment.
5. Active state is visually distinct and exposed with `aria-current="page"`.
6. No component library beyond the project's existing shadcn/Base UI stack is added.
7. Automated tests, the production build, accessibility checks, and browser-state inspection pass.
