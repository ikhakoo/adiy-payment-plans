// A-DIY Hub, loaded on every hub page. Buttons marked data-hub-chat ("Chat now", "Message us")
// open the Gorgias chat widget when the theme has it, and otherwise follow their link to Help & Support.
(function () {
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-hub-chat]");
    if (!el) return;
    var chat = window.GorgiasChat;
    if (chat && typeof chat.open === "function") {
      e.preventDefault();
      chat.open();
    }
  });
})();

// Order switcher (orders.server.ts orderSwitcher): upgrades the native <select> to an app-styled
// listbox. The select stays in the form (visually hidden) and is what gets submitted, so without
// JS, or if anything here fails, the plain select keeps working.
(function () {
  var CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var uid = 0;

  function text(tag, cls, value) {
    var el = document.createElement(tag);
    el.className = cls;
    el.textContent = value;
    return el;
  }

  function enhance(form) {
    var select = form.querySelector("select");
    var field = form.querySelector(".sw-field");
    var label = form.querySelector(".sw-label");
    if (!select || !field || form.getAttribute("data-sw-on")) return;
    form.setAttribute("data-sw-on", "1");
    var id = "sw-" + ++uid;
    var opts = Array.prototype.slice.call(select.options);
    var info = function (o) {
      return {
        title: o.getAttribute("data-title") || o.textContent,
        sub: o.getAttribute("data-sub") || "",
        meta: o.getAttribute("data-meta") || "",
      };
    };

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sw-btn";
    btn.id = id + "-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id + "-list");
    if (label) {
      if (!label.id) label.id = id + "-label";
      btn.setAttribute("aria-labelledby", label.id + " " + btn.id);
      label.setAttribute("for", btn.id);
    }
    var current = info(select.options[select.selectedIndex] || opts[0]);
    var btnText = document.createElement("span");
    btnText.className = "sw-btn-text";
    btnText.appendChild(text("b", "sw-btn-title", current.title));
    if (current.sub) btnText.appendChild(text("small", "sw-btn-sub", current.sub));
    btn.appendChild(btnText);
    var chev = field.querySelector(".sw-chev");
    if (chev) btn.appendChild(chev);

    var list = document.createElement("ul");
    list.className = "sw-list";
    list.id = id + "-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("tabindex", "-1");
    if (label) list.setAttribute("aria-labelledby", label.id);
    list.hidden = true;
    var items = opts.map(function (o, i) {
      var d = info(o);
      var li = document.createElement("li");
      li.id = id + "-opt-" + i;
      li.className = "sw-opt";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === select.selectedIndex ? "true" : "false");
      var main = document.createElement("span");
      main.className = "sw-opt-text";
      main.appendChild(text("b", "", d.title));
      if (d.sub) main.appendChild(text("small", "", d.sub));
      li.appendChild(main);
      if (d.meta) li.appendChild(text("span", "sw-opt-meta", d.meta));
      var tick = document.createElement("span");
      tick.className = "sw-opt-check";
      tick.innerHTML = CHECK;
      li.appendChild(tick);
      li.addEventListener("click", function () {
        choose(i);
      });
      li.addEventListener("mousemove", function () {
        setActive(i);
      });
      list.appendChild(li);
      return li;
    });

    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    field.appendChild(btn);
    field.appendChild(list);
    form.classList.add("sw-on");

    var active = select.selectedIndex;
    function setActive(i) {
      if (i < 0 || i >= items.length) return;
      items.forEach(function (li, j) {
        li.classList.toggle("is-active", j === i);
      });
      active = i;
      list.setAttribute("aria-activedescendant", items[i].id);
      var li = items[i];
      if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
    }
    function open() {
      list.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      form.classList.add("sw-open");
      setActive(select.selectedIndex);
      list.focus();
    }
    function close(focusBtn) {
      if (list.hidden) return;
      list.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      form.classList.remove("sw-open");
      if (focusBtn) btn.focus();
    }
    function choose(i) {
      close(true);
      if (i === select.selectedIndex) return;
      select.selectedIndex = i;
      items.forEach(function (li, j) {
        li.setAttribute("aria-selected", j === i ? "true" : "false");
      });
      btn.classList.add("is-loading");
      form.submit();
    }

    btn.addEventListener("click", function () {
      if (list.hidden) open();
      else close(true);
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        open();
      }
    });
    list.addEventListener("keydown", function (e) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActive(Math.min(items.length - 1, active + 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActive(Math.max(0, active - 1));
          break;
        case "Home":
          e.preventDefault();
          setActive(0);
          break;
        case "End":
          e.preventDefault();
          setActive(items.length - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          choose(active);
          break;
        case "Escape":
          e.preventDefault();
          close(true);
          break;
        case "Tab":
          close(false);
          break;
      }
    });
    document.addEventListener("click", function (e) {
      if (!form.contains(e.target)) close(false);
    });
  }

  function init() {
    var forms = document.querySelectorAll("form[data-sw]");
    for (var i = 0; i < forms.length; i++) {
      try {
        enhance(forms[i]);
      } catch (err) {
        // Leave the native select in place.
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
