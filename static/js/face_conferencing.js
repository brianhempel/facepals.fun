let myVid           = document.getElementById('myVid');
let myVidCanvas     = document.createElement('canvas');
var myVidCanvasCtx;
let myFaceCanvas    = document.getElementById('myFaceCanvas');
let loadingElem     = document.getElementById('loading');
let debugInfoButton = document.getElementById('debugInfoButton');
let debugInfoElem   = document.getElementById('debugInfo');
// let miniFaceSize    = 64;
let miniFaceSize    = 80;
myFaceCanvas.width  = miniFaceSize;
myFaceCanvas.height = miniFaceSize;
myFaceCanvas.style.borderRadius = "" + (miniFaceSize / 2) + "px";
var myWidth, myHeight;
var faceDetectionWorker;
var faceCX, faceCY, faceSize;
var targetFaceCX, targetFaceCY, targetFaceSize;
var myVidStream;
var myFaceStream;
var myPeerName;
var roomName        = window.location.href.match(/\/rooms\/([A-Za-z0-9'_!\-]+)/)[1];
var peers           = {};
var iceLog          = "";



// baseline idle 73.8
// no showing vid / face canvase 77.1
// no face detection 78.4
// and no circular clipping 79.5
// and no drawing on game canvas 91.3
// and no drawing on face canvas 93.1
// add back drawing on face canvas and face detection 89.9

const peerConnConfig = {
  iceServers: [
    {
      urls: 'turn:facepals.fun:5349',
      username: 'facepals',
      credential: 'facepalspwd'
    }
  ]
}

Array.prototype.maxBy = function(f) {
  var best_i    = -1;
  var best_val  = null;
  var best_elem = null;

  this.forEach( elem => {
    var val = f(elem);
    if (best_val === null || val > best_val) {
      best_val == val;
      best_elem = elem;
    }
  });

  return best_elem;
};

Array.prototype.subtract = function (subtrahendArr) {
  return this.filter(elem => !subtrahendArr.includes(elem));
}


// The protocol is to:

// 1. Acquire a peer name by POSTing to /rooms/:room_name/peers

// 2. Poll /rooms/:room_name/peers

// 3. When a peer is listed that you haven't connected to, it is the
//   responsibility of the lexigraphically lower peer_name to offer, so:

// 4a. If other_peer_name < my_peer_name, then:
//   (i)  Post my JSON RTCPeerConnectionDescription offer to
//       /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/offers/MY_PEER_NAME
//   (ii) Add a data channel
//   (iii) Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/answers/OTHER_PEER_NAME
//       for the answering description

// 4b. If other_peer_name > my_peer_name, then:
//   (i)  Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/offers/OTHER_PEER_NAME for the offer
//   (ii) Listen for a data channel
//   (iii) Post my JSON RTCPeerConnectionDescription answer to
//        /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/answers/MY_PEER_NAME

function acquirePeerName() {
  fetch('/rooms/' + roomName + '/peers', { method: 'POST' })
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    myPeerName = data.peer_name;
    console.log("My peer name is " + myPeerName);
    heartbeat();
    pollForPeers();
    window.addEventListener("beforeunload", _ => navigator.sendBeacon('/rooms/' + roomName + '/peers/' + myPeerName + '/remove'));
  }).catch(err => {
    console.warn("Couldn't acquire peer name", err);
    window.setTimeout(acquirePeerName, 3000);
  });
}

function heartbeat() {
  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/heartbeat', { method: 'POST' })
  .then(resp => resp.ok ? resp :  Promise.reject(resp))
  .then(data => {
    window.setTimeout(heartbeat, 5000);
  }).catch(err => {
    console.warn("Heartbeat error", err);
    window.setTimeout(heartbeat, 5000);
  });
}

function pollForAnswerFrom(peerName) {
  if (!(peerName in peers)) { // Peer removed.
    return;
  }

  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/answers/' + peerName)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    console.log('Got answer from ' + peerName);
    peers[peerName].status = 'connected'
    peers[peerName].peerConn.ontrack = makeOnTrackHandler(peerName);
    window.setTimeout(() => pollForIceCandidates(peerName, 100), 100);
    peers[peerName].peerConn.setRemoteDescription(new RTCSessionDescription(data));
  }).catch(err => {
    console.log('Waiting for answer from ' + peerName, err);
    window.setTimeout(() => pollForAnswerFrom(peerName), 1000);
  });
}

