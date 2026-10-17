# QuickNotes System Design

QuickNotes is a notes app that is moving from a browser-only tool to an online service for 1 million users. This repository has two parts:

1. **An API client** (`index.html`, `api.js`, `style.css`) that proves the front end can talk to a REST API. It uses the [JSONPlaceholder](https://jsonplaceholder.typicode.com) practice API to load, create and delete notes.
2. **Three design documents** that the backend team can build the real service from: the API design, the data model and the architecture.

## How to run the API client

You need a web browser and an internet connection. There is nothing to install.

1. Download or clone this repository:
   ```bash
   git clone https://github.com/your-username/quicknotes-system-design.git
   cd quicknotes-system-design
   ```
2. Open `index.html` in your browser (double-click it, or run `python3 -m http.server 8000` in the folder and visit `http://localhost:8000`).
3. Try it out:
   - Click **Load notes** to fetch 10 notes with `GET /posts?_limit=10`. You will see "Loading notes...", then "Loaded 10 notes from the server."
   - Fill in the form and click **Add note** to send a `POST`. The title is required and can be at most 100 characters; the body is optional. The new note appears at the top with its status code and id.
   - Click **Delete** on a note to send a `DELETE /posts/{id}` and remove it from the list.

**Practice API limitation:** JSONPlaceholder does not really save changes. A created note always gets id 101, and a deleted note comes back the next time you load. The client works around this, and the code comment above `handleDelete` in `api.js` explains how.

## What the client demonstrates

- A reusable `request()` function that calls `fetch`, checks `response.ok` and throws on errors
- GET, POST and DELETE, each inside `try` / `catch` / `finally`
- Loading, success, error and empty states shown on the page
- Input validation (a title is required, maximum 100 characters)
- Buttons disabled while a request is running
- User text inserted with `textContent` only, never `innerHTML`

## Design documents

| Document | What it covers |
|----------|----------------|
| [docs/api-design.md](docs/api-design.md) | The real QuickNotes REST API: 11 endpoints, request and response examples, and error codes |
| [docs/data-model.md](docs/data-model.md) | Users, notes, tags and note_tags: columns, keys, relationships, SQL, queries, an index and the SQL vs NoSQL decision |
| [docs/architecture.md](docs/architecture.md) | Requirements, load estimates for 1 million users, the architecture diagram, request flows, trade-offs and how single points of failure are avoided |

## Project structure

```
quicknotes-system-design/
├── index.html
├── api.js
├── style.css
├── README.md
└── docs/
    ├── api-design.md
    ├── data-model.md
    └── architecture.md
```

## What I learned

- **An API client has to plan for failure, not just success.** Requests can fail because of the network, a bad status code or unreadable data, so `request()` checks `response.ok` and every call uses `try` / `catch` / `finally`. The `finally` block re-enables the buttons so the page never gets stuck.
- **Fake APIs behave differently from real ones.** JSONPlaceholder says a note was created or deleted but stores nothing, so I had to keep my own list on the page and give each note its own key, because every created note comes back with id 101.
- **The data model comes from the relationships.** Users own many notes (one-to-many), but notes and tags are many-to-many, and a join table (`note_tags`) is the clean way to store that. An index on `notes(user_id, created_at)` matches the most common query.
- **Estimates guide the architecture.** Working out about 350 reads per second at peak and about 52 writes per second showed that the system is read-heavy, so caching and a read replica matter more than sharding.
- **Every design choice is a trade-off.** A cache makes reads fast but can be stale, and a queue keeps requests quick but makes some results arrive later. Good design means naming the trade-off and choosing on purpose.
