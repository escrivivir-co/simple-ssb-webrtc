// Signaling interface contract
// All signaling transports must implement: encode(), decode()
// The manual transport uses base64-encoded compressed SDP for copy-paste

const ManualSignaling = {
  /**
   * Encode a full SDP (with gathered ICE candidates) into a compact string
   * suitable for copy-paste between users.
   */
  encode(sessionDescription) {
    const json = JSON.stringify(sessionDescription);
    // Use base64 encoding. In production, could add compression (pako/zlib).
    if (typeof btoa === 'function') {
      return btoa(json);
    }
    return Buffer.from(json).toString('base64');
  },

  /**
   * Decode a copy-pasted string back into an RTCSessionDescription init dict
   */
  decode(encoded) {
    let json;
    if (typeof atob === 'function') {
      json = atob(encoded);
    } else {
      json = Buffer.from(encoded, 'base64').toString('utf-8');
    }
    return JSON.parse(json);
  }
};

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ManualSignaling };
}