function makeOnIceCandidateHandler(peerName) {
  let sendIceCandidate = candidateJson => {
    console.log(candidateJson);
    let jsonStr = JSON.stringify(candidateJson);
    iceLog += (new Date()).toISOString() + " To   " + peerName + " sending ICE candidate " + jsonStr + "\n";
    fetch('/rooms/' + roomName + '/peers/' + peerName + '/ice_candidates/' + myPeerName, {
      method: 'POST',
      body: jsonStr,
      headers: { 'Content-Type': 'application/json' }
    })
    .then(resp => resp.ok ? resp :  Promise.reject(resp))
    .catch(err => {
      console.error('Error sending ICE candidate to ' + peerName, err);
      window.setTimeout(() => sendIceCandidate(candidateJson), 500);
      iceLog += (new Date()).toISOString() + " To   " + peerName + " ERROR sending ICE candidate (" + jsonStr + ")\n";
    });
  };
  return function (event) {
    if (!(peerName in peers)) { // Peer removed.
      return;
    }

    if (event.candidate) {
      sendIceCandidate(event.candidate.toJSON());
    }
  };
}

function makeOnTrackHandler(peerName) {
  return function (event) {
    if (!(peerName in peers)) { // Peer removed.
      return;
    }

    if (!peers[peerName].vidElem) {
      let vidElem                = document.createElement("video");
      vidElem.width              = miniFaceSize;
      vidElem.height             = miniFaceSize;
      myFaceCanvas.before(vidElem);
      vidElem.style.borderRadius = "" + (miniFaceSize / 2) + "px";
      vidElem.style.position     = "absolute";
      peers[peerName].vidElem    = vidElem;
      vidElem.srcObject          = event.streams[0];
      vidElem.play();
    }
  };
}

function makeOnMessageHandler(peerName) {
  return function (event) {
    if (!(peerName in peers)) { // Peer removed.
      return;
    }
    // Up to the game to implement this.
    // console.log("receiving ", event.data);
    handleMessage(peerName, JSON.parse(event.data));
  };
}

function broadcast(data) {
  json_str = JSON.stringify(data)
  for (const peerName in peers) {
    // console.log(peers[peerName].dataChan);
    if (peers[peerName].dataChan && peers[peerName].dataChan.readyState === "open") {
      // console.log("broadcasting ", data);
      //window.setTimeout(() => { peers[peerName].dataChan.send(json_str); }, Math.random()*2000)
      // if (Math.random() > 0.5) {
        // window.setTimeout(() => { peers[peerName].dataChan.send(json_str); }, Math.random()*2000)
      // }
      peers[peerName].dataChan.send(json_str);
    }
  }
};

function getIceCandidateData(peerName, candidateId) {
  if (!(peerName in peers)) { // Peer removed.
    return;
  }

  iceLog += (new Date()).toISOString() + " From " + peerName + " getting ICE candidate " + candidateId + "\n";
  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/ice_candidates/' + peerName + '/' + candidateId)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    console.log(data);
    iceLog += (new Date()).toISOString() + " From " + peerName + " got ICE candidate " + candidateId + " (" + JSON.stringify(data) + ")\n";
    peers[peerName].peerConn.addIceCandidate(data).then(() => {
      // iceLog += (new Date()).toISOString() + "      " + peerName + " ICE state " + peers[peerName].peerConn.iceConnectionState + "\n";
    }).catch(err => {
      console.error("addIceCandidate() failure  " + err.name + " from " + peerName, err, data);
      console.error(JSON.stringify(data));
      iceLog += (new Date()).toISOString() + " From " + peerName + " ERROR  " + err.name + " on addIceCandidate() " + candidateId + " (" + JSON.stringify(data) + ")\n";
      // iceLog += (new Date()).toISOString() + "      " + peerName + " ICE state " + peers[peerName].peerConn.iceConnectionState + "\n";
    });
  }).catch(err => {
    console.error("Error getting ice candidate " + candidateId + " from " + peerName, err);
    iceLog += (new Date()).toISOString() + " From " + peerName + " ERROR getting ICE candidate " + candidateId + "\n";
    window.setTimeout(() => getIceCandidateData(peerName, candidateId, 500));
  });
}

