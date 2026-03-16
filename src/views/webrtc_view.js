const { div, h2, h3, p, section, button, form, input, label, textarea, br, a, span, video, select, option } = require("../server/node_modules/hyperaxe");
const { template, i18n } = require('./main_views');

/**
 * Main WebRTC view — manual copy-paste signaling for testing.
 * Integrated into Oasis look & feel.
 */
const webrtcView = () => {
  const header = div({ class: "tags-header" },
    h2(i18n.webrtcTitle || "WebRTC"),
    p(i18n.webrtcDescription || "Peer-to-peer connection via copy-paste signaling.")
  );

  // ── Step 1: Create or Join ──
  const step1 = div({ class: "card", id: "step-create" },
    h3(span({ class: "emoji" }, "①"), " ", i18n.webrtcStart || "Start"),
    p(i18n.webrtcStartDescription || "Choose whether to create a new room or join an existing one."),
    div({ class: "webrtc-mode-selector" },
      label({ for: "call-mode" }, i18n.webrtcModeLabel || "Mode: "),
      select({ id: "call-mode", class: "webrtc-select" },
        option({ value: "data" }, i18n.webrtcModeData || "Data Only (chat)"),
        option({ value: "av" }, i18n.webrtcModeAV || "Audio/Video Call")
      )
    ),
    div({ class: "mode-buttons-row" },
      button({ type: "button", class: "filter-btn", id: "btn-create-room" }, i18n.webrtcCreateRoom || "Create Room"),
      button({ type: "button", class: "filter-btn", id: "btn-join-room" }, i18n.webrtcJoinRoom || "Join Room")
    )
  );

  // ── Step 2a: Offer generated (creator) ──
  const step2offer = div({ class: "card webrtc-hidden", id: "step-offer" },
    h3(span({ class: "emoji" }, "②"), " ", i18n.webrtcYourOfferCode || "Your Offer Code"),
    p(i18n.webrtcOfferCopy || "Copy this code and send it to your peer:"),
    textarea({ id: "offer-code", readonly: true, rows: 4, class: "webrtc-code" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-copy-offer" }, i18n.webrtcCopyToClipboard || "Copy to Clipboard"),
    br(), br(),
    p(i18n.webrtcPasteAnswer || "Now paste your peer's Answer Code below:"),
    textarea({ id: "answer-input", rows: 4, placeholder: i18n.webrtcPasteAnswerPlaceholder || "Paste the answer code from your peer here...", class: "webrtc-input" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-accept-answer" }, i18n.webrtcConnect || "Connect")
  );

  // ── Step 2b: Join (responder) ──
  const step2join = div({ class: "card webrtc-hidden", id: "step-join" },
    h3(span({ class: "emoji" }, "②"), " ", i18n.webrtcJoinTitle || "Join Room"),
    p(i18n.webrtcPasteOffer || "Paste the Offer Code you received from the room creator:"),
    textarea({ id: "remote-offer-input", rows: 4, placeholder: i18n.webrtcPasteOfferPlaceholder || "Paste the offer code here...", class: "webrtc-input" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-join-submit" }, i18n.webrtcGenerateAnswer || "Generate Answer")
  );

  // ── Step 2c: Answer generated (responder) ──
  const step2answer = div({ class: "card webrtc-hidden", id: "step-answer-out" },
    h3(span({ class: "emoji" }, "③"), " ", i18n.webrtcYourAnswerCode || "Your Answer Code"),
    p(i18n.webrtcAnswerCopy || "Copy this code and send it back to the room creator:"),
    textarea({ id: "answer-code", readonly: true, rows: 4, class: "webrtc-code" }),
    br(),
    button({ type: "button", class: "create-button", id: "btn-copy-answer" }, i18n.webrtcCopyToClipboard || "Copy to Clipboard"),
    p(i18n.webrtcWaitingConnection || "Waiting for connection...")
  );

  // ── Media panel (video + controls) ──
  const mediaPanel = div({ class: "card webrtc-hidden", id: "step-media" },
    h3(span({ class: "emoji" }, "▶"), " ", i18n.webrtcMedia || "Media"),
    div({ class: "webrtc-video-grid" },
      div({ class: "webrtc-video-box" },
        label(i18n.webrtcLocal || "Local"),
        video({ id: "local-video", autoplay: true, playsinline: true, muted: true, class: "webrtc-video" })
      ),
      div({ class: "webrtc-video-box" },
        label(i18n.webrtcRemote || "Remote"),
        video({ id: "remote-video", autoplay: true, playsinline: true, class: "webrtc-video" })
      )
    ),
    div({ class: "webrtc-media-controls" },
      button({ type: "button", class: "filter-btn", id: "btn-toggle-mic" }, "🎙 ", i18n.webrtcMuteMic || "Mute Mic"),
      button({ type: "button", class: "filter-btn", id: "btn-toggle-cam" }, "📷 ", i18n.webrtcHideCam || "Hide Cam")
    )
  );

  // ── Connection status ──
  const statusPanel = div({ class: "card webrtc-hidden", id: "step-connected" },
    h3(span({ class: "emoji" }, "☍"), " ", i18n.webrtcConnected || "Connected"),
    div({ id: "connection-info" },
      div({ class: "card-field" },
        span({ class: "card-label" }, i18n.webrtcStatus || "Status: "),
        span({ class: "card-value", id: "conn-status" }, "...")
      ),
      div({ class: "card-field" },
        span({ class: "card-label" }, i18n.webrtcDataChannel || "DataChannel: "),
        span({ class: "card-value", id: "dc-status" }, "...")
      )
    )
  );

  // ── Chat / DataChannel test ──
  const chatPanel = div({ class: "card webrtc-hidden", id: "step-chat" },
    h3(span({ class: "emoji" }, "ꕕ"), " ", i18n.webrtcChat || "DataChannel Chat"),
    div({ id: "chat-messages", class: "webrtc-chat-messages" }),
    form({ id: "chat-form" },
      div({ class: "webrtc-chat-row" },
        input({ type: "text", id: "chat-input", placeholder: i18n.webrtcTypePlaceholder || "Type a message...", autocomplete: "off", class: "webrtc-chat-input" }),
        button({ type: "submit", class: "filter-btn" }, i18n.webrtcSend || "Send")
      )
    )
  );

  // ── Disconnect ──
  const disconnectPanel = div({ class: "card webrtc-hidden", id: "step-disconnect" },
    button({ type: "button", class: "filter-btn webrtc-disconnect-btn", id: "btn-disconnect" }, i18n.webrtcDisconnect || "Disconnect")
  );

  const pageTpl = template(
    i18n.webrtcTitle || "WebRTC",
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
