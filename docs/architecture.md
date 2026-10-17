# QuickNotes Architecture

QuickNotes is moving from a browser-only app to an online service for **1 million users**. This document describes the requirements, the expected load, the architecture the backend team should build and the reasons behind it.

## 1. Requirements

### Functional requirements

- Users can register, log in and log out.
- Users can **create, list, read, edit and delete** their own notes (see the API design document).
- Users can create tags, attach them to notes and filter notes by tag.
- Users can search their notes by text.
- Notes are private: a user can only access their own notes.
- Notes are available from any device once the user logs in.

### Non-functional requirements

| Requirement | Target |
|-------------|--------|
| Availability | 99.9% uptime (about 9 hours of downtime per year at most) |
| Latency | 95% of `GET /notes` requests answered in under 300 ms; 95% of writes in under 500 ms |
| Durability | A saved note is never lost: replicated storage plus daily backups with point-in-time recovery |
| Scalability | Can add servers to handle growth without redesigning the system |
| Security | HTTPS everywhere, hashed passwords, token authentication, per-user access checks, rate limiting |
| Consistency | A user sees their own change immediately; other views may lag by a few seconds |
| Maintainability | Stateless servers and automated deploys so updates cause no downtime |

## 2. Load estimate for 1 million users

### Assumptions

| Item | Value |
|------|-------|
| Registered users | 1,000,000 |
| Daily active users (DAU) | 30% = **300,000** |
| Read requests per active user per day | 20 (opening the app, listing and opening notes) |
| Write requests per active user per day | 3 (2 new notes, 1 edit or delete) |
| Average stored size of a note | 2 KB (title, body, tags, row and index overhead) |
| Seconds per day | 86,400 |
| Peak traffic | 5x the average |
| Cache hit rate | 80% of reads |

### Results

| Measure | Calculation | Result |
|---------|-------------|--------|
| Reads per day | 300,000 x 20 | 6,000,000 |
| **Reads per second (average)** | 6,000,000 / 86,400 | **about 69/s** |
| **Reads per second (peak)** | 69 x 5 | **about 350/s** |
| Writes per day | 300,000 x 3 | 900,000 |
| **Writes per second (average)** | 900,000 / 86,400 | **about 10/s** |
| **Writes per second (peak)** | 10.4 x 5 | **about 52/s** |
| New notes per year | 300,000 x 2 x 365 | about 219 million |
| **Storage per year** | 219,000,000 x 2 KB | **about 440 GB** (0.44 TB) |

- **Read-heavy:** reads outnumber writes by roughly 7 to 1, so the design focuses on caching and read replicas.
- With an 80% cache hit rate, only about 20% of peak reads reach the database: roughly **70 reads per second** on the read replica and about 52 writes per second on the primary. This is small enough for one well-sized database pair, which is why we do not start with sharding.
- Disk planning: 440 GB of data per year, multiplied by about 1.5 for indexes, is about 660 GB per year on the primary, and the read replica holds a full copy too. Starting with 2 TB disks gives several years of headroom.

## 3. Architecture diagram

```
                            +-----------------------+
                            |         CLIENT        |
                            |   (browser / mobile)  |
                            +-----------------------+
                                        |
                                        v
                            +-----------------------+
                            |          DNS          |
                            |       www -> CDN      |
                            |  api -> Load Balancer |
                            +-----------------------+
                      +-----------------+-----------------+
  static files        |                                   |   API calls (/v1/notes ...)
  (HTML, CSS, JS)     v                                   v
          +-----------------------+           +-----------------------+
          |          CDN          |           |     LOAD BALANCER     |
          |      (edge cache)     |           | (HTTPS, health checks)|
          +-----------------------+           +-----------------------+
                                                          |
                                            +-------------+-------------+
                                            v                           v
                                  +-------------------+       +-------------------+
                                  |    APP SERVER 1   |       |    APP SERVER 2   |
                                  |    (stateless)    |       |    (stateless)    | ... N
                                  +-------------------+       +-------------------+
                                            |                           |
                                            +-------------+-------------+
                                                          |
   every app server uses all three services below:        |
                  +---------------------------------------+-----------------------+
                  v                                       v                       v
          +---------------+                     +-------------------+   +-------------------+
          |     CACHE     |                     |     PRIMARY DB    |   |       QUEUE       |
          |    (Redis)    |                     |    (all writes)   |   |     (durable)     |
          |   + replica   |                     +-------------------+   +-------------------+
          +---------------+                               |                       |
                                                          | replication           v
                                                          v             +-------------------+
                                               +---------------------+  |      WORKERS      |
                                               |     READ REPLICA    |  |    (2 or more)    |
                                               |   (reads that miss  |  +-------------------+
                                               |      the cache)     |            |
                                               +---------------------+            v
                                                                  Primary DB / email service

Write path:  App server --> Primary DB  (then queue a background job)
Read path:   App server --> Cache --(miss)--> Read Replica
```

## 4. Components: the problem each one solves

