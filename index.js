// ssb-webrtc plugin for secret-stack
// Provides WebRTC signaling over SSB private messages

const SIGNAL_TYPE = 'webrtc-signal';

module.exports = {
  name: 'webrtc',
  version: '0.1.0',
  manifest: {
    offer: 'async',
    answer: 'async',
    candidate: 'async',
    hangup: 'async',
    listen: 'source'
  },
  permissions: {
    master: { allow: ['offer', 'answer', 'candidate', 'hangup', 'listen'] }
  },
  init(sbot, config) {
    const pull = require('pull-stream');

    function publishSignal(peerId, signalType, payload, cb) {
      const content = {
        type: SIGNAL_TYPE,
        signal: signalType,
        payload: payload,
        timestamp: Date.now(),
        recps: [sbot.id, peerId]
      };
      sbot.private.publish(content, content.recps, cb);
    }

    return {
      offer(peerId, sdp, cb) {
        publishSignal(peerId, 'offer', { sdp }, cb);
      },

      answer(peerId, sdp, cb) {
        publishSignal(peerId, 'answer', { sdp }, cb);
      },

      candidate(peerId, candidate, cb) {
        publishSignal(peerId, 'candidate', { candidate }, cb);
      },

      hangup(peerId, cb) {
        publishSignal(peerId, 'hangup', {}, cb);
      },

      // Returns a pull-stream source of incoming signals addressed to us
      listen() {
        return pull(
          sbot.createLogStream({ live: true, old: false }),
          pull.asyncMap((msg, cb) => {
            if (!msg || !msg.value) return cb(null, null);
            // Try to unbox private messages
            if (typeof msg.value.content === 'string') {
              sbot.private.unbox(msg.value.content, (err, content) => {
                if (err || !content) return cb(null, null);
                if (content.type !== SIGNAL_TYPE) return cb(null, null);
                if (!content.recps || !content.recps.includes(sbot.id)) return cb(null, null);
                cb(null, {
                  from: msg.value.author,
                  signal: content.signal,
                  payload: content.payload,
                  timestamp: content.timestamp,
                  key: msg.key
                });
              });
            } else {
              return cb(null, null);
            }
          }),
          pull.filter(Boolean)
        );
      }
    };
  }
};
