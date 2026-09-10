import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Filter,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { getErrorMessage, getSupabase, supabase, supabaseConfigured } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  createCustomerRecord,
  ensureDefaultLeadForm,
  getProfile,
  createUser,
  listFields,
  listForms,
  listRecentUserRecords,
  listUsers,
  manageUser,
  searchAdminRecords,
  searchSafeRecords,
  setRecordFieldValidation,
  updateAdminRecord,
  updateSafeFields,
} from './lib/data'
import { downloadCsv } from './lib/csv'
import {
  type FieldValue,
  type FieldValues,
  type Form,
  type FormField,
  type Profile,
  type RawRecord,
  type Role,
  type SafeRecord,
} from './lib/types'
import { fieldInputType, formatCardInput, formatDate, formatDateTime, formatExpiryInput, initials, isEditableByUser, isIncludedLeadField, isValidCardNumber, normalizeLoginIdentifier, validateValue } from './lib/utils'

type View = 'overview' | 'records' | 'forms' | 'users'
type Toast = { type: 'success' | 'error'; message: string }

function App() {
  const [sessionReady, setSessionReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setAuthError(error.message)
      setSession(data.session)
      setSessionReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setProfile(null)
    })
    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user.id) return
    void getProfile(session.user.id)
      .then((nextProfile) => {
        if (!nextProfile.is_active) {
          setAuthError('Your account is currently inactive. Please contact an administrator.')
          void getSupabase().auth.signOut()
          return
        }
        setProfile(nextProfile)
      })
      .catch((error: unknown) => setAuthError(getErrorMessage(error)))
  }, [session?.user.id])

  if (!supabaseConfigured) return <SetupView />
  if (!sessionReady) return <LoadingScreen label="Warming up your workspace" />
  if (!session) return <LoginView initialError={authError} />
  if (!profile) return <LoadingScreen label="Loading your workspace" error={authError} />
  if (profile.role !== 'admin') return <AgentPortal profile={profile} onSignOut={() => void getSupabase().auth.signOut()} />

  return (
    <Workspace
      profile={profile}
      onProfileChange={setProfile}
      onSignOut={() => void getSupabase().auth.signOut()}
    />
  )
}

function SetupView() {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="brand-mark large"><BookOpen size={25} /></div>
        <p className="eyebrow">Eleven Notepad setup</p>
        <h1>Connect your private workspace.</h1>
        <p className="muted-copy">The frontend is ready. Add your Supabase project credentials, run the database migration, and deploy this app to Vercel.</p>
        <div className="setup-step"><span>01</span><div><strong>Add environment variables</strong><code>VITE_SUPABASE_URL<br />VITE_SUPABASE_ANON_KEY</code></div></div>
        <div className="setup-step"><span>02</span><div><strong>Run the migration</strong><p>Apply <code>supabase/migrations/001_slatebook.sql</code> in the Supabase SQL editor.</p></div></div>
        <div className="setup-step"><span>03</span><div><strong>Deploy on Vercel</strong><p>Set the same two public variables in Project Settings, then redeploy.</p></div></div>
        <div className="security-note"><ShieldCheck size={18} /><span>Only the public anon key belongs in the browser. RLS protects raw customer values.</span></div>
      </div>
    </div>
  )
}

function LoadingScreen({ label, error }: { label: string; error?: string }) {
  return <div className="loading-screen"><div className="loading-orbit"><RefreshCw size={21} /></div><p>{error || label}</p></div>
}

