// Rewards portal home: the cash-out form.
(function () {
  var root = document.getElementById("rw-cashout");
  var btn = document.getElementById("rw-cashout-btn");
  if (!root || !btn) return;
  var cfg = JSON.parse(root.getAttribute("data-config"));
  var msg = document.getElementById("rw-cashout-msg");

  function show(text) {
    msg.textContent = text;
    msg.style.display = text ? "block" : "none";
  }

  btn.addEventListener("click", function (e) {
    e.preventDefault();
    var amount = Number(document.getElementById("rw-amount").value);
    var email = document.getElementById("rw-email").value.trim();
    if (!(amount >= cfg.min)) return show("The minimum cash-out is $" + cfg.min + ".");
    if (amount > cfg.max) return show("You can cash out up to $" + cfg.max.toFixed(2) + ".");
    if (!window.confirm("Send a $" + amount + " Amazon gift card to " + email + "?")) return;
    btn.disabled = true;
    show("");
    fetch(cfg.api, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cashout", amount: amount, email: email }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, message: "Network error — please try again." };
        });
      })
      .then(function (json) {
        if (!json.ok) {
          btn.disabled = false;
          return show(json.message || "Something went wrong.");
        }
        window.location.href = cfg.portal + "?cashout=1";
      });
  });
})();
