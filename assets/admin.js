const postForm = document.getElementById("post-form");
const formStatus = document.getElementById("form-status");
const postList = document.getElementById("post-list");
const visitorMetrics = document.getElementById("visitor-metrics");
const resumeForm = document.getElementById("resume-form");
const resumeFile = document.getElementById("resume-file");
const resumeFileName = document.getElementById("resume-file-name");
const resumeMeta = document.getElementById("resume-meta");
const resumeStatus = document.getElementById("resume-status");

function formatDate(value) {
  const date = new Date(`${value}Z`);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function formatFileSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderResumeDetails(resume) {
  const updated = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(resume.updated_at));
  resumeMeta.textContent = `Updated ${updated} / ${formatFileSize(resume.size)}`;
}

async function loadResumeDetails() {
  try {
    const response = await fetch("/api/resume", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load résumé details.");
    renderResumeDetails(await response.json());
  } catch (error) {
    resumeMeta.textContent = error.message || "Could not load résumé details.";
  }
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

async function loadVisitorMetrics() {
  try {
    const response = await fetch("/api/metrics/visitors", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load visitor metrics.");
    const metrics = await response.json();
    const cards = [
      ["Today", metrics.unique_today],
      ["Last 7 days", metrics.unique_last_7_days],
      ["All-time unique", metrics.unique_visitors],
      ["Total visits", metrics.total_visits],
      ["Unique résumé clicks", metrics.unique_resume_clickers],
      ["Total résumé clicks", metrics.total_resume_clicks],
    ];

    visitorMetrics.replaceChildren(...cards.map(([label, value]) => {
      const card = document.createElement("div");
      card.className = "metric-card";
      const count = document.createElement("strong");
      count.textContent = Number(value).toLocaleString("en-US");
      const description = document.createElement("span");
      description.textContent = label;
      card.append(count, description);
      return card;
    }));
  } catch (error) {
    visitorMetrics.replaceChildren();
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = error.message || "Could not load visitor metrics.";
    visitorMetrics.append(message);
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

resumeFile.addEventListener("change", () => {
  const file = resumeFile.files[0];
  resumeFileName.textContent = file ? file.name : "Drop in a new version";
});

resumeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = resumeForm.querySelector('button[type="submit"]');
  const file = resumeFile.files[0];
  if (!file) return;

  button.disabled = true;
  resumeStatus.textContent = "Uploading…";

  try {
    const response = await fetch("/api/resume", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    renderResumeDetails(result);
    resumeForm.reset();
    resumeFileName.textContent = "Drop in a new version";
    resumeStatus.textContent = "Résumé updated. The public link now serves this version.";
  } catch (error) {
    resumeStatus.textContent = error.message || "Could not upload the résumé.";
  } finally {
    button.disabled = false;
  }
});

loadPosts();
loadVisitorMetrics();
loadResumeDetails();
