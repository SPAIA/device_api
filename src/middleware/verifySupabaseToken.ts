// src/middleware/verifySupabaseToken.ts

import { Context, Next } from 'hono'

export async function verifySupabaseToken(c: Context, next: Next) {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
        return c.text('Unauthorized', 401)
    }

    const token = authHeader.replace('Bearer ', '')

    // 1) If you only need to confirm the token is present:
    //    - That’s it; you can proceed to next()
    // 2) If you need deeper validation:
    //    - E.g. call Supabase admin endpoint to verify the token
    //    - or decode the JWT and confirm its signature
    //    - For example:
    // const { user, error } = await supabase.auth.api.getUser(token)
    // if (error) {
    //   return c.text('Invalid token', 401)
    // }
    // c.set('user', user)

    await next()
}
