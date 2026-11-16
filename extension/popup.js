// AI-generated — to be rewritten by me
// Popup UI. Sends the query to background.js and lists the results.
// TODO: show the autocomplete list (suggest) while typing.
// TODO: when a result is clicked, call route() from the current page, then ask
//       content.js to highlight the next menu item.

const input = document.getElementById("query");
const list = document.getElementById("results");

input.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter" || !input.value.trim()) return;
  const res = await chrome.runtime.sendMessage({ type: "search", query: input.value, k: 5 });
  list.innerHTML = "";
  if (!res.ok) {
    list.textContent = res.error;
    return;
  }
  for (const item of res.data) {
    const li = document.createElement("li");
    li.textContent = `${item.name_en} — ${item.name_ko}`;
    list.appendChild(li);
  }
});