function LoginView({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(initialError)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (mode === 'reset') {
        if (!identifier.includes('@')) throw new Error('Username accounts do not use email reset links. Ask an administrator to set a new password.')
        const { error } = await getSupabase().auth.resetPasswordForEmail(identifier.trim().toLowerCase(), { redirectTo: window.location.origin })
        if (error) throw error
        setMessage('If that email exists, a reset link is on its way.')
      } else {
        const { error } = await getSupabase().auth.signInWithPassword({ email: normalizeLoginIdentifier(identifier), password })
        if (error) throw error
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-art"><div className="glow glow-one" /><div className="glow glow-two" /><div className="art-grid" /><div className="art-copy"><div className="brand-mark"><BookOpen size={22} /></div><p className="eyebrow light">Private by design</p><h2>Keep the lead,<br /><em>protect the person.</em></h2><p>One calm place for customer details your whole team can use without exposing what they should not see.</p><div className="art-pill"><ShieldCheck size={16} /> Field-level privacy built in</div></div></div>
      <div className="auth-panel"><div className="auth-form-wrap"><p className="eyebrow">Welcome to Eleven Notepad</p><h1>{mode === 'login' ? 'Good to see you.' : 'Reset your password.'}</h1><p className="muted-copy">{mode === 'login' ? 'Sign in with the username and password given to you by an administrator.' : 'Email accounts can receive a secure reset link. Username accounts are reset by an administrator.'}</p><form onSubmit={submit} className="stack-form"><label>{mode === 'login' ? 'Username or email' : 'Email address'}<input autoFocus type={mode === 'login' ? 'text' : 'email'} value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={mode === 'login' ? 'jordan.lee' : 'you@company.com'} required /></label>{mode === 'login' && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required minLength={6} /></label>}{message && <div className={`inline-message ${message.includes('way') ? 'success' : 'error'}`}><ShieldAlert size={16} />{message}</div>}<button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Send reset link'}<ArrowRight size={17} /></button></form><button className="text-button" onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setMessage('') }}>{mode === 'login' ? 'Forgot your password?' : 'Back to sign in'}</button><p className="auth-footnote"><Lock size={14} /> Your workspace uses database-level access rules.</p></div></div>
    </div>
  )
}

function AgentPortal({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const [form, setForm] = useState<Form | null>(null)
  const [fields, setFields] = useState<FormField[]>([])
  const [latestLeads, setLatestLeads] = useState<SafeRecord[]>([])
  const [searchResults, setSearchResults] = useState<SafeRecord[]>([])
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<SafeRecord | null>(null)

  async function loadPortal() {
    setLoading(true)
    setError('')
    try {
      const nextForm = (await listForms(false))[0]
      if (!nextForm) throw new Error('The Lead intake form is not ready yet. Ask an administrator to open the workspace once.')
      setForm(nextForm)
      setFields(await listFields(nextForm.id))
      setLatestLeads(await listRecentUserRecords(nextForm.id, 5))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadPortal() }, [])

  async function runSearch(term = query.trim()) {
    if (!form) return
    if (!term) {
      setSearched(false)
      setSearchResults([])
      return
    }
    setSearching(true)
    setError('')
    try {
      setSearchResults(await searchSafeRecords(form.id, term, 1, 25))
      setSearched(true)
    } catch (searchError) {
      setError(getErrorMessage(searchError))
    } finally {
      setSearching(false)
    }
  }

  async function refreshLatest() {
    if (!form) return
    setLatestLeads(await listRecentUserRecords(form.id, 5))
  }

  async function saveLead(values: FieldValues, record: SafeRecord | null) {
    if (!form) return
    if (record) {
      await updateSafeFields(record.record_id, values, record.updated_at)
    } else {
      await createCustomerRecord(form.id, values)
    }
    setEditorOpen(false)
    setEditingRecord(null)
    await refreshLatest()
    if (searched && query.trim()) await runSearch(query.trim())
  }

  const visibleLeads = searched ? searchResults : latestLeads
  return <div className="agent-portal"><header className="agent-header"><div className="brand-lockup"><div className="brand-mark"><BookOpen size={20} /></div><span>Eleven Notepad</span></div><div className="agent-account"><span>{profile.username || profile.display_name || profile.email.split('@')[0]}</span><button className="icon-button" onClick={onSignOut} title="Sign out"><LogOut size={17} /></button></div></header><main className="agent-main"><section className="agent-hero"><p className="eyebrow">Private lead portal</p><h1>Find a lead.</h1><p className="muted-copy">Search by phone number, or add a new lead using the fixed form.</p><form className="agent-search" onSubmit={(event) => { event.preventDefault(); void runSearch() }}><Search size={21} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by phone number…" aria-label="Search leads by phone number" /><button type="submit" disabled={!form || searching}>{searching ? 'Searching…' : 'Search'}</button></form><button className="button primary agent-add-button" disabled={!form} onClick={() => { setEditingRecord(null); setEditorOpen(true) }}><Plus size={17} /> Add new lead</button></section>{error && <ErrorBanner message={error} onRetry={() => void loadPortal()} />}{loading ? <LoadingBlock /> : <section className="agent-feed"><div className="agent-feed-heading"><div><p className="eyebrow">{searched ? 'Search results' : 'Your latest leads'}</p><h2>{searched ? `${searchResults.length} lead${searchResults.length === 1 ? '' : 's'} found` : 'Recently added by you'}</h2></div>{searched && <button className="text-button" onClick={() => { setQuery(''); setSearched(false); setSearchResults([]) }}>Clear search</button>}</div>{visibleLeads.length ? <div className="agent-lead-grid">{visibleLeads.map((lead) => <AgentLeadCard key={lead.record_id} record={lead} fields={fields} onOpen={() => { setEditingRecord(lead); setEditorOpen(true) }} />)}</div> : <div className="agent-empty"><FileText size={20} /><strong>{searched ? 'No matching lead' : 'No leads added yet'}</strong><span>{searched ? 'Try another phone number or lead detail.' : 'Your newest leads will appear here after you add them.'}</span></div>}</section>}{editorOpen && form && <RecordEditor presentation="modal" form={form} fields={fields} record={editingRecord} isAdmin={false} agentName={profile.username || profile.display_name || profile.email.split('@')[0]} onClose={() => { setEditorOpen(false); setEditingRecord(null) }} onSave={(values) => saveLead(values, editingRecord)} />}</main></div>
}

function AgentLeadCard({ record, fields, onOpen }: { record: SafeRecord; fields: FormField[]; onOpen: () => void }) {
  const values = record.safe_values
  const name = [values.first_name, values.last_name].filter(Boolean).join(' ') || 'Lead without a name'
  const phone = values.phone ? String(values.phone) : 'Phone not entered'
  const status = values.lead_status ? String(values.lead_status) : 'New'
  const cardField = fields.find((field) => field.field_key === 'card_information')
  const cardValidated = Boolean(cardField && record.validations?.[cardField.id] === 'valid')
  return <button className="agent-lead-card" onClick={onOpen}><div className="agent-lead-card-top"><span className="agent-lead-initial">{name.slice(0, 1).toUpperCase()}</span><span className="agent-lead-status">{status}</span></div><strong>{name}</strong><span className="agent-lead-phone">{phone}</span><div className="agent-lead-meta"><span>{formatDateTime(record.updated_at)}</span>{cardValidated && <span className="agent-valid-card"><ValidationBadge status="valid" /> Card validated · {values.last_four_digits ? `••••${values.last_four_digits}` : 'last four protected'}</span>}</div></button>
}

function Workspace({ profile, onProfileChange, onSignOut }: { profile: Profile; onProfileChange: (profile: Profile) => void; onSignOut: () => void }) {
  const [view, setView] = useState<View>(profile.role === 'admin' ? 'overview' : 'records')
  const [mobileNav, setMobileNav] = useState(false)
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const notify = useCallback((type: Toast['type'], message: string) => {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 4200)
  }, [])

  function navigate(nextView: View, formId?: string) {
    setView(nextView)
    if (formId) setSelectedFormId(formId)
    setMobileNav(false)
  }

  return (
    <div className="app-shell admin-workspace">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="sidebar-top"><div className="brand-lockup"><div className="brand-mark"><BookOpen size={20} /></div><span>Eleven Notepad</span></div><button className="icon-button mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div>
        <div className="workspace-switcher"><div className="workspace-avatar">E</div><div><strong>Eleven Notepad HQ</strong><span>Private workspace</span></div><ChevronDown size={16} /></div>
        <nav className="main-nav">
          {profile.role === 'admin' && <NavItem icon={<LayoutDashboard size={18} />} label="Overview" active={view === 'overview'} onClick={() => navigate('overview')} />}
          <NavItem icon={<FileText size={18} />} label={profile.role === 'admin' ? 'Customer records' : 'Lead portal'} active={view === 'records'} onClick={() => navigate('records')} />
          {profile.role === 'admin' && <NavItem icon={<Users size={18} />} label="Team access" active={view === 'users'} onClick={() => navigate('users')} />}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><LifeBuoy size={17} /><div><strong>Need a hand?</strong><span>Check your setup guide</span></div><ArrowRight size={15} /></div><div className="profile-chip"><div className="avatar">{initials(profile.display_name, profile.username || profile.email)}</div><div className="profile-meta"><strong>{profile.display_name || profile.username || profile.email.split('@')[0]}</strong><span>{profile.role === 'admin' ? 'Manager / administrator' : 'Team member'}</span></div><button className="icon-button" onClick={onSignOut} title="Sign out"><LogOut size={17} /></button></div></div>
      </aside>
      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-content"><header className="topbar"><button className="icon-button menu-trigger" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumbs"><span>Eleven Notepad HQ</span><ArrowRight size={14} /><strong>{view === 'users' ? 'Team access' : view === 'records' ? (profile.role === 'admin' ? 'Customer records' : 'Lead portal') : view === 'forms' ? 'Lead intake' : 'Overview'}</strong></div><div className="topbar-actions"><div className="secure-badge"><span className="secure-dot" /> Encrypted workspace</div><button className="icon-button" onClick={() => notify('success', 'Everything is up to date.')} title="System status"><CheckCircle2 size={19} /></button></div></header><div className="page-content">{view === 'overview' && <Overview profile={profile} onNavigate={navigate} notify={notify} />}{view === 'forms' && <FormsView isAdmin={profile.role === 'admin'} onNavigate={navigate} />}{view === 'records' && <RecordsView profile={profile} isAdmin={profile.role === 'admin'} initialFormId={selectedFormId} notify={notify} />}{view === 'users' && profile.role === 'admin' && <UsersView currentUser={profile} notify={notify} onProfileChange={onProfileChange} />}</div></main>{toast && <div className={`toast ${toast.type}`}><CheckCircle2 size={17} />{toast.message}<button onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  )
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{active && <span className="active-line" />}</button>
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted-copy">{description}</p></div>{action && <div className="page-header-action">{action}</div>}</div>
}

function Overview({ profile, onNavigate, notify }: { profile: Profile; onNavigate: (view: View, formId?: string) => void; notify: (type: Toast['type'], message: string) => void }) {
  const [forms, setForms] = useState<Form[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<SafeRecord[]>([])

  useEffect(() => {
    async function loadOverview() {
      if (profile.role === 'admin') await ensureDefaultLeadForm()
      const [nextForms, nextUsers] = await Promise.all([listForms(profile.role === 'admin'), profile.role === 'admin' ? listUsers() : Promise.resolve([] as Profile[])])
        setForms(nextForms)
        setUsers(nextUsers)
        const firstForm = nextForms.find((form) => form.status === 'active')
        if (firstForm) setActivity(await searchSafeRecords(firstForm.id, '', 1, 5))
    }
    void loadOverview().catch((error: unknown) => notify('error', getErrorMessage(error))).finally(() => setLoading(false))
  }, [notify, profile.role])

  const activeForms = forms.filter((form) => form.status === 'active')
  return <><PageHeader eyebrow="Good morning" title={profile.display_name ? `Hello, ${profile.display_name.split(' ')[0]}.` : 'Your workspace.'} description="A clear view of the customer details your team is building together." action={<button className="button secondary" onClick={() => onNavigate('records')}><Search size={17} /> Search records</button>} />{loading ? <LoadingBlock /> : <><div className="stat-grid"><StatCard icon={<FileText size={19} />} label="Active forms" value={activeForms.length} detail="Ready for your team" tone="blue" /><StatCard icon={<Lock size={19} />} label="Privacy rules" value="On" detail="Applied at database level" tone="green" /><StatCard icon={<Users size={19} />} label={profile.role === 'admin' ? 'Team members' : 'Your role'} value={profile.role === 'admin' ? users.filter((user) => user.is_active).length : 'Member'} detail={profile.role === 'admin' ? 'Active access' : 'Safe fields only'} tone="purple" /><StatCard icon={<BarChart3 size={19} />} label="Recent leads" value={activity.length} detail="Latest records found" tone="amber" /></div><div className="overview-grid"><section className="panel featured-panel"><div className="panel-heading"><div><p className="eyebrow">Get started</p><h2>Make every detail count.</h2></div><div className="heading-icon"><SparkIcon /></div></div><p className="panel-copy">Choose a form to add a customer, or jump into your records to find the next conversation.</p><div className="quick-actions"><button onClick={() => onNavigate('forms')}><span className="quick-icon blue"><SlidersHorizontal size={18} /></span><span><strong>Browse forms</strong><small>{activeForms.length} active {activeForms.length === 1 ? 'form' : 'forms'}</small></span><ArrowRight size={16} /></button><button onClick={() => onNavigate('records')}><span className="quick-icon purple"><Search size={18} /></span><span><strong>Search customers</strong><small>Find a safe, shared view</small></span><ArrowRight size={16} /></button>{profile.role === 'admin' && <button onClick={() => onNavigate('users')}><span className="quick-icon amber"><UserPlus size={18} /></span><span><strong>Create team accounts</strong><small>Set usernames and passwords</small></span><ArrowRight size={16} /></button>}</div></section><section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Recent activity</p><h2>Latest records</h2></div><button className="text-button" onClick={() => onNavigate('records')}>View all <ArrowRight size={14} /></button></div>{activity.length ? <div className="activity-list">{activity.map((record) => <button className="activity-row" key={record.record_id} onClick={() => onNavigate('records', record.form_id)}><div className="activity-avatar">{record.form_name.slice(0, 1).toUpperCase()}</div><div><strong>{record.form_name}</strong><span>Updated {formatDateTime(record.updated_at)}</span></div><ArrowRight size={15} /></button>)}</div> : <EmptyState compact icon={<FileText size={19} />} title="No records yet" description="Your recent customer records will appear here." />}</section></div><section className="privacy-banner"><div className="privacy-banner-icon"><ShieldCheck size={21} /></div><div><strong>Privacy is part of the workflow.</strong><span>Fields marked masked or admin-only are removed from regular-user results—not just hidden in the interface.</span></div><button onClick={() => notify('success', 'Eleven Notepad protects sensitive fields at the data layer.')}>Learn more <ArrowRight size={15} /></button></section></>}</>
}

function SparkIcon() { return <span className="spark-icon"><span /><span /><span /></span> }

function StatCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: ReactNode; detail: string; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>
}

function FormsView({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate: (view: View, formId?: string) => void }) {
  const [forms, setForms] = useState<Form[]>([])
  const [selectedForm, setSelectedForm] = useState<Form | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    try {
      if (isAdmin) await ensureDefaultLeadForm()
      const nextForms = await listForms(isAdmin)
      setForms(nextForms)
      setSelectedForm(nextForms[0] || null)
      setError('')
    } catch (loadError) { setError(getErrorMessage(loadError)) } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [isAdmin])

  return <><PageHeader eyebrow="Lead intake" title="One form, one shared workflow." description="The same fixed form is used by agents and administrators. Phone is the only required field." />{error && <ErrorBanner message={error} onRetry={() => void reload()} />}{loading ? <LoadingBlock /> : <div className="form-layout"><div className="form-list">{forms.map((form) => <FormCard key={form.id} form={form} isAdmin={isAdmin} selected={selectedForm?.id === form.id} onSelect={() => isAdmin ? setSelectedForm(form) : onNavigate('records', form.id)} />)}{!forms.length && <EmptyState icon={<SlidersHorizontal size={20} />} title="Lead intake is not available" description="Open the Overview as an administrator to initialize the workspace form." />}</div>{selectedForm && <FixedFormPreview form={selectedForm} onNavigate={onNavigate} />}</div>}</>
}

function FormCard({ form, isAdmin, selected, onSelect }: { form: Form; isAdmin: boolean; selected: boolean; onSelect: () => void }) {
  return <button className={`form-card ${selected ? 'selected' : ''}`} onClick={onSelect}><div className="form-card-top"><div className="form-symbol"><FileText size={19} /></div><span className={`status-pill ${form.status === 'active' ? 'active' : 'archived'}`}><span />{form.status}</span></div><h3>{form.name}</h3><p>{form.description || 'The shared customer lead form.'}</p><div className="form-card-foot"><span><span className="mini-dot" /> {form.status === 'active' ? 'Ready to use' : 'Admin archive'}</span><span>{isAdmin ? 'Preview' : 'Open'} <ArrowRight size={14} /></span></div></button>
}

function FixedFormPreview({ form, onNavigate }: { form: Form; onNavigate: (view: View, formId?: string) => void }) {
  const [fields, setFields] = useState<FormField[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void listFields(form.id, true)
      .then(setFields)
      .catch(() => setFields([]))
      .finally(() => setLoading(false))
  }, [form.id])

  const activeFields = fields.filter((field) => !field.is_archived && isIncludedLeadField(field) && field.field_key !== 'cvv')
  return <section className="panel builder-panel"><div className="builder-header"><div><p className="eyebrow">Fixed form</p><h2>{form.name}</h2></div><span className="status-pill active"><span />Active</span></div><p className="panel-copy">This is the only form in the workspace. Every field stays available; only Phone is required. Full card numbers are protected from agents.</p><div className="field-list-heading"><div><span className="eyebrow">Available fields</span><small>Use Customer records to add, validate, or search leads.</small></div><button className="button primary compact" onClick={() => onNavigate('records', form.id)}><Plus size={15} /> Open form</button></div>{loading ? <LoadingBlock /> : activeFields.length ? <div className="builder-fields">{activeFields.map((field, index) => <div className="builder-field" key={field.id}><div className="field-order">{String(index + 1).padStart(2, '0')}</div><div className="builder-field-main"><strong>{field.label}</strong><span>{field.field_type === 'card' ? 'Card number · admin only' : field.field_key === 'phone' ? 'Phone · required' : field.visibility === 'visible' ? 'Visible to agents' : field.visibility === 'masked' ? 'Masked for agents' : 'Admin only'}</span></div><span className={`visibility-chip ${field.visibility === 'admin_only' ? 'private' : field.visibility === 'masked' ? 'masked' : 'public'}`}>{field.visibility === 'admin_only' ? <Lock size={12} /> : field.visibility === 'masked' ? <ShieldCheck size={12} /> : <Check size={12} />}{field.visibility === 'admin_only' ? 'Admin only' : field.visibility === 'masked' ? 'Validated suffix' : 'Visible'}</span></div>)}</div> : <EmptyState compact icon={<SlidersHorizontal size={19} />} title="Lead intake is empty" description="The fixed form fields will appear after the workspace is initialized." />}</section>
}

