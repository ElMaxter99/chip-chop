// Demo app: hash routing, API calls with fetch, a confirmation modal.
var view = document.getElementById("view");
var modalRoot = document.getElementById("modal-root");
document.getElementById("clock").textContent = new Date().toLocaleTimeString();

function api(path, options) {
  return fetch(path, options).then(function (r) { return r.json(); });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function openDeleteModal(entry) {
  modalRoot.innerHTML =
    '<div class="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Delete password">' +
    "<h2>Delete password</h2>" +
    "<p>Delete <b>" + esc(entry.title) + "</b>? This cannot be undone.</p>" +
    '<div class="actions"><button id="cancel">Cancel</button><button id="confirm" class="danger">Confirm</button></div>' +
    "</div></div>";
  document.getElementById("cancel").onclick = closeModal;
  document.getElementById("confirm").onclick = closeModal;
}

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeModal();
});

var routes = {
  "/login": function () {
    view.innerHTML =
      "<h2>Sign in</h2>" +
      '<form id="login"><label>User <input name="user" aria-label="User"></label>' +
      '<label>Password <input name="pass" type="password" aria-label="Password"></label>' +
      '<button type="submit">Sign in</button></form>';
  },
  "/home": function () {
    view.innerHTML = "<h2>Home</h2><p>Loading…</p>";
    api("/api/summary").then(function (s) {
      view.innerHTML =
        "<h2>Home</h2>" +
        '<ul class="stats"><li>Total: <b>' + s.total + "</b></li><li>Active: <b>" + s.active + "</b></li><li>Weak: <b>" + s.weak + "</b></li></ul>";
    });
  },
  "/passwords": function () {
    view.innerHTML = "<h2>Passwords</h2><p>Loading…</p>";
    api("/api/passwords").then(function (list) {
      if (!list.length) {
        view.innerHTML = "<h2>Passwords</h2><p class=\"empty\">No passwords yet.</p>";
        return;
      }
      var rows = list.map(function (p) {
        return "<tr><td>" + esc(p.title) + "</td><td>" + esc(p.username) + "</td><td>" + (p.isActive ? "Active" : "Inactive") +
          '</td><td><button data-id="' + p.id + '">Delete</button></td></tr>';
      }).join("");
      view.innerHTML =
        "<h2>Passwords</h2><table><thead><tr><th>Title</th><th>User</th><th>Status</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
      view.querySelectorAll("button[data-id]").forEach(function (b) {
        b.onclick = function () {
          var id = Number(b.getAttribute("data-id"));
          openDeleteModal(list.filter(function (p) { return p.id === id; })[0]);
        };
      });
    });
  }
};

function render() {
  closeModal();
  var path = (location.hash || "").replace(/^#!?/, "") || "/home";
  (routes[path] || routes["/home"])();
}

window.addEventListener("hashchange", render);
render();
