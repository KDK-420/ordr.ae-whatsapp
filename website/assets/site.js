// ordr.ae site script: the mobile menu on every page, and the phone demo on the two home pages.
// The phone is a sample conversation that runs in the browser. It creates no real orders or bookings.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const menuBtn = $("menuBtn");
  const panel = $("mobilePanel");
  if (menuBtn && panel) {
    menuBtn.addEventListener("click", () => {
      menuBtn.setAttribute("aria-expanded", String(panel.classList.toggle("open")));
    });
    panel.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
      panel.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    }));
  }

  const chat = $("chatArea");
  if (!chat) return;

  const copy = {
    en: {
      received: "Order request received", confirmed: "Booking confirmed", typing: "typing…",
      rows: ["Service", "Selection", "Price"], confirm: "Yes, confirm", back: "Go back",
      askOrder: (t) => `Great choice. ${t}. Shall I send this order request to the team?`,
      askBooking: (s, t) => `Perfect! ${s.service} ${t}. ${s.price}. Shall I confirm?`,
      again: "No problem. You can choose another option.",
      doneOrder: "Thanks! Your order request is ready for the team.",
      doneBooking: "All set! We look forward to seeing you.",
      more: "Anything else I can help you with?",
      pick: "This sample chat follows set steps, so please choose an option below. The real assistant reads plain sentences on WhatsApp.",
      yes: /\b(yes|yeah|confirm|ok|okay|sure)\b/i, no: /\b(back|no|cancel)\b/i,
      scenarios: {
        salon: { name: "Glow Salon", avatar: "G", intro: "Hi! Can I book a haircut tomorrow afternoon?", reply: "Absolutely! Sara has openings tomorrow. Which time works for you?", choices: ["2:00 PM", "3:30 PM", "4:00 PM"], service: "Haircut with Sara", price: "AED 80", kind: "booking" },
        spa: { name: "Serene Spa", avatar: "S", intro: "Can I book a massage tomorrow?", reply: "Of course. Here are the available times for a 60-minute massage.", choices: ["11:00 AM", "2:30 PM", "6:00 PM"], service: "60-minute massage", price: "AED 220", kind: "booking" },
        restaurant: { name: "Olive Kitchen", avatar: "O", intro: "Hi! Can I order something for dinner?", reply: "Absolutely. Here are a few popular items. What would you like?", choices: ["Margherita Pizza", "Chicken Pasta", "Caesar Salad"], service: "Dinner order", price: "Confirmed by the team", kind: "order" },
        shop: { name: "The Edit Store", avatar: "E", intro: "Do you have black tote bags available?", reply: "Yes! Would you like to reserve one or ask about delivery?", choices: ["Reserve one", "Delivery", "More details"], service: "Black tote bag", price: "Confirmed by the team", kind: "order" },
        padel: { name: "Padel House", avatar: "P", intro: "Any padel courts free tonight?", reply: "Yes. Choose an available court time.", choices: ["6:00 PM", "7:30 PM", "9:00 PM"], service: "Padel court", price: "Rate on confirmation", kind: "booking" },
        resort: { name: "Azure Resort", avatar: "A", intro: "Do you have rooms available this weekend?", reply: "Happy to help. What kind of stay are you looking for?", choices: ["One night", "Two nights", "Suite enquiry"], service: "Resort stay enquiry", price: "Rates on request", kind: "booking" },
      },
    },
    ar: {
      received: "تم استلام طلبك", confirmed: "تم تأكيد الحجز", typing: "يكتب…",
      rows: ["الخدمة", "الاختيار", "السعر"], confirm: "نعم، أكّد", back: "رجوع",
      askOrder: (t) => `اختيار رائع: ${t}. هل أرسل طلبك إلى الفريق؟`,
      askBooking: (s, t) => `ممتاز! ${s.service}، ${t}. ${s.price}. هل أؤكد؟`,
      again: "لا مشكلة. يمكنك اختيار خيار آخر.",
      doneOrder: "شكراً! طلبك جاهز لدى الفريق.",
      doneBooking: "تم! نتطلع إلى رؤيتك.",
      more: "هل يمكنني مساعدتك في شيء آخر؟",
      pick: "هذه محادثة تجريبية بخطوات محددة، فاختر أحد الخيارات أدناه. أما المساعد الفعلي فيفهم الجمل العادية عبر واتساب.",
      yes: /^\s*(نعم|أكد|أكّد|تمام|موافق)/, no: /^\s*(لا|رجوع|إلغاء)(\s|$)/,
      scenarios: {
        salon: { name: "Glow Salon", avatar: "G", intro: "مرحباً! هل يمكنني حجز قص شعر غداً بعد الظهر؟", reply: "بالتأكيد! سارة متاحة غداً. أي وقت يناسبك؟", choices: ["2:00 م", "3:30 م", "4:00 م"], service: "قص شعر مع سارة", price: "80 درهماً", kind: "booking" },
        spa: { name: "Serene Spa", avatar: "S", intro: "هل يمكنني حجز مساج غداً؟", reply: "بالطبع. هذه الأوقات المتاحة لجلسة مساج مدتها 60 دقيقة.", choices: ["11:00 ص", "2:30 م", "6:00 م"], service: "مساج 60 دقيقة", price: "220 درهماً", kind: "booking" },
        restaurant: { name: "Olive Kitchen", avatar: "O", intro: "مرحباً! هل يمكنني طلب شيء للعشاء؟", reply: "بالتأكيد. هذه بعض الأصناف المفضلة. ماذا تحب أن تطلب؟", choices: ["بيتزا مارغريتا", "باستا بالدجاج", "سلطة سيزر"], service: "طلب عشاء", price: "يؤكده الفريق", kind: "order" },
        shop: { name: "The Edit Store", avatar: "E", intro: "هل لديكم حقائب توت سوداء؟", reply: "نعم! هل تود حجز واحدة أم السؤال عن التوصيل؟", choices: ["احجز واحدة", "التوصيل", "تفاصيل أكثر"], service: "حقيبة توت سوداء", price: "يؤكده الفريق", kind: "order" },
        padel: { name: "Padel House", avatar: "P", intro: "هل توجد ملاعب بادل متاحة الليلة؟", reply: "نعم. اختر وقتاً متاحاً.", choices: ["6:00 م", "7:30 م", "9:00 م"], service: "ملعب بادل", price: "السعر عند التأكيد", kind: "booking" },
        resort: { name: "Azure Resort", avatar: "A", intro: "هل لديكم غرف متاحة نهاية هذا الأسبوع؟", reply: "يسعدنا مساعدتك. ما نوع الإقامة التي تبحث عنها؟", choices: ["ليلة واحدة", "ليلتان", "استفسار عن جناح"], service: "استفسار عن إقامة", price: "الأسعار عند الطلب", kind: "booking" },
      },
    },
  };
  const t = copy[document.documentElement.lang] || copy.en;

  let current = "salon";
  let step = 0;
  let timers = [];
  let locked = false;
  let chosen = "";

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const toBottom = () => { chat.scrollTop = chat.scrollHeight; };

  function bubble(text, side) {
    const el = document.createElement("div");
    el.className = `bubble ${side}`;
    const label = document.createElement("span");
    label.textContent = text;
    const time = document.createElement("time");
    time.textContent = `9:41${side === "user" ? " ✓✓" : ""}`;
    el.append(label, time);
    chat.appendChild(el);
    toBottom();
  }

  function options(choices) {
    const group = document.createElement("div");
    group.className = "options";
    choices.forEach((choice) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = choice;
      b.addEventListener("click", () => send(choice));
      group.appendChild(b);
    });
    chat.appendChild(group);
    toBottom();
  }

  function receipt() {
    const s = t.scenarios[current];
    const card = document.createElement("div");
    card.className = "receipt";
    const title = document.createElement("strong");
    title.textContent = `✓ ${s.kind === "order" ? t.received : t.confirmed}`;
    const list = document.createElement("dl");
    [s.service, chosen, s.price].forEach((value, i) => {
      const dt = document.createElement("dt");
      dt.textContent = t.rows[i];
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.append(dt, dd);
    });
    card.append(title, list);
    chat.appendChild(card);
  }

  function reply(text, choices, withReceipt) {
    locked = true;
    const typing = document.createElement("div");
    typing.className = "bubble bot";
    typing.textContent = t.typing;
    chat.appendChild(typing);
    toBottom();
    later(() => {
      typing.remove();
      bubble(text, "bot");
      if (withReceipt) receipt();
      if (choices) options(choices);
      locked = false;
      toBottom();
    }, 420);
  }

  function reset(key) {
    timers.forEach(clearTimeout);
    timers = [];
    current = key;
    step = 0;
    chosen = "";
    locked = false;
    chat.replaceChildren();
    const s = t.scenarios[key];
    $("chatName").textContent = s.name;
    $("chatAvatar").textContent = s.avatar;
    document.querySelectorAll("[data-industry]").forEach((b) => b.classList.toggle("active", b.dataset.industry === key));
    later(() => {
      bubble(s.intro, "user");
      later(() => reply(s.reply, s.choices), 260);
    }, 150);
  }

  function send(raw) {
    const text = String(raw).trim();
    if (!text || locked) return;
    chat.querySelectorAll(".options").forEach((n) => n.remove());
    bubble(text, "user");
    $("chatInput").value = "";
    const s = t.scenarios[current];
    const confirmChoices = [t.confirm, t.back];
    if (step === 0) {
      const match = s.choices.find((c) => c.toLowerCase() === text.toLowerCase());
      if (!match) return reply(t.pick, s.choices);
      chosen = match;
      step = 1;
      reply(s.kind === "order" ? t.askOrder(match) : t.askBooking(s, match), confirmChoices);
    } else if (step === 1) {
      if (t.no.test(text)) {
        step = 0;
        reply(t.again, s.choices);
      } else if (t.yes.test(text)) {
        step = 2;
        reply(s.kind === "order" ? t.doneOrder : t.doneBooking, null, true);
      } else {
        reply(t.pick, confirmChoices);
      }
    } else {
      step = 0;
      reply(t.more, s.choices);
    }
  }

  $("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    send($("chatInput").value);
  });
  $("resetChat").addEventListener("click", () => reset(current));
  document.querySelectorAll("[data-industry]").forEach((b) => b.addEventListener("click", () => reset(b.dataset.industry)));

  const modal = $("demoModal");
  const closeModal = () => modal.classList.remove("show");
  $("watchDemo").addEventListener("click", () => modal.classList.add("show"));
  $("closeModal").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  document.querySelectorAll("[data-modal-demo]").forEach((b) => b.addEventListener("click", () => {
    closeModal();
    reset(b.dataset.modalDemo);
    document.querySelector(".device-zone").scrollIntoView({ behavior: "smooth", block: "center" });
  }));

  reset(current);
})();
