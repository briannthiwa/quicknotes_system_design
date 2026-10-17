/*
 * QuickNotes API client
 *
 * A small front end that talks to the JSONPlaceholder practice API
 * (https://jsonplaceholder.typicode.com). It can load notes (GET),
 * create a note (POST) and delete a note (DELETE).
 *
 * Safety rules used throughout:
 *  - every request goes through request(), which checks response.ok
 *  - every request is wrapped in try / catch / finally
 *  - user text is only ever inserted with textContent, so it can never be
 *    interpreted as HTML
 */

const API_URL = "https://jsonplaceholder.typicode.com/posts";
const NOTES_LIMIT = 10;
const MAX_TITLE_LENGTH = 100;
const USER_ID = 1;

// ---------- DOM references ----------

const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");

// ---------- State ----------

let notes = []; // notes currently shown on the page
let nextKey = 1; // client-side keys (see the note about DELETE below)
let isBusy = false; // true while a request is running

// ---------- The reusable request function ----------

/**
 * Calls fetch, checks response.ok and throws on errors.
 * Resolves to { status, data } where data is the parsed JSON body
 * (or null when the body is empty).
 */
async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data };
}

// GET: load the first 10 notes
function getNotes() {
  return request(`${API_URL}?_limit=${NOTES_LIMIT}`);
}

// POST: create a note
function createNote(note) {
  return request(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note),
  });
}

// DELETE: remove a note by its server id
function deleteNote(id) {
  return request(`${API_URL}/${id}`, { method: "DELETE" });
}

// ---------- UI helpers ----------

// Shows a message in the status paragraph. type: "loading" | "success" | "error"
function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : "status";
}

// Disables the buttons while a request is running so it cannot be sent twice.
function setBusy(busy) {
  isBusy = busy;
  loadBtn.disabled = busy;
  submitBtn.disabled = busy;
  notesList.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.disabled = busy;
  });
}

// Turns a technical error into a message a person can understand.
function friendlyError(error, action) {
  if (error.status >= 500) {
    return `The server had a problem and could not ${action}. Please try again in a moment (status ${error.status}).`;
  }
  if (error.status === 404) {
    return `Could not ${action}: the server could not find it (status 404).`;
  }
  if (error.status) {
    return `Could not ${action} (status ${error.status}). Please try again.`;
  }
  if (error instanceof SyntaxError) {
    return `The server sent a reply we could not read, so we could not ${action}.`;
  }
  return `Could not ${action}. Check your internet connection and try again.`;
}

// Converts data from the server into the shape we keep on the page.
// "local" is true for notes created in this browser session.
function toNote(raw, local = false) {
  return {
    key: `note-${nextKey++}`,
    id: raw.id,
    title: String(raw.title ?? ""),
    body: String(raw.body ?? ""),
    local,
  };
}

// ---------- Rendering (textContent only) ----------

function createNoteItem(note) {
  const li = document.createElement("li");
  li.className = "note";
  li.dataset.key = note.key;

  const title = document.createElement("h3");
  title.textContent = note.title;
  li.appendChild(title);

  if (note.body) {
    const body = document.createElement("p");
    body.textContent = note.body;
    li.appendChild(body);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.setAttribute("aria-label", `Delete note: ${note.title}`);
  deleteBtn.dataset.key = note.key;
  deleteBtn.disabled = isBusy;
  li.appendChild(deleteBtn);

  return li;
}

function renderNotes() {
  notesList.textContent = ""; // removes the old items

  // Empty state
  if (notes.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No notes to show. Click Load notes or add a new note.";
    notesList.appendChild(li);
    return;
  }

  for (const note of notes) {
    notesList.appendChild(createNoteItem(note));
  }
}

// ---------- Task 1: load notes (GET) ----------

async function handleLoad() {
  setBusy(true);
  setStatus("Loading notes...", "loading");

  try {
    const { data } = await getNotes();
    if (!Array.isArray(data)) {
      throw new SyntaxError("Expected a list of notes");
    }

    notes = data.map((raw) => toNote(raw));
    renderNotes();

    if (notes.length === 0) {
      setStatus("The server has no notes to show.", "success");
    } else {
      const word = notes.length === 1 ? "note" : "notes";
      setStatus(`Loaded ${notes.length} ${word} from the server.`, "success");
    }
  } catch (error) {
    console.error("Load failed:", error);
    setStatus(friendlyError(error, "load notes"), "error");
  } finally {
    setBusy(false);
  }
}

// ---------- Task 2: create a note (POST) ----------

// Returns an error message, or "" when the title is fine.
function validateTitle(title) {
  if (title.length === 0) {
    return "Please enter a title for your note.";
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `The title is too long (${title.length} characters). The maximum is ${MAX_TITLE_LENGTH}.`;
  }
  return "";
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isBusy) return;

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim(); // the body is optional

  const problem = validateTitle(title);
  if (problem) {
    setStatus(problem, "error");
    titleInput.focus();
    return; // nothing is sent to the server
  }

  setBusy(true);
  setStatus("Saving note...", "loading");

  try {
    const { status, data } = await createNote({ title, body, userId: USER_ID });

    notes.unshift(toNote(data, true)); // newest note goes to the top
    renderNotes();

    noteForm.reset(); // clear the form afterwards
    setStatus(`Note created (status ${status}, id ${data.id}).`, "success");
  } catch (error) {
    console.error("Create failed:", error);
    setStatus(friendlyError(error, "save the note"), "error");
  } finally {
    setBusy(false);
  }
}

// ---------- Task 3: delete a note (DELETE) ----------

/*
 * IMPORTANT: JSONPlaceholder only pretends to change data.
 *  - POST returns 201 and a new id (always 101), but nothing is stored.
 *  - DELETE returns 200, but the note is not really removed, so loading
 *    the notes again brings every deleted note back.
 *
 * How this client copes:
 *  1. The list on the page is our working copy. When the server answers
 *     with a success status we update that copy, exactly as we would with a
 *     real backend.
 *  2. Every note on the page gets its own client-side "key". We cannot use
 *     the server id as the identity, because every created note comes back
 *     with id 101.
 *  3. A note created in this session was never stored on the server, so
 *     there is nothing to delete there. We remove it from the page only and
 *     do not send a DELETE request for the made-up id 101.
 *  4. Notes loaded from the server are deleted with DELETE /posts/{id}. If
 *     the request fails, the note stays in the list and an error is shown.
 */
async function handleDelete(key) {
  const note = notes.find((n) => n.key === key);
  if (!note || isBusy) return;

  if (note.local) {
    notes = notes.filter((n) => n.key !== key);
    renderNotes();
    setStatus(
      "Note removed from the page. It was only stored in your browser, so no request was sent.",
      "success"
    );
    return;
  }

  setBusy(true);
  setStatus("Deleting note...", "loading");

  try {
    const { status } = await deleteNote(note.id);

    notes = notes.filter((n) => n.key !== key);
    renderNotes();
    setStatus(`Note deleted (status ${status}, id ${note.id}).`, "success");
  } catch (error) {
    console.error("Delete failed:", error);
    setStatus(friendlyError(error, "delete the note"), "error");
  } finally {
    setBusy(false);
  }
}

// ---------- Wire everything up ----------

loadBtn.addEventListener("click", handleLoad);
noteForm.addEventListener("submit", handleSubmit);
// One listener on the list handles every Delete button (event delegation).
notesList.addEventListener("click", (event) => {
  const btn = event.target.closest(".delete-btn");
  if (btn) handleDelete(btn.dataset.key);
});

// First paint: empty state and a hint
renderNotes();
setStatus("Click Load notes to fetch notes from the server.", "");
