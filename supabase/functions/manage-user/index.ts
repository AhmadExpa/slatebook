import { corsHeaders, json, requireAdmin } from '../_shared.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const access = await requireAdmin(req)
  if (access instanceof Response) return access

  try {
    const body = await req.json()
    const userId = String(body.user_id || '')
    const action = body.action
    if (!userId || userId === access.userId) return json({ error: 'You cannot change your own account here.' }, 400)
    const { data: target, error: targetError } = await access.adminClient.from('profiles').select('id, role, is_active').eq('id', userId).single()
    if (targetError || !target) return json({ error: 'User not found.' }, 404)

    if (action === 'status') {
      const isActive = Boolean(body.value)
      if (!isActive && target.role === 'admin') {
        const { count } = await access.adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true)
        if ((count || 0) <= 1) return json({ error: 'The last active administrator cannot be deactivated.' }, 400)
      }
      const { error: profileError } = await access.adminClient.from('profiles').update({ is_active: isActive }).eq('id', userId)
      if (profileError) return json({ error: profileError.message }, 400)
      const { error: authError } = await access.adminClient.auth.admin.updateUserById(userId, { ban_duration: isActive ? 'none' : '876000h' })
      if (authError) return json({ error: authError.message }, 400)
      return json({ ok: true })
    }

    if (action === 'role' && (body.value === 'admin' || body.value === 'user')) {
      if (body.value === 'user' && target.role === 'admin') {
        const { count } = await access.adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true)
        if ((count || 0) <= 1) return json({ error: 'The last active administrator cannot be demoted.' }, 400)
      }
      const { error } = await access.adminClient.from('profiles').update({ role: body.value }).eq('id', userId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
    return json({ error: 'Unsupported user action.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to update user.' }, 500)
  }
})
