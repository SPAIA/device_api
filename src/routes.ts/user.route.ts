// src/user.routes.ts

import { Hono } from 'hono'
import { verifySupabaseToken } from '../middleware/verifySupabaseToken'
import postgres from 'postgres'

export function userRoutes() {
    // new instance of Hono just for user endpoints
    const userApp = new Hono()

    // route-level middleware for all user routes
    userApp.use('*', verifySupabaseToken)

    // GET /users
    userApp.get('/', async (c) => {
        // maybe do some DB calls with c.env.HYPERDRIVE
        const sql = postgres(c.env.HYPERDRIVE.connectionString)
        const users = await sql`SELECT * FROM "Users" LIMIT 5`
        await sql.end()
        return c.json(users)
    })
    userApp.get('/user/devices', async (c) => {
        return c.json({ devices: [])
    })


    // POST /users
    userApp.post('/', async (c) => {
        // could also fetch user from c.get('user') if you stored it in the token validation step
        const payload = await c.req.json()
        // do some DB inserts with payload
        return c.text('User created', 201)
    })

    return userApp
}