function RecordsView({ profile, isAdmin, initialFormId, notify }: { profile: Profile; isAdmin: boolean; initialFormId: string | null; notify: (type: Toast['type'], message: string) => void }) {
  const [forms, setForms] = useState<Form[]>([])
  const [formId, setFormId] = useState(initialFormId || '')
  const [fields, setFields] = useState<FormField[]>([])
  const [records, setRecords] = useState<Array<SafeRecord | RawRecord>>([])
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<SafeRecord | RawRecord | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { void listForms(isAdmin).then((nextForms) => { setForms(nextForms); if (!formId && nextForms[0]) setFormId(nextForms[0].id) }).catch((loadError: unknown) => setError(getErrorMessage(loadError))) }, [isAdmin])
  useEffect(() => { if (formId) void listFields(formId, isAdmin).then(setFields).catch((loadError: unknown) => setError(getErrorMessage(loadError))) }, [formId, isAdmin])
  useEffect(() => { if (!formId) { setLoading(false); return } void runSearch() }, [formId, submittedQuery, page, isAdmin])

  async function runSearch() {
    setLoading(true); setError('')
    try {
      const nextRecords = isAdmin ? await searchAdminRecords(formId, submittedQuery, page) : await searchSafeRecords(formId, submittedQuery, page)
      setRecords(nextRecords); setTotal(nextRecords[0]?.total_count || 0)
    } catch (loadError) { setError(getErrorMessage(loadError)) } finally { setLoading(false) }
  }

  function search(event: FormEvent) { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()) }

  async function saveRecord(values: FieldValues, record: SafeRecord | RawRecord | null) {
    if (record) {
      await (isAdmin ? updateAdminRecord(record.record_id, values) : updateSafeFields(record.record_id, values, record.updated_at))
      notify('success', 'Customer record updated.')
    } else {
      await createCustomerRecord(formId, values)
      notify('success', 'Customer record saved. Sensitive fields are now protected.')
    }
    setEditorOpen(false); setEditingRecord(null); await runSearch()
  }

  async function exportRecords() {
    setExporting(true)
    try {
      const exportForms = forms
      const map = new Map<string, FormField[]>()
      await Promise.all(exportForms.map(async (form) => map.set(form.id, await listFields(form.id, true))))
      const exported: RawRecord[] = []
      let currentPage = 1
      while (true) {
        const batch = await searchAdminRecords(formId || null, '', currentPage, 100)
        exported.push(...batch)
        if (batch.length < 100) break
        currentPage += 1
      }
      downloadCsv(exported, exportForms, map)
      notify('success', `${exported.length} record${exported.length === 1 ? '' : 's'} exported.`)
    } catch (exportError) { notify('error', getErrorMessage(exportError)) } finally { setExporting(false) }
  }

  const selectedForm = forms.find((form) => form.id === formId)
  const canNext = page * 50 < total
  return <><PageHeader eyebrow={isAdmin ? 'Customer records' : 'Lead portal'} title={isAdmin ? 'Find the next conversation.' : 'Your lead portal.'} description={isAdmin ? 'Search by phone or any lead detail, validate card information, or export a clean CSV.' : 'Search by phone to find a lead, or add a new lead using the fixed form.'} action={<div className="header-actions">{isAdmin && <button className="button secondary" onClick={() => void exportRecords()} disabled={exporting}><Download size={17} />{exporting ? 'Exporting…' : 'Export CSV'}</button>}<button className="button primary" disabled={!formId} onClick={() => { setEditingRecord(null); setEditorOpen(true) }}><Plus size={17} />{isAdmin ? 'Add customer' : 'Add new lead'}</button></div>} /><div className="records-toolbar">{isAdmin && <div className="select-wrap"><Filter size={16} /><select value={formId} onChange={(event) => { setFormId(event.target.value); setPage(1); setSubmittedQuery(''); setQuery('') }}><option value="">Select a form</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}{form.status === 'archived' ? ' · archived' : ''}</option>)}</select><ChevronDown size={15} /></div>}<form className="search-box" onSubmit={search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by phone or lead detail…" disabled={!formId} /><button type="submit" disabled={!formId}>Search</button></form></div>{error && <ErrorBanner message={error} onRetry={() => void runSearch()} />}{selectedForm && <div className="record-context"><div><span className="eyebrow">Viewing form</span><strong>{selectedForm.name}</strong></div><span className="result-count">{total ? `${total} record${total === 1 ? '' : 's'}` : 'No matching records'}</span></div>}{loading ? <LoadingBlock /> : records.length ? <><div className="records-table">{records.map((record) => <RecordRow key={record.record_id} record={record} fields={fields} isAdmin={isAdmin} onOpen={() => { setEditingRecord(record); setEditorOpen(true) }} />)}</div><div className="pagination"><span>Page {page}</span><div><button className="button ghost compact" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button className="button ghost compact" disabled={!canNext} onClick={() => setPage((current) => current + 1)}>Next</button></div></div></> : <EmptyState icon={<Search size={21} />} title={formId ? 'No records found' : 'Ready for your first lead'} description={formId ? 'Try a different search or add a new lead to this fixed form.' : 'Your lead form will appear here once the workspace is initialized.'} action={formId ? <button className="button primary" onClick={() => { setEditingRecord(null); setEditorOpen(true) }}><Plus size={16} />{isAdmin ? 'Add customer' : 'Add new lead'}</button> : undefined} />}{editorOpen && selectedForm && <RecordEditor form={selectedForm} fields={fields} record={editingRecord} isAdmin={isAdmin} agentName={profile.username || profile.display_name || profile.email.split('@')[0]} onClose={() => { setEditorOpen(false); setEditingRecord(null) }} onSave={(values) => saveRecord(values, editingRecord)} />}</>
}

