/* Hero demo: pick a business and watch the conversation play. The page is complete without this
   file: the first conversation is in the HTML, so no-JS readers and crawlers still see it. */
(function () {
  var CHATS = {
    en: {
      salon: { name: "Glow Salon", status: "online", at: "21:14", lines: [
        [1, "can I get a haircut tomorrow afternoon?"],
        [0, "Sure! Sara is free tomorrow at 14:00, 15:30 or 16:00. Which works for you?"],
        [1, "3:30"],
        [0, "Holding it for you: haircut with Sara, tomorrow at 15:30, AED 80. Shall I book it?"],
        [1, "yes"],
        [0, "Done, booking number 12. We'll remind you before your visit 😊"],
      ] },
      sports: { name: "Marina Padel", status: "online", at: "23:48", lines: [
        [1, "any padel court free tomorrow at 8 for 90 min?"],
        [0, "Court 2 is free at 20:00 for 90 minutes, AED 280. Book it?"],
        [1, "yes please"],
        [0, "You're booked: Padel 90 min on Court 2, tomorrow at 20:00. Booking number 31.\n📍 Marina Walk, Dubai"],
      ] },
      resort: { name: "Palm Bay Resort", status: "online", at: "10:02", lines: [
        [1, "room for 2 adults, 14 to 16 December?"],
        [0, "For those 2 nights we have a Garden Room at AED 900 a night, or a Sea View Room at AED 1,250."],
        [1, "sea view"],
        [0, "Holding the Sea View Room, 14 to 16 Dec, total AED 2,500. What name should I put it under?"],
      ] },
      restaurant: { name: "Bella Pasta", status: "online", at: "19:31", lines: [
        [1, "hi, can I order for pickup?"],
        [0, "Of course! Here's our menu. Pick a category: Pizza, Pasta or Desserts."],
        [1, "Pizza"],
        [0, "Margherita AED 42, Pepperoni AED 48. Which one would you like?"],
        [1, "Margherita"],
        [0, "Added to your cart: 1 Margherita, AED 42. Anything else, or shall we check out?"],
      ] },
      shop: { name: "Roastery & Co", status: "online", at: "16:20", lines: [
        [1, "do you have Ethiopia beans in 1kg?"],
        [0, "Yes, Ethiopia Yirgacheffe 1 kg is AED 220, and 3 are left. Add one to your cart?"],
        [1, "yes"],
        [0, "Added. Your cart total is AED 220 including VAT. Anything else?"],
      ] },
    },
    ar: {
      salon: { name: "صالون جلو", status: "متصل", at: "21:14", lines: [
        [1, "أبغى موعد قص شعر بكرة العصر"],
        [0, "أكيد! سارة متاحة بكرة الساعة 2:00 أو 3:30 أو 4:00. أي وقت يناسبك؟"],
        [1, "3:30"],
        [0, "حجزت لك مؤقتاً: قص شعر مع سارة، بكرة الساعة 3:30، 80 درهم. أأكد الحجز؟"],
        [1, "نعم"],
        [0, "تم، رقم الحجز 12. سنذكّرك قبل موعدك 😊"],
      ] },
      sports: { name: "مارينا بادل", status: "متصل", at: "23:48", lines: [
        [1, "فيه ملعب بادل فاضي بكرة الساعة 8 لمدة ساعة ونص؟"],
        [0, "الملعب 2 متاح الساعة 8:00 مساءً لمدة 90 دقيقة، 280 درهم. أحجزه؟"],
        [1, "إي لو سمحت"],
        [0, "تم الحجز: بادل 90 دقيقة في الملعب 2، بكرة الساعة 8:00 مساءً. رقم الحجز 31.\n📍 مارينا ووك، دبي"],
      ] },
      resort: { name: "منتجع بالم باي", status: "متصل", at: "10:02", lines: [
        [1, "غرفة لشخصين من 14 إلى 16 ديسمبر؟"],
        [0, "لهاتين الليلتين لدينا غرفة الحديقة بـ 900 درهم لليلة، أو غرفة بإطلالة بحرية بـ 1,250 درهم."],
        [1, "الإطلالة البحرية"],
        [0, "حجزت لك مؤقتاً الغرفة بإطلالة بحرية، من 14 إلى 16 ديسمبر، الإجمالي 2,500 درهم. باسم من الحجز؟"],
      ] },
      restaurant: { name: "بيلا باستا", status: "متصل", at: "19:31", lines: [
        [1, "مرحبا، أقدر أطلب استلام؟"],
        [0, "بالتأكيد! هذه قائمتنا. اختر الفئة: بيتزا أو باستا أو حلويات."],
        [1, "بيتزا"],
        [0, "مارجريتا 42 درهم، بيبروني 48 درهم. أيهما تفضل؟"],
        [1, "مارجريتا"],
        [0, "تمت الإضافة إلى سلتك: 1 مارجريتا، 42 درهم. شيء آخر أم ننتقل إلى إتمام الطلب؟"],
      ] },
      shop: { name: "روستري آند كو", status: "متصل", at: "16:20", lines: [
        [1, "عندكم بن إثيوبي 1 كيلو؟"],
        [0, "نعم، إثيوبيا يرغاشيفي 1 كيلو بـ 220 درهم، وبقي 3 فقط. أضيفه إلى سلتك؟"],
        [1, "نعم"],
        [0, "تمت الإضافة. إجمالي سلتك 220 درهم شامل الضريبة. هل تحتاج شيئاً آخر؟"],
      ] },
    },
  };

  var root = document.querySelector("[data-demo]");
  if (!root) return;
  var language = document.documentElement.lang === "ar" ? "ar" : "en";
  var chats = CHATS[language];
  var box = root.querySelector(".chat");
  var nameEl = root.querySelector(".phone-name");
  var statusEl = root.querySelector(".phone-status");
  var avatar = root.querySelector(".avatar");
  var tabs = Array.prototype.slice.call(root.querySelectorAll(".tab"));
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var run = 0;

  function bubble(line, time, animate) {
    var el = document.createElement("div");
    el.className = "msg" + (line[0] ? " me" : "") + (animate ? " in" : "");
    el.appendChild(document.createTextNode(line[1]));
    var t = document.createElement("time");
    t.textContent = time;
    el.appendChild(t);
    box.appendChild(el);
  }

  function clockAfter(start, minutes) {
    var parts = start.split(":");
    var total = (Number(parts[0]) * 60 + Number(parts[1]) + minutes) % 1440;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(Math.floor(total / 60)) + ":" + pad(total % 60);
  }

  function wait(ms) { return new Promise(function (done) { setTimeout(done, ms); }); }

  async function play(key) {
    var chat = chats[key];
    var mine = ++run;
    tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.chat === key)); });
    nameEl.textContent = chat.name;
    statusEl.textContent = chat.status;
    avatar.textContent = chat.name.charAt(0);
    box.textContent = "";
    if (calm) {
      chat.lines.forEach(function (l, i) { bubble(l, clockAfter(chat.at, i), false); });
      return;
    }
    for (var i = 0; i < chat.lines.length; i++) {
      var line = chat.lines[i];
      if (!line[0]) {
        var dots = document.createElement("div");
        dots.className = "msg typing";
        dots.innerHTML = "<i></i><i></i><i></i>";
        box.appendChild(dots);
        await wait(900);
        if (mine !== run) return;
        dots.remove();
      } else {
        await wait(650);
        if (mine !== run) return;
      }
      bubble(line, clockAfter(chat.at, i), true);
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () { play(tab.dataset.chat); });
  });
})();
