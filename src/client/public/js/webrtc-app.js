/**
 * WebRTC Copy-Paste Signaling App for Oasis
 * 
 * Manual signaling: users exchange offer/answer codes
 * through any external channel (chat, email, paper...).
 * Once connected, a DataChannel is established for P2P messaging.
 */
(function () {
  'use strict';

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  let pc = null;          // RTCPeerConnection
  let dc = null;          // RTCDataChannel (send side)
  let dcRemote = null;    // RTCDataChannel (receive side)
  let localStream = null; // MediaStream (local camera/mic)
  let callMode = 'data';  // 'data' or 'av'

  // ── Helpers ──

  function encode(obj) {
    return btoa(JSON.stringify(obj));
  }

  function decode(str) {
    return JSON.parse(atob(str.trim()));
  }

  function $(id) {
    return document.getElementById(id);
  }

  function show(id) {
    var el = $(id);
    if (el) el.classList.remove('webrtc-hidden');
  }

  function hide(id) {
    var el = $(id);
    if (el) el.classList.add('webrtc-hidden');
  }

  function appendChat(who, text) {
    var container = $('chat-messages');
    if (!container) return;
    var msg = document.createElement('div');
    msg.className = 'webrtc-chat-msg';
    var lbl = document.createElement('span');
    lbl.className = who === 'You' ? 'webrtc-chat-you' : 'webrtc-chat-peer';
    lbl.textContent = who + ': ';
    var txt = document.createTextNode(text);
    msg.appendChild(lbl);
    msg.appendChild(txt);
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  function updateStatus(connState, dcState) {
    const cs = $('conn-status');
    const ds = $('dc-status');
    if (cs) cs.textContent = connState || pc?.connectionState || '...';
    if (ds) ds.textContent = dcState || dc?.readyState || dcRemote?.readyState || '...';
  }

  // ── DataChannel setup ──

  function setupDataChannel(channel) {
    channel.onopen = function () {
      updateStatus('connected', 'open');
      show('step-chat');
      show('step-disconnect');
      appendChat('System', 'DataChannel open — you can chat now!');
    };
    channel.onclose = function () {
      updateStatus('disconnected', 'closed');
      appendChat('System', 'DataChannel closed.');
    };
    channel.onmessage = function (e) {
      appendChat('Peer', e.data);
    };
  }

  // ── PeerConnection setup ──

  function createPeerConnection() {
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.oniceconnectionstatechange = function () {
      updateStatus(pc.iceConnectionState);
    };
    pc.onconnectionstatechange = function () {
      updateStatus(pc.connectionState);
    };

    // Receive data channel from remote
    pc.ondatachannel = function (e) {
      dcRemote = e.channel;
      setupDataChannel(dcRemote);
    };

    // Receive remote media tracks
    pc.ontrack = function (e) {
      var remoteVideo = $('remote-video');
      if (remoteVideo && e.streams && e.streams[0]) {
        remoteVideo.srcObject = e.streams[0];
      }
    };

    return pc;
  }

  // ── Media helpers ──

  async function acquireMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });
      var localVideo = $('local-video');
      if (localVideo) {
        localVideo.srcObject = localStream;
      }
      return localStream;
    } catch (err) {
      appendChat('System', 'Camera/mic error: ' + err.message);
      return null;
    }
  }

  function addMediaTracks() {
    if (!localStream || !pc) return;
    localStream.getTracks().forEach(function (track) {
      pc.addTrack(track, localStream);
    });
  }

  function stopMedia() {
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    var lv = $('local-video');
    var rv = $('remote-video');
    if (lv) lv.srcObject = null;
    if (rv) rv.srcObject = null;
  }

  /**
   * Wait for ICE gathering to complete so we get a single
   * self-contained SDP (no trickle needed).
   */
  function waitForIceComplete(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') {
        return resolve(pc.localDescription);
      }
      pc.onicegatheringstatechange = function () {
        if (pc.iceGatheringState === 'complete') {
          resolve(pc.localDescription);
        }
      };
    });
  }

  // ── Public API ──

  const webrtcApp = {

    /** Creator: generate offer */
    createRoom: async function () {
      callMode = $('call-mode') ? $('call-mode').value : 'data';
      createPeerConnection();

      // Create DataChannel before offer
      dc = pc.createDataChannel('oasis-webrtc', { ordered: true });
      setupDataChannel(dc);

      // If A/V mode, acquire media and add tracks
      if (callMode === 'av') {
        var stream = await acquireMedia();
        if (stream) {
          addMediaTracks();
          show('step-media');
        }
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for all ICE candidates to be gathered
      const fullOffer = await waitForIceComplete(pc);
      $('offer-code').value = encode(fullOffer);

      hide('step-create');
      show('step-offer');
      show('step-connected');
      updateStatus('waiting for answer...', 'pending');
    },

    /** Creator: accept peer's answer */
    acceptAnswer: async function () {
      const raw = $('answer-input').value;
      if (!raw.trim()) return;
      try {
        const answer = decode(raw);
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        updateStatus('connecting...');
      } catch (err) {
        appendChat('System', 'Error: invalid answer code — ' + err.message);
      }
    },

    /** Joiner: paste offer, generate answer */
    joinRoom: async function () {
      var raw = $('remote-offer-input').value;
      if (!raw.trim()) return;
      try {
        var offer = decode(raw);

        // Auto-detect AV call from offer SDP (sendrecv + audio/video m-lines)
        var hasMedia = offer.sdp && (offer.sdp.indexOf('m=audio') !== -1 || offer.sdp.indexOf('m=video') !== -1);
        var hasSendRecv = offer.sdp && offer.sdp.indexOf('a=sendrecv') !== -1;
        callMode = (hasMedia && hasSendRecv) ? 'av' : ($('call-mode') ? $('call-mode').value : 'data');

        createPeerConnection();

        // Answerer: set remote description FIRST, then add tracks, then createAnswer
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // If A/V call detected, acquire local media and add tracks
        if (callMode === 'av') {
          var stream = await acquireMedia();
          if (stream) {
            addMediaTracks();
            show('step-media');
          }
        }

        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const fullAnswer = await waitForIceComplete(pc);
        $('answer-code').value = encode(fullAnswer);

        hide('step-join');
        show('step-answer-out');
        show('step-connected');
        updateStatus('waiting for connection...');
      } catch (err) {
        appendChat('System', 'Error: invalid offer code — ' + err.message);
      }
    },

    /** Send a message via DataChannel */
    sendMessage: function (e) {
      e.preventDefault();
      const input = $('chat-input');
      const text = input.value.trim();
      if (!text) return;
      const channel = dc || dcRemote;
      if (!channel || channel.readyState !== 'open') {
        appendChat('System', 'DataChannel not open yet.');
        return;
      }
      channel.send(text);
      appendChat('You', text);
      input.value = '';
    },

    /** Copy code to clipboard */
    copyCode: function (textareaId) {
      const ta = $(textareaId);
      if (!ta) return;
      ta.select();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(ta.value);
      } else {
        document.execCommand('copy');
      }
    },

    /** Disconnect and reset */
    disconnect: function () {
      if (dc) { try { dc.close(); } catch (_) {} }
      if (dcRemote) { try { dcRemote.close(); } catch (_) {} }
      if (pc) { try { pc.close(); } catch (_) {} }
      stopMedia();
      pc = null;
      dc = null;
      dcRemote = null;
      callMode = 'data';

      hide('step-offer');
      hide('step-join');
      hide('step-answer-out');
      hide('step-connected');
      hide('step-chat');
      hide('step-disconnect');
      hide('step-media');
      show('step-create');

      $('offer-code').value = '';
      $('answer-input').value = '';
      $('remote-offer-input').value = '';
      $('answer-code').value = '';
      $('chat-messages').innerHTML = '';
      updateStatus('disconnected', 'closed');

      // Reset toggle button labels
      var mic = $('btn-toggle-mic');
      var cam = $('btn-toggle-cam');
      if (mic) { mic.textContent = '\ud83c\udf99 Mute Mic'; mic.classList.remove('webrtc-btn-muted'); }
      if (cam) { cam.textContent = '\ud83d\udcf7 Hide Cam'; cam.classList.remove('webrtc-btn-muted'); }
    },

    /** Toggle microphone */
    toggleMic: function () {
      if (!localStream) return;
      var audioTrack = localStream.getAudioTracks()[0];
      if (!audioTrack) return;
      audioTrack.enabled = !audioTrack.enabled;
      var btn = $('btn-toggle-mic');
      if (btn) {
        btn.textContent = audioTrack.enabled ? '\ud83c\udf99 Mute Mic' : '\ud83c\udf99 Unmute Mic';
        btn.classList.toggle('webrtc-btn-muted', !audioTrack.enabled);
      }
    },

    /** Toggle camera */
    toggleCam: function () {
      if (!localStream) return;
      var videoTrack = localStream.getVideoTracks()[0];
      if (!videoTrack) return;
      videoTrack.enabled = !videoTrack.enabled;
      var btn = $('btn-toggle-cam');
      if (btn) {
        btn.textContent = videoTrack.enabled ? '\ud83d\udcf7 Hide Cam' : '\ud83d\udcf7 Show Cam';
        btn.classList.toggle('webrtc-btn-muted', !videoTrack.enabled);
      }
    }
  };

  // Expose globally
  window.webrtcApp = webrtcApp;

  // ── Bind UI events by element ID ──
  document.addEventListener('DOMContentLoaded', function () {
    $('btn-create-room').addEventListener('click', webrtcApp.createRoom);
    $('btn-join-room').addEventListener('click', function () { show('step-join'); });
    $('btn-copy-offer').addEventListener('click', function () { webrtcApp.copyCode('offer-code'); });
    $('btn-accept-answer').addEventListener('click', webrtcApp.acceptAnswer);
    $('btn-join-submit').addEventListener('click', webrtcApp.joinRoom);
    $('btn-copy-answer').addEventListener('click', function () { webrtcApp.copyCode('answer-code'); });
    $('btn-disconnect').addEventListener('click', webrtcApp.disconnect);
    $('btn-toggle-mic').addEventListener('click', webrtcApp.toggleMic);
    $('btn-toggle-cam').addEventListener('click', webrtcApp.toggleCam);
    $('chat-form').addEventListener('submit', webrtcApp.sendMessage);

    // Click-to-select on readonly textareas
    ['offer-code', 'answer-code'].forEach(function (id) {
      $(id).addEventListener('click', function () { this.select(); });
    });
  });
})();
