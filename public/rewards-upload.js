// Rewards portal uploader. Files go straight from the browser to Google Drive using
// resumable uploads (the app only creates the upload session), in 8 MB chunks, so a dropped
// connection resumes where it left off instead of starting over.
(function () {
  var root = document.getElementById("rw-upload");
  if (!root) return;
  var cfg = JSON.parse(root.getAttribute("data-config"));
  var list = document.getElementById("rw-list");
  var input = document.getElementById("rw-files");
  var agree = document.getElementById("rw-agree");
  var submitBtn = document.getElementById("rw-submit");
  var errorBox = document.getElementById("rw-error");
  var CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KB
  var submissionId = null;
  var files = []; // { id, name, size, status: queued|uploading|done|failed, el }
  var queue = Promise.resolve();

  function showError(message) {
    errorBox.textContent = message || "";
    errorBox.style.display = message ? "block" : "none";
  }

  function api(action, payload) {
    var body = Object.assign({ action: action, submissionId: submissionId }, payload || {});
    return fetch(cfg.api, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, message: "Network error — please try again." };
        });
      })
      .then(function (json) {
        if (!json.ok) throw new Error(json.message || "Something went wrong.");
        return json;
      });
  }

  function sizeLabel(bytes) {
    return bytes > 1024 * 1024 * 1024
      ? (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB"
      : Math.max(1, Math.round(bytes / 1024 / 1024)) + " MB";
  }

  function refresh() {
    var done = files.filter(function (f) { return f.status === "done"; }).length;
    var busy = files.some(function (f) { return f.status === "queued" || f.status === "uploading"; });
    submitBtn.disabled = !(done > 0 && !busy && agree.checked);
    submitBtn.textContent = busy ? "Waiting for uploads to finish…" : "Submit for review";
  }

  function render(f) {
    if (!f.el) {
      f.el = document.createElement("li");
      list.appendChild(f.el);
    }
    var label =
      f.status === "done" ? "Uploaded"
      : f.status === "failed" ? "Failed — " + (f.error || "try again")
      : f.status === "queued" ? "Waiting…"
      : "Uploading " + Math.floor(f.progress || 0) + "%";
    f.el.innerHTML = "";
    var line = document.createElement("div");
    line.textContent = f.name + " · " + sizeLabel(f.size) + " · " + label + " ";
    if (f.status === "done" || f.status === "failed") {
      var remove = document.createElement("a");
      remove.href = "#";
      remove.textContent = "Remove";
      remove.onclick = function (e) {
        e.preventDefault();
        removeFile(f);
      };
      line.appendChild(remove);
    }
    f.el.appendChild(line);
    if (f.status === "uploading" || f.status === "queued") {
      var bar = document.createElement("div");
      bar.className = "bar";
      bar.innerHTML = "<span style='width:" + (f.progress || 0) + "%'></span>";
      f.el.appendChild(bar);
    }
    refresh();
  }

  function removeFile(f) {
    var done = function () {
      files = files.filter(function (x) { return x !== f; });
      if (f.el) f.el.remove();
      refresh();
    };
    if (!f.id) return done();
    api("remove-file", { fileId: f.id }).then(done, function (e) { showError(e.message); });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // One PUT to the Drive session. Resolves with the XHR (status 308 = more to send).
  function put(url, blob, start, total, onProgress) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      if (blob) {
        xhr.setRequestHeader("Content-Range", "bytes " + start + "-" + (start + blob.size - 1) + "/" + total);
        xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(start + e.loaded); };
      } else {
        xhr.setRequestHeader("Content-Range", "bytes */" + total); // "how much do you have?"
      }
      xhr.onload = function () { resolve(xhr); };
      xhr.onerror = xhr.ontimeout = function () { resolve(xhr); }; // status 0
      xhr.send(blob || null);
    });
  }

  function nextOffset(xhr, fallback) {
    var range = xhr.getResponseHeader("Range"); // "bytes=0-1234"
    return range ? parseInt(range.split("-")[1], 10) + 1 : fallback;
  }

  function uploadBytes(file, url, onProgress) {
    var offset = 0;
    var failures = 0;
    function step() {
      if (offset >= file.size && file.size > 0) return Promise.reject(new Error("Upload didn't finish."));
      var end = Math.min(offset + CHUNK, file.size);
      return put(url, file.slice(offset, end), offset, file.size, onProgress).then(function (xhr) {
        if (xhr.status === 200 || xhr.status === 201) return JSON.parse(xhr.responseText).id;
        if (xhr.status === 308) {
          failures = 0;
          offset = nextOffset(xhr, end);
          return step();
        }
        if (xhr.status === 0 || xhr.status >= 500) {
          if (++failures > 6) throw new Error("Connection lost — please try again.");
          // Back off, then ask Drive how much it already has and carry on from there.
          return sleep(Math.min(30000, 1000 * Math.pow(2, failures))).then(function () {
            return put(url, null, 0, file.size).then(function (status) {
              if (status.status === 200 || status.status === 201) return JSON.parse(status.responseText).id;
              if (status.status === 308) offset = nextOffset(status, 0);
              return step();
            });
          });
        }
        throw new Error("Upload rejected (" + xhr.status + ").");
      });
    }
    return step();
  }

  function upload(f) {
    f.status = "uploading";
    f.progress = 0;
    render(f);
    return api("upload-url", {
      name: f.file.name,
      size: f.file.size,
      mimeType: f.file.type,
      origin: window.location.origin,
    })
      .then(function (res) {
        f.id = res.fileId;
        return uploadBytes(f.file, res.uploadUrl, function (sent) {
          f.progress = (sent / f.file.size) * 100;
          render(f);
        });
      })
      .then(function (driveFileId) {
        return api("upload-done", { fileId: f.id, driveFileId: driveFileId });
      })
      .then(
        function () {
          f.status = "done";
          f.file = null;
          render(f);
        },
        function (e) {
          f.status = "failed";
          f.error = e.message;
          render(f);
        },
      );
  }

  input.addEventListener("change", function () {
    showError("");
    Array.prototype.forEach.call(input.files, function (file) {
      var f = { name: file.name, size: file.size, file: file, status: "queued", progress: 0 };
      files.push(f);
      render(f);
      queue = queue.then(function () { return upload(f); }); // one at a time
    });
    input.value = "";
  });

  agree.addEventListener("change", refresh);

  submitBtn.addEventListener("click", function (e) {
    e.preventDefault();
    showError("");
    submitBtn.disabled = true;
    api("submit", { note: document.getElementById("rw-note").value, agreed: agree.checked }).then(
      function () {
        window.location.href = cfg.portal + "?submitted=1";
      },
      function (err) {
        showError(err.message);
        refresh();
      },
    );
  });

  window.addEventListener("beforeunload", function (e) {
    if (files.some(function (f) { return f.status === "uploading" || f.status === "queued"; })) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Create (or reopen) the submission, then show files already uploaded to it.
  input.disabled = true;
  api("start", { orderId: cfg.orderId, typeId: cfg.typeId }).then(
    function (res) {
      submissionId = res.submissionId;
      res.files.forEach(function (existing) {
        var f = { id: existing.id, name: existing.name, size: existing.size, status: "done", progress: 100 };
        files.push(f);
        render(f);
      });
      input.disabled = false;
      refresh();
    },
    function (e) {
      showError(e.message);
    },
  );
})();
