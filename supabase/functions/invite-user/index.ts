import { corsHeaders, json, requireAdmin } from '../_shared.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const access = await requireAdmin(req)
  if (access instanceof Response) return access

  try {
    const body = await req.json()
    const email = String(body.email || '').trim().toLowerCase()
    const displayName = String(body.display_name || '').trim()
    const role = body.role === 'admin' ? 'admin' : 'user'
    if (!/^\S+@\S+\.\S+$/.test(email) || !displayName) return json({ error: 'A valid email and full name are required.' }, 400)

    const { data: invitation, error } = await access.adminClient.auth.admin.inviteUserByEmail(email, {
      data: { display_name: displayName, role },
    })
    if (error) return json({ error: error.message }, 400)
    if (invitation.user) {
      const { error: profileError } = await access.adminClient.from('profiles').update({ display_name: displayName, role, is_active: true }).eq('id', invitation.user.id)
      if (profileError) return json({ error: profileError.message }, 400)
    }
    return json({ ok: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to send invitation.' }, 500)
  }
})