function RecordRow({ record, fields, isAdmin, onOpen }: { record: SafeRecord | RawRecord; fields: FormField[]; isAdmin: boolean; onOpen: () => void }) {
  const values = isAdmin && 'raw_values' in record ? record.raw_values : record.safe_values
  const previewFields = fields.filter((field) => isIncludedLeadField(field) && (field.visibility !== 'admin_only' || isAdmin)).slice(0, 3)
  return <button className="record-row" onClick={onOpen}><div className="record-id"><div className="record-avatar">{record.form_name.slice(0, 1).toUpperCase()}</div><div><strong>{record.form_name}</strong><span>{formatDate(record.created_at)} · ID {record.record_id.slice(0, 8)}</span></div></div><div className="record-preview">{previewFields.map((field) => <span key={field.id}><small>{field.label}</small><strong>{values[field.field_key] === undefined || values[field.field_key] === null || values[field.field_key] === '' ? '—' : String(values[field.field_key])} {record.validations?.[field.id] && <ValidationBadge status={record.validations[field.id]} />}</strong></span>)}</div><div className="record-updated"><span>{formatDateTime(record.updated_at)}</span><ArrowRight size={16} /></div></button>
}

function ValidationBadge({ status }: { status: 'valid' | 'invalid' }) {
  return <span className={`field-validation ${status}`} title={status === 'valid' ? 'Validated by admin' : 'Marked invalid by admin'}>{status === 'valid' ? <Check size={11} /> : <X size={11} />}</span>
}

