# Phase 4 Research

## Current Architecture

### useOperations hook (`src/hooks/useOperations.js`)

**How data is fetched:**
```js
const { data, error: loadError } = await supabase
  .from('operations')
  .select('id, workspace_id, user_id, amount, type, description, operation_date, created_at')
  .eq('workspace_id', workspaceId)
  .order('operation_date', { ascending: false })
  .order('created_at', { ascending: false });
```
- Explicit column list in `.select()` — must be updated when adding `category_id`
- After fetch, each operation is mapped through `mapOperationWithDisplayName(operation, authUser)` which adds `displayName` field
- Summary (today/month income/expense/salary/total) is calculated client-side in `calculateSummary(operations)`

**Return shape:**
```js
return {
  operations,   // Array of mapped operation objects
  loading,      // boolean
  error,        // string | null
  addOperation, // async (data) => insertedOperation | null
  deleteOperation, // async (id) => boolean
  refresh,      // async () => void
  summary       // { today: { income, expense, salary, total }, month: { ... } }
};
```

**Current operation fields (from DB + mapped):**
- `id`, `workspace_id`, `user_id`, `amount`, `type`, `description`, `operation_date`, `created_at`
- `displayName` (added by mapper)

**addOperation payload construction:**
```js
const payload = {
  workspace_id: workspaceId,
  user_id: userId,
  amount: Number(data?.amount) || 0,
  type,
  description: data?.description || '',
  operation_date: data?.operation_date || new Date().toISOString().slice(0, 10)
};
```
After insert, calls `loadOperations()` to refetch all data (full reload pattern, not optimistic).

**DB schema** (`supabase/migrations/20260224_phase3_operations.sql`):
```sql
CREATE TABLE public.operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    amount numeric(15,2) NOT NULL CHECK (amount > 0),
    type text NOT NULL CHECK (type IN ('income', 'expense', 'salary')),
    description text,
    operation_date date NOT NULL DEFAULT CURRENT_DATE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```
RLS policies exist for select/insert/update/delete based on workspace membership roles.

---

### OperationPage (`src/pages/OperationPage.jsx`)

**Filter state variables:**
```js
const [filterType, setFilterType] = useState(null);       // null = все
const [sortField, setSortField] = useState('date');        // 'date' | 'amount'
const [sortDir, setSortDir]     = useState('desc');        // 'asc' | 'desc'
```

**visibleOperations useMemo — current chain:**
1. `monthlyOperations` — filters `operations` to current month only via `isDateInCurrentMonth()`
2. `visibleOperations` — applies `filterType` filter, then sorts by `sortField`/`sortDir`

```js
const visibleOperations = useMemo(() => {
  const filtered = filterType
    ? monthlyOperations.filter((op) => op.type === filterType)
    : [...monthlyOperations];

  return filtered.sort((a, b) => {
    let valA, valB;
    if (sortField === 'amount') {
      valA = Math.abs(Number(a.amount) || 0);
      valB = Math.abs(Number(b.amount) || 0);
    } else {
      valA = new Date(a.operation_date || a.created_at).getTime();
      valB = new Date(b.operation_date || b.created_at).getTime();
    }
    return sortDir === 'asc' ? valA - valB : valB - valA;
  });
}, [monthlyOperations, filterType, sortField, sortDir]);
```

**Form state (formData shape):**
```js
const [formData, setFormData] = useState({
  type: getDefaultType(searchParams),  // from URL ?type=...
  amount: '',
  description: '',
  operationDate: new Date().toISOString().slice(0, 10)
});
```

**How modal open/close works:**
- `isModalOpen` boolean state — toggled by `openAddModal(type)` and `closeModal()`
- Modal is rendered inline in OperationPage JSX (not using AddOperationModal component!)
- The inline modal has its own form fields duplicating AddOperationModal's structure
- `handleSubmit` calls `addOperation(...)` then `closeModal()` on success

**Important:** OperationPage has its OWN inline modal form (lines 380-462), NOT the `AddOperationModal` component. This is a separate implementation from WorkspacePage's modal.

**Filter UI:** Type filter buttons (Все / Доход / Расход / Зарплата) rendered as pill buttons. Sort buttons for date and amount.

