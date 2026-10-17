# QuickNotes Data Model

QuickNotes stores four entities: **users**, **notes**, **tags** and **note_tags**. The SQL below uses SQLite syntax so it runs in a playground such as sqliteonline.com. In PostgreSQL (the production recommendation) the same design would use `BIGINT GENERATED ALWAYS AS IDENTITY` for ids, `VARCHAR`/`TEXT` for text and `TIMESTAMPTZ` for timestamps.

## Entities

### users

A person with an account.

| Column | Type | Key / constraints | Description |
|--------|------|-------------------|-------------|
| id | INTEGER | **Primary key** | Unique user id |
| email | TEXT | NOT NULL, UNIQUE | Login email; no two accounts share one |
| password_hash | TEXT | NOT NULL | Hashed password (never the plain password) |
| display_name | TEXT | NOT NULL | Name shown in the app |
| created_at | TEXT | NOT NULL, default now | When the account was created |

### notes

One note written by one user.

| Column | Type | Key / constraints | Description |
|--------|------|-------------------|-------------|
| id | INTEGER | **Primary key** | Unique note id |
| user_id | INTEGER | **Foreign key** to users(id), NOT NULL | The owner of the note |
| title | TEXT | NOT NULL, 1 to 100 characters | Note title (same rule as the API) |
| body | TEXT | NOT NULL, default empty | Note text (optional in the API) |
| created_at | TEXT | NOT NULL, default now | When the note was created |
| updated_at | TEXT | NOT NULL, default now | When the note was last changed |

### tags

A label a user can put on notes, such as `work` or `ideas`.

| Column | Type | Key / constraints | Description |
|--------|------|-------------------|-------------|
| id | INTEGER | **Primary key** | Unique tag id |
| user_id | INTEGER | **Foreign key** to users(id), NOT NULL | The user who owns the tag |
| name | TEXT | NOT NULL, UNIQUE with user_id | Tag text; unique per user |

### note_tags (join table)

Links notes to tags.

| Column | Type | Key / constraints | Description |
|--------|------|-------------------|-------------|
| note_id | INTEGER | **Foreign key** to notes(id), part of the **composite primary key** | The note |
| tag_id | INTEGER | **Foreign key** to tags(id), part of the **composite primary key** | The tag |

The composite primary key `(note_id, tag_id)` means the same tag cannot be attached to the same note twice.

## Relationships

- **users to notes: one-to-many.** One user writes many notes, but each note belongs to exactly one user (`notes.user_id`).
- **users to tags: one-to-many.** One user owns many tags, and each tag belongs to one user (`tags.user_id`), so two users can both have a tag called `work` without clashing.
- **notes to tags: many-to-many.** A note can have several tags (`work` and `urgent`) and a tag can be on many notes. A relational table cannot store a list of ids in one column cleanly, so the **join table `note_tags`** holds one row per note-and-tag pair. It turns the many-to-many relationship into two one-to-many relationships: notes to note_tags and tags to note_tags.
- **Deleting:** `ON DELETE CASCADE` means deleting a user deletes their notes and tags, and deleting a note or tag deletes its `note_tags` rows, so no orphan rows are left behind.

```
users 1 ---- * notes 1 ---- * note_tags * ---- 1 tags * ---- 1 users
```

## CREATE TABLE statements

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE tags (
    id      INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name    TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
    note_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);

CREATE INDEX idx_notes_user_created ON notes (user_id, created_at DESC);
CREATE INDEX idx_note_tags_tag ON note_tags (tag_id);
```

## Sample data

```sql
INSERT INTO users (id, email, password_hash, display_name) VALUES
    (1, 'amina@example.com', 'hash1', 'Amina'),
    (2, 'brian@example.com', 'hash2', 'Brian'),
    (3, 'chloe@example.com', 'hash3', 'Chloe');   -- has no notes yet

INSERT INTO notes (id, user_id, title, body, created_at) VALUES
    (1, 1, 'Team meeting',  'Agenda: launch plan', '2026-10-15 09:00:00'),
    (2, 1, 'Shopping list', 'Milk, eggs, bread',   '2026-10-16 18:05:00'),
    (3, 1, 'Book ideas',    'African folk tales',  '2026-10-17 08:30:00'),
    (4, 2, 'Study plan',    'Databases, networks', '2026-10-17 07:00:00');

INSERT INTO tags (id, user_id, name) VALUES
    (1, 1, 'work'),
    (2, 1, 'personal'),
    (3, 2, 'study');

INSERT INTO note_tags (note_id, tag_id) VALUES
    (1, 1),
    (2, 2),
    (3, 2),
    (4, 3);
```

## Example queries

**1. A user's 20 newest notes** (this is the query behind `GET /notes`; it uses the index below).

```sql
SELECT id, title, created_at
FROM notes
WHERE user_id = 1
ORDER BY created_at DESC
LIMIT 20;
```

**2. All notes with a given tag, with a JOIN** (behind `GET /notes?tag=personal`).

```sql
SELECT n.id, n.title, t.name AS tag
FROM notes n
JOIN note_tags nt ON nt.note_id = n.id
JOIN tags t       ON t.id = nt.tag_id
WHERE n.user_id = 1
  AND t.name = 'personal'
ORDER BY n.created_at DESC;
```

**3. How many notes each tag has, with GROUP BY** (tags with no notes still appear because of the LEFT JOIN).

```sql
SELECT t.name, COUNT(nt.note_id) AS note_count
FROM tags t
LEFT JOIN note_tags nt ON nt.tag_id = t.id
WHERE t.user_id = 1
GROUP BY t.id, t.name
ORDER BY note_count DESC;
```

**4. Users who have written no notes.**

```sql
SELECT u.id, u.display_name
FROM users u
LEFT JOIN notes n ON n.user_id = u.id
WHERE n.id IS NULL;
```

**5. Update a note** (behind `PATCH /notes/{id}`; the `user_id` check stops one user editing another's note).

```sql
UPDATE notes
SET title = 'Team meeting (moved to Friday)',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1 AND user_id = 1;
```

## Indexes

**`idx_notes_user_created ON notes (user_id, created_at DESC)`**: almost every request is "show this user's newest notes". Without the index the database would scan every note of every user (hundreds of millions of rows at scale) and then sort them. With it, the database jumps straight to the user's rows already in newest-first order and stops after 20, so the query stays fast no matter how large the table grows.

**`idx_note_tags_tag ON note_tags (tag_id)`**: the composite primary key `(note_id, tag_id)` already makes "tags of a note" fast, but "notes with this tag" starts from the tag, so it needs its own index on `tag_id`.

Indexes are not free: each one uses disk space and slows writes slightly, so we only add the ones that match real queries.

## SQL or NoSQL?

I choose **SQL (a relational database such as PostgreSQL)**. QuickNotes data is naturally structured and connected: users own notes and tags, and notes and tags are linked many-to-many. A relational database enforces those links with foreign keys, prevents duplicates with unique constraints (one email per account, one tag name per user) and handles the many-to-many query "notes with this tag" cleanly with a JOIN. Writes such as creating a note and attaching its tags must succeed or fail together, which SQL transactions guarantee. The expected load (roughly 10 writes per second on average for 1 million users, see the architecture document) is well within what one primary database with read replicas can handle, so NoSQL's main advantage, easy horizontal write scaling, is not needed yet. If a feature later needs full-text search or huge scale, we can add a search engine or partition the data without abandoning SQL as the source of truth.
