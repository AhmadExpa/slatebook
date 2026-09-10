import { corsHeaders, json, requireAdmin } from '../_shared.ts'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const access = await requireAdmin(req)
  if (access instanceof Response) return access

  try {
    const body = await req.json()
    const username = String(body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    const displayName = String(body.display_name || '').trim()
    const role = body.role === 'admin' ? 'admin' : 'user'

    if (!USERNAME_PATTERN.test(username)) {
      return json({ error: 'Username must be 3–40 characters and use only letters, numbers, dots, underscores, or hyphens.' }, 400)
    }
    if (password.length < 8 || password.length > 72) return json({ error: 'Password must be between 8 and 72 characters.' }, 400)
    if (!displayName || displayName.length > 120) return json({ error: 'A full name is required and must be 120 characters or fewer.' }, 400)

    const { data: existing, error: existingError } = await access.adminClient
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()
    if (existingError) return json({ error: existingError.message }, 400)
    if (existing) return json({ error: 'That username is already in use.' }, 409)

    // Usernames are mapped to an internal Auth email so Supabase can provide
    // password authentication without requiring an email address from staff.
    const internalEmail = `${username}@users.slatebook.local`
    const { data: created, error: createError } = await access.adminClient.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { username, display_name: displayName },
    })
    if (createError || !created.user) return json({ error: createError?.message || 'Unable to create the account.' }, 400)

    const { data: profile, error: profileError } = await access.adminClient
      .from('profiles')
      .update({ username, display_name: displayName, role, is_active: true })
      .eq('id', created.user.id)
      .select('id')
      .maybeSingle()
    if (profileError || !profile) {
      await access.adminClient.auth.admin.deleteUser(created.user.id)
      return json({ error: profileError?.message || 'The Auth account was created but its Eleven Notepad profile could not be prepared.' }, 400)
    }

    return json({ ok: true, user_id: created.user.id, username, role })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to create the account.' }, 500)
  }
})