**workspaceId access:**
```js
const { workspaceId: workspaceIdFromContext } = useWorkspace();
const workspaceId = params.workspaceId || searchParams.get('workspaceId') || workspaceIdFromContext;
```

---

### AddOperationModal (`src/components/AddOperationModal.jsx`)

**Props:**
```js
{ type: initialType, onClose, onSave }
```
- `type` — preset operation type ('income'|'expense'|'salary')
- `onClose` — callback to close modal
- `onSave` — async (payload) => void, receives `{ type, amount, description, operation_date }`

**Form fields and state:**
```js
const [form, setForm] = useState({
  type:          initialType || 'income',
  amount:        '',
  description:   '',
  operationDate: todayDateString(),
});
```
Fields: type (select), amount (text with decimal inputMode), description (textarea), operationDate (date input).

**How save works:**
```js
await onSave({
  type:           form.type,
  amount,                        // parsed number
  description:    form.description,
  operation_date: form.operationDate,
});
onClose();
```
No `category_id` or tags in payload currently. The `onSave` callback is `addOperation` from `useOperations`.

**workspaceId — how it's accessed:**
AddOperationModal does NOT receive `workspaceId` as a prop and does NOT use `useWorkspace()` context. It is purely a presentation component that delegates save to `onSave`. The `workspaceId` is handled by the parent (WorkspacePage passes `addOperation` which already has `workspaceId` in closure).

---

### WorkspacePage (`src/pages/WorkspacePage.jsx`)

**How addOperation is called from dashboard quick buttons:**
```js
const [modalType, setModalType] = useState(null); // null = closed, 'income'|'expense'|'salary'

const openOperationForm = (type) => {
  setModalType(type || 'income');
};
```
Quick action buttons call `openOperationForm('income')`, etc. FAB button also calls `openOperationForm('income')`.

**Modal rendering:**
```jsx
{modalType && (
  <AddOperationModal
    type={modalType}
    onClose={() => setModalType(null)}
    onSave={addOperation}
  />
)}
```
`addOperation` comes from `useOperations(workspaceId)`. WorkspacePage uses the shared `AddOperationModal` component (unlike OperationPage which has an inline modal).

**Dashboard also displays last 5 operations** (lines 294-313) showing type label, description, and signed amount. No tags or categories shown currently.

---

### WorkspaceContext (`src/contexts/WorkspaceContext.jsx`)

**workspaceId access pattern:**
```js
const { workspaceId: workspaceIdFromParams } = useParams();
const [searchParams] = useSearchParams();
const workspaceId = workspaceIdFromParams || searchParams.get('workspaceId') || null;
```
Exposed in context value as `workspaceId`. Also provides `currentWorkspace`, `userRole`, `allWorkspaces`, and CRUD functions.

---

### usePermissions (`src/hooks/usePermissions.js`)

Derives all permission flags from `userRole` obtained via `useWorkspace()`.

**Key permissions relevant to Phase 4:**
- `canCreateOperations`: owner/admin/member
- `canEditOwnOperations`: owner/admin/member
- `canEditAllOperations`: owner/admin
- `canDeleteOperations`: owner/admin
- `canEditDirectories`: owner/admin — **already exists for future phases!**
- `canViewDirectories`: owner/admin/member/viewer

The `canEditDirectories` / `canViewDirectories` flags are already defined (lines 50-51) — these can be used for category/tag management permissions.

---

## Integration Points for Phase 4

### Where to add category_id

**In useOperations.js:**
- `loadOperations`: Add `category_id` to the `.select()` column list (line 124)
- `addOperation` payload (line 173-179): Add `category_id: data?.category_id || null`
- Insert `.select()` (line 189): Add `category_id` to column list

**In AddOperationModal.jsx:**
- New form field: category dropdown (`<select>`)
- Form state: add `categoryId: null` to initial state
- `handleSubmit` payload: add `category_id: form.categoryId`
- **Challenge:** Modal needs category list — either pass as prop or use a hook. Since modal doesn't have `workspaceId`, either:
  - (a) Add `workspaceId` prop and call `useCategories(workspaceId)` inside, or
  - (b) Pass `categories` array as a prop from parent

