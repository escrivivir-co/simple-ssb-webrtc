const { div, h2, h3, p, section, button, form, input, label, textarea, br, a, span, video, select, option } = require("../server/node_modules/hyperaxe");
const { template, i18n } = require('./main_views');

/**
 * Main WebRTC view — manual copy-paste signaling for testing.
 * Integrated into Oasis look & feel.
 */
const webrtcView = () => {
  const header = div({ class: "tags-header" },
    h2("WebRTC"),
    p("Peer-to-peer connection via copy-paste signaling. ",
      "Share codes with your peer through any external channel (chat, email, paper...).")
  );

  // ── Step 1: Create or Join ──
  const step1 = div({ class: "card", id: "step-create" },
    h3(span({ class: "emoji" }, "①"), " Start"),
    p("Choose whether to create a new room or join an existing one."),
    div({ class: "webrtc-mode-selector" },
      label({ for: "call-mode" }, "Mode: "),
      select({ id: "call-mode", class: "webrtc-select" },
        option({ value: "data" }, "Data Only (chat)"),
        option({ value: "av" }, "Audio/Video Call")
      )
    ),
    div({ class: "mode-buttons-row" },
      button({ type: "button", class: "filter-btn", id: "btn-create-room" }, "Create Room"),
      button({ type: "button", class: "filter-btn", id: "btn-join-room" }, "Join Room")
    )
  );

  // ── Step 2a: Offer generated (creator) ──
  const step2offer = div({ class: "card webrtc-hidden", id: "step-offer" },
    h3(span({ class: "emoji" }, "②"), " Your Offer Code"),
    p("Copy this code and send it to your peer:"),
    textarea({ id: "offer-code", readonly: true, rows: 4, class: "webrtc-code" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-copy-offer" }, "Copy to Clipboard"),
    br(), br(),
    p("Now paste your peer's Answer Code below:"),
    textarea({ id: "answer-input", rows: 4, placeholder: "Paste the answer code from your peer here...", class: "webrtc-input" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-accept-answer" }, "Connect")
  );

  // ── Step 2b: Join (responder) ──
  const step2join = div({ class: "card webrtc-hidden", id: "step-join" },
    h3(span({ class: "emoji" }, "②"), " Join Room"),
    p("Paste the Offer Code you received from the room creator:"),
    textarea({ id: "remote-offer-input", rows: 4, placeholder: "Paste the offer code here...", class: "webrtc-input" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-join-submit" }, "Generate Answer")
  );

  // ── Step 2c: Answer generated (responder) ──
  const step2answer = div({ class: "card webrtc-hidden", id: "step-answer-out" },
    h3(span({ class: "emoji" }, "③"), " Your Answer Code"),
    p("Copy this code and send it back to the room creator:"),
    textarea({ id: "answer-code", readonly: true, rows: 4, class: "webrtc-code" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-copy-answer" }, "Copy to Clipboard"),
    p("Waiting for connection...")
  );

  // ── Media panel (video + controls) ──
  const mediaPanel = div({ class: "card webrtc-hidden", id: "step-media" },
    h3(span({ class: "emoji" }, "▶"), " Media"),
    div({ class: "webrtc-video-grid" },
      div({ class: "webrtc-video-box" },
        label("Local"),
        video({ id: "local-video", autoplay: true, playsinline: true, muted: true, class: "webrtc-video" })
      ),
      div({ class: "webrtc-video-box" },
        label("Remote"),
        video({ id: "remote-video", autoplay: true, playsinline: true, class: "webrtc-video" })
      )
    ),
    div({ class: "webrtc-media-controls" },
      button({ type: "button", class: "filter-btn", id: "btn-toggle-mic" }, "🎙 Mute Mic"),
      button({ type: "button", class: "filter-btn", id: "btn-toggle-cam" }, "📷 Hide Cam")
    )
  );

  // ── Connection status ──
  const statusPanel = div({ class: "card webrtc-hidden", id: "step-connected" },
    h3(span({ class: "emoji" }, "☍"), " Connected"),
    div({ id: "connection-info" },
      div({ class: "card-field" },
        span({ class: "card-label" }, "Status: "),
        span({ class: "card-value", id: "conn-status" }, "...")
      ),
      div({ class: "card-field" },
        span({ class: "card-label" }, "DataChannel: "),
        span({ class: "card-value", id: "dc-status" }, "...")
      )
    )
  );

  // ── Chat / DataChannel test ──
  const chatPanel = div({ class: "card webrtc-hidden", id: "step-chat" },
    h3(span({ class: "emoji" }, "ꕕ"), " DataChannel Chat"),
    div({ id: "chat-messages", class: "webrtc-chat-messages" }),
    form({ id: "chat-form" },
      div({ class: "webrtc-chat-row" },
        input({ type: "text", id: "chat-input", placeholder: "Type a message...", autocomplete: "off", class: "webrtc-chat-input" }),
        button({ type: "submit", class: "filter-btn" }, "Send")
      )
    )
  );

  // ── Disconnect ──
  const disconnectPanel = div({ class: "card webrtc-hidden", id: "step-disconnect" },
    button({ type: "button", class: "filter-btn webrtc-disconnect-btn", id: "btn-disconnect" }, "Disconnect")
  );

  const pageTpl = template(
    "WebRTC",
    section(
      header,
      step1,
      step2offer,
      step2join,
      step2answer,
      mediaPanel,
      statusPanel,
      chatPanel,
      disconnectPanel
    )
  );

  // Append the CSS + client-side script after the template HTML
  return pageTpl
    .replace('</head>', '<link rel=\"stylesheet\" href=\"/assets/styles/webrtc.css\"></head>')
    + '<script src=\"/js/webrtc-app.js\"></script>';
};

exports.webrtcView = webrtcView;
