import { createAuthClient } from 'better-auth/react'
import { adminClient, organizationClient } from 'better-auth/client/plugins'

/**
 * Browser better-auth client. baseURL defaults to the current origin and the
 * `/api/auth` base path, which Vite proxies to the API in dev (see
 * vite.config.ts). The admin + organization plugins mirror the server config
 * in apps/api/src/auth.ts so role/org typing lines up.
 */
export const authClient = createAuthClient({
  plugins: [adminClient(), organizationClient()],
})

export const { signIn, signOut, signUp, useSession } = authClient

export type SessionUser = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>['data']
>['user']