function pollForIceCandidates(peerName, delayMs) {
  if (!(peerName in peers)) { // Peer removed.
    return;
  }

  if (!peers[peerName].iceCandidateIdsProcessed) {
    peers[peerName].iceCandidateIdsProcessed = [];
  }

  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/ice_candidates/' + peerName)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    var anyNew = false;
    data.ice_candidate_ids.forEach(candidateId => {
      if (!peers[peerName].iceCandidateIdsProcessed.includes(candidateId)) {
        anyNew = true;
        peers[peerName].iceCandidateIdsProcessed.push(candidateId);
        getIceCandidateData(peerName, candidateId);
      }
    });
    window.setTimeout(() => pollForIceCandidates(peerName, Math.min(anyNew ? delayMs : delayMs + 100, 5000)), delayMs)
  }).catch(err => {
    window.setTimeout(() => pollForIceCandidates(peerName, delayMs), delayMs)
    console.log("Error polling for ice candidate from " + peerName, err);
  });
}

function pollForOfferFrom(peerName) {
  if (!(peerName in peers)) { // Peer removed.
    return;
  }
  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/offers/' + peerName)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    console.log('Got offer from ' + peerName);
    peers[peerName].status = 'answering';
    let peerConn = peers[peerName].peerConn || new RTCPeerConnection(peerConnConfig);
    if (!peers[peerName].peerConn) {
      peerConn.ondatachannel = event => {
        console.log("ondatachannel", event);
        peers[peerName].dataChan           = event.channel;
        peers[peerName].dataChan.onmessage = makeOnMessageHandler(peerName);
        peers[peerName].dataChan.onopen    = event => console.log("Channel opened to " + peerName);
        peers[peerName].dataChan.onclose   = event => console.log("Channel closed to " + peerName);
      };
      peerConn.onicecandidate  = makeOnIceCandidateHandler(peerName);
      peerConn.oniceconnectionstatechange = _ => {
        iceLog += (new Date()).toISOString() + "      " + peerName + " ICE state " + peerConn.iceConnectionState + "\n";
      };
      peerConn.addEventListener("icecandidateerror", (event) => {
        if (event.errorCode === 701) {
          console.error("icecandidateerror " + peerName + " " + event.url + " " + event.errorText);
          iceLog += (new Date()).toISOString() + "      " + peerName + " ICE icecandidateerror 701 " + " " + event.url + " " + event.errorText + "\n";
        }
      });
      peerConn.addTrack(myFaceStream.getVideoTracks()[0], myVidStream);
      peerConn.addTrack(myVidStream.getAudioTracks()[0], myVidStream);
      peers[peerName].peerConn = peerConn;
    }
    peerConn.ontrack = makeOnTrackHandler(peerName);
    window.setTimeout(() => pollForIceCandidates(peerName, 100), 100);
    peerConn.setRemoteDescription(new RTCSessionDescription(data));
    peerConn.createAnswer()
    .then(localConnDesc => {
      console.log("createAnswer localConnDesc");
      console.log(localConnDesc);
      peerConn.setLocalDescription(localConnDesc);
      return fetch('/rooms/' + roomName + '/peers/' + peerName + '/answers/' + myPeerName, {
        method: 'POST',
        body: JSON.stringify(localConnDesc),
        headers: { 'Content-Type': 'application/json' }
      });
    })
    .then(resp => resp.ok ? resp :  Promise.reject(resp))
    .catch(err => {
        console.error('Error responding to offer', err)
        pollForOfferFrom(peerName)
    });
  }).catch(err => {
    console.log('Waiting for offer from ' + peerName, err);
    window.setTimeout(() => pollForOfferFrom(peerName), 1000);
  });
}

