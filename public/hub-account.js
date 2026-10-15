// Account & Addresses: inline edit forms and address actions. Each one posts JSON {intent, ...}
// to the page itself (proxy.account.tsx) and reloads on success.
(function () {
  var root = document.getElementById("hub-account");
  if (!root) return;
  var cfg = JSON.parse(root.getAttribute("data-config"));

  function block(el) {
    return el.closest(".acct-block");
  }
  function show(msg, text) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.hidden = !text;
  }

  function send(data, msg, buttons) {
    buttons.forEach(function (b) { b.disabled = true; });
    show(msg, "");
    return fetch(cfg.url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, message: "Network error. Please try again." };
        });
      }, function () {
        return { ok: false, message: "Network error. Please try again." };
      })
      .then(function (json) {
        if (json.ok) {
          window.location.href = cfg.url + "?updated=1";
          return;
        }
        buttons.forEach(function (b) { b.disabled = false; });
        show(msg, json.message || "Something went wrong.");
      });
  }

  root.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("button");
    if (!el || !root.contains(el)) return;
    var b = block(el);

    // Edit / Add: swap the read-only view for the form. data-edit="#id" opens another block's form
    // (e.g. "Add address" in the card header, "Edit" on the billing row).
    if (el.hasAttribute("data-edit")) {
      var target = el.getAttribute("data-edit");
      var tb = target ? root.querySelector(target) : b;
      if (!tb) return;
      e.preventDefault();
      var form = tb.querySelector(".acct-form");
      if (!form) return;
      var view = tb.querySelector(".acct-view");
      if (view) view.hidden = true;
      if (el.hasAttribute("data-hide-on-open")) {
        el.hidden = true;
        form._opener = el;
      }
      form.hidden = false;
      if (target && form.scrollIntoView) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
      var first = form.querySelector("input:not([disabled])");
      if (first) first.focus({ preventScroll: !!target });
      return;
    }
    if (el.hasAttribute("data-cancel") && b) {
      e.preventDefault();
      var f = b.querySelector(".acct-form");
      f.reset();
      f.hidden = true;
      show(f.querySelector(".acct-msg"), "");
      var v = b.querySelector(".acct-view");
      if (v) v.hidden = false;
      if (f._opener) {
        f._opener.hidden = false;
        f._opener.focus();
        f._opener = null;
      }
      return;
    }

    // Remove / Make default on a saved address.
    var intent = el.getAttribute("data-intent");
    if (intent && b) {
      e.preventDefault();
      if (intent === "address-delete" && !window.confirm("Remove this address?")) return;
      send({ intent: intent, id: el.getAttribute("data-id") }, b.querySelector(".acct-view .acct-msg"), [el]);
    }
  });

  root.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.classList.contains("acct-form")) return;
    e.preventDefault();
    var data = { intent: form.getAttribute("data-intent") };
    if (form.getAttribute("data-id")) data.id = form.getAttribute("data-id");
    var fields = form.querySelectorAll("input[name], select[name]");
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      data[f.name] = f.type === "checkbox" ? f.checked : f.value;
    }
    var missing = null;
    var req = form.querySelectorAll("[required]");
    for (var j = 0; j < req.length && !missing; j++) {
      if (!req[j].value.trim()) missing = req[j];
    }
    if (missing) {
      missing.focus();
      return show(form.querySelector(".acct-msg"), "Please fill in the required fields.");
    }
    send(data, form.querySelector(".acct-msg"), [form.querySelector("button[type=submit]")]);
  });
})();
