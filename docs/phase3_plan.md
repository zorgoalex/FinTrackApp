# Phase 3 - Operation Tracking Plan

This document outlines the detailed plan for implementing Phase 3, focusing on operation tracking within the FinTrackApp.

## 1. Database Schema: `operations` Table

### Table Definition
Create a new table named `operations` with the following columns:

-   `id`: `uuid` (Primary Key, default gen_random_uuid())
-   `workspace_id`: `uuid` (Foreign Key to `workspaces.id`, NOT NULL)
-   `user_id`: `uuid` (Foreign Key to `users.id`, NULLABLE, ON DELETE SET NULL)
-   `amount`: `numeric(15, 2)` (NOT NULL, CHECK (amount > 0)) - Stores monetary values with two decimal places.
-   `type`: `text` (NOT NULL, CHECK (type IN ('income', 'expense', 'salary', 'transfer'))) - Defines the type of operation.
-   `description`: `text` (NULLABLE) - Optional description for the operation.
-   `date`: `date` (NOT NULL, DEFAULT CURRENT_DATE) - The date of the operation.
-   `created_at`: `timestamp with time zone` (NOT NULL, DEFAULT NOW()) - Timestamp of record creation.

### Constraints
-   `PRIMARY KEY (id)`
-   `FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE`
-   `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`
-   `CHECK (amount > 0)`
-   `CHECK (type IN ('income', 'expense', 'salary', 'transfer'))`

### Indexes
-   `CREATE INDEX idx_operations_workspace_id ON operations (workspace_id);`
-   `CREATE INDEX idx_operations_user_id ON operations (user_id);`
-   `CREATE INDEX idx_operations_date ON operations (date);`
-   `CREATE INDEX idx_operations_type ON operations (type);`

## 2. Row Level Security (RLS) Policies for `operations`

RLS policies will ensure that users can only access operations relevant to their role and ownership within a workspace.

### Policies
1.  **`Enable RLS on operations table`**: `ALTER TABLE operations ENABLE ROW LEVEL SECURITY;`
2.  **`Owner/Admin Policy (Full Access)`**:
    -   Name: `allow_workspace_admin_access`
    -   Target: `operations`
    -   Role: `authenticated`
    -   `USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = operations.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'admin')))`
    -   `WITH CHECK (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = operations.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'admin')))`
    -   This policy grants full access (SELECT, INSERT, UPDATE, DELETE) to owners and admins of the associated workspace.
3.  **`Member Policy (Create/Delete Own)`**:
    -   Name: `allow_member_own_operations`
    -   Target: `operations`
    -   Role: `authenticated`
    -   `USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = operations.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'member'))`
    -   `WITH CHECK (operations.user_id = auth.uid() AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = operations.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'member'))`
    -   This policy allows members to SELECT all operations in their workspace, and INSERT/DELETE their *own* operations. (Note: UPDATE is not explicitly granted here as per requirement, but can be added if needed later).
4.  **`Viewer Policy (Read-Only)`**:
    -   Name: `allow_viewer_read_access`
    -   Target: `operations`
    -   Role: `authenticated`
    -   `USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = operations.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'viewer'))`
    -   This policy grants read-only (SELECT) access to viewers of the associated workspace.

## 3. SQL Migration Script

```sql
-- Migration: Create operations table and RLS policies

-- Create operations table
CREATE TABLE public.operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    amount numeric(15, 2) NOT NULL CHECK (amount > 0),
    type text NOT NULL CHECK (type IN ('income', 'expense', 'salary', 'transfer')),
    description text,
    date date NOT NULL DEFAULT CURRENT_DATE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX idx_operations_workspace_id ON public.operations (workspace_id);
CREATE INDEX idx_operations_user_id ON public.operations (user_id);
CREATE INDEX idx_operations_date ON public.operations (date);
CREATE INDEX idx_operations_type ON public.operations (type);

-- Enable Row Level Security
ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;

-- Policy for Owners/Admins: Full access to all operations in their workspace
CREATE POLICY allow_workspace_admin_access ON public.operations
FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = operations.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
    )
) WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = operations.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
    )
);

-- Policy for Members: Read all, Create/Delete own operations
CREATE POLICY allow_member_operations ON public.operations
FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = operations.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role = 'member'
    )
) WITH CHECK (
    (auth.uid() = operations.user_id AND (auth.role() = 'authenticated' OR auth.role() = 'service_role')) -- Allow INSERT/DELETE own
    OR
    EXISTS ( -- Allow SELECT for all operations in workspace
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = operations.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role = 'member'
    )
);

-- Policy for Viewers: Read-only access to all operations in their workspace
CREATE POLICY allow_viewer_read_access ON public.operations
FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = operations.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role = 'viewer'
    )
);

-- Ensure authenticated users can only interact with their own workspaces' operations
-- This is implicitly covered by the workspace_members check in each policy.
-- No additional global policy needed for 'authenticated' role beyond the specific RLS policies above.
```