function pollForPeers() {
  fetch('/rooms/' + roomName + '/peers')
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    // console.log(data);
    if (!data.peers.includes(myPeerName)) {
      // We lost connection at some point. Need to renegotiate.
      window.location.reload();
    }
    data.peers.forEach(peerName => {
      if (!(peerName in peers)) {
        peers[peerName] = { status: 'new' };
      }
    });
    Object.keys(peers).subtract(data.peers).forEach(removePeer);
    for (const peerName in peers) {
      // 3. When a peer is listed that you haven't connected to, it is the
      //   responsibility of the lexigraphically lower peer_name to offer, so:

      if (peers[peerName].status === 'new') {
        // 4a. If other_peer_name < my_peer_name, then:
        //   (i)  Post my JSON RTCPeerConnectionDescription offer to
        //        /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/offers/MY_PEER_NAME
        //   (ii) Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/answers/OTHER_PEER_NAME
        //        for the answering description
        if (peerName < myPeerName) {
          // makeOfferTo(peerName);
          peers[peerName].status = 'offering';
          let peerConn = peers[peerName].peerConn || new RTCPeerConnection(peerConnConfig);
          if (!peers[peerName].peerConn) {
            let dataChan             = peerConn.createDataChannel('channel to ' + peerName, { ordered: true, maxRetransmits: 0 });
            console.log(dataChan);
            dataChan.onmessage       = makeOnMessageHandler(peerName);
            dataChan.onopen          = event => console.log("Channel opened to " + peerName);
            dataChan.onclose         = event => console.log("Channel closed to " + peerName);
            peers[peerName].dataChan = dataChan;
            peerConn.onicecandidate = makeOnIceCandidateHandler(peerName);
            peerConn.oniceconnectionstatechange = _ => {
              iceLog += (new Date()).toISOString() + "      " + peerName + " ICE state " + peerConn.iceConnectionState + "\n";
            };
            peerConn.addEventListener("icecandidateerror", (event) => {
              if (event.errorCode === 701) {
                console.error("icecandidateerror " + peerName + " " + event.url + " " + event.errorText);
                iceLog += (new Date()).toISOString() + "      " + peerName + " ICE icecandidateerror 701 " + " " + event.url + " " + event.errorText + "\n";
              }
            });
            peerConn.addTrack(myFaceStream.getVideoTracks()[0], myVidStream);
            peerConn.addTrack(myVidStream.getAudioTracks()[0], myVidStream);
            peers[peerName].peerConn = peerConn;
          }
          peerConn
            .createOffer({
              offerToReceiveAudio: 1,
              offerToReceiveVideo: 1,
              voiceActivityDetection: true
            })
            .then(localConnDesc => {
              // console.log(localConnDesc);
              // console.log(localConnDesc.type);
              // console.log(localConnDesc.sdp);
              peerConn.setLocalDescription(localConnDesc);
              return fetch('/rooms/' + roomName + '/peers/' + peerName + '/offers/' + myPeerName, {
                method: 'POST',
                body: JSON.stringify(localConnDesc),
                headers: { 'Content-Type': 'application/json' }
              });
            }).then(resp => resp.ok ? resp :  Promise.reject(resp))
            .then(resp => {
              console.log(resp);
              window.setTimeout(() => pollForAnswerFrom(peerName), 1000);
            }).catch(err => {
              console.error("Offer to " + peerName + " failed", err);
              peers[peerName].status = 'new';
            });

        } else if (peerName > myPeerName) {
          // 4b. If other_peer_name > my_peer_name, then:
          //   (i)  Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/offers/OTHER_PEER_NAME for the offer
          //   (ii) Post my JSON RTCPeerConnectionDescription answer to
          //       /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/answers/MY_PEER_NAME
          peers[peerName].status = 'waiting for offer';
          pollForOfferFrom(peerName);
        }
      }
    }
    window.setTimeout(pollForPeers, 3000)
  }).catch(err => {
    console.warn('Peers polling failure', err);
    window.setTimeout(pollForPeers, 3000);
  });

  // Ensure low bitrate.
  for (const peerName in peers) {
    if (peers[peerName].peerConn) {
      // Set to 60kbps video
      // console.log(peers[peerName].peerConn.getSenders());
      peers[peerName].peerConn.getSenders().forEach(sender => {
        if (sender.track.kind === "video") {
          let params = sender.getParameters();
          params.encodings[0].maxBitrate = 60*1000;
          sender.setParameters(params);
        }
      });
    }
  }
}