**In OperationPage.jsx (inline modal):**
- Same form field additions as AddOperationModal
- New filter state: `const [filterCategory, setFilterCategory] = useState(null);`
- `visibleOperations` useMemo: add category filtering step
- New category filter dropdown in the filter bar
- OperationPage already uses `useWorkspace()` so it can call `useCategories(workspaceId)` directly

### Where to add tags

**In useOperations.js:**
- After fetching operations, need a second query to load tags for those operations
- Option A: Fetch `operation_tags` + `tags` via join: `supabase.from('operation_tags').select('operation_id, tags(id, name, color)').in('operation_id', operationIds)`
- Option B: Use supabase foreign table join if relationship is set up
- Merge tags into each operation object: `operation.tags = [{ id, name, color }, ...]`

**In AddOperationModal.jsx:**
- New `TagInput` component (chips + autocomplete input)
- Form state: add `tagIds: []` or `tagNames: []`
- On save: need to handle tag resolution (name → ID, create if missing)
- Tag creation is a two-step process: (1) save operation, (2) insert `operation_tags` rows

**In OperationPage.jsx:**
- Display tag chips on each operation row (after description, before author)
- New filter state: `const [filterTags, setFilterTags] = useState([]);` (multi-select)
- `visibleOperations` useMemo: add tag filtering (operation must have ALL or ANY selected tags)
- New tag filter UI: multi-select chips/dropdown in filter bar

### Hooks needed

**useCategories(workspaceId):**
```js
// Suggested return shape:
{
  categories,       // Array<{ id, workspace_id, name, type, color }>
  loading,
  error,
  addCategory,      // async ({ name, type, color }) => category | null
  deleteCategory,   // async (id) => boolean
  refresh
}
```
- Fetches from `categories` table where `workspace_id` matches
- `type` field allows filtering categories relevant to income vs expense vs salary
- Could also provide a `categoriesByType` grouped object for convenience

**useTags(workspaceId):**
```js
// Suggested return shape:
{
  tags,            // Array<{ id, workspace_id, name, color }>
  loading,
  error,
  addTag,          // async ({ name, color }) => tag | null
  findOrCreateTag, // async (name) => tag — for autocomplete "create on fly"
  deleteTag,       // async (id) => boolean
  refresh
}
```
- Fetches from `tags` table where `workspace_id` matches
- `findOrCreateTag` is important for the tag input UX — user types a name, if it exists reuse it, otherwise create

---

## Key challenges / risks

### 1. Two separate modal implementations
OperationPage has its **own inline modal form** (lines 380-462) that duplicates AddOperationModal's functionality. When adding category/tag fields:
- **Either** refactor OperationPage to use `AddOperationModal` component (reduces duplication)
- **Or** add category/tag to both places (more work, risk of drift)
- **Recommendation:** Refactor OperationPage to use AddOperationModal to avoid maintaining two forms

### 2. AddOperationModal lacks workspaceId
AddOperationModal is a pure presentational component — it receives `onSave` and renders a form. It doesn't know about workspace. For categories/tags it needs data:
- **Option A:** Add `workspaceId` prop → use hooks inside modal
- **Option B:** Add `categories` and `tags` props → parent fetches and passes down
- **Option C:** Add `workspaceId` prop, use hooks, but also accept optional `categories`/`tags` override props
- **Recommendation:** Option A is cleanest. Add `workspaceId` prop. Both WorkspacePage and OperationPage already have it.

### 3. Tag creation during save — multi-step transaction
When user adds a new tag name that doesn't exist:
1. Create tag in `tags` table → get `tag_id`
2. Insert operation → get `operation_id`
3. Insert `operation_tags(operation_id, tag_id)` rows

This is a 3-step process. If step 3 fails, orphan tags remain. Options:
- Use a Supabase edge function / RPC for atomic creation
- Do it client-side with sequential awaits (simpler, acceptable for MVP)
- **Recommendation:** Client-side sequential for now. Tags are cheap to have as orphans.

### 4. Tag save flow in useOperations.addOperation
Currently `addOperation` builds payload and inserts into `operations`. After Phase 4:
- `addOperation` needs to also accept `tagIds` (or `tagNames`)
- After inserting operation, insert `operation_tags` rows
- Could do: `addOperation({ ...fields, tags: [{ id, name }] })` → resolve/create tags → insert junction rows
- OR: return operation from `addOperation`, let caller handle tag linking (bad separation)
- **Recommendation:** Extend `addOperation` to handle tags internally

