// Help & Support: the new-request form. Photos are downscaled in the browser (max 1600px JPEG) so
// requests stay small through the app proxy, then sent as base64 in one JSON POST.
(function () {
  var form = document.getElementById("sp-form");
  if (!form) return;
  var cfg = JSON.parse(form.getAttribute("data-config"));
  var msg = document.getElementById("sp-msg");
  var btn = document.getElementById("sp-submit");
  var input = document.getElementById("sp-photos");
  var thumbs = document.getElementById("sp-thumbs");
  var order = document.getElementById("sp-order");
  var hint = document.getElementById("sp-order-hint");
  var MAX_SIDE = 1600;
  var photos = []; // { name, data (base64, no prefix), size, url }

  function show(text, ok) {
    msg.textContent = text;
    msg.className = ok ? "notice" : "notice warn";
    msg.style.display = text ? "block" : "none";
  }

  function topic() {
    var el = form.querySelector('input[name="topic"]:checked');
    return el ? el.value : "";
  }

  function syncHint() {
    if (hint) hint.textContent = topic() && !cfg.needsOrder[topic()] ? "Optional" : "";
  }
  form.addEventListener("change", function (e) {
    if (e.target && e.target.name === "topic") syncHint();
  });
  syncHint();

  if (cfg.focus) {
    var target = document.getElementById("new-request");
    if (target) setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
  }

  // Decodes an image file and re-encodes it as JPEG no larger than MAX_SIDE on its longest side.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var c = canvas.getContext("2d");
        c.fillStyle = "#fff"; // transparent PNGs would otherwise turn black
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        var dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        var data = dataUrl.slice(dataUrl.indexOf(",") + 1);
        resolve({ name: file.name, data: data, size: Math.floor((data.length * 3) / 4), url: dataUrl });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      img.src = url;
    });
  }

  function total() {
    return photos.reduce(function (sum, p) { return sum + p.size; }, 0);
  }

  function render() {
    thumbs.innerHTML = "";
    photos.forEach(function (p, i) {
      var li = document.createElement("li");
      var img = document.createElement("img");
      img.src = p.url;
      img.alt = "";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove photo");
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        photos.splice(i, 1);
        render();
      });
      li.appendChild(img);
      li.appendChild(rm);
      thumbs.appendChild(li);
    });
  }

  if (input) {
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = "";
      var room = cfg.maxPhotos - photos.length;
      if (files.length > room) show("You can add up to " + cfg.maxPhotos + " photos.");
      else show("");
      files = files.slice(0, Math.max(0, room));
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain.then(function () {
          return shrink(file).then(
            function (p) {
              if (p.size > cfg.maxPhoto || total() + p.size > cfg.maxTotal) return show("That photo is too large to add.");
              photos.push(p);
              render();
            },
            function () { show("We couldn't read " + file.name + ". Please choose a JPEG or PNG photo."); },
          );
        });
      });
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var t = topic();
    var orderId = order ? order.value : "";
    var message = document.getElementById("sp-message").value.trim();
    if (!t) return show("Please choose a topic.");
    if (cfg.needsOrder[t] && !orderId) return show("Please select your order.");
    if (message.length < cfg.minMessage) return show("Please tell us a little more about how we can help.");

    btn.disabled = true;
    show("Sending your request…", true);
    fetch(cfg.action, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: t,
        orderId: orderId,
        message: message,
        origin: window.location.origin,
        photos: photos.map(function (p) { return { name: p.name, data: p.data }; }),
      }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, message: "Network error — please try again." };
        });
      }, function () {
        return { ok: false, message: "Network error — please try again." };
      })
      .then(function (json) {
        if (!json.ok) {
          btn.disabled = false;
          return show(json.message || "Something went wrong.");
        }
        show(json.message || "Thanks! Your request is in.", true);
        form.reset();
        photos = [];
        render();
        setTimeout(function () {
          window.location.replace(window.location.pathname); // drops ?topic= so it doesn't scroll again
        }, 2500);
      });
  });
})();
