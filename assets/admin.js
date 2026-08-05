const postForm = document.getElementById("post-form");
const formStatus = document.getElementById("form-status");
const postList = document.getElementById("post-list");

function formatDate(value) {
  const date = new Date(`${value}Z`);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function renderPosts(posts) {
  postList.replaceChildren();

  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No field notes published.";
    postList.append(empty);
    return;
  }

  posts.forEach((post) => {
    const row = document.createElement("article");
    row.className = "post-row";

    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = post.title;
    const meta = document.createElement("span");
    meta.className = "post-meta";
    meta.textContent = `${post.category} / ${formatDate(post.created_at)} / ID ${post.id}`;
    details.append(title, meta);

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${post.title}`);
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`Delete “${post.title}”? This cannot be undone.`)) return;

      deleteButton.disabled = true;
      deleteButton.textContent = "Deleting…";
      try {
        const response = await fetch(`/api/posts/${post.id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error);
        }
        await loadPosts();
        formStatus.textContent = `Deleted “${post.title}”.`;
      } catch (error) {
        formStatus.textContent = error.message || "Could not delete the note.";
        deleteButton.disabled = false;
        deleteButton.textContent = "Delete";
      }
    });

    row.append(details, deleteButton);
    postList.append(row);
  });
}

async function loadPosts() {
  try {
    const response = await fetch("/api/posts", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load field notes.");
    renderPosts(await response.json());
  } catch (error) {
    postList.replaceChildren();
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = error.message || "Could not load field notes.";
    postList.append(message);
  }
}

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = postForm.querySelector('button[type="submit"]');
  const formData = new FormData(postForm);

  button.disabled = true;
  formStatus.textContent = "Publishing…";

  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        category: formData.get("category"),
        content: formData.get("content"),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    postForm.reset();
    formStatus.textContent = `Published “${result.title}”.`;
    await loadPosts();
  } catch (error) {
    formStatus.textContent = error.message || "Could not publish the note.";
  } finally {
    button.disabled = false;
  }
});

loadPosts();
