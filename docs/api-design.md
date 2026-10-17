# QuickNotes API Design

This document describes the **real QuickNotes API** that the backend team should build. It is not the JSONPlaceholder practice API used by the browser client in this repository; the client's GET, POST and DELETE calls map onto the `/notes` endpoints below.

## Conventions

- **Base URL:** `https://api.quicknotes.example/v1` (the version is in the path so we can change the API later without breaking old clients).
- **Format:** JSON requests and responses (`Content-Type: application/json`). Timestamps are ISO 8601 in UTC, for example `2026-10-17T09:30:00Z`.
- **Resources are nouns, methods are verbs:** `/notes` (plural noun), with `GET` to read, `POST` to create, `PATCH` to change part of a note and `DELETE` to remove it.
- **Authentication:** after login the client sends `Authorization: Bearer <token>` on every request except register and login.
- **Ownership:** a user can only see and change their own notes and tags.
- **Pagination:** list endpoints accept `?page=1&limit=20` (default limit 20, maximum 100) and return a `meta` object with totals.
- **Filtering and sorting on `GET /notes`:** `?tag=work`, `?q=meeting` (search in title and body) and `?sort=-created_at` (newest first, the default).

## Endpoints

| # | Method | Path | Description | Auth | Success status |
|---|--------|------|-------------|------|----------------|
| 1 | POST | `/auth/register` | Create a new user account | No | 201 Created |
| 2 | POST | `/auth/login` | Exchange email and password for an access token | No | 200 OK |
| 3 | GET | `/notes` | List the signed-in user's notes (paginated, filterable) | Yes | 200 OK |
| 4 | POST | `/notes` | Create a new note | Yes | 201 Created |
| 5 | GET | `/notes/{id}` | Get one note, including its tags | Yes | 200 OK |
| 6 | PATCH | `/notes/{id}` | Update the title and/or body of a note | Yes | 200 OK |
| 7 | DELETE | `/notes/{id}` | Delete a note | Yes | 204 No Content |
| 8 | GET | `/tags` | List the user's tags | Yes | 200 OK |
| 9 | POST | `/tags` | Create a tag | Yes | 201 Created |
| 10 | PUT | `/notes/{id}/tags/{tagId}` | Attach a tag to a note (safe to repeat) | Yes | 204 No Content |
| 11 | DELETE | `/notes/{id}/tags/{tagId}` | Remove a tag from a note | Yes | 204 No Content |

Notes on the design:
- `PUT /notes/{id}/tags/{tagId}` is idempotent: attaching the same tag twice has the same result as attaching it once.
- `DELETE` returns **204** with no body because there is nothing left to return.
- `POST /notes` returns a `Location` header, for example `Location: /v1/notes/4021`, pointing at the new note.

## Example: create a note (`POST /notes`)

**Request**

```http
POST /v1/notes HTTP/1.1
Host: api.quicknotes.example
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{
  "title": "Team meeting",
  "body": "Agenda: launch plan, budget, hiring.",
  "tags": ["work"]
}
```

Rules: `title` is required, 1 to 100 characters. `body` is optional (default empty string). `tags` is optional, a list of tag names that are created if they do not exist yet.

**Response: 201 Created**

```http
HTTP/1.1 201 Created
Location: /v1/notes/4021
Content-Type: application/json

{
  "id": 4021,
  "title": "Team meeting",
  "body": "Agenda: launch plan, budget, hiring.",
  "tags": [
    { "id": 7, "name": "work" }
  ],
  "created_at": "2026-10-17T09:30:00Z",
  "updated_at": "2026-10-17T09:30:00Z"
}
```

## Example: list notes (`GET /notes?page=1&limit=2`)

**Request**

```http
GET /v1/notes?page=1&limit=2 HTTP/1.1
Host: api.quicknotes.example
Authorization: Bearer eyJhbGciOi...
```

**Response: 200 OK**

```json
{
  "data": [
    {
      "id": 4021,
      "title": "Team meeting",
      "body": "Agenda: launch plan, budget, hiring.",
      "tags": [{ "id": 7, "name": "work" }],
      "created_at": "2026-10-17T09:30:00Z",
      "updated_at": "2026-10-17T09:30:00Z"
    },
    {
      "id": 4020,
      "title": "Shopping list",
      "body": "Milk, eggs, bread",
      "tags": [],
      "created_at": "2026-10-16T18:05:12Z",
      "updated_at": "2026-10-16T18:05:12Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 2,
    "total": 57,
    "total_pages": 29
  }
}
```

An empty list is **not** an error: the API returns `200 OK` with `"data": []` and `"total": 0`, and the client shows its empty state.

## Example: log in (`POST /auth/login`)

```json
// Request
{ "email": "amina@example.com", "password": "correct horse battery staple" }

// Response: 200 OK
{ "access_token": "eyJhbGciOi...", "token_type": "Bearer", "expires_in": 3600 }
```

## Error responses

Every error uses the same JSON shape so the client can handle all of them in one place:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request body is not valid.",
    "details": [
      { "field": "title", "message": "Title must be between 1 and 100 characters." }
    ]
  }
}
```

`code` is a short machine-readable string, `message` is safe to show to a person, and `details` is optional.

| Status | Meaning | When the API returns it |
|--------|---------|-------------------------|
| 400 Bad Request | The request is malformed or fails validation | Invalid JSON, missing or too-long `title`, bad `page` or `limit` |
| 401 Unauthorized | The caller is not authenticated | Missing, expired or invalid token; wrong email or password at login |
| 403 Forbidden | Authenticated, but not allowed | Trying to read, edit or delete another user's note or tag; suspended account |
| 404 Not Found | The resource does not exist | `GET /notes/99999` for an id that does not exist; unknown URL |
| 409 Conflict | The request clashes with existing data | Registering an email that is already used; creating a tag name that already exists |
| 429 Too Many Requests | Rate limit exceeded | Too many requests from one user or IP in a short time (a `Retry-After` header says when to retry) |
| 500 Internal Server Error | Unexpected server fault | Unhandled bug or failure in the server; details are logged, not sent to the client |
| 503 Service Unavailable | Temporarily unable to serve | Database failover in progress or the server is shutting down for a deploy |

### Example error bodies

**401 Unauthorized**

```json
{
  "error": {
    "code": "invalid_token",
    "message": "Your session has expired. Please log in again."
  }
}
```

**403 Forbidden**

```json
{
  "error": {
    "code": "forbidden",
    "message": "You do not have permission to access this note."
  }
}
```

**404 Not Found**

```json
{
  "error": {
    "code": "note_not_found",
    "message": "No note exists with id 99999."
  }
}
```

**500 Internal Server Error**

```json
{
  "error": {
    "code": "internal_error",
    "message": "Something went wrong on our side. Please try again.",
    "request_id": "req_8f3a2c1d"
  }
}
```

The `request_id` lets support staff find the matching entry in the server logs without exposing internal details to the user.
