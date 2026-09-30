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

// Referral card (portal home): copy / share the customer's link.
(function () {
  var copy = document.getElementById("rw-ref-copy");
  var share = document.getElementById("rw-ref-share");
  var link = document.getElementById("rw-ref-link");
  if (!link) return;
  if (copy) {
    copy.addEventListener("click", function (e) {
      e.preventDefault();
      (navigator.clipboard ? navigator.clipboard.writeText(link.value) : Promise.reject()).then(
        function () { copy.textContent = "Copied!"; },
        function () { link.select(); document.execCommand("copy"); copy.textContent = "Copied!"; },
      );
      setTimeout(function () { copy.textContent = "Copy link"; }, 2000);
    });
  }
  if (share) {
    if (!navigator.share) share.style.display = "none";
    share.addEventListener("click", function (e) {
      e.preventDefault();
      navigator.share({ title: "$300 off an A-DIY deck", text: share.getAttribute("data-text"), url: link.value });
    });
  }
})();

// Referral landing page: a friend claims their one-time code, then goes shopping with it applied.
(function () {
  var root = document.getElementById("rw-referral");
  var btn = document.getElementById("rw-claim");
  if (!root || !btn) return;
  var cfg = JSON.parse(root.getAttribute("data-config"));
  var msg = document.getElementById("rw-claim-msg");
  btn.addEventListener("click", function (e) {
    e.preventDefault();
    var email = document.getElementById("rw-friend-email").value.trim();
    btn.disabled = true;
    msg.style.display = "none";
    fetch(cfg.api, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim-referral", code: cfg.code, email: email }),
    })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, message: "Network error — please try again." }; });
      })
      .then(function (json) {
        if (!json.ok) {
          btn.disabled = false;
          msg.textContent = json.message || "Something went wrong.";
          msg.style.display = "block";
          return;
        }
        msg.innerHTML = "";
        var text = document.createElement("span");
        text.textContent = "Your code " + json.code + " is ready — taking you to the store with it applied. Use " + email + " at checkout.";
        msg.appendChild(text);
        msg.style.display = "block";
        setTimeout(function () {
          window.location.href = "/discount/" + encodeURIComponent(json.code) + "?redirect=%2F";
        }, 2500);
      });
  });
})();