function removePeer(peerName) {
  let peer = peers[peerName];
  if (peer.peerConn) {
    try {
      peer.status = 'gone';
      peer.peerConn.close();
      if (peer.vidElem) { peer.vidElem.remove(); }
    } catch (err) {
      console.warn("Error removing peer ", err);
    }
  }
  delete peers[peerName];

  if (window.removePeerFromGame) {
    removePeerFromGame(peerName);
  }
}

// window.opencvDownloaded
function setupOpenCV() {
  if (window.opencvDownloaded) {
    window.faceDetectionWorker = new Worker("/static/js/face_detection_worker.js");
    window.faceDetectionWorker.addEventListener("message", ({ data }) => {
      // console.log(data);
      if (data.type === "ready") {
        askForFaceDetection();
      } else if (data.type === "faceLocation") {

        targetFaceCX    = data.location.faceCX;
        targetFaceCY    = data.location.faceCY;
        targetFaceSize  = Math.round(data.location.faceSize * (gameState?.globals?.faceSizeMultiplier || 1.0));

        window.setTimeout(askForFaceDetection, 0.2*1000);
      } else if (data.type === "noFace") {
        window.setTimeout(askForFaceDetection, 0.2*1000);
      } else if (data.type === "error") {
        window.setTimeout(askForFaceDetection, 5*1000);
      }
    });
  } else {
    window.setTimeout(setupOpenCV, 50);
  }
}


function askForFaceDetection() {
  if (!myVid.paused) {
    myVidCanvasCtx.drawImage(myVid, 0, 0, myVidCanvas.width, myVidCanvas.height);
    faceDetectionWorker.postMessage({
      type      : 'detect',
      imageData : myVidCanvasCtx.getImageData(0, 0, myVidCanvas.width, myVidCanvas.height)
    });
  } else {
    window.setTimeout(askForFaceDetection, 0.5*1000);
  }
}


// this.mic = this.context.createMediaStreamSource(stream);
// this.mic.connect(this.script);
// // necessary to make sample run, but should not be.
// this.script.connect(this.context.destination);

let soundLevelsRingBuffer = Array(20).fill(0); /* 10 * 2048 = 20480 ~ half a second */
var soundLevelsRingI      = 0;
// let soundLevelElem        = document.getElementById("soundLevel");
// let soundMinElem          = document.getElementById("soundMin");
var quarterSecondMeanSoundLevel = 0;
var quarterSecondMinSoundLevel  = 0;
var quarterSecondMaxSoundLevel  = 0;
// START HERE hook up to game. (Players shake when grrring.)

function setupSoundMeter(stream) {
  let context = new AudioContext();
  let source = context.createMediaStreamSource(stream);
  let processor = context.createScriptProcessor(512, 1, 1);

  source.connect(processor);
  processor.connect(context.destination);
  processor.onaudioprocess = function (event) {
    let samples     = event.inputBuffer.getChannelData(0);
    let sampleCount = samples.length;
    let total       = 0;

    for (var i = 0; i < sampleCount; i++) {
      total += Math.abs(samples[i]);
    }

    soundLevelsRingBuffer[soundLevelsRingI] = Math.sqrt(total / sampleCount);
    soundLevelsRingI = (soundLevelsRingI + 1) % soundLevelsRingBuffer.length;
  };

  let updateLevels = () => {
    quarterSecondMeanSoundLevel = soundLevelsRingBuffer.reduce( (a, b) => a + b ) / soundLevelsRingBuffer.length;
    quarterSecondMinSoundLevel  = soundLevelsRingBuffer.reduce( (a, b) => Math.min(a,b) );
    quarterSecondMaxSoundLevel  = soundLevelsRingBuffer.reduce( (a, b) => Math.max(a,b) );

    // soundLevelElem.innerText = "" + quarterSecondMeanSoundLevel;
    // soundMinElem.innerText = "" + quarterSecondMinSoundLevel;

    window.setTimeout(updateLevels, 50);
  }
  window.setTimeout(updateLevels, 50);
}