- **Client:** gives users a screen to read and write notes, and sends API requests with the login token.
- **DNS:** turns the human-friendly names (`www.quicknotes.example`, `api.quicknotes.example`) into the right addresses, and lets us move or add servers without users changing anything.
- **CDN:** serves the static files (HTML, CSS, JavaScript, images) from servers close to the user, which solves slow page loads and keeps that traffic off our app servers.
- **Load balancer:** spreads requests across several app servers and stops sending traffic to unhealthy ones, which solves overload and a single server being a point of failure.
- **App servers (two or more):** run the API code (validation, authentication, business rules) and, because they keep no state, can be added or removed freely, which solves the capacity limit of one machine.
- **Cache (Redis):** keeps recently read note lists in memory, which solves slow, repeated database reads and protects the database during peaks.
- **Primary database:** is the single source of truth that safely stores users, notes and tags and accepts every write, which solves reliable, consistent storage.
- **Read replica:** holds a live copy of the primary and answers read queries, which solves reads and writes competing for the same database and gives us a ready standby if the primary fails.
- **Queue:** holds background jobs until a worker is free, which solves slow work (sending emails, updating the search index, cleaning up) delaying the user's request and absorbs sudden bursts.
- **Workers (two or more):** take jobs from the queue and run them, retrying on failure, which solves long-running tasks blocking the app servers.

## 5. Request flows

### `GET /notes`: list my notes

1. The client calls `https://api.quicknotes.example/v1/notes?page=1&limit=20` with its token.
2. **DNS** resolves `api.quicknotes.example` to the **load balancer**.
3. The load balancer terminates HTTPS and forwards the request to a healthy **app server**.
4. The app server checks the token; if it is missing or invalid it returns **401**.
5. It builds the cache key, for example `notes:user:42:page:1:limit:20`, and asks the **cache**.
6. **Cache hit** (about 80% of requests): the app server returns the stored JSON immediately with **200 OK**.
7. **Cache miss:** the app server runs the query on the **read replica** (`WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20`, using the index).
8. The app server stores the result in the cache with a short expiry (for example 60 seconds).
9. It returns **200 OK** with the notes and pagination `meta`.
10. If the database cannot be reached the app server returns **503** (or **500** for an unexpected fault) with the standard error body.

### `POST /notes`: create a note

1. The client sends `POST /v1/notes` with a JSON body and its token.
2. DNS and the **load balancer** route it to an **app server**.
3. The app server authenticates the token (**401** if invalid) and validates the body: title required and at most 100 characters, otherwise **400** with details.
4. It starts a transaction on the **primary database**, inserts the note, creates any new tags and fills `note_tags`, then commits.
5. It **deletes this user's cached list pages** (for example every `notes:user:42:*` key) so the next read is fresh.
6. It puts a job such as `index_note` on the **queue** (update the search index, and so on) and does not wait for it.
7. It returns **201 Created** with the new note and a `Location` header.
8. A **worker** takes the job from the queue, does the background work and retries if it fails; after repeated failures the job moves to a dead-letter queue for investigation.
9. The primary **replicates** the new note to the **read replica** within milliseconds, so later reads see it.

## 6. Trade-offs

1. **Cache speed vs fresh data.** Caching makes the most common request very fast and takes about 80% of the load off the database, but cached pages can be out of date. We reduce this by deleting a user's cached pages on every write and keeping the expiry short (60 seconds). The cost is extra complexity (cache invalidation) and one more component to run. We accept stale data for a few seconds because a notes list is not safety-critical.

2. **Read replica lag (eventual consistency).** The replica copies changes from the primary with a small delay, so a user could create a note and see an old list for a moment. We accept this for most reads, and for the first read after a write we can read from the primary instead. In return, reads scale by adding replicas and the primary is protected.

3. **Asynchronous queue vs doing everything in the request.** Moving search indexing and emails to a queue keeps the API fast and survives spikes, but those results appear a little later and we must monitor the queue, retries and dead-letter jobs.

4. **SQL with one primary vs a distributed NoSQL database.** One primary is simple and gives strong consistency and transactions, but all writes go through one machine, so there is a ceiling. At our estimate (about 52 writes per second at peak) the ceiling is far away. If we outgrow it, we can partition (shard) users across several databases.

5. **Cost vs availability.** Two or more app servers, a replica, a cache replica and extra workers cost more than a minimal setup, but they remove single points of failure and meet the 99.9% target.

## 7. Avoiding single points of failure

| Component | Single point of failure risk | How we avoid it |
|-----------|------------------------------|-----------------|
| DNS | The DNS provider goes down | Use a managed DNS service with several name servers (or two providers) |
| CDN | One edge location fails | The CDN has many edge locations; if one fails, traffic goes to another |
| Load balancer | The balancer is the only entry point | Use a managed or paired load balancer across at least two availability zones with automatic failover |
| App servers | One server crashes | Run at least two, in different availability zones, with health checks; the load balancer stops sending traffic to a failed one, and auto-scaling replaces it |
| Cache | The cache node dies | Run Redis with a replica and automatic failover; the app also works without the cache by reading from the replica, just more slowly |
| Primary database | The primary dies, losing writes | The read replica is promoted automatically (failover); daily backups and point-in-time recovery protect against data loss |
| Read replica | The replica dies | Add a second replica; the app server falls back to the primary for reads until a replica is back |
| Queue | The queue loses jobs | Use a durable, replicated queue; jobs are removed only after a worker confirms success, with retries and a dead-letter queue |
| Workers | One worker dies | Run at least two workers; an unfinished job returns to the queue and another worker takes it |
| Whole data centre | An availability zone fails | Spread app servers, the database pair and workers across at least two availability zones |

We also monitor everything (error rates, latency, queue length, replica lag) and alert the team before users notice a problem.