function RecordEditor({ form, fields, record, isAdmin, agentName, onClose, onSave, presentation = 'modal' }: { form: Form; fields: FormField[]; record: SafeRecord | RawRecord | null; isAdmin: boolean; agentName: string; onClose: () => void; onSave: (values: FieldValues) => Promise<void>; presentation?: 'drawer' | 'modal' }) {
  const raw = record && 'raw_values' in record ? record.raw_values : record?.safe_values
  const isNew = !record
  const [values, setValues] = useState<FieldValues>({ ...(isNew ? { agent_name: agentName } : {}), ...(raw || {}) })
  const [validationState, setValidationState] = useState(record?.validations || {})
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState('')
  const [error, setError] = useState('')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const allFields = fields.filter((field) => !field.is_archived && isIncludedLeadField(field) && field.field_key !== 'cvv')
  const accountType = String(values.account_type || '')
  const shownFields = allFields.filter((field) => {
    if (isAdmin) return true
    if (record && ['card_information', 'cvv'].includes(field.field_key)) return false
    if (record && field.field_key === 'last_four_digits' && !values.last_four_digits) return false
    if (['card_information', 'cvv', 'expiry', 'last_four_digits'].includes(field.field_key)) return accountType === 'Card' || accountType === 'Both'
    if (field.field_key === 'checking_account_last_four') return accountType === 'Checking account' || accountType === 'Both'
    return true
  })

  function setValue(key: string, value: string) {
    const field = allFields.find((item) => item.field_key === key)
    const normalized = field?.field_type === 'card' ? formatCardInput(value) : field?.field_type === 'expiry' ? formatExpiryInput(value) : field?.field_type === 'cvv' ? value.replace(/\D/g, '') : value
    setValues((current) => {
      const next = { ...current, [key]: normalized === '' ? null : normalized }
      if (key === 'account_type' && normalized === 'Card') next.checking_account_last_four = null
      if (key === 'account_type' && normalized === 'Checking account') {
        next.card_information = null
        next.cvv = null
        next.expiry = null
        next.last_four_digits = null
      }
      if (key === 'card_information') {
        const digits = normalized.replace(/\D/g, '')
        next.last_four_digits = digits.length >= 4 ? digits.slice(-4) : null
      }
      return next
    })
  }

  async function markValidation(field: FormField, status: 'valid' | 'invalid' | null) {
    if (!record || !isAdmin) return
    setValidating(field.id); setError('')
    try {
      await setRecordFieldValidation(record.record_id, field.id, status)
      setValidationState((current) => {
        const next = { ...current }
        if (status) next[field.id] = status
        else delete next[field.id]
        return next
      })
    } catch (validationError) { setError(getErrorMessage(validationError)) } finally { setValidating('') }
  }

  async function save() {
    setError('')
    for (const field of shownFields) {
      if (isNew || isAdmin || isEditableByUser(field)) {
        const validationError = validateValue(field, values[field.field_key] ?? null)
        if (validationError) { setError(validationError); return }
      }
    }
    const payload = isAdmin || isNew ? values : Object.fromEntries(shownFields.filter((field) => isEditableByUser(field) && field.field_key !== 'agent_name').map((field) => [field.field_key, values[field.field_key] ?? null]))
    setSaving(true)
    try { await onSave(payload); } catch (saveError) { setError(getErrorMessage(saveError)) } finally { setSaving(false) }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  async function saveAndClose() {
    setShowCloseConfirm(false)
    await save()
  }

  function requestClose() {
    setShowCloseConfirm(true)
  }

  return (
    <div className={`drawer-backdrop ${presentation === 'modal' ? 'centered-record-backdrop' : ''}`}>
      <aside className={`record-drawer ${presentation === 'modal' ? 'record-modal' : ''}`}>
        <div className="drawer-header">
          <div><p className="eyebrow">{isNew ? 'New lead' : isAdmin ? 'Admin record view' : 'Customer record'}</p><h2>{isNew ? 'Add new lead' : 'Record details'}</h2></div>
          <button className="icon-button" onClick={requestClose} aria-label="Close lead form"><X size={20} /></button>
        </div>
        <div className="drawer-security">{isAdmin ? <><ShieldCheck size={16} /> Full administrator view · raw card values visible</> : <><Lock size={16} /> Safe view · sensitive values stay protected</>}</div>
        <form className="drawer-form" onSubmit={submit}>
          {shownFields.map((field) => {
            const lockedSensitive = !isNew && !isAdmin && ['card_information', 'last_four_digits', 'checking_account_last_four'].includes(field.field_key)
            const derivedLastFour = field.field_key === 'last_four_digits'
            const editable = (isNew || isAdmin || isEditableByUser(field)) && !(field.field_key === 'agent_name' && !isAdmin) && !lockedSensitive && !derivedLastFour
            const displayValue = field.field_key === 'agent_name' && isNew ? agentName : values[field.field_key] ?? ''
            const cardStatus = field.field_type === 'card' && displayValue ? isValidCardNumber(String(displayValue)) : null
            const sensitive = field.field_key === 'card_information'
            return <div className={`drawer-field ${!editable ? 'locked' : ''}`} key={field.id}><label>{field.label}{field.is_required && <span className="required-mark">*</span>}<FieldInput field={field} value={String(displayValue)} disabled={!editable} onChange={(value) => setValue(field.field_key, value)} />{cardStatus !== null && <span className={`card-validation ${cardStatus ? 'valid' : 'invalid'}`}>{cardStatus ? <Check size={13} /> : <X size={13} />}{cardStatus ? 'Card number passes validation' : 'Enter a valid card number'}</span>}{!editable && <span className="locked-hint"><Lock size={12} />{derivedLastFour ? 'Shown after an administrator validates the card' : field.field_key === 'agent_name' ? 'Set automatically from username' : lockedSensitive ? 'Sensitive value cannot be edited after saving' : field.visibility === 'admin_only' ? 'Admin-only field' : 'Read-only field'}</span>}{isAdmin && record && sensitive && <div className="validation-controls"><span>Admin validation</span><button type="button" className={validationState[field.id] === 'valid' ? 'selected-valid' : ''} disabled={Boolean(validating)} onClick={() => void markValidation(field, 'valid')}><Check size={13} /> Valid</button><button type="button" className={validationState[field.id] === 'invalid' ? 'selected-invalid' : ''} disabled={Boolean(validating)} onClick={() => void markValidation(field, 'invalid')}><X size={13} /> Invalid</button>{validationState[field.id] && <button type="button" className="clear-validation" disabled={Boolean(validating)} onClick={() => void markValidation(field, null)}>Clear</button>}</div>}{validationState[field.id] && !isAdmin && <span className="locked-hint"><ValidationBadge status={validationState[field.id]} /> {validationState[field.id] === 'valid' ? 'Validated by admin' : 'Marked invalid by admin'}</span>}</label></div>
          })}
          {!isAdmin && <div className="input-hint security-note"><Lock size={14} /> Choose Card, Checking account, or Both to reveal the matching account fields. Card numbers are hidden after saving; only a validated last four can appear.</div>}
          {error && <div className="inline-message error"><ShieldAlert size={16} />{error}</div>}
          <div className="drawer-submit"><button type="button" className="button ghost" onClick={requestClose}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Save lead' : 'Save changes'}<Check size={16} /></button></div>
        </form>
      </aside>
      {showCloseConfirm && <div className="close-confirm-backdrop"><section className="close-confirm" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title"><p className="eyebrow">Unsaved lead</p><h3 id="close-confirm-title">Save before closing?</h3><p>Your entered details are not saved yet. Choose Save to keep this lead or Discard to close without saving.</p><div className="modal-actions"><button type="button" className="button ghost" onClick={() => setShowCloseConfirm(false)}>Keep editing</button><button type="button" className="button subtle-danger" onClick={onClose}>Discard</button><button type="button" className="button primary" onClick={() => void saveAndClose()} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Save lead' : 'Save changes'}</button></div></section></div>}
    </div>
  )
}

function FieldInput({ field, value, disabled, onChange }: { field: FormField; value: string; disabled: boolean; onChange: (value: string) => void }) {
  if (field.field_type === 'textarea') return <textarea rows={4} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={`Enter ${field.label.toLowerCase()}`} />
  if (field.field_type === 'select') return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Choose an option</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  return <input type={fieldInputType(field.field_type)} inputMode={field.field_type === 'card' || field.field_type === 'cvv' || field.field_type === 'expiry' ? 'numeric' : undefined} autoComplete={field.field_type === 'card' || field.field_type === 'cvv' ? 'off' : undefined} maxLength={field.field_type === 'card' ? 23 : field.field_type === 'expiry' ? 5 : field.field_type === 'cvv' ? 4 : undefined} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={field.field_type === 'expiry' ? 'MM/YY' : `Enter ${field.label.toLowerCase()}`} />
}

function UsersView({ currentUser, notify, onProfileChange }: { currentUser: Profile; notify: (type: Toast['type'], message: string) => void; onProfileChange: (profile: Profile) => void }) {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')

  async function reload() { setLoading(true); try { setUsers(await listUsers()) } catch (error) { notify('error', getErrorMessage(error)) } finally { setLoading(false) } }
  useEffect(() => { void reload() }, [])
  const filtered = useMemo(() => users.filter((user) => `${user.username || ''} ${user.display_name || ''} ${user.email}`.toLowerCase().includes(search.toLowerCase())), [search, users])

  async function changeStatus(user: Profile) {
    try { await manageUser(user.id, 'status', !user.is_active); setUsers((current) => current.map((item) => item.id === user.id ? { ...item, is_active: !item.is_active } : item)); notify('success', `${user.username || user.email} is now ${user.is_active ? 'inactive' : 'active'}.`) } catch (error) { notify('error', getErrorMessage(error)) }
  }
  async function changeRole(user: Profile) {
    const nextRole: Role = user.role === 'admin' ? 'user' : 'admin'
    try { await manageUser(user.id, 'role', nextRole); setUsers((current) => current.map((item) => item.id === user.id ? { ...item, role: nextRole } : item)); if (user.id === currentUser.id) onProfileChange({ ...currentUser, role: nextRole }); notify('success', `${user.username || user.email} is now ${nextRole === 'admin' ? 'a manager / administrator' : 'a team member'}.`) } catch (error) { notify('error', getErrorMessage(error)) }
  }

  return <><PageHeader eyebrow="Team access" title="Keep access intentional." description="Create team-member or manager accounts directly. Managers have the same permissions as administrators." action={<button className="button primary" onClick={() => setShowCreate(true)}><UserPlus size={17} /> Create account</button>} /><div className="team-toolbar"><div className="team-summary"><div className="summary-icon"><Users size={18} /></div><div><strong>{users.filter((user) => user.is_active).length} active members</strong><span>{users.length} total accounts in this workspace</span></div></div><div className="search-box small"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search usernames or people…" /></div></div>{loading ? <LoadingBlock /> : <div className="panel people-panel"><div className="table-heading"><span>Person</span><span>Role</span><span>Status</span><span>Joined</span><span /></div>{filtered.map((user) => <div className="person-row" key={user.id}><div className="person-cell"><div className="avatar">{initials(user.display_name, user.username || user.email)}</div><div><strong>{user.display_name || 'Unnamed account'}</strong><span>{user.username || user.email}</span></div></div><div><span className={`role-pill ${user.role}`}><span />{user.role === 'admin' ? 'Manager / admin' : 'Team member'}</span></div><div><span className={`status-pill ${user.is_active ? 'active' : 'archived'}`}><span />{user.is_active ? 'Active' : 'Inactive'}</span></div><div className="joined-date">{formatDate(user.created_at)}</div><div className="row-menu"><button className="icon-button" title="Toggle access" disabled={user.id === currentUser.id} onClick={() => void changeStatus(user)}>{user.is_active ? <Lock size={16} /> : <KeyRound size={16} />}</button><button className="icon-button" title="Change role" disabled={user.id === currentUser.id} onClick={() => void changeRole(user)}><MoreHorizontal size={17} /></button></div></div>)}{!filtered.length && <EmptyState compact icon={<Users size={20} />} title="No teammates found" description="Try another search term." />}</div>}{showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreate={async (username, password, name, role) => { await createUser(username, password, name, role); setShowCreate(false); notify('success', `Account ${username} created.`); await reload() }} />}</>
}

function CreateUserModal({ onClose, onCreate }: { onClose: () => void; onCreate: (username: string, password: string, name: string, role: Role) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="Create an account" onClose={onClose}><form className="stack-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { if (password !== confirmation) throw new Error('The passwords do not match.'); await onCreate(username, password, name, role) } catch (createError) { setError(getErrorMessage(createError)) } finally { setBusy(false) } }}><p className="modal-intro">Set the credentials yourself, then securely give the username and password to the person. Managers have the same access as administrators.</p><label>Full name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Jordan Lee" required /></label><label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="jordan.lee" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,39}" title="Use 3–40 letters, numbers, dots, underscores, or hyphens." required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /></label><label>Confirm password<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Re-enter the password" minLength={8} required /></label><label>Access level<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="user">Team member</option><option value="admin">Manager / administrator</option></select></label>{error && <div className="inline-message error"><ShieldAlert size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}<ArrowRight size={16} /></button></div></form></Modal>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop"><section className="modal"><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={19} /></button></div>{children}</section></div>
}

function LoadingBlock() { return <div className="loading-block"><RefreshCw size={18} /><span>Loading your records…</span></div> }

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-banner"><ShieldAlert size={18} /><span>{message}</span><button onClick={onRetry}>Try again</button></div>
}

function EmptyState({ icon, title, description, action, compact = false }: { icon: ReactNode; title: string; description: string; action?: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>
}

export default App