function waitForOpenCVThenGo() {
  if (window.opencvDownloaded) {
    loadingElem.remove();

    navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: { width: 384, height: 288 } })
    .then(stream => {
      myVidStream               = stream;
      myWidth                   = stream.getVideoTracks()[0].getSettings().width;
      myHeight                  = stream.getVideoTracks()[0].getSettings().height;
      myVid.width               = myWidth;
      myVid.height              = myHeight;
      myVid.srcObject           = stream;
      myVidCanvas.width         = myWidth;
      myVidCanvas.height        = myHeight;
      myVidCanvas.style.display = 'none';
      document.body.appendChild(myVidCanvas);
      myVidCanvasCtx            = myVidCanvas.getContext('2d');
      faceCX                    = myWidth / 2;
      faceCY                    = myHeight / 2;
      faceSize                  = Math.min(myWidth, myHeight);
      targetFaceCX              = faceCX;
      targetFaceCY              = faceCY;
      targetFaceSize            = faceSize;
      console.log(stream.getVideoTracks()[0].getSettings())
      console.log(stream.getAudioTracks()[0].getSettings())

      setupSoundMeter(stream);

      myVid.play();
    }).catch(e => console.error('getUserMedia: ', e));
  } else {
    window.setTimeout(waitForOpenCVThenGo, 50);
  }
}

function updateDebugInfo() {
  var debugText = "";

  debugText += "ICE connection states:\n";
  for (const peerName in peers) {
    if (peers[peerName].peerConn) {
      debugText += peerName + ": " + peers[peerName].peerConn.iceConnectionState + "\n";
    }
  }

  debugText += "\n";
  debugText += "ICE log:\n";
  debugText += iceLog;

  debugInfoElem.innerText = debugText;

  if (debugInfo.style.display === "block") {
    window.setTimeout(updateDebugInfo, 1000);
  }
}

window.addEventListener('DOMContentLoaded', (event) => {
  debugInfo.style.display = "none";

  debugInfoButton.addEventListener("click", event => {
    if (debugInfo.style.display === "none") {
      debugInfo.style.display = "block";
      debugInfoButton.innerText = "Hide Debug Info";
      updateDebugInfo();
    } else {
      debugInfo.style.display = "none";
      debugInfoButton.innerText = "Show Debug Info";
    }
  });

  document.querySelectorAll("a.inviteLink").forEach(elem => {
    elem.href      = window.location.href;
    elem.innerHTML = elem.href;
  });

  let myFaceCtx = myFaceCanvas.getContext('2d');
  myFaceStream = myFaceCanvas.captureStream(15);

  myVid.addEventListener('playing', () => {
    function drawFace() {
      // myCtx.drawImage(myVid, 0, 0);

      minDim = Math.min(myWidth, myHeight)

      dist = ((targetFaceCX - faceCX)**2 + (targetFaceCY - faceCY)**2 + (targetFaceSize - faceSize)**2)**0.5 / faceSize
      push = Math.min(dist*0.5, 1.0);
      faceCX   = (1.0 - push)*faceCX + push*targetFaceCX;
      faceCY   = (1.0 - push)*faceCY + push*targetFaceCY;
      faceSize = (1.0 - push)*faceSize + push*targetFaceSize;

      myFaceCtx.drawImage(myVid, faceCX - faceSize/2, faceCY - faceSize/2, faceSize, faceSize, 0, 0, miniFaceSize, miniFaceSize);

      // window.setTimeout(drawFace, 1000 / 60);
      window.setTimeout(drawFace, 1000 / 40);
    }

    window.setTimeout(drawFace, 100);
    // window.setTimeout(faceDetect, 500);
    acquirePeerName();
  });

  setupOpenCV();
  waitForOpenCVThenGo();
});

