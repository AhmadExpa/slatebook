import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function clients(req: Request): { userClient: SupabaseClient; adminClient: SupabaseClient } {
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authorization = req.headers.get('Authorization') || ''
  return {
    userClient: createClient(url, anonKey, { global: { headers: { Authorization: authorization } } }),
    adminClient: createClient(url, serviceRoleKey),
  }
}

export async function requireAdmin(req: Request): Promise<{ userId: string; adminClient: SupabaseClient } | Response> {
  const { userClient, adminClient } = clients(req)
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return json({ error: 'Authentication required.' }, 401)
  const { data: profile, error: profileError } = await adminClient.from('profiles').select('role, is_active').eq('id', user.id).single()
  if (profileError || !profile?.is_active || profile.role !== 'admin') return json({ error: 'Administrator access required.' }, 403)
  return { userId: user.id, adminClient }
}
