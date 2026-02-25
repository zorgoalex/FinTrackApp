# Plan: Phase 6 — User Profile & Appearance Settings

## Overview

This phase introduces a **user profile** system with persistent appearance preferences.  
Settings are stored per-user in the database (Supabase `user_settings` table) so they survive across devices and sessions.

---

## Features

### 1. User Profile Page (`/profile`)
- Display current user's email and avatar (initials fallback)
- Editable display name
- Timezone selector (for future use)

### 2. Appearance Preferences

#### 2.1 Summary Blocks View Mode
User can choose how the **summary/totals blocks** are displayed at the top of `OperationPage`:

| Mode | Description |
|------|-------------|
| `cards` | Default — large cards with icons (current behaviour) |
| `compact` | Compact horizontal bar with smaller numbers |
| `minimal` | Text-only, no background, single line |

The selected mode is **saved to the user's profile** and loaded automatically on next visit.

#### 2.2 (Future) Other appearance settings — reserved for later:
- Default operation type (income / expense / salary)
- Default date range filter
- Dark/light mode override

---

## Database

### New table: `user_settings`

```sql
CREATE TABLE public.user_settings (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name text,
    summary_view_mode text NOT NULL DEFAULT 'cards'
        CHECK (summary_view_mode IN ('cards', 'compact', 'minimal')),
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,  -- extensible for future settings
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Each user can only read and write their own settings
CREATE POLICY "Users can view own settings" ON public.user_settings
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own settings" ON public.user_settings
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own settings" ON public.user_settings
    FOR UPDATE USING (user_id = auth.uid());
```

---

## Frontend

### New files
- `src/hooks/useUserSettings.js` — load/save settings via Supabase (upsert on change)
- `src/pages/ProfilePage.jsx` — profile + settings page
- `src/components/SummaryBlocks/` — extract current summary cards into a component folder:
  - `SummaryBlocks.jsx` — switcher that renders the chosen view
  - `SummaryCardsView.jsx` — current default cards
  - `SummaryCompactView.jsx` — compact horizontal bar
  - `SummaryMinimalView.jsx` — minimal text-only

### Modified files
- `src/pages/OperationPage.jsx` — replace inline summary blocks with `<SummaryBlocks mode={userSettings.summaryViewMode} />`
- `src/App.jsx` (or router) — add `/profile` route
- Navigation/header — add "Profile" link or avatar button

### Hook: `useUserSettings`
```js
// Returns:
{
  settings,        // { summary_view_mode, display_name, preferences }
  loading,
  updateSettings,  // async (patch) => upsert into user_settings
}
```

Settings are loaded once on mount. `updateSettings` does an upsert — instant local update + async save (optimistic UI).

---

## UX Flow

1. User clicks their avatar / name in the top-right corner → opens `/profile`
2. Profile page shows their info + a **"View" section** with 3 radio/button options for summary blocks
3. Selecting an option:
   - Immediately updates the UI (optimistic)
   - Saves to `user_settings` via upsert
4. On next login / page load, the saved preference is restored

---

## Implementation Order

1. SQL migration — create `user_settings` table + RLS
2. `useUserSettings` hook
3. Extract `SummaryBlocks` components (cards / compact / minimal views)
4. Wire `SummaryBlocks` into `OperationPage`
5. Build `ProfilePage` with the view-mode switcher
6. Add navigation entry to profile page

---

## Open Questions

- Should `display_name` replace the email in the workspace member list?  → Yes, if set
- Should appearance settings be **workspace-scoped** or **global per user**?  → Global per user (cross-workspace preference)
- Mobile: show summary view switcher in profile or directly on the operations page via a small icon?  → Profile only (keep the ops page clean)
