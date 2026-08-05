document.getElementById("year").textContent = new Date().getFullYear();

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14 },
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

const postList = document.getElementById("blog-posts");

function renderPosts(posts) {
  postList.replaceChildren();

  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "blog-empty";
    empty.textContent = "No field notes yet.";
    postList.append(empty);
    return;
  }

  posts.forEach((post, index) => {
    const details = document.createElement("details");
    details.className = "post";

    const summary = document.createElement("summary");
    summary.className = "post-summary";

    const number = document.createElement("span");
    number.className = "post-number";
    number.textContent = `Note ${String(posts.length - index).padStart(3, "0")}`;

    const title = document.createElement("h3");
    title.textContent = post.title;

    const wordCount = post.content.trim().split(/\s+/).length;
    const meta = document.createElement("span");
    meta.className = "post-meta";
    meta.textContent = `${post.category} / ${Math.max(1, Math.ceil(wordCount / 200))} min read`;

    const action = document.createElement("span");
    action.className = "post-action";
    action.textContent = "Read note";

    const body = document.createElement("div");
    body.className = "post-body";
    post.content.split(/\n\s*\n/).forEach((paragraphText) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = paragraphText;
      body.append(paragraph);
    });

    summary.append(number, title, meta, action);
    details.append(summary, body);
    postList.append(details);
  });
}

async function loadPosts() {
  try {
    const response = await fetch("/api/posts");
    if (!response.ok) throw new Error("Could not load field notes.");
    renderPosts(await response.json());
  } catch (error) {
    postList.innerHTML = '<p class="blog-empty">Field notes are unavailable right now.</p>';
  }
}

loadPosts();