### 5. visibleOperations useMemo complexity
Currently filters by type only. Adding category + tags:
```js
// Pseudocode for new chain:
let filtered = monthlyOperations;
if (filterType) filtered = filtered.filter(op => op.type === filterType);
if (filterCategory) filtered = filtered.filter(op => op.category_id === filterCategory);
if (filterTags.length) filtered = filtered.filter(op =>
  filterTags.every(tagId => op.tags?.some(t => t.id === tagId))  // AND logic
);
return filtered.sort(...);
```
This is straightforward. No significant complexity risk. The dependency array grows by 2 items.

### 6. Tag autocomplete UX
- Needs a component that shows existing tags as suggestions while typing
- Selecting a tag adds it as a chip, removing is click-X
- Could use a simple filtered dropdown (no debounce needed — tags are loaded once per workspace, typically < 100)
- **Recommendation:** Simple local filter, no server-side search/debounce

### 7. RLS for new tables
Need RLS policies on `categories`, `tags`, and `operation_tags` tables:
- `categories`: same pattern as `operations` — workspace membership check
- `tags`: same pattern
- `operation_tags`: needs to check that user has write access to the operation's workspace
- Use existing `user_has_role()` function from Phase 3 migration

---

## Recommended component structure

### New files to create:
- `src/hooks/useCategories.js` — CRUD for categories scoped to workspace
- `src/hooks/useTags.js` — CRUD for tags scoped to workspace
- `src/components/TagInput.jsx` — reusable tag chips + autocomplete input component
- `supabase/migrations/20260224_phase4_categories_tags.sql` — DDL for categories, tags, operation_tags tables + RLS

### Files to modify:
- `src/hooks/useOperations.js` — add `category_id` to select/insert, fetch tags after operations, include tags in `addOperation`
- `src/components/AddOperationModal.jsx` — add `workspaceId` prop, category dropdown, TagInput, pass category_id + tags in onSave payload
- `src/pages/OperationPage.jsx` — add category/tag filter state, update visibleOperations, display tags in operation rows, update inline modal OR switch to AddOperationModal
- `src/pages/WorkspacePage.jsx` — pass `workspaceId` to AddOperationModal, optionally show tags on recent operations list

### Component hierarchy for AddOperationModal after changes:
```
AddOperationModal
  props: { type, onClose, onSave, workspaceId }
  hooks: useCategories(workspaceId), useTags(workspaceId)
  children:
    <select> for type
    <select> for category (filtered by type)
    <input> for amount
    <textarea> for description
    <input type="date"> for date
    <TagInput tags={allTags} selected={form.tagIds} onChange={...} />
```

---

## Open questions for plan

1. **Category-type binding:** Should categories be filtered by operation type (e.g., "Groceries" only for expense)? The proposed `categories.type` column suggests yes. Should the category dropdown update when user changes the type select?

2. **OperationPage inline modal vs AddOperationModal:** Should we refactor OperationPage to use AddOperationModal (reduces duplication, single form to maintain) or keep them separate? Recommendation: refactor.

3. **Tag filtering logic:** AND (operation must have ALL selected tags) or OR (operation must have ANY selected tag)? AND is more useful for narrowing down.

4. **Category filter on OperationPage:** Simple dropdown or pill buttons like the type filter? Dropdown is more scalable (categories could be many), pills are consistent with existing UI.

5. **Tag colors:** Are colors required on creation or optional with defaults? Should there be a color picker UI or predefined palette?

6. **Operation row tag display:** Show all tags as chips inline? What if an operation has many tags — truncate with "+N more"?

7. **Dashboard recent operations (WorkspacePage):** Should tags/category be shown on the 5-item recent list too, or only on OperationPage? The recent list is compact; adding tags may clutter it.

8. **Category/tag management UI:** Is there a separate settings/admin page for managing categories and tags, or are they created only inline during operation creation? The `canEditDirectories` permission exists but no management page is specified in Phase 4 requirements.

9. **Puppeteer test scope:** Should tests cover category/tag CRUD (creation, assignment, filtering) or just basic operation CRUD with existing fields plus the new filter UI?