## 4. Frontend Development

### Forms for Operation Creation (Modals)
-   **Component:** `OperationFormModal.jsx` (reusable for different types)
-   **Inputs:** `amount`, `type` (dropdown/radio: Income, Expense, Salary, Transfer), `description`, `date`.
-   **Validation:** Client-side validation for required fields, amount > 0, valid date.
-   **Integration:**
    -   Buttons on `HomePage.jsx` or `OperationPage.jsx` to open "Add Income", "Add Expense", "Add Salary" modals.
    -   `type` field pre-selected based on the button clicked.
    -   API integration to submit data to the backend (`/api/operations`).

### Operations List with Filters
-   **Component:** `OperationList.jsx`
-   **Display:** Table or list view of operations including `date`, `type`, `description`, `amount`, and `user_id` (displaying user name if available).
-   **Filters:**
    -   By Date Range (`date` picker)
    -   By Type (dropdown: All, Income, Expense, Salary, Transfer)
    -   By User (`user_id` dropdown for workspace members)
    -   Pagination / Infinite Scroll.
-   **Actions:** Edit/Delete buttons (conditional based on RLS and user role).
-   **Integration:** Fetch operations from backend (`/api/operations?filters...`).

### Dashboard with Real Data
-   **Component:** `DashboardPage.jsx` (likely an extension of `HomePage.jsx` or a new dedicated page)
-   **Key Metrics:**
    -   Total Income (current month/year)
    -   Total Expenses (current month/year)
    -   Net Balance (current month/year)
    -   Breakdown by operation type (charts/graphs).
    -   Trends over time.
-   **Data Source:** Aggregated data from `operations` table, potentially new API endpoints for dashboard-specific statistics.
-   **Visualization:** Use a charting library (e.g., Chart.js, Recharts).

## 5. Tasks for Codex (Numbered Specific Tasks)

1.  **Backend: Database Setup**
    *   Create the `operations` table in `public` schema with specified columns, types, and constraints.
    *   Add `ON DELETE SET NULL` for `user_id` foreign key.
    *   Apply all specified indexes.
    *   Implement RLS policies for `operations` table as detailed in Section 2.
2.  **Backend: API Endpoints for Operations**
    *   Implement `POST /api/operations` for creating a new operation.
    *   Implement `GET /api/operations` for listing operations with filtering, sorting, and pagination capabilities.
    *   Implement `GET /api/operations/{id}` for fetching a single operation.
    *   Implement `PUT /api/operations/{id}` for updating an existing operation.
    *   Implement `DELETE /api/operations/{id}` for deleting an operation.
    *   Ensure all endpoints respect RLS policies and user roles.
3.  **Frontend: Operation Form Modals**
    *   Create a reusable React component `OperationFormModal.jsx`.
    *   Implement form fields for `amount`, `type`, `description`, `date`.
    *   Add client-side validation.
    *   Integrate API calls for submitting new operations.
    *   Add buttons to `HomePage.jsx` or `OperationPage.jsx` to trigger the modals for "Income," "Expense," "Salary."
4.  **Frontend: Operations List Component**
    *   Create `OperationList.jsx` component to display operations.
    *   Implement UI for filtering by date range, type, and user.
    *   Integrate API calls to fetch filtered and paginated operations.
    *   Add conditional rendering for Edit/Delete buttons based on user permissions.
5.  **Frontend: Dashboard Integration**
    *   Update `HomePage.jsx` or create `DashboardPage.jsx` to display key financial metrics.
    *   Develop API endpoints on the backend to fetch aggregated data for the dashboard (e.g., total income/expense by month, balance over time).
    *   Integrate a charting library to visualize data.
6.  **Testing:**
    *   Write unit and integration tests for backend API endpoints (RLS, validation).
    *   Write frontend unit tests for form validation and component rendering.
    *   Implement end-to-end tests for operation creation, listing, and filtering.

## 6. Edge Cases: `user_id = null` (Deleted User)

When a user is deleted, their `user_id` in the `operations` table will be set to `NULL` due to the `ON DELETE SET NULL` foreign key constraint.

### Handling in Frontend
-   When displaying an operation, if `user_id` is `NULL`, display "Deleted User" or "N/A" instead of attempting to fetch or display a user's name.
-   Filter by `user_id` dropdown should include an option for "Deleted Users" or implicitly handle operations with `NULL user_id` when no specific user filter is applied.

### Handling in Backend
-   The RLS policies are designed to handle `auth.uid()` which will not match `NULL`, so operations with `user_id = NULL` will still be subject to `workspace_id` based access.
-   When fetching operations, ensure that the API can correctly return operations where `user_id` is `NULL`.
-   Consider adding a `system_created` boolean field if some operations are not directly tied to a specific user (e.g., system adjustments), although the `NULL user_id` already covers this for deleted users.
