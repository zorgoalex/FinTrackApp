# Frontend Integration Guide for Invitation System

This document outlines how to integrate the frontend application with the new backend Edge Functions for handling workspace invitations.

## 1. Overview

The invitation system consists of two main backend functions:
1.  `invite-user`: Allows workspace Owners and Admins to send email invitations.
2.  `accept-invitation`: Allows a logged-in user to accept a pending invitation using a unique token.

The general flow is:
1.  An Admin/Owner invites a new user via email from the workspace settings UI.
2.  The `invite-user` function creates an invitation record and sends an email containing a unique link.
3.  The recipient clicks the link and is taken to the `InvitationAcceptPage`.
4.  The page ensures the user is logged in (or signs up).
5.  The page calls the `accept-invitation` function with the token from the link.
6.  On success, the user is added to the workspace and redirected to it.

## 2. Environment Variables

The backend uses an environment variable `APP_BASE_URL` to construct the invitation link in emails. Ensure your frontend's base URL is set in the Supabase project's environment variables.

- **Variable:** `APP_BASE_URL`
- **Example:** `https://www.fintrackapp.com`

## 3. API Endpoints

All endpoints require the standard Supabase `Authorization` and `apikey` headers.

---

### Invite a User

- **Endpoint:** `POST /functions/v1/invite-user`
- **Description:** Creates an invitation and sends an email.
- **Permissions:** Must be called by a user with the 'Owner' or 'Admin' role in the workspace.
- **Headers:**
  ```
  Authorization: Bearer <USER_SUPABASE_JWT>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "workspaceId": "uuid-of-the-workspace",
    "email": "invited.user@example.com",
    "role": "Member"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "invitation_id": "uuid-of-the-new-invitation"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing required fields in the body.
  - `401 Unauthorized`: Invalid or missing JWT.
  - `403 Forbidden`: User does not have permission to invite.
  - `409 Conflict`: An invitation for this email is already pending.
  - `500 Internal Server Error`: Unexpected backend error.

---

### Accept an Invitation

- **Endpoint:** `POST /functions/v1/accept-invitation`
- **Description:** Validates a token and adds the logged-in user to the workspace.
- **Permissions:** Must be called by a logged-in user. The user's email must match the one on the invitation.
- **Headers:**
  ```
  Authorization: Bearer <USER_SUPABASE_JWT>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "token": "uuid-token-from-the-email-link"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "workspaceId": "uuid-of-the-joined-workspace"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing `token`.
  - `401 Unauthorized`: Invalid or missing JWT.
  - `403 Forbidden`: The logged-in user's email does not match the invited email.
  - `404 Not Found`: The invitation token is invalid.
  - `410 Gone`: The invitation has expired or has already been used.
  - `500 Internal Server Error`: Unexpected backend error.

## 4. Frontend Component Guide

### `InvitationAcceptPage.jsx`

This page handles the logic for a user accepting an invitation.

1.  **Get Token:** On page load, extract the `token` from the URL query parameters (`?token=...`).
2.  **Check Auth State:**
    - Use the Supabase client to check if a user is currently logged in.
    - **If NOT logged in:** Redirect the user to the login page. You can pass a `redirect_to` URL so they are sent back to the acceptance page after logging in or signing up.
    - **If logged in:** Proceed to the next step.
3.  **Call the API:**
    - Make a `POST` request to the `/functions/v1/accept-invitation` endpoint, passing the user's JWT in the header and the `token` in the body.
4.  **Handle Response:**
    - **On success:** Use the `workspaceId` from the response to redirect the user to their new workspace (e.g., `/workspace/${workspaceId}`). You might want to show a success message first.
    - **On failure:** Display an appropriate error message to the user based on the status code (e.g., "This invitation has expired.").

### `InvitationNotifications.jsx`

This component should display a list of pending invitations for the currently logged-in user.

1.  **Fetch Data:** Use the Supabase JS client to query the `workspace_invitations` table.
2.  **Query:**
    ```javascript
    const { data: user, error: userError } = await supabase.auth.getUser();
    if (user) {
        const { data: invitations, error } = await supabase
            .from('workspace_invitations')
            .select('*, workspace:workspaces(name)') // Join to get workspace name
            .eq('invited_email', user.email)
            .eq('status', 'pending');

        // Render the list of invitations
    }
    ```
3.  **Functionality:** For each invitation, you can provide "Accept" and "Decline" buttons.
    - The "Accept" button would navigate to the `InvitationAcceptPage`.
    - The "Decline" button could trigger an update to the invitation record, setting its status to `declined`. This would require a simple RLS policy allowing users to update invitations addressed to them.
