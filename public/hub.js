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